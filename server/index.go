package biggie

import (
	"crypto/sha256"
	"encoding/hex"
	"math"
	"sort"
	"strings"
)

type Block struct {
	ID    int `json:"block_id"`
	Start int `json:"start_byte"`
	End   int `json:"end_byte"`
}

type SearchResult struct {
	ResultID string  `json:"result_id"`
	BlockID  int     `json:"block_id"`
	Start    int     `json:"start_byte"`
	End      int     `json:"end_byte"`
	Score    float64 `json:"score,omitempty"`
	Snippet  string  `json:"snippet"`
}

type Evidence struct {
	BlockID int    `json:"block_id"`
	Start   int    `json:"start_byte"`
	End     int    `json:"end_byte"`
	Text    string `json:"text"`
	SHA256  string `json:"sha256"`
}

type posting struct {
	ids     []uint32
	dropped bool
}

type BlockIndex struct {
	source       string
	blocks       []Block
	postings     map[string]*posting
	droppedTerms int
}

type IndexOptions struct {
	BlockBytes, BlockOverlap, MaxPostings, MaxTerms int
}

var stopwords = map[string]bool{
	"a": true, "an": true, "and": true, "are": true, "as": true, "at": true,
	"be": true, "by": true, "exact": true, "for": true, "from": true, "in": true,
	"is": true, "it": true, "of": true, "on": true, "only": true, "return": true,
	"the": true, "this": true, "to": true, "was": true, "what": true, "with": true,
}

func NewBlockIndex(source string, opts IndexOptions) *BlockIndex {
	if opts.BlockBytes <= 0 {
		opts.BlockBytes = 16_384
	}
	if opts.BlockOverlap < 0 {
		opts.BlockOverlap = 0
	}
	if opts.MaxPostings <= 0 {
		opts.MaxPostings = 4096
	}
	if opts.MaxTerms <= 0 {
		opts.MaxTerms = 250_000
	}
	idx := &BlockIndex{source: source, postings: make(map[string]*posting)}
	for start := 0; start < len(source); {
		end := min(len(source), start+opts.BlockBytes)
		if end < len(source) {
			if newline := strings.IndexByte(source[end:min(len(source), end+opts.BlockOverlap)], '\n'); newline >= 0 {
				end += newline + 1
			}
		}
		id := len(idx.blocks)
		idx.blocks = append(idx.blocks, Block{ID: id, Start: start, End: end})
		seen := make(map[string]struct{})
		walkTerms(source[start:end], func(term string) {
			if _, ok := seen[term]; ok {
				return
			}
			seen[term] = struct{}{}
			entry, ok := idx.postings[term]
			if !ok {
				if len(idx.postings) >= opts.MaxTerms {
					idx.droppedTerms++
					return
				}
				entry = &posting{}
				idx.postings[term] = entry
			}
			if entry.dropped {
				return
			}
			if len(entry.ids) >= opts.MaxPostings {
				entry.ids = nil
				entry.dropped = true
				return
			}
			entry.ids = append(entry.ids, uint32(id))
		})
		if end == len(source) {
			break
		}
		start = max(start+1, end-opts.BlockOverlap)
	}
	return idx
}

func isTermByte(ch byte) bool {
	return ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_'
}

func walkTerms(text string, yield func(string)) {
	for i := 0; i < len(text); {
		for i < len(text) && !isTermByte(text[i]) {
			i++
		}
		start := i
		for i < len(text) && isTermByte(text[i]) {
			i++
		}
		if start < i {
			yield(strings.ToLower(text[start:i]))
		}
	}
}

func queryTerms(queries []string) []string {
	seen := make(map[string]bool)
	var out []string
	for _, query := range queries {
		walkTerms(query, func(term string) {
			if !stopwords[term] && !seen[term] {
				seen[term] = true
				out = append(out, term)
			}
		})
	}
	return out
}

