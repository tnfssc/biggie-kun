package biggie

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"
)

const directAnswerMarker = `","answer":"`
const streamSafetyHoldback = 64

type directResponseStream struct {
	withReasoning bool
	reasoningSink func(string) error
	contentSink   func(string) error
	header        strings.Builder
	answer        strings.Builder
	pending       string
	reasoning     strings.Builder
	trailer       strings.Builder
	finalAnswer   string
	answerStarted bool
	answerClosed  bool
	emitted       bool
	sinkFailed    bool
}

func newDirectResponseStream(withReasoning bool, reasoningSink, contentSink func(string) error) *directResponseStream {
	return &directResponseStream{withReasoning: withReasoning, reasoningSink: reasoningSink, contentSink: contentSink, answerStarted: !withReasoning}
}

func (s *directResponseStream) Push(piece string) error {
	if s.answerStarted {
		return s.pushAnswer(piece)
	}
	if s.header.Len() == 0 && s.reasoning.Len() == 0 {
		piece = strings.TrimLeft(piece, " \t\r\n")
	}
	s.header.WriteString(piece)
	text := s.header.String()
	marker := strings.Index(text, directAnswerMarker)
	if marker < 0 {
		if decoded, ok := decodeJSONFragment(text); ok && LooksLikeLeak(s.reasoning.String()+decoded) {
			return errors.New("model returned unsafe streamed reasoning")
		}
		cut := len(text) - streamSafetyHoldback - len(directAnswerMarker)
		if cut <= 0 {
			return nil
		}
		cut = safeJSONCut(text, cut)
		if cut == 0 {
			return nil
		}
		return s.emitReasoning(text[:cut], cut)
	}
	remainingReasoning := text[:marker]
	decodedReasoning, ok := decodeJSONFragment(remainingReasoning)
	if !ok {
		return errors.New("model returned malformed streamed reasoning")
	}
	fullReasoning := strings.TrimSpace(s.reasoning.String() + decodedReasoning)
	if fullReasoning == "" || LooksLikeLeak(fullReasoning) {
		return errors.New("model returned unsafe or empty streamed reasoning")
	}
	if err := s.emitReasoning(remainingReasoning, marker); err != nil {
		return err
	}
	s.answerStarted = true
	rest := strings.TrimLeft(text[marker+len(directAnswerMarker):], " \t\r\n")
	s.header.Reset()
	return s.pushAnswer(rest)
}

func (s *directResponseStream) emitReasoning(piece string, consumed int) error {
	if piece == "" {
		return nil
	}
	decoded, ok := decodeJSONFragment(piece)
	if !ok {
		return errors.New("model returned malformed streamed reasoning")
	}
	if LooksLikeLeak(s.reasoning.String() + decoded) {
		return errors.New("model returned unsafe streamed reasoning")
	}
	s.reasoning.WriteString(decoded)
	if s.reasoningSink != nil {
		if err := s.reasoningSink(decoded); err != nil {
			s.sinkFailed = true
			return err
		}
	}
	text := s.header.String()
	s.header.Reset()
	s.header.WriteString(text[consumed:])
	s.emitted = true
	return nil
}

func (s *directResponseStream) pushAnswer(piece string) error {
	if s.answerClosed {
		s.trailer.WriteString(piece)
		return nil
	}
	if piece == "" {
		return nil
	}
	s.pending += piece
	if end := jsonStringEnd(s.pending); end >= 0 {
		decoded, ok := decodeJSONFragment(s.pending[:end])
		if !ok {
			return errors.New("model returned malformed streamed answer")
		}
		if err := s.validateAnswer(s.answer.String() + decoded); err != nil {
			return err
		}
		s.answer.WriteString(decoded)
		s.finalAnswer = decoded
		s.trailer.WriteString(s.pending[end+1:])
		s.pending = ""
		s.answerClosed = true
		return nil
	}
	if decoded, ok := decodeJSONFragment(s.pending); ok {
		if err := s.validateAnswer(s.answer.String() + decoded); err != nil {
			return err
		}
	}
	cut := len(s.pending) - streamSafetyHoldback
	if cut <= 0 {
		return nil
	}
	cut = safeJSONCut(s.pending, cut)
	if cut == 0 {
		return nil
	}
	return s.emitAnswer(s.pending[:cut], cut)
}

func (s *directResponseStream) validateAnswer(answer string) error {
	answer = strings.TrimSpace(answer)
	if strings.HasPrefix(answer, internalRefusal) || LooksLikeLeak(answer) {
		return errors.New("model returned unsafe streamed answer")
	}
	return nil
}

func (s *directResponseStream) emitAnswer(piece string, consumed int) error {
	if piece == "" {
		return nil
	}
	decoded, ok := decodeJSONFragment(piece)
	if !ok {
		return errors.New("model returned malformed streamed answer")
	}
	if err := s.validateAnswer(s.answer.String() + decoded); err != nil {
		return err
	}
	s.answer.WriteString(decoded)
	if s.contentSink != nil {
		if err := s.contentSink(decoded); err != nil {
			s.sinkFailed = true
			return err
		}
	}
	s.pending = s.pending[consumed:]
	s.emitted = true
	return nil
}

