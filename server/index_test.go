package biggie

import (
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestRealHundredMillionTokenIndex(t *testing.T) {
	// This builds and queries the real production index. The old test allocated a
	// large string but only counted its bytes, so it proved nothing about recall.
	const defaultBytes = 400_000_000
	targetBytes := defaultBytes
	if configured := os.Getenv("BIGGIE_REAL_TEST_BYTES"); configured != "" {
		value, err := strconv.Atoi(configured)
		if err != nil || value < 1_000_000 {
			t.Fatalf("invalid BIGGIE_REAL_TEST_BYTES=%q", configured)
		}
		targetBytes = value
	}
	filler := "ordinary filler line with no unique values\n"
	needle := "FINAL RECORD CASE-Z9Q7 carries launch code CODE-ORANGE99 at 04:30 UTC.\n"
	prefixBytes := targetBytes - len(needle)
	prefix := strings.Repeat(filler, prefixBytes/len(filler))
	corpus := prefix + filler[:prefixBytes%len(filler)] + needle
	if tokens := EstimateTokens(corpus); tokens != (int64(targetBytes)+3)/4 {
		t.Fatalf("corpus has %d tokens, wanted %d", tokens, (int64(targetBytes)+3)/4)
	}
	index := NewBlockIndex(corpus, IndexOptions{
		BlockBytes: 16_384, BlockOverlap: 512, MaxPostings: 4096, MaxTerms: 250_000,
	})
	results := index.Search([]string{"CASE-Z9Q7"}, 12)
	if len(results) == 0 || !strings.Contains(results[0].Snippet, "CODE-ORANGE99") {
		t.Fatalf("needle not retrieved from %d-byte corpus: %#v", len(corpus), results)
	}
	reads := index.ReadBlocks([]int{results[0].BlockID}, 0, 80_000)
	if len(reads) != 1 || !strings.Contains(reads[0].Text, "04:30 UTC") {
		t.Fatalf("retrieved block did not contain the answer")
	}
}

func TestDefaultRequestLimitAdmitsBillionTokenJSON(t *testing.T) {
	if DefaultConfig().MaxRequestBytes <= 4_000_000_000 {
		t.Fatalf("default request limit must leave room for 4GB of text plus JSON framing")
	}
}

func TestIndexFindsDuplicateExactKeys(t *testing.T) {
	corpus := "CASE-A code WRONG\n" + strings.Repeat("filler\n", 5000) + "CASE-A code RIGHT\n"
	index := NewBlockIndex(corpus, IndexOptions{BlockBytes: 2048, BlockOverlap: 64, MaxPostings: 4096, MaxTerms: 1000})
	results := index.Search([]string{"CASE-A"}, 12)
	found := 0
	for _, result := range results {
		if strings.Contains(result.Snippet, "CASE-A") {
			found++
		}
	}
	if found != 2 {
		t.Fatalf("wanted both duplicate keys, found %d", found)
	}
}

func TestIndexReleaseDropsCorpusReferences(t *testing.T) {
	index := NewBlockIndex("CASE-A has CODE-X", IndexOptions{})
	index.Release()
	if index.source != "" || index.blocks != nil || index.postings != nil {
		t.Fatalf("request-scoped index retained corpus state")
	}
}
