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

type StreamingModelClient interface {
	ChatStream(context.Context, ModelRequest, func(string) error) error
}

type ollamaResult struct {
	Message struct {
		Content string `json:"content"`
	} `json:"message"`
	Error              string `json:"error"`
	Done               bool   `json:"done"`
	DoneReason         string `json:"done_reason"`
	TotalDuration      int64  `json:"total_duration"`
	LoadDuration       int64  `json:"load_duration"`
	PromptEvalCount    int    `json:"prompt_eval_count"`
	PromptEvalDuration int64  `json:"prompt_eval_duration"`
	EvalCount          int    `json:"eval_count"`
	EvalDuration       int64  `json:"eval_duration"`
}

type OllamaClient struct {
	Host   string
	Client *http.Client
}

func NewOllamaClient(host string, timeout time.Duration) *OllamaClient {
	return &OllamaClient{Host: strings.TrimRight(host, "/"), Client: &http.Client{Timeout: timeout}}
}

func ollamaPayload(request ModelRequest, stream bool) map[string]any {
	payload := map[string]any{
		"model": request.Model, "messages": request.Messages, "stream": stream,
		"keep_alive": "30m",
		"options":    map[string]any{"num_ctx": request.NumCtx, "num_predict": request.NumPredict, "temperature": request.Temperature},
	}
	if request.JSONFormat {
		payload["format"] = "json"
	}
	if request.Think != nil {
		payload["think"] = *request.Think
	}
	return payload
}

func (o *OllamaClient) doChat(ctx context.Context, request ModelRequest, stream bool) (*http.Response, error) {
	payload := ollamaPayload(request, stream)
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, o.Host+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpRequest.Header.Set("content-type", "application/json")
	response, err := o.Client.Do(httpRequest)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer response.Body.Close()
		message, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		return nil, fmt.Errorf("ollama HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(message)))
	}
	return response, nil
}

func logOllama(request ModelRequest, started time.Time, result ollamaResult) {
	purpose := request.Purpose
	if purpose == "" {
		purpose = "chat"
	}
	log.Printf("ollama phase=%s wall=%s total=%s load=%s prompt_tokens=%d prompt_eval=%s eval_tokens=%d eval=%s done=%s",
		purpose, time.Since(started).Round(time.Millisecond), time.Duration(result.TotalDuration).Round(time.Millisecond),
		time.Duration(result.LoadDuration).Round(time.Millisecond), result.PromptEvalCount,
		time.Duration(result.PromptEvalDuration).Round(time.Millisecond), result.EvalCount,
		time.Duration(result.EvalDuration).Round(time.Millisecond), result.DoneReason)
}

func (o *OllamaClient) Chat(ctx context.Context, request ModelRequest) (string, error) {
	started := time.Now()
	response, err := o.doChat(ctx, request, false)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	var result ollamaResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return "", err
	}
	logOllama(request, started, result)
	return result.Message.Content, nil
}

func (o *OllamaClient) ChatStream(ctx context.Context, request ModelRequest, emit func(string) error) error {
	started := time.Now()
	response, err := o.doChat(ctx, request, true)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	decoder := json.NewDecoder(response.Body)
	for {
		var result ollamaResult
		if err := decoder.Decode(&result); err != nil {
			if err == io.EOF {
				return io.ErrUnexpectedEOF
			}
			return err
		}
		if result.Error != "" {
			return fmt.Errorf("ollama stream: %s", result.Error)
		}
		if result.Message.Content != "" {
			if err := emit(result.Message.Content); err != nil {
				return err
			}
		}
		if result.Done {
			logOllama(request, started, result)
			if result.DoneReason != "stop" {
				return fmt.Errorf("ollama stopped before completion: %s", result.DoneReason)
			}
			return nil
		}
	}
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
