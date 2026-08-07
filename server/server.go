package biggie

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Server struct {
	cfg      Config
	engine   *Engine
	limiter  *HourlyLimiter
	flight   *SingleFlight
	throttle *Throttle
}

func NewServer(cfg Config, model ModelClient) *Server {
	return &Server{cfg: cfg, engine: NewEngine(cfg, model), limiter: NewHourlyLimiter(cfg.RequestsPerHour, cfg.TokensPerHour), flight: &SingleFlight{}, throttle: NewThrottle(cfg.BytesPerSecond)}
}

func (s *Server) Handler() http.Handler { return http.HandlerFunc(s.serveHTTP) }

func cors(headers http.Header) {
	headers.Set("access-control-allow-origin", "*")
	headers.Set("access-control-allow-headers", "*")
	headers.Set("access-control-allow-methods", "GET, POST, OPTIONS")
}

func (s *Server) writeBytes(ctx context.Context, w http.ResponseWriter, status int, contentType string, body []byte) {
	cors(w.Header())
	w.Header().Set("content-type", contentType)
	w.Header().Set("content-length", strconv.Itoa(len(body)))
	w.Header().Set("x-biggie-context-window", strconv.FormatInt(ContextWindow, 10))
	w.WriteHeader(status)
	_ = s.throttle.Wait(ctx, len(body))
	_, _ = w.Write(body)
}
func (s *Server) writeJSON(ctx context.Context, w http.ResponseWriter, status int, payload any) {
	body, _ := json.Marshal(payload)
	s.writeBytes(ctx, w, status, "application/json; charset=utf-8", body)
}
func apiError(message, kind string) map[string]any {
	return map[string]any{"error": map[string]any{"message": message, "type": kind, "code": kind}}
}

func clientIP(request *http.Request) string {
	if value := strings.TrimSpace(request.Header.Get("cf-connecting-ip")); value != "" {
		return value
	}
	if value := strings.TrimSpace(request.Header.Get("x-forwarded-for")); value != "" {
		return strings.TrimSpace(strings.Split(value, ",")[0])
	}
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		return host
	}
	return request.RemoteAddr
}

func setRateHeaders(headers http.Header, info RateInfo) {
	headers.Set("retry-after", strconv.FormatInt(info.ResetSeconds, 10))
	headers.Set("x-ratelimit-limit-requests", strconv.Itoa(info.RequestsLimit))
	headers.Set("x-ratelimit-remaining-requests", strconv.Itoa(max(0, info.RequestsLimit-info.RequestsUsed)))
	headers.Set("x-ratelimit-limit-tokens", strconv.FormatInt(info.TokensLimit, 10))
	headers.Set("x-ratelimit-remaining-tokens", strconv.FormatInt(info.TokensRemaining, 10))
	headers.Set("x-ratelimit-reset", strconv.FormatInt(info.ResetSeconds, 10))
}

