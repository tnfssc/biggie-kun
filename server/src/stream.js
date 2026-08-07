import { writeThrottled } from "./limits.js";

export function sseHeaders(res, extra = {}) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
}

export async function writeSse(res, throttle, payload) {
  const line =
    payload === "[DONE]"
      ? "data: [DONE]\n\n"
      : `data: ${JSON.stringify(payload)}\n\n`;
  await writeThrottled(res, Buffer.from(line, "utf8"), throttle);
}

export function makeChunk({
  id,
  model,
  created,
  delta,
  finishReason = null,
  usage = undefined,
}) {
  const chunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
  if (usage) chunk.usage = usage;
  return chunk;
}

export async function streamCompletion(res, throttle, {
  id,
  model,
  reasoning,
  content,
  usage,
  extraHeaders = {},
}) {
  sseHeaders(res, extraHeaders);
  // Flush headers
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const created = Math.floor(Date.now() / 1000);

  await writeSse(
    res,
    throttle,
    makeChunk({
      id,
      model,
      created,
      delta: { role: "assistant" },
    }),
  );

  if (reasoning) {
    const { chunkText } = await import("./thinker.js");
    for (const piece of chunkText(reasoning)) {
      await writeSse(
        res,
        throttle,
        makeChunk({
          id,
          model,
          created: Math.floor(Date.now() / 1000),
          delta: { reasoning_content: piece },
        }),
      );
    }
  }

  if (content) {
    const { chunkText } = await import("./thinker.js");
    for (const piece of chunkText(content, 32)) {
      await writeSse(
        res,
        throttle,
        makeChunk({
          id,
          model,
          created: Math.floor(Date.now() / 1000),
          delta: { content: piece },
        }),
      );
    }
  }

  await writeSse(
    res,
    throttle,
    makeChunk({
      id,
      model,
      created: Math.floor(Date.now() / 1000),
      delta: {},
      finishReason: "stop",
      usage,
    }),
  );
  await writeSse(res, throttle, "[DONE]");
  await new Promise((resolve) => res.end(resolve));
}
