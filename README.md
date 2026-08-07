<p align="center">
  <img src="assets/logo.svg" alt="biggie-kun" width="160" />
</p>

# biggie-kun

**1 billion token context window.** It just works differently.

OpenAI-compatible chat API. No auth. Context stays in RAM. Ships as one opaque
binary in Docker.

```bash
curl -s http://127.0.0.1:11500/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "biggie-kun",
    "messages": [
      {"role":"user","content":"The launch window is 04:30 UTC. When is launch?"}
    ]
  }'
```

## API

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/v1/chat/completions` | only public completion endpoint |
| `GET` | `/health` | liveness + upstream Ollama |

Open. No API keys.

### Memory (`memory_id`)

Optional **server-side RAM session** so later turns can reuse prior context
without resending the full history.

| How to set | Example |
| --- | --- |
| JSON body | `"memory_id": "my-session"` |
| Header | `x-memory-id: my-session` |
| Header | `x-biggie-memory: my-session` |
| OpenAI `user` field | `"user": "alice"` → key `user:alice` |

The response echoes `"memory_id"` when a session is active.

```bash
# turn 1
curl -s http://127.0.0.1:11500/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'x-memory-id: demo' \
  -d '{"model":"biggie-kun","messages":[{"role":"user","content":"Code is CODE-ORANGE99."}]}'

# turn 2 — short message; server still has turn 1 in RAM
curl -s http://127.0.0.1:11500/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'x-memory-id: demo' \
  -d '{"model":"biggie-kun","messages":[{"role":"user","content":"What is the code?"}]}'
```

Notes:
- **Not auth.** Anyone who knows the id can continue that session on this process.
- **RAM only** — never written to disk. Gone on restart, TTL expiry, or size eviction.
- **Optional.** You can instead send a full multi-turn `messages` array (standard OpenAI style) with no `memory_id`.

### Usage

`usage.prompt_tokens` is the size of **your input**
(`ceil(utf8_bytes / 4)`, capped at 1B).  
If you send ~100M tokens of content, the response reports ~100M prompt tokens.

`completion_tokens` = reasoning + answer.  
`completion_tokens_details.reasoning_tokens` = reasoning only.

### Streaming + reasoning

```bash
curl -N http://127.0.0.1:11500/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "biggie-kun",
    "stream": true,
    "include_reasoning": true,
    "messages": [
      {"role":"user","content":"The launch window is 04:30 UTC. When is launch?"}
    ]
  }'
```

SSE order: `role` → `delta.reasoning_content*` → `delta.content*` → `finish_reason` + `usage` → `[DONE]`.  
Set `"include_reasoning": false` to skip thinking.

## Limits

| Limit | Default |
| --- | ---: |
| Requests / hour / IP | 10 |
| Input tokens / hour / IP | 1 000 000 000 |
| Link pace | 32 Mbit/s |
| Global concurrency | 1 |

IP from `CF-Connecting-IP`, then `X-Forwarded-For`, then the socket.

## How it works

Small contexts answer in one pass. Large contexts stay in a RAM index; the
controller model issues bounded recall steps, then a presenter rewrites the
public answer so internals never leak. From the outside it is one model with a
1B-token window.

## Quick start

### Docker

```bash
docker build -t biggie-kun .
docker run --rm --network host \
  -e OLLAMA_HOST=http://127.0.0.1:11434 \
  biggie-kun serve --model llama3.2
```

Needs a reachable [Ollama](https://ollama.com) with your controller model.

### Dev

```bash
cd server
node --test
node src/cli.js serve --model llama3.2
```

### Compose + Cloudflare Tunnel

See [`deploy/`](./deploy) — same pattern as a typical self-hosted stack:

```bash
cp deploy/.env.example deploy/.env
# set CLOUDFLARED_TUNNEL_TOKEN (hostname → http://biggie-kun:11500)
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

## Layout

```
server/          Node gateway + RAM memory + presenter
deploy/          docker compose + cloudflared
assets/          logo + favicon
Dockerfile       bun --compile → single binary, no sources in runtime image
```

## License

MIT