func (s *Server) serveHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		cors(w.Header())
		w.WriteHeader(http.StatusNoContent)
		return
	}
	switch {
	case r.Method == http.MethodGet && (r.URL.Path == "/" || r.URL.Path == "/index.html"):
		w.Header().Set("cache-control", "public, max-age=60")
		s.writeBytes(r.Context(), w, 200, "text/html; charset=utf-8", []byte(LandingHTML))
		return
	case r.Method == http.MethodGet && r.URL.Path == "/favicon.svg":
		w.Header().Set("cache-control", "public, max-age=86400")
		s.writeBytes(r.Context(), w, 200, "image/svg+xml", []byte(FaviconSVG))
		return
	case r.Method == http.MethodGet && r.URL.Path == "/logo-loop.mp4":
		w.Header().Set("cache-control", "public, max-age=31536000, immutable")
		s.writeBytes(r.Context(), w, 200, "video/mp4", LogoLoopMP4)
		return
	case r.Method == http.MethodGet && r.URL.Path == "/logo-loop.webp":
		w.Header().Set("cache-control", "public, max-age=31536000, immutable")
		s.writeBytes(r.Context(), w, 200, "image/webp", LogoLoopPoster)
		return
	case r.Method == http.MethodGet && r.URL.Path == "/health":
		s.health(w, r)
		return
	case r.Method == http.MethodPost && r.URL.Path == "/v1/chat/completions":
		s.chat(w, r)
		return
	default:
		s.writeJSON(r.Context(), w, 404, apiError("only GET /, GET /health, and POST /v1/chat/completions", "not_found"))
	}
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	err := s.engine.Model.Healthy(ctx)
	status := 200
	state := "ok"
	if err != nil {
		status = 503
		state = "degraded"
	}
	payload := map[string]any{"status": state, "product": Product, "context_window": ContextWindow, "ready": err == nil, "stream": true, "reasoning": true, "limits": map[string]any{"req_per_hour": s.cfg.RequestsPerHour, "tokens_per_hour": s.cfg.TokensPerHour, "max_request_bytes": s.cfg.MaxRequestBytes, "bytes_per_sec": s.cfg.BytesPerSecond, "global_concurrency": 1, "auth": "none"}, "busy": s.flight.Busy()}
	s.writeJSON(r.Context(), w, status, payload)
}

func (s *Server) decodeBody(w http.ResponseWriter, r *http.Request) (ChatRequest, error) {
	if r.ContentLength > s.cfg.MaxRequestBytes {
		return ChatRequest{}, fmt.Errorf("body exceeds max_request_bytes (%d)", s.cfg.MaxRequestBytes)
	}
	limited := http.MaxBytesReader(w, r.Body, s.cfg.MaxRequestBytes)
	defer limited.Close()
	decoder := json.NewDecoder(throttledReader{ctx: r.Context(), r: limited, t: s.throttle})
	decoder.UseNumber()
	var body ChatRequest
	if err := decoder.Decode(&body); err != nil {
		return ChatRequest{}, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return ChatRequest{}, errors.New("body must contain one JSON object")
	}
	return body, nil
}

func (s *Server) chat(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if r.ContentLength > 0 {
		// Content-Length includes JSON framing, so it cannot accurately represent
		// message tokens at the 1B boundary. Reserve only the request slot here;
		// enforce the exact content-derived token budget after streaming decode.
		if ok, reason, info := s.limiter.Check(ip, 0); !ok {
			setRateHeaders(w.Header(), info)
			s.writeJSON(r.Context(), w, 429, apiError("hourly budget exceeded", reason))
			return
		}
	}
	body, err := s.decodeBody(w, r)
	if err != nil {
		status := 400
		kind := "bad_request"
		if strings.Contains(err.Error(), "request body too large") || strings.Contains(err.Error(), "max_request_bytes") {
			status = 413
			kind = "payload_too_large"
		}
		s.writeJSON(r.Context(), w, status, apiError(err.Error(), kind))
		return
	}
	messages, err := NormalizeMessages(body.Messages)
	if err != nil {
		s.writeJSON(r.Context(), w, 400, apiError(err.Error(), "bad_request"))
		return
	}
	var tokens int64
	for _, message := range messages {
		tokens += EstimateTokens(message.Content)
	}
	if ok, reason, info := s.limiter.Check(ip, tokens); !ok {
		setRateHeaders(w.Header(), info)
		s.writeJSON(r.Context(), w, 429, apiError("hourly budget exceeded", reason))
		return
	}
	holder := ip + ":" + randomID()
	if !s.flight.Acquire(holder) {
		w.Header().Set("retry-after", "5")
		s.writeJSON(r.Context(), w, 503, apiError("one request is already in flight; retry shortly", "server_busy"))
		return
	}
	defer s.flight.Release(holder)
	if body.Stream {
		s.streamChat(w, r, body, tokens)
		return
	}
	result, err := s.engine.Complete(r.Context(), body, nil)
	if err != nil {
		s.writeJSON(r.Context(), w, 502, apiError(err.Error(), "upstream_error"))
		return
	}
	rate := s.limiter.Commit(ip, result.Usage.PromptTokens)
	setRateHeaders(w.Header(), rate)
	s.writeJSON(r.Context(), w, 200, OpenAIResponse(result))
}

