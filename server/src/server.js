import http from "node:http";
import { randomUUID } from "node:crypto";
import {
  CONTEXT_WINDOW,
  DIRECT_TOKEN_THRESHOLD,
  PRODUCT,
  completeChat,
  handleChatCompletion,
} from "./chat.js";
import {
  BandwidthThrottle,
  DEFAULT_BYTES_PER_SEC,
  DEFAULT_REQ_PER_HOUR,
  DEFAULT_TOKENS_PER_HOUR,
  GlobalSingleFlight,
  HourlyLimiter,
  estimateTokens,
  readThrottled,
  writeThrottled,
} from "./limits.js";
import { ram } from "./memory.js";
import { ollamaHealthy } from "./ollama.js";
import { streamCompletion } from "./stream.js";

export function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  return req.socket.remoteAddress || "0.0.0.0";
}

function sendJson(res, status, payload, throttle, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", String(body.length));
  res.setHeader("x-biggie-context-window", String(CONTEXT_WINDOW));
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  return writeThrottled(res, body, throttle).then(
    () =>
      new Promise((resolve) => {
        res.end(() => resolve());
      }),
  );
}

function rateHeaders(info) {
  return {
    "retry-after": String(info.reset_seconds ?? 3600),
    "x-ratelimit-limit-requests": String(info.requests_limit),
    "x-ratelimit-remaining-requests": String(
      Math.max(0, info.requests_limit - info.requests_used),
    ),
    "x-ratelimit-limit-tokens": String(info.tokens_limit),
    "x-ratelimit-remaining-tokens": String(info.tokens_remaining),
    "x-ratelimit-reset": String(info.reset_seconds),
  };
}

export function createServer(cfg) {
  const limiter = new HourlyLimiter({
    reqPerHour: cfg.reqPerHour,
    tokensPerHour: cfg.tokensPerHour,
  });
  const flight = new GlobalSingleFlight();
  const throttle = new BandwidthThrottle(cfg.bytesPerSec);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    try {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("access-control-allow-origin", "*");
        res.setHeader("access-control-allow-headers", "*");
        res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
        res.end();
        return;
      }

      if (req.method === "GET" && path === "/health") {
        const health = await ollamaHealthy(cfg.ollamaHost);
        const ok = health === true;
        await sendJson(
          res,
          ok ? 200 : 503,
          {
            status: ok ? "ok" : "degraded",
            product: PRODUCT,
            context_window: CONTEXT_WINDOW,
            ollama_reachable: ok,
            ollama_error: ok ? null : health?.error || "unreachable",
            model: cfg.model,
            stream: true,
            reasoning: true,
            limits: {
              req_per_hour: cfg.reqPerHour,
              tokens_per_hour: cfg.tokensPerHour,
              bytes_per_sec: cfg.bytesPerSec,
              global_concurrency: 1,
              auth: "none",
            },
            memory: ram.stats(),
            busy: flight.busy(),
          },
          throttle,
        );
        return;
      }

      if (req.method === "POST" && path === "/v1/chat/completions") {
        const ip = clientIp(req);
        const holder = `${ip}:${randomUUID()}`;
        const length = Number.parseInt(req.headers["content-length"] || "0", 10);
        if (!Number.isFinite(length) || length <= 0) {
          await sendJson(
            res,
            400,
            { error: { message: "empty body", type: "bad_request", code: "bad_request" } },
            throttle,
          );
          return;
        }
        if (length > cfg.maxRequestBytes) {
          await sendJson(
            res,
            413,
            {
              error: {
                message: `body exceeds max_request_bytes (${cfg.maxRequestBytes})`,
                type: "payload_too_large",
                code: "payload_too_large",
              },
            },
            throttle,
          );
          return;
        }

        const pre = limiter.check(ip, Math.max(1, Math.floor(length / 4)));
        if (!pre.ok) {
          await sendJson(
            res,
            429,
            {
              error: {
                message: "hourly budget exceeded",
                type: pre.reason,
                code: pre.reason,
                extra: pre.info,
              },
            },
            throttle,
            rateHeaders(pre.info),
          );
          return;
        }

        if (!flight.tryAcquire(holder)) {
          await sendJson(
            res,
            503,
            {
              error: {
                message: "one request is already in flight; retry shortly",
                type: "server_busy",
                code: "server_busy",
              },
            },
            throttle,
            { "retry-after": "5" },
          );
          return;
        }

        try {
          const raw = await readThrottled(req, cfg.maxRequestBytes, throttle);
          let body;
          try {
            body = JSON.parse(raw.toString("utf8"));
          } catch {
            await sendJson(
              res,
              400,
              {
                error: {
                  message: "body must be UTF-8 JSON",
                  type: "bad_request",
                  code: "bad_request",
                },
              },
              throttle,
            );
            return;
          }
          if (!body || typeof body !== "object" || Array.isArray(body)) {
            await sendJson(
              res,
              400,
              {
                error: {
                  message: "body must be a JSON object",
                  type: "bad_request",
                  code: "bad_request",
                },
              },
              throttle,
            );
            return;
          }

          const joinedPreview = Array.isArray(body.messages)
            ? body.messages
                .map((m) => {
                  if (!m || m.content == null) return "";
                  return typeof m.content === "string"
                    ? m.content
                    : JSON.stringify(m.content);
                })
                .join("")
            : "";
          const promptTokens =
            estimateTokens(joinedPreview) || Math.ceil(raw.length / 4);
          raw.fill?.(0);
          const budget = limiter.check(ip, promptTokens);
          if (!budget.ok) {
            await sendJson(
              res,
              429,
              {
                error: {
                  message: "hourly budget exceeded",
                  type: budget.reason,
                  code: budget.reason,
                  extra: budget.info,
                },
              },
              throttle,
              rateHeaders(budget.info),
            );
            return;
          }

          const stream = body.stream === true;
          try {
            if (stream) {
              const result = await completeChat(body, cfg, req.headers);
              const billed = result.usage?.prompt_tokens || promptTokens;
              const rate = limiter.commit(ip, billed);
              await streamCompletion(res, throttle, {
                id: result.id,
                model: result.model,
                reasoning: result.reasoning,
                content: result.content,
                usage: result.usage,
                extraHeaders: {
                  "x-biggie-context-window": String(CONTEXT_WINDOW),
                  ...rateHeaders(rate),
                },
              });
            } else {
              const result = await handleChatCompletion(body, cfg, req.headers);
              const billed = result?.usage?.prompt_tokens || promptTokens;
              const rate = limiter.commit(ip, billed);
              await sendJson(res, 200, result, throttle, rateHeaders(rate));
            }
          } catch (error) {
            const code = error.code || "internal_error";
            const status =
              code === "bad_request" ? 400 : error.status ? 502 : 500;
            if (!res.headersSent) {
              await sendJson(
                res,
                status,
                {
                  error: {
                    message: String(error.message || error),
                    type: code,
                    code,
                  },
                },
                throttle,
              );
            } else {
              res.destroy(error);
            }
            return;
          }
        } finally {
          flight.release(holder);
        }
        return;
      }

      await sendJson(
        res,
        404,
        {
          error: {
            message: "only GET /health and POST /v1/chat/completions",
            type: "not_found",
            code: "not_found",
          },
        },
        throttle,
      );
    } catch (error) {
      if (!res.headersSent) {
        await sendJson(
          res,
          error.code === "payload_too_large" ? 413 : 500,
          {
            error: {
              message: String(error.message || error),
              type: error.code || "internal_error",
              code: error.code || "internal_error",
            },
          },
          throttle,
        );
      } else {
        res.destroy(error);
      }
    }
  });

  return server;
}

