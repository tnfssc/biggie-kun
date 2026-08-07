package biggie

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

type scriptedModel struct {
	mu        sync.Mutex
	responses []string
	requests  []ModelRequest
}

func (m *scriptedModel) Chat(_ context.Context, request ModelRequest) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.requests = append(m.requests, request)
	if len(m.responses) == 0 {
		return "", io.ErrUnexpectedEOF
	}
	response := m.responses[0]
	m.responses = m.responses[1:]
	return response, nil
}
func (m *scriptedModel) Healthy(context.Context) error { return nil }

func testConfig() Config {
	cfg := DefaultConfig()
	cfg.BytesPerSecond = 1 << 30
	cfg.RequestsPerHour = 100
	cfg.MaxRequestBytes = 8 << 20
	return cfg
}

func TestChunkedChatRequest(t *testing.T) {
	model := &scriptedModel{responses: []string{"04:30 UTC", "04:30 UTC"}}
	server := NewServer(testConfig(), model)
	body := `{"model":"biggie-kun","include_reasoning":false,"messages":[{"role":"user","content":"Launch is 04:30 UTC."},{"role":"user","content":"When is launch?"}]}`
	reader, writer := io.Pipe()
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", reader)
	request.Header.Set("content-type", "application/json")
	request.ContentLength = -1 // Force Transfer-Encoding: chunked semantics.
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = io.Copy(writer, strings.NewReader(body))
		_ = writer.Close()
	}()
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	<-done
	if recorder.Code != http.StatusOK {
		t.Fatalf("chunked request failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response["object"] != "chat.completion" {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestStreamingEmitsReasoningOnEveryAgentTurn(t *testing.T) {
	model := &scriptedModel{responses: []string{
		`{"action":"search","queries":["CASE-Z9Q7"],"top_k":12}`,
		`{"action":"read","result_ids":["s1r1"],"neighbors":0}`,
		`{"action":"finish","answer":"CODE-ORANGE99","evidence_ids":["e1"]}`,
		"CODE-ORANGE99",
		"The matching record gives the requested code.",
	}}
	cfg := testConfig()
	cfg.DirectTokenThreshold = 1
	server := NewServer(cfg, model)
	document := strings.Repeat("ordinary filler\n", 3000) + "CASE-Z9Q7 has CODE-ORANGE99\n"
	payload, _ := json.Marshal(ChatRequest{Model: Product, Stream: true, Messages: []Message{
		{Role: "user", Content: document}, {Role: "user", Content: "What code belongs to CASE-Z9Q7?"},
	}})
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(payload))
	request.Header.Set("content-type", "application/json")
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("stream failed: %d %s", recorder.Code, recorder.Body.String())
	}
	stream := recorder.Body.String()
	if count := strings.Count(stream, `"reasoning_content"`); count < 3 {
		t.Fatalf("wanted progressive reasoning across agent turns, got %d chunks:\n%s", count, stream)
	}
	if reasoningAt, contentAt := strings.Index(stream, `"reasoning_content"`), strings.Index(stream, `"content"`); reasoningAt < 0 || contentAt < 0 || reasoningAt > contentAt {
		t.Fatalf("reasoning must stream before answer content:\n%s", stream)
	}
	if !strings.Contains(stream, "CODE-ORANGE99") || !strings.HasSuffix(stream, "data: [DONE]\n\n") {
		t.Fatalf("incomplete stream:\n%s", stream)
	}
}

func TestParseActionWithTrailingText(t *testing.T) {
	action, ok := ParseAction("note\n{\"action\":\"search\",\"queries\":[\"KEY\"]}\ntrailing")
	if !ok || action.Action != "search" || len(action.Queries) != 1 {
		t.Fatalf("failed to recover action: %#v %v", action, ok)
	}
}

func TestCompletionsAreStatelessAndHealthIsOpaque(t *testing.T) {
	model := &scriptedModel{responses: []string{"CODE-ORANGE99", "CODE-ORANGE99", "I do not know.", "I cannot find that in the provided context."}}
	server := NewServer(testConfig(), model)
	firstBody := `{"model":"biggie-kun","include_reasoning":false,"messages":[{"role":"user","content":"The secret is CODE-ORANGE99."},{"role":"user","content":"What is the secret?"}]}`
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(firstBody))
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("first completion failed: %d %s", recorder.Code, recorder.Body.String())
	}
	secondBody := `{"model":"biggie-kun","include_reasoning":false,"messages":[{"role":"user","content":"What is the secret?"}]}`
	secondRequest := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(secondBody))
	secondRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(secondRecorder, secondRequest)
	if secondRecorder.Code != http.StatusOK {
		t.Fatalf("second completion failed: %d %s", secondRecorder.Code, secondRecorder.Body.String())
	}
	model.mu.Lock()
	secondPrompt := model.requests[2].Messages[1].Content
	model.mu.Unlock()
	if strings.Contains(secondPrompt, "CODE-ORANGE99") {
		t.Fatalf("second request inherited the first request context: %s", secondPrompt)
	}
	healthRequest := httptest.NewRequest(http.MethodGet, "/health", nil)
	healthRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(healthRecorder, healthRequest)
	if healthRecorder.Code != http.StatusOK || strings.Contains(strings.ToLower(healthRecorder.Body.String()), "ollama") {
		t.Fatalf("health exposed implementation state: %d %s", healthRecorder.Code, healthRecorder.Body.String())
	}
}

func TestLandingServesSilentLogoLoop(t *testing.T) {
	server := NewServer(testConfig(), &scriptedModel{})
	pageRequest := httptest.NewRequest(http.MethodGet, "/", nil)
	pageRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(pageRecorder, pageRequest)
	page := pageRecorder.Body.String()
	for _, expected := range []string{"autoplay muted loop playsinline", `poster="/logo-loop.webp"`, "prefers-reduced-motion"} {
		if !strings.Contains(page, expected) {
			t.Fatalf("landing page missing %q", expected)
		}
	}
	videoRequest := httptest.NewRequest(http.MethodGet, "/logo-loop.mp4", nil)
	videoRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(videoRecorder, videoRequest)
	if videoRecorder.Code != http.StatusOK || videoRecorder.Header().Get("content-type") != "video/mp4" || videoRecorder.Body.Len() < 300_000 {
		t.Fatalf("logo video not served correctly: status=%d type=%q bytes=%d", videoRecorder.Code, videoRecorder.Header().Get("content-type"), videoRecorder.Body.Len())
	}
}
