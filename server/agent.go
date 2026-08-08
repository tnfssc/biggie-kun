package biggie

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"time"
)

const controllerSystem = `You control a fast document reader. Choose search, read, or answer yourself.

For search, copy rare exact names from the user's question into queries. For read, use result IDs from the latest search. After reading, normally answer on the next turn; only continue when the excerpt gives a specific new search term. Never repeat the same action. Synthesis and imperfect answers are welcome.

Every action includes a thought of at most six words about the actual subject or fact. Never describe your process or mention searching, reading, checking, looking, narrowing, context, evidence, or tools. Keep the final answer direct.`

const forceAnswerSystem = `Answer the user directly from the supplied document excerpts in one short sentence. Be useful even if the excerpts are incomplete. Do not mention searching, reading, context, evidence, tools, or your process. Return only the answer.`

func controllerSchema(actions []string) map[string]any {
	variants := make([]any, 0, len(actions))
	for _, action := range actions {
		properties := map[string]any{
			"action":  map[string]any{"type": "string", "const": action},
			"thought": map[string]any{"type": "string", "minLength": 3, "maxLength": 64, "description": "A short subject or fact, never process commentary"},
		}
		required := []string{"action", "thought"}
		switch action {
		case "search":
			properties["queries"] = map[string]any{"type": "array", "items": map[string]any{"type": "string"}}
			properties["top_k"] = map[string]any{"type": "integer", "minimum": 1, "maximum": 12}
			required = append(required, "queries")
		case "read":
			properties["result_ids"] = map[string]any{"type": "array", "items": map[string]any{"type": "string"}}
			properties["neighbors"] = map[string]any{"type": "integer", "minimum": 0, "maximum": 1}
			required = append(required, "result_ids")
		case "answer":
		}
		variants = append(variants, map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false})
	}
	return map[string]any{"oneOf": variants}
}

type Action struct {
	Action      string   `json:"action"`
	Queries     []string `json:"queries,omitempty"`
	TopK        int      `json:"top_k,omitempty"`
	ResultIDs   []string `json:"result_ids,omitempty"`
	Neighbors   int      `json:"neighbors,omitempty"`
	Answer      string   `json:"answer,omitempty"`
	EvidenceIDs []string `json:"evidence_ids,omitempty"`
	Thought     string   `json:"thought,omitempty"`
}

type AgentTrace struct {
	Turn             int      `json:"turn"`
	Action           Action   `json:"action"`
	ControllerRepair bool     `json:"controller_repair,omitempty"`
	ResultCount      int      `json:"result_count,omitempty"`
	EvidenceIDs      []string `json:"evidence_ids,omitempty"`
	Accepted         *bool    `json:"accepted,omitempty"`
}

type AgentResult struct {
	Answer          string              `json:"answer"`
	EvidenceIDs     []string            `json:"evidence_ids"`
	Evidence        map[string]Evidence `json:"evidence"`
	Turns           int                 `json:"turns"`
	SearchActions   int                 `json:"search_actions"`
	ScannedBytes    int                 `json:"scanned_bytes"`
	ProtocolRepairs int                 `json:"protocol_repairs"`
	FinishReason    string              `json:"finish_reason"`
	WallSeconds     float64             `json:"wall_seconds"`
	DocumentSHA256  string              `json:"document_sha256"`
	Trace           []AgentTrace        `json:"trace"`
}

type AgentOptions struct {
	MaxTurns, NumCtx, ScanBytes, MaxTokens int
	Model                                  string
}

type ReasoningSink func(string) error

func ParseAction(text string) (Action, bool) {
	text = strings.TrimSpace(text)
	var action Action
	if json.Unmarshal([]byte(text), &action) == nil && action.Action != "" {
		return action, true
	}
	start := strings.IndexByte(text, '{')
	if start < 0 {
		return Action{}, false
	}
	decoder := json.NewDecoder(strings.NewReader(text[start:]))
	if decoder.Decode(&action) == nil && action.Action != "" {
		return action, true
	}
	return Action{}, false
}

