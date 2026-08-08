package biggie

import (
	"os"
	"strconv"
	"time"
)

const (
	Product              = "biggie-kun"
	ContextWindow        = int64(1_000_000_000)
	DirectTokenThreshold = int64(24_000)
	DefaultMaxBodyBytes  = int64(4_100_000_000) // 1B tokens plus JSON framing.
)

type Config struct {
	Listen               string
	Port                 int
	OllamaHost           string
	Model                string
	MaxRequestBytes      int64
	MaxTurns             int
	NumCtx               int
	ScanBytes            int
	BlockBytes           int
	BlockOverlap         int
	MaxPostings          int
	MaxTerms             int
	RequestsPerHour      int
	TokensPerHour        int64
	BytesPerSecond       int64
	DirectTokenThreshold int64
	OllamaTimeout        time.Duration
}

func DefaultConfig() Config {
	return Config{
		Listen:               envString("BIGGIE_LISTEN", "0.0.0.0"),
		Port:                 envInt("BIGGIE_PORT", 11500),
		OllamaHost:           firstEnv("OLLAMA_HOST", "BIGGIE_OLLAMA_HOST", "http://127.0.0.1:11434"),
		Model:                envString("BIGGIE_MODEL", "llama3.2"),
		MaxRequestBytes:      envInt64("BIGGIE_MAX_REQUEST_BYTES", DefaultMaxBodyBytes),
		MaxTurns:             envInt("BIGGIE_MAX_TURNS", 30),
		NumCtx:               envInt("BIGGIE_NUM_CTX", 32768),
		ScanBytes:            envInt("BIGGIE_SCAN_BYTES", 400_000),
		BlockBytes:           envInt("BIGGIE_BLOCK_BYTES", 16_384),
		BlockOverlap:         envInt("BIGGIE_BLOCK_OVERLAP", 512),
		MaxPostings:          envInt("BIGGIE_MAX_POSTINGS", 4096),
		MaxTerms:             envInt("BIGGIE_MAX_TERMS", 250_000),
		RequestsPerHour:      envInt("BIGGIE_REQ_PER_HOUR", 10),
		TokensPerHour:        envInt64("BIGGIE_TOKENS_PER_HOUR", ContextWindow),
		BytesPerSecond:       envInt64("BIGGIE_BYTES_PER_SEC", 4_000_000),
		DirectTokenThreshold: envInt64("BIGGIE_DIRECT_TOKEN_THRESHOLD", DirectTokenThreshold),
		OllamaTimeout:        time.Duration(envInt64("BIGGIE_OLLAMA_TIMEOUT_SECONDS", 900)) * time.Second,
	}
}

func envString(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func firstEnv(first, second, fallback string) string {
	if value := os.Getenv(first); value != "" {
		return value
	}
	return envString(second, fallback)
}

func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return value
}

func envInt64(key string, fallback int64) int64 {
	value, err := strconv.ParseInt(os.Getenv(key), 10, 64)
	if err != nil {
		return fallback
	}
	return value
}
