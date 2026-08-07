# Dig deeper

The honest version: biggie-kun does not give its underlying transformer a
native one-billion-token attention window. It presents a billion-token context
window by keeping the request text local, indexing it, and letting a smaller
model retrieve bounded pieces over several turns. We cheated—and that is the
point of the project.

From the client’s perspective it remains one ordinary chat-completions model.
The client sends the full conversation on every request. There are no session
IDs and no server-side conversation store.

## Request lifecycle

1. The HTTP handler streams and decodes one bounded JSON body.
2. Inputs up to 24,000 estimated tokens are sent through directly.
3. Larger inputs are divided into overlapping byte blocks and indexed in RAM.
4. A controller model searches for specific terms, reads candidate blocks, and
   may repeat this process for multiple hops.
5. A finish action is accepted only when the cited evidence contains the answer.
6. A presenter turns the extractive draft into the public answer.
7. The request-scoped corpus, block table, postings, evidence, and transcript
   references are released when the completion ends. Nothing is retained for a
   later request.

This is closer to an agentic document reader hidden behind a model endpoint than
to extending a transformer’s attention matrix to one billion tokens.

## Why it can scale

The corpus is stored once after JSON decoding. For the common request shape—one
large context message followed by one question—the index points directly into
that string instead of constructing another multi-gigabyte transcript.

Blocks store byte offsets. Term postings use 32-bit block IDs, cap the number of
postings for common terms, and cap the total vocabulary. Extremely common terms
are discarded because they are not useful retrieval keys.

The controller reads at most a configured number of source bytes and takes at
most a configured number of turns. The underlying model therefore sees a small,
bounded prompt even when the client supplied gigabytes.

## What “1 billion tokens” means

Usage accounting is `ceil(UTF-8 bytes / 4)`. A billion-token context therefore
corresponds to roughly 4 GB of UTF-8 message content. The default HTTP body limit
is 4.1 GB to leave room for JSON framing.

This needs substantial host memory. During decoding and indexing, budget beyond
the 4 GB corpus for the Go heap, block metadata, postings, model runtime, and
temporary allocations. Reverse proxies may impose much smaller upload limits.

The repository’s opt-in full-scale test constructs an exact 4,000,000,000-byte
corpus, builds the production index, retrieves a unique record near the end, and
reads the answer-bearing block:

```bash
cd server
BIGGIE_REAL_TEST_BYTES=4000000000 \
  go test -run TestRealHundredMillionTokenIndex -count=1 -v
```

The normal test suite performs the same real retrieval path over 400 MB, or
about 100 million estimated tokens.

## Reasoning stream

For large requests, every controller turn emits a short public
`reasoning_content` delta after its action completes. A final reasoning pass is
then streamed in small chunks before answer content. Set
`include_reasoning: false` to disable all reasoning deltas.

These updates are intentionally phrased as user-facing reasoning rather than a
dump of controller JSON, block identifiers, or internal prompts.

## Accuracy trade-offs

The one-billion-token window is addressable, not equivalent to native global
attention:

- Retrieval is lexical, so questions without useful shared terms can miss the
  right block.
- Multi-hop answers depend on the controller discovering the next identifier.
- Highly duplicated keys require reading every plausible match within budget.
- The presenter can improve phrasing but cannot recover facts the retrieval
  phase never found.
- The server deliberately returns an insufficient-context answer rather than
  accepting an ungrounded extractive result.

## Self-hosting

The binary uses an Ollama chat model as its controller, direct-answer model,
presenter, and reasoning voice.

```bash
docker build -t biggie-kun .
docker run --rm --network host \
  -e OLLAMA_HOST=http://127.0.0.1:11434 \
  biggie-kun serve --model llama3.2
```

Or use the Cloudflare Tunnel deployment:

```bash
cp deploy/.env.example deploy/.env
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

For tunnel deployments, the public hostname should target
`http://biggie-kun:11500`. Cloudflare plan limits can be lower than the app’s
4.1 GB body limit; use a direct or suitably configured private route for the
largest requests.

## Development

```bash
cd server
go test ./...
go test -race ./...
go run ./cmd/biggie-kun serve --model llama3.2
```

The final container is a pinned, non-root distroless image containing one static
Go binary.
