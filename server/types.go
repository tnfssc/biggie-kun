package biggie

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type Message struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type ChatRequest struct {
	Model            string    `json:"model"`
	Messages         []Message `json:"messages"`
	Stream           bool      `json:"stream"`
	IncludeReasoning *bool     `json:"include_reasoning,omitempty"`
	Reasoning        *bool     `json:"reasoning,omitempty"`
	Temperature      float64   `json:"temperature,omitempty"`
	MaxTokens        int       `json:"max_tokens,omitempty"`
}

type NormalizedMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func NormalizeMessages(raw []Message) ([]NormalizedMessage, error) {
	if len(raw) == 0 {
		return nil, errors.New("messages must be a non-empty array")
	}
	out := make([]NormalizedMessage, 0, len(raw))
	hasText := false
	for _, item := range raw {
		switch item.Role {
		case "system", "user", "assistant", "tool":
		default:
			return nil, errors.New("message.role must be system|user|assistant|tool")
		}
		content := strings.ReplaceAll(messageText(item.Content), "\x00", "")
		if strings.TrimSpace(content) != "" {
			hasText = true
		}
		out = append(out, NormalizedMessage{Role: item.Role, Content: content})
	}
	if !hasText {
		return nil, errors.New("messages contain no text")
	}
	return out, nil
}

func messageText(content any) string {
	switch value := content.(type) {
	case nil:
		return ""
	case string:
		return value
	case []any:
		parts := make([]string, 0, len(value))
		for _, item := range value {
			switch part := item.(type) {
			case string:
				parts = append(parts, part)
			case map[string]any:
				if text, ok := part["text"].(string); ok && part["type"] == "text" {
					parts = append(parts, text)
				} else if text, ok := part["content"].(string); ok {
					parts = append(parts, text)
				}
			}
		}
		return strings.Join(parts, "\n")
	default:
		encoded, err := json.Marshal(value)
		if err == nil {
			return string(encoded)
		}
		return fmt.Sprint(value)
	}
}

func Transcript(messages []NormalizedMessage) string {
	var out strings.Builder
	for _, message := range messages {
		content := strings.TrimSpace(message.Content)
		if content == "" {
			continue
		}
		if out.Len() > 0 {
			out.WriteString("\n\n")
		}
		fmt.Fprintf(&out, "[%s]\n%s", message.Role, content)
	}
	return out.String()
}

func SplitQuestionDocument(messages []NormalizedMessage) (question, document string) {
	last := len(messages) - 1
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" && strings.TrimSpace(messages[i].Content) != "" {
			last = i
			break
		}
	}
	question = strings.TrimSpace(messages[last].Content)
	if len(messages) == 2 && last == 1 && strings.TrimSpace(messages[0].Content) != "" {
		return question, messages[0].Content
	}
	var parts strings.Builder
	for i, message := range messages {
		if i == last || strings.TrimSpace(message.Content) == "" {
			continue
		}
		if parts.Len() > 0 {
			parts.WriteString("\n\n")
		}
		fmt.Fprintf(&parts, "[%s]\n%s", message.Role, strings.TrimSpace(message.Content))
	}
	return question, parts.String()
}

func EstimateTokens(text string) int64 {
	if text == "" {
		return 0
	}
	return (int64(len(text)) + 3) / 4
}