export function defaultConfig(env = process.env) {
  return {
    listen: env.BIGGIE_LISTEN || "0.0.0.0",
    port: Number(env.BIGGIE_PORT || 11500),
    ollamaHost: env.OLLAMA_HOST || env.BIGGIE_OLLAMA_HOST || "http://127.0.0.1:11434",
    model: env.BIGGIE_MODEL || "llama3.2",
    maxRequestBytes: Number(env.BIGGIE_MAX_REQUEST_BYTES || 512_000_000),
    maxTurns: Number(env.BIGGIE_MAX_TURNS || 10),
    numCtx: Number(env.BIGGIE_NUM_CTX || 32768),
    scanCharacters: Number(env.BIGGIE_SCAN_CHARACTERS || 400_000),
    blockCharacters: Number(env.BIGGIE_BLOCK_CHARACTERS || 16_384),
    blockOverlap: Number(env.BIGGIE_BLOCK_OVERLAP || 512),
    maxPostings: Number(env.BIGGIE_MAX_POSTINGS || 4096),
    maxTerms: Number(env.BIGGIE_MAX_TERMS || 250_000),
    reqPerHour: Number(env.BIGGIE_REQ_PER_HOUR || DEFAULT_REQ_PER_HOUR),
    tokensPerHour: Number(env.BIGGIE_TOKENS_PER_HOUR || DEFAULT_TOKENS_PER_HOUR),
    bytesPerSec: Number(env.BIGGIE_BYTES_PER_SEC || DEFAULT_BYTES_PER_SEC),
    directTokenThreshold: Number(
      env.BIGGIE_DIRECT_TOKEN_THRESHOLD || DIRECT_TOKEN_THRESHOLD,
    ),
  };
}

export function start(cfg = defaultConfig()) {
  const server = createServer(cfg);
  server.listen(cfg.port, cfg.listen, () => {
    process.stdout.write(
      `${JSON.stringify({
        product: PRODUCT,
        context_window: CONTEXT_WINDOW,
        listen: cfg.listen,
        port: cfg.port,
        ollama_host: cfg.ollamaHost,
        model: cfg.model,
        endpoint: "/v1/chat/completions",
        stream: true,
        reasoning: true,
        auth: "none",
        memory: "ram",
        disk_context: false,
        limits: {
          req_per_hour: cfg.reqPerHour,
          tokens_per_hour: cfg.tokensPerHour,
          bytes_per_sec: cfg.bytesPerSec,
          global_concurrency: 1,
        },
      })}\n`,
    );
  });
  return server;
}
