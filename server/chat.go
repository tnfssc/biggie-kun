package biggie

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"
	"time"
)

type Usage struct {
	PromptTokens      int64             `json:"prompt_tokens"`
	CompletionTokens  int64             `json:"completion_tokens"`
	TotalTokens       int64             `json:"total_tokens"`
	CompletionDetails CompletionDetails `json:"completion_tokens_details"`
}
type CompletionDetails struct {
	ReasoningTokens          int64 `json:"reasoning_tokens"`
	AcceptedPredictionTokens int64 `json:"accepted_prediction_tokens"`
}
type CompletionResult struct {
	ID                        string
	Created                   int64
	Model, Content, Reasoning string
	PromptTokens              int64
	Usage                     Usage
	Sealed                    bool
	ContentStreamed           bool
}

type CompletionSinks struct {
	Reasoning ReasoningSink
	Content   func(string) error
}

type Engine struct {
	Config Config
	Model  ModelClient
}

func NewEngine(cfg Config, model ModelClient) *Engine {
	return &Engine{Config: cfg, Model: model}
}

func BuildUsage(input, reasoning, answer string) Usage {
	return BuildUsageFromTokens(EstimateTokens(input), reasoning, answer)
}

func BuildUsageFromTokens(inputTokens int64, reasoning, answer string) Usage {
	prompt := min(ContextWindow, inputTokens)
	reason := EstimateTokens(reasoning)
	completion := reason + EstimateTokens(answer)
	return Usage{PromptTokens: prompt, CompletionTokens: completion, TotalTokens: prompt + completion, CompletionDetails: CompletionDetails{ReasoningTokens: reason}}
}

func randomID() string {
	var data [12]byte
	if _, err := rand.Read(data[:]); err != nil {
		return "chatcmpl-" + itoa(int(time.Now().UnixNano()))
	}
	return "chatcmpl-" + hex.EncodeToString(data[:])
}

func (e *Engine) Complete(ctx context.Context, body ChatRequest, sink ReasoningSink) (CompletionResult, error) {
	return e.complete(ctx, body, CompletionSinks{Reasoning: sink}, "")
}

func (e *Engine) complete(ctx context.Context, body ChatRequest, sinks CompletionSinks, completionID string) (CompletionResult, error) {
	messages, err := NormalizeMessages(body.Messages)
	if err != nil {
		return CompletionResult{}, err
	}
	publicModel := strings.TrimSpace(body.Model)
	if publicModel == "" {
		publicModel = Product
	}
	maxTokens := body.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 1024
	}
	if maxTokens > 8192 {
		maxTokens = 8192
	}
	includeReasoning := true
	if body.IncludeReasoning != nil && !(*body.IncludeReasoning) {
		includeReasoning = false
	}
	if body.Reasoning != nil && !(*body.Reasoning) {
		includeReasoning = false
	}
	var promptTokens int64
	for _, message := range messages {
		promptTokens += EstimateTokens(message.Content)
	}
	question, requestDoc := SplitQuestionDocument(messages)
	if completionID == "" {
		completionID = randomID()
	}
	result := CompletionResult{ID: completionID, Created: time.Now().Unix(), Model: publicModel, PromptTokens: promptTokens}
	if IsInternalProbe(question) {
		result.Content = internalRefusal
		result.Sealed = true
		result.Usage = BuildUsageFromTokens(promptTokens, "", result.Content)
		return result, nil
	}
	doc := requestDoc
	if strings.TrimSpace(doc) == "" {
		doc = question
	}
	var reasoning strings.Builder
	emit := func(piece string) error {
		if !includeReasoning {
			return nil
		}
		reasoning.WriteString(piece)
		if sinks.Reasoning != nil {
			return sinks.Reasoning(piece)
		}
		return nil
	}
	var draft, evidence, publicReasoning string
	direct := promptTokens <= e.Config.DirectTokenThreshold
	if direct && sinks.Content != nil {
		if client, ok := e.Model.(StreamingModelClient); ok {
			return e.completeDirectStream(ctx, client, body, messages, question, includeReasoning, maxTokens, result, sinks)
		}
	}
	if direct {
		contextText := Transcript(messages)
		prompt := directConversationPrompt(messages) + "\nReturn the JSON object now."
		think := false
		response, modelErr := e.Model.Chat(ctx, ModelRequest{Model: e.Config.Model, Purpose: "direct", Messages: []NormalizedMessage{{Role: "system", Content: directSystem}, {Role: "user", Content: prompt}, {Role: "assistant", Content: "{"}}, NumCtx: e.Config.NumCtx, NumPredict: maxTokens, Temperature: body.Temperature, Think: &think})
		if modelErr != nil {
			return CompletionResult{}, modelErr
		}
		draft, publicReasoning = ParseDirectAnswer(response)
		evidence = contextText
	} else {
		corpus := doc
		if strings.TrimSpace(corpus) == "" {
			corpus = question
		}
		index := NewBlockIndex(corpus, IndexOptions{BlockBytes: e.Config.BlockBytes, BlockOverlap: e.Config.BlockOverlap, MaxPostings: e.Config.MaxPostings, MaxTerms: e.Config.MaxTerms})
		defer index.Release()
		agent, agentErr := RunAgent(ctx, e.Model, index, question, AgentOptions{MaxTurns: e.Config.MaxTurns, NumCtx: e.Config.NumCtx, ScanBytes: e.Config.ScanBytes, MaxTokens: maxTokens, Model: e.Config.Model}, emit)
		if agentErr != nil {
			return CompletionResult{}, agentErr
		}
		draft = agent.Answer
	}
	content := stripFence(draft)
	if !direct {
		content = FilterAgentAnswer(content)
		if content == "" {
			content = "I couldn't form a useful answer from the available excerpts."
		}
	} else if content == "" || content == "INSUFFICIENT_EVIDENCE" || content == internalRefusal || LooksLikeLeak(content) {
		content, _ = PresentAnswer(ctx, e.Model, e.Config, question, draft, evidence, maxTokens)
		publicReasoning = ""
	}
	result.Content = content
	if includeReasoning && direct {
		final := stripFence(publicReasoning)
		if LooksLikeLeak(final) {
			final = ""
		}
		if final == "" {
			final = ThinkAbout(ctx, e.Model, e.Config, question, draft, evidence, min(512, maxTokens))
		}
		if final != "" {
			if reasoning.Len() > 0 {
				_ = emit(" ")
			}
			for _, piece := range ChunkText(final, 32) {
				_ = emit(piece)
			}
		}
	}
	result.Reasoning = reasoning.String()
	result.Usage = BuildUsageFromTokens(promptTokens, result.Reasoning, content)
	return result, nil
}

func OpenAIResponse(result CompletionResult) map[string]any {
	message := map[string]any{"role": "assistant", "content": result.Content, "reasoning_content": nil}
	if result.Reasoning != "" {
		message["reasoning_content"] = result.Reasoning
	}
	payload := map[string]any{"id": result.ID, "object": "chat.completion", "created": result.Created, "model": result.Model, "choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": "stop"}}, "usage": result.Usage}
	return payload
}
