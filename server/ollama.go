package biggie

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

type ModelRequest struct {
	Model       string
	Purpose     string
	Messages    []NormalizedMessage
	NumCtx      int
	NumPredict  int
	Temperature float64
	JSONFormat  bool
	Think       *bool
}

type ModelClient interface {
	Chat(context.Context, ModelRequest) (string, error)
	Healthy(context.Context) error
}

type OllamaClient struct {
	Host   string
	Client *http.Client
}

func NewOllamaClient(host string, timeout time.Duration) *OllamaClient {
	return &OllamaClient{Host: strings.TrimRight(host, "/"), Client: &http.Client{Timeout: timeout}}
}

func (o *OllamaClient) Chat(ctx context.Context, request ModelRequest) (string, error) {
	started := time.Now()
	payload := map[string]any{
		"model": request.Model, "messages": request.Messages, "stream": false,
		"keep_alive": "30m",
		"options":    map[string]any{"num_ctx": request.NumCtx, "num_predict": request.NumPredict, "temperature": request.Temperature},
	}
	if request.JSONFormat {
		payload["format"] = "json"
	}
	if request.Think != nil {
		payload["think"] = *request.Think
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, o.Host+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpRequest.Header.Set("content-type", "application/json")
	response, err := o.Client.Do(httpRequest)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		return "", fmt.Errorf("ollama HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(message)))
	}
	var result struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		DoneReason         string `json:"done_reason"`
		TotalDuration      int64  `json:"total_duration"`
		LoadDuration       int64  `json:"load_duration"`
		PromptEvalCount    int    `json:"prompt_eval_count"`
		PromptEvalDuration int64  `json:"prompt_eval_duration"`
		EvalCount          int    `json:"eval_count"`
		EvalDuration       int64  `json:"eval_duration"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return "", err
	}
	purpose := request.Purpose
	if purpose == "" {
		purpose = "chat"
	}
	log.Printf("ollama phase=%s wall=%s total=%s load=%s prompt_tokens=%d prompt_eval=%s eval_tokens=%d eval=%s done=%s",
		purpose, time.Since(started).Round(time.Millisecond), time.Duration(result.TotalDuration).Round(time.Millisecond),
		time.Duration(result.LoadDuration).Round(time.Millisecond), result.PromptEvalCount,
		time.Duration(result.PromptEvalDuration).Round(time.Millisecond), result.EvalCount,
		time.Duration(result.EvalDuration).Round(time.Millisecond), result.DoneReason)
	return result.Message.Content, nil
}

func (o *OllamaClient) Healthy(ctx context.Context) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, o.Host+"/api/tags", nil)
	if err != nil {
		return err
	}
	response, err := o.Client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("ollama HTTP %d", response.StatusCode)
	}
	return nil
}