func FilterAgentThought(text string) string {
	text = strings.TrimSpace(stripFence(text))
	for _, prefix := range []string{"need to find ", "need to inspect ", "need to understand ", "searching for ", "looking for ", "checking for ", "reading about ", "finding ", "the search result snippet mentions "} {
		if strings.HasPrefix(strings.ToLower(text), prefix) {
			text = strings.TrimSpace(text[len(prefix):])
			break
		}
	}
	lower := strings.ToLower(text)
	for _, phrase := range []string{"let me", "i'll", "i will", "need to", "the user", "tool", "result id", "snippet", "results yet", "context", "evidence", "searching", "checking", "looking", "narrowing", "verifying", "reading more", "specific words"} {
		if strings.Contains(lower, phrase) {
			return ""
		}
	}
	words := strings.Fields(text)
	if len(words) == 0 || len(words) == 1 && !strings.ContainsAny(words[0], "0123456789_-") {
		return ""
	}
	if len(words) > 6 {
		words = words[:6]
	}
	return strings.Join(words, " ")
}

func FilterAgentAnswer(text string) string {
	text = strings.TrimSpace(stripFence(text))
	for range 3 {
		lower := strings.ToLower(text)
		processLead := false
		for _, prefix := range []string{"based on ", "from the context", "from this context", "from the evidence", "i found ", "i looked ", "i read ", "after searching", "after reading", "after looking", "let me ", "i'll ", "i will "} {
			if strings.HasPrefix(lower, prefix) {
				processLead = true
				break
			}
		}
		if !processLead {
			break
		}
		if end := strings.Index(text, "\n\n"); end >= 0 {
			text = strings.TrimSpace(text[end+2:])
			continue
		}
		end := -1
		for _, marker := range []string{". ", "! ", "? ", "\n"} {
			if at := strings.Index(text, marker); at >= 0 && (end < 0 || at < end) {
				end = at + len(marker)
			}
		}
		if end < 0 {
			return ""
		}
		text = strings.TrimSpace(text[end:])
	}
	for _, phrase := range []string{" as noted in the document excerpt", " in the provided document excerpt", " from the supplied document excerpts"} {
		text = strings.ReplaceAll(text, phrase, "")
	}
	return text
}