func (idx *BlockIndex) Search(queries []string, topK int) []SearchResult {
	if topK <= 0 {
		topK = 12
	}
	scores := make(map[int]float64)
	for _, term := range queryTerms(queries) {
		entry := idx.postings[term]
		if entry == nil || entry.dropped || len(entry.ids) == 0 {
			continue
		}
		idf := math.Log1p(float64(len(idx.blocks)) / float64(len(entry.ids)))
		for _, id := range entry.ids {
			scores[int(id)] += idf
		}
	}
	normalized := make([]string, 0, len(queries))
	for _, query := range queries {
		if query = strings.ToLower(strings.TrimSpace(query)); query != "" {
			normalized = append(normalized, query)
		}
	}
	// Exact scanning is deliberately bounded to candidate blocks when lexical terms hit.
	candidates := make([]int, 0, len(scores))
	for id := range scores {
		candidates = append(candidates, id)
	}
	if len(candidates) == 0 {
		for id := range idx.blocks {
			candidates = append(candidates, id)
		}
	}
	for _, id := range candidates {
		text := strings.ToLower(idx.source[idx.blocks[id].Start:idx.blocks[id].End])
		for _, query := range normalized {
			if strings.Contains(text, query) {
				scores[id] += 20
			}
		}
	}
	if len(scores) == 0 {
		for i := 0; i < min(topK, len(idx.blocks)); i++ {
			scores[i] = 0
		}
	}
	type rank struct {
		id    int
		score float64
	}
	ranked := make([]rank, 0, len(scores))
	for id, score := range scores {
		ranked = append(ranked, rank{id, score})
	}
	sort.Slice(ranked, func(i, j int) bool {
		return ranked[i].score > ranked[j].score || ranked[i].score == ranked[j].score && ranked[i].id < ranked[j].id
	})
	if len(ranked) > topK {
		ranked = ranked[:topK]
	}
	results := make([]SearchResult, 0, len(ranked))
	for i, item := range ranked {
		block := idx.blocks[item.id]
		text := idx.source[block.Start:block.End]
		lower := strings.ToLower(text)
		hit := 0
		for _, query := range normalized {
			if at := strings.Index(lower, query); at >= 0 {
				hit = at
				break
			}
		}
		left, right := max(0, hit-320), min(len(text), hit+960)
		results = append(results, SearchResult{ResultID: "r" + itoa(i+1), BlockID: item.id, Start: block.Start, End: block.End, Score: math.Round(item.score*1000) / 1000, Snippet: text[left:right]})
	}
	return results
}

func (idx *BlockIndex) ReadBlocks(ids []int, neighbors, maxBytes int) []Evidence {
	wanted := make(map[int]bool)
	for _, id := range ids {
		for n := id - neighbors; n <= id+neighbors; n++ {
			if n >= 0 && n < len(idx.blocks) {
				wanted[n] = true
			}
		}
	}
	ordered := make([]int, 0, len(wanted))
	for id := range wanted {
		ordered = append(ordered, id)
	}
	sort.Ints(ordered)
	var out []Evidence
	used := 0
	for _, id := range ordered {
		block := idx.blocks[id]
		text := idx.source[block.Start:block.End]
		if used+len(text) > maxBytes {
			break
		}
		hash := sha256.Sum256([]byte(text))
		out = append(out, Evidence{BlockID: id, Start: block.Start, End: block.End, Text: text, SHA256: hex.EncodeToString(hash[:])})
		used += len(text)
	}
	return out
}

func (idx *BlockIndex) SourceSHA256() string {
	hash := sha256.Sum256([]byte(idx.source))
	return hex.EncodeToString(hash[:])
}

// Release drops every reference held by the request-scoped index. The caller's
// request still owns the corpus until the HTTP handler returns; after that the
// garbage collector can reclaim the entire context in one cycle.
func (idx *BlockIndex) Release() {
	idx.source = ""
	idx.blocks = nil
	idx.postings = nil
}

func FallbackQuery(question string) []string {
	terms := queryTerms([]string{question})
	sort.SliceStable(terms, func(i, j int) bool { return len(terms[i]) > len(terms[j]) })
	if len(terms) > 8 {
		terms = terms[:8]
	}
	if len(terms) == 0 {
		return []string{question}
	}
	return terms
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	var buf [24]byte
	i := len(buf)
	for value > 0 {
		i--
		buf[i] = byte('0' + value%10)
		value /= 10
	}
	return string(buf[i:])
}
