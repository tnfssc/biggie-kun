#!/usr/bin/env node
import { start, defaultConfig } from "./server.js";

function help() {
  process.stdout.write(
    `biggie-kun - 1B token context window

Usage:
  biggie-kun serve [options]

Options:
  --listen HOST              (default 0.0.0.0)
  --port N                   (default 11500)
  --ollama-host URL          (default http://127.0.0.1:11434)
  --model NAME               controller model in Ollama
  --req-per-hour N           (default 10)
  --tokens-per-hour N        (default 1000000000)
  --bytes-per-sec N          (default 4000000 = 32Mbit/s)
`,
  );
}

function parseArgs(argv) {
  const cfg = defaultConfig();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "-h":
      case "--help":
        help();
        process.exit(0);
        break;
      case "--listen":
        cfg.listen = next();
        break;
      case "--port":
        cfg.port = Number(next());
        break;
      case "--ollama-host":
        cfg.ollamaHost = next();
        break;
      case "--model":
        cfg.model = next();
        break;
      case "--req-per-hour":
        cfg.reqPerHour = Number(next());
        break;
      case "--tokens-per-hour":
        cfg.tokensPerHour = Number(next());
        break;
      case "--bytes-per-sec":
        cfg.bytesPerSec = Number(next());
        break;
      case "--max-request-bytes":
        cfg.maxRequestBytes = Number(next());
        break;
      default:
        process.stderr.write(`unknown arg: ${a}\n`);
        process.exit(2);
    }
  }
  return cfg;
}

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === "-h" || argv[0] === "--help") {
  help();
  process.exit(argv.length ? 0 : 2);
}
const [cmd, ...rest] = argv;
if (cmd !== "serve") {
  process.stderr.write(`unknown command: ${cmd}\n`);
  help();
  process.exit(2);
}
start(parseArgs(rest));
