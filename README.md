<p align="center">
  <img src="assets/logo.svg" alt="biggie-kun" width="160" />
</p>

# biggie-kun

**A chat model with a 1 billion-token context window.**

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21852829.svg)](https://doi.org/10.5281/zenodo.21852829)

Send the whole conversation when you need it. No sessions, uploads, vector
stores, or model-specific client code—just normal OpenAI-compatible chat
completions.

```bash
curl -s http://127.0.0.1:11500/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "biggie-kun",
    "messages": [
      {"role":"user","content":"The launch window is 04:30 UTC."},
      {"role":"user","content":"When is launch?"}
    ]
  }'
```

## API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/` | model homepage |
| `POST` | `/v1/chat/completions` | JSON or streaming chat completion |
| `GET` | `/health` | model readiness |

The endpoint accepts fixed-length and chunked JSON request bodies. There is no
authentication.

### Context

Send the complete conversation in `messages`, exactly as you would with any
other chat-completions model. The context window is 1,000,000,000 estimated
tokens. Token usage follows `ceil(UTF-8 bytes / 4)`.

The default maximum JSON body is 4.1 GB, leaving room for one billion tokens
plus request framing. Configure it with `BIGGIE_MAX_REQUEST_BYTES`.

### Streaming reasoning

```bash
curl -N http://127.0.0.1:11500/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "biggie-kun",
    "stream": true,
    "messages": [{"role":"user","content":"When is the launch?"}]
  }'
```

SSE order:

```text
role → reasoning_content* → content* → finish_reason + usage → [DONE]
```

Set `"include_reasoning": false` to return only answer content.

## Limits

| Limit | Default |
| --- | ---: |
| Context window | 1,000,000,000 tokens |
| Maximum JSON body | 4,100,000,000 bytes |
| Requests / hour / IP | 10 |
| Input tokens / hour / IP | 1,000,000,000 |
| Link pace | 32 Mbit/s |
| Concurrent completions | 1 |

## Build

```bash
docker build -t biggie-kun .
```

Want the implementation details, limitations, self-hosting setup, and the honest
story behind the billion-token window? [Dig deeper](./DIG_DEEPER.md).

## Paper

[**1-Billion-Token Context Window. It’s Absolutely Unreal.**](https://doi.org/10.5281/zenodo.21852829)
is the accompanying preprint. Version 1.0.0 has not been peer reviewed and is
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## License

MIT
