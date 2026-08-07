package main

import (
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"

	biggie "github.com/tnfssc/biggie-kun/server"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" {
		fmt.Print(help)
		if len(args) == 0 {
			return fmt.Errorf("a command is required")
		}
		return nil
	}

	switch args[0] {
	case "serve":
		if len(args) == 2 && (args[1] == "-h" || args[1] == "--help") {
			fmt.Print(help)
			return nil
		}
		cfg, err := parseServeArgs(args[1:])
		if err != nil {
			return err
		}
		return biggie.NewServer(cfg, biggie.NewOllamaClient(cfg.OllamaHost, cfg.OllamaTimeout)).ListenAndServe()
	case "healthcheck":
		url := "http://127.0.0.1:11500/health"
		if len(args) > 2 {
			return fmt.Errorf("usage: biggie-kun healthcheck [URL]")
		}
		if len(args) == 2 {
			url = args[1]
		}
		client := &http.Client{Timeout: 4 * time.Second}
		response, err := client.Get(url)
		if err != nil {
			return err
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return fmt.Errorf("healthcheck returned %s", response.Status)
		}
		return nil
	default:
		return fmt.Errorf("unknown command: %s", args[0])
	}
}

func parseServeArgs(args []string) (biggie.Config, error) {
	cfg := biggie.DefaultConfig()
	for i := 0; i < len(args); i++ {
		if i+1 >= len(args) {
			return cfg, fmt.Errorf("missing value for %s", args[i])
		}
		value := args[i+1]
		i++
		var err error
		switch args[i-1] {
		case "--listen":
			cfg.Listen = value
		case "--port":
			cfg.Port, err = strconv.Atoi(value)
		case "--ollama-host":
			cfg.OllamaHost = value
		case "--model":
			cfg.Model = value
		case "--req-per-hour":
			cfg.RequestsPerHour, err = strconv.Atoi(value)
		case "--tokens-per-hour":
			cfg.TokensPerHour, err = strconv.ParseInt(value, 10, 64)
		case "--bytes-per-sec":
			cfg.BytesPerSecond, err = strconv.ParseInt(value, 10, 64)
		case "--max-request-bytes":
			cfg.MaxRequestBytes, err = strconv.ParseInt(value, 10, 64)
		default:
			return cfg, fmt.Errorf("unknown option: %s", args[i-1])
		}
		if err != nil {
			return cfg, fmt.Errorf("invalid value for %s: %w", args[i-1], err)
		}
	}
	return cfg, nil
}

const help = `biggie-kun - 1B token context window

Usage:
  biggie-kun serve [options]
  biggie-kun healthcheck [URL]

Options:
  --listen HOST
  --port N
  --ollama-host URL
  --model NAME
  --req-per-hour N
  --tokens-per-hour N
  --bytes-per-sec N
  --max-request-bytes N
`
