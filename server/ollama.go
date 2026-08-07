package biggie

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type ModelRequest struct {
	Model       string
	Messages    []NormalizedMessage
	NumCtx      int
	NumPredict  int
	Temperature float64
	JSONFormat  bool
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
	payload := map[string]any{
		"model": request.Model, "messages": request.Messages, "stream": false,
		"keep_alive": "30m",
		"options":    map[string]any{"num_ctx": request.NumCtx, "num_predict": request.NumPredict, "temperature": request.Temperature},
	}
	if request.JSONFormat {
		payload["format"] = "json"
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
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return "", err
	}
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