func (s *directResponseStream) Finish() error {
	if !s.answerStarted {
		return errors.New("model omitted answer field")
	}
	if !s.answerClosed || strings.TrimSpace(s.trailer.String()) != "}" {
		return errors.New("model returned incomplete streamed answer")
	}
	answer := strings.TrimSpace(s.answer.String())
	if answer == "" || answer == internalRefusal || LooksLikeLeak(answer) {
		return errors.New("model returned unsafe or empty streamed answer")
	}
	final := strings.TrimRight(s.finalAnswer, " \t\r\n")
	if final != "" {
		if s.contentSink != nil {
			if err := s.contentSink(final); err != nil {
				s.sinkFailed = true
				return err
			}
		}
		s.emitted = true
	}
	return nil
}

func decodeJSONFragment(text string) (string, bool) {
	var decoded string
	if err := json.Unmarshal([]byte(`"`+text+`"`), &decoded); err != nil {
		return "", false
	}
	return decoded, true
}

func safeJSONCut(text string, cut int) int {
	for cut > 0 {
		if utf8.ValidString(text[:cut]) {
			if _, ok := decodeJSONFragment(text[:cut]); ok && !endsWithHighSurrogate(text[:cut]) {
				return cut
			}
		}
		cut--
	}
	return 0
}

func endsWithHighSurrogate(text string) bool {
	if len(text) < 6 || text[len(text)-6:len(text)-4] != `\u` {
		return false
	}
	value, err := strconv.ParseUint(text[len(text)-4:], 16, 16)
	return err == nil && value >= 0xD800 && value <= 0xDBFF
}

func jsonStringEnd(text string) int {
	escaped := false
	for i := 0; i < len(text); i++ {
		if escaped {
			escaped = false
			continue
		}
		switch text[i] {
		case '\\':
			escaped = true
		case '"':
			return i
		}
	}
	return -1
}

func (s *directResponseStream) Answer() string    { return strings.TrimSpace(s.answer.String()) }
func (s *directResponseStream) Reasoning() string { return strings.TrimSpace(s.reasoning.String()) }
func (s *directResponseStream) Emitted() bool     { return s.emitted }
func (s *directResponseStream) SinkFailed() bool  { return s.sinkFailed }

func (e *Engine) completeDirectStream(ctx context.Context, client StreamingModelClient, body ChatRequest, messages []NormalizedMessage, question string, includeReasoning bool, maxTokens int, result CompletionResult, sinks CompletionSinks) (CompletionResult, error) {
	evidence := Transcript(messages)
	prompt := "USER QUESTION:\n" + question + "\n\nCONTEXT EVIDENCE:\n" + evidence
	system := directStreamSystem
	prefix := `{"reasoning":"`
	if !includeReasoning {
		system = directStreamAnswerSystem
		prefix = `{"answer":"`
	}
	think := false
	request := ModelRequest{Model: e.Config.Model, Purpose: "direct-stream", Messages: []NormalizedMessage{{Role: "system", Content: system}, {Role: "user", Content: prompt}, {Role: "assistant", Content: prefix}}, NumCtx: e.Config.NumCtx, NumPredict: maxTokens, Temperature: body.Temperature, Think: &think}
	stream := newDirectResponseStream(includeReasoning, sinks.Reasoning, sinks.Content)
	if err := client.ChatStream(ctx, request, stream.Push); err != nil {
		return CompletionResult{}, err
	}
	if err := stream.Finish(); err != nil {
		if stream.Emitted() || stream.SinkFailed() {
			return CompletionResult{}, err
		}
		return e.fallbackDirectStream(ctx, question, evidence, includeReasoning, maxTokens, result, sinks)
	}
	result.Content = stream.Answer()
	result.Reasoning = stream.Reasoning()
	result.ContentStreamed = true
	result.Usage = BuildUsageFromTokens(result.PromptTokens, result.Reasoning, result.Content)
	return result, nil
}

func (e *Engine) fallbackDirectStream(ctx context.Context, question, evidence string, includeReasoning bool, maxTokens int, result CompletionResult, sinks CompletionSinks) (CompletionResult, error) {
	content, _ := PresentAnswer(ctx, e.Model, e.Config, question, "", evidence, maxTokens)
	if includeReasoning {
		reasoning := ThinkAbout(ctx, e.Model, e.Config, question, content, evidence, min(512, maxTokens))
		for _, piece := range ChunkText(reasoning, 32) {
			if sinks.Reasoning != nil {
				if err := sinks.Reasoning(piece); err != nil {
					return CompletionResult{}, err
				}
			}
		}
		result.Reasoning = reasoning
	}
	for _, piece := range ChunkText(content, 32) {
		if sinks.Content != nil {
			if err := sinks.Content(piece); err != nil {
				return CompletionResult{}, err
			}
		}
	}
	result.Content = content
	result.ContentStreamed = true
	result.Usage = BuildUsageFromTokens(result.PromptTokens, result.Reasoning, result.Content)
	return result, nil
}