func writeSSE(w http.ResponseWriter, payload any) error {
	var line []byte
	if text, ok := payload.(string); ok && text == "[DONE]" {
		line = []byte("data: [DONE]\n\n")
	} else {
		body, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		line = append([]byte("data: "), body...)
		line = append(line, '\n', '\n')
	}
	_, err := w.Write(line)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	return err
}

func chunk(id, model string, created int64, delta map[string]any, finish any, usage any) map[string]any {
	payload := map[string]any{"id": id, "object": "chat.completion.chunk", "created": created, "model": model, "choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}}
	if usage != nil {
		payload["usage"] = usage
	}
	return payload
}

func (s *Server) streamChat(w http.ResponseWriter, r *http.Request, body ChatRequest, fallbackTokens int64) {
	cors(w.Header())
	w.Header().Set("content-type", "text/event-stream; charset=utf-8")
	w.Header().Set("cache-control", "no-cache, no-transform")
	w.Header().Set("connection", "keep-alive")
	w.Header().Set("x-accel-buffering", "no")
	w.Header().Set("x-biggie-context-window", strconv.FormatInt(ContextWindow, 10))
	w.WriteHeader(200)
	model := body.Model
	if strings.TrimSpace(model) == "" {
		model = Product
	}
	id := randomID()
	created := time.Now().Unix()
	_ = writeSSE(w, chunk(id, model, created, map[string]any{"role": "assistant"}, nil, nil))
	reasoningSink := func(piece string) error {
		return writeSSE(w, chunk(id, model, time.Now().Unix(), map[string]any{"reasoning_content": piece}, nil, nil))
	}
	contentSink := func(piece string) error {
		return writeSSE(w, chunk(id, model, time.Now().Unix(), map[string]any{"content": piece}, nil, nil))
	}
	result, err := s.engine.complete(r.Context(), body, CompletionSinks{Reasoning: reasoningSink, Content: contentSink}, id)
	if err != nil {
		s.limiter.Commit(clientIP(r), fallbackTokens)
		log.Printf("stream completion failed: %v", err)
		_ = writeSSE(w, map[string]any{"error": map[string]any{"message": "upstream request failed", "type": "upstream_error", "code": "upstream_error"}})
		_ = writeSSE(w, "[DONE]")
		return
	}
	if !result.ContentStreamed {
		for _, piece := range ChunkText(result.Content, 32) {
			_ = writeSSE(w, chunk(id, result.Model, time.Now().Unix(), map[string]any{"content": piece}, nil, nil))
		}
	}
	billed := result.Usage.PromptTokens
	if billed == 0 {
		billed = fallbackTokens
	}
	rate := s.limiter.Commit(clientIP(r), billed)
	setRateHeaders(w.Header(), rate)
	_ = writeSSE(w, chunk(id, result.Model, time.Now().Unix(), map[string]any{}, "stop", result.Usage))
	_ = writeSSE(w, "[DONE]")
}

func ChunkText(text string, maxBytes int) []string {
	if text == "" {
		return nil
	}
	var parts []string
	start := 0
	for i := range text {
		if i-start >= maxBytes && (text[i] == ' ' || text[i] == '\n' || text[i] == '\t') {
			parts = append(parts, text[start:i+1])
			start = i + 1
		}
	}
	if start < len(text) {
		parts = append(parts, text[start:])
	}
	return parts
}

func (s *Server) ListenAndServe() error {
	server := &http.Server{Addr: net.JoinHostPort(s.cfg.Listen, strconv.Itoa(s.cfg.Port)), Handler: s.Handler(), ReadHeaderTimeout: 15 * time.Second, IdleTimeout: 120 * time.Second, MaxHeaderBytes: 1 << 20}
	return server.ListenAndServe()
}