func RunAgent(ctx context.Context, client ModelClient, index *BlockIndex, question string, opts AgentOptions, sink ReasoningSink) (AgentResult, error) {
	started := time.Now()
	searchResults := map[string]SearchResult{}
	evidence := map[string]Evidence{}
	var evidenceOrder []string
	var resultOrder []string
	var trace []AgentTrace
	searched, scanned, repairs, turns := 0, 0, 0, 0
	state := "No tool results yet."
	answerState := state
	finalAnswer := ""
	finishReason := "answer"
	answerRequested := false
	repairUsed := false
	think := false
	phase := "start"

	emit := func(text string) error {
		text = FilterAgentThought(text)
		if text != "" && sink != nil {
			return sink(text + " ")
		}
		return nil
	}

agentLoop:
	for turn := 1; turn <= opts.MaxTurns; turn++ {
		turns = turn
		allowed := []string{"search", "answer"}
		if phase == "searched" {
			allowed = []string{"read", "answer"}
		} else if phase == "read" {
			allowed = []string{"answer", "search"}
		}
		prompt := "USER QUESTION:\n" + question + "\n\nLATEST TOOL RESULT:\n" + state + "\n\nAllowed actions now: " + strings.Join(allowed, " or ") + ". Turn " + itoa(turn) + "/" + itoa(opts.MaxTurns) + "; scanned " + itoa(scanned) + "/" + itoa(opts.ScanBytes) + " bytes."
		raw, err := client.Chat(ctx, ModelRequest{Model: opts.Model, Purpose: "controller", Messages: []NormalizedMessage{{Role: "system", Content: controllerSystem}, {Role: "user", Content: prompt}}, NumCtx: opts.NumCtx, NumPredict: 256, JSONSchema: controllerSchema(allowed), Think: &think})
		if err != nil {
			return AgentResult{}, err
		}
		action, ok := ParseAction(raw)
		if ok {
			action.Action = strings.ToLower(strings.TrimSpace(action.Action))
			if action.Action == "finish" {
				action.Action = "answer"
			}
			ok = action.Action == "search" || action.Action == "read" || action.Action == "answer"
		}
		if !ok {
			repairs++
			trace = append(trace, AgentTrace{Turn: turn, Action: action, ControllerRepair: true})
			if !repairUsed {
				repairUsed = true
				state = "ACTION ERROR: Return exactly one search, read, or answer JSON object."
				continue
			}
			break
		}
		log.Printf("agent turn=%d action=%s queries=%q result_ids=%q thought=%q", turn, action.Action, action.Queries, action.ResultIDs, action.Thought)

		switch action.Action {
		case "search":
			queries := action.Queries
			if len(queries) == 0 {
				queries = FallbackQuery(question)
			}
			if len(queries) > 6 {
				queries = queries[:6]
			}
			topK := action.TopK
			if topK < 1 {
				topK = 8
			}
			if topK > 12 {
				topK = 12
			}
			results := index.Search(queries, topK)
			searchResults = make(map[string]SearchResult, len(results))
			resultOrder = resultOrder[:0]
			for i, result := range results {
				result.ResultID = "s" + itoa(searched+1) + "r" + itoa(i+1)
				searchResults[result.ResultID] = result
				resultOrder = append(resultOrder, result.ResultID)
				results[i] = result
			}
			searched++
			phase = "searched"
			state = "SEARCH RESULTS:\n" + mustJSON(results)
			if answerState == "No tool results yet." {
				answerState = state
			}
			if err := emit(action.Thought); err != nil {
				return AgentResult{}, err
			}
			trace = append(trace, AgentTrace{Turn: turn, Action: action, ResultCount: len(results)})

		case "read":
			requested := action.ResultIDs
			if len(requested) == 0 {
				requested = resultOrder
			}
			var selected []SearchResult
			for _, id := range requested {
				if result, ok := searchResults[id]; ok {
					selected = append(selected, result)
				}
				if len(selected) == 4 {
					break
				}
			}
			if len(selected) == 0 {
				state = "TOOL ERROR: Those result IDs are unavailable. Choose from the latest search results or search again."
				trace = append(trace, AgentTrace{Turn: turn, Action: action, ControllerRepair: true})
				continue
			}
			blockIDs := make([]int, len(selected))
			for i, result := range selected {
				blockIDs[i] = result.BlockID
			}
			reads := index.ReadBlocks(blockIDs, min(max(action.Neighbors, 0), 1), min(48_000, max(0, opts.ScanBytes-scanned)))
			items := make([]map[string]any, 0, len(reads))
			var evidenceIDs []string
			for _, read := range reads {
				id := ""
				for existing, item := range evidence {
					if item.BlockID == read.BlockID {
						id = existing
						break
					}
				}
				if id == "" {
					id = "e" + itoa(len(evidence)+1)
					evidenceOrder = append(evidenceOrder, id)
					scanned += len(read.Text)
				}
				evidence[id] = read
				evidenceIDs = append(evidenceIDs, id)
				items = append(items, map[string]any{"id": id, "text": read.Text})
			}
			if len(items) == 0 {
				state = "TOOL RESULT: The read returned no text. Search another term or answer from what you have."
			} else {
				state = "DOCUMENT EXCERPTS:\n" + mustJSON(items)
				answerState = state
			}
			phase = "read"
			if err := emit(action.Thought); err != nil {
				return AgentResult{}, err
			}
			trace = append(trace, AgentTrace{Turn: turn, Action: action, EvidenceIDs: evidenceIDs})

		case "answer":
			accepted := true
			trace = append(trace, AgentTrace{Turn: turn, Action: action, Accepted: &accepted})
			if err := emit(action.Thought); err != nil {
				return AgentResult{}, err
			}
			answerRequested = true
			break agentLoop
		}
	}

	if finalAnswer == "" {
		maxTokens := opts.MaxTokens
		if maxTokens <= 0 {
			maxTokens = 1024
		}
		prompt := "USER QUESTION:\n" + question + "\n\nDOCUMENT MATERIAL:\n" + answerState + "\n\nAnswer now."
		raw, err := client.Chat(ctx, ModelRequest{Model: opts.Model, Purpose: "answer", Messages: []NormalizedMessage{{Role: "system", Content: forceAnswerSystem}, {Role: "user", Content: prompt}}, NumCtx: opts.NumCtx, NumPredict: maxTokens, Think: &think})
		if err != nil {
			return AgentResult{}, err
		}
		turns++
		finalAnswer = FilterAgentAnswer(raw)
		if !answerRequested {
			finishReason = "forced_answer"
		}
		if finalAnswer == "" {
			finalAnswer = "I couldn't form a useful answer from the available excerpts."
		}
	}

	return AgentResult{Answer: finalAnswer, EvidenceIDs: evidenceOrder, Evidence: evidence, Turns: turns, SearchActions: searched, ScannedBytes: scanned, ProtocolRepairs: repairs, FinishReason: finishReason, WallSeconds: mathRound(time.Since(started).Seconds(), 2), Trace: trace}, nil
}

func mustJSON(value any) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func mathRound(value float64, places int) float64 {
	factor := 1.0
	for range places {
		factor *= 10
	}
	return float64(int64(value*factor+0.5)) / factor
}
