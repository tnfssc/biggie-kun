export const DEFAULT_REQ_PER_HOUR = 10;
export const DEFAULT_TOKENS_PER_HOUR = 1_000_000_000;
export const DEFAULT_BITS_PER_SEC = 32_000_000;
export const DEFAULT_BYTES_PER_SEC = DEFAULT_BITS_PER_SEC / 8;
export const HOUR_MS = 60 * 60 * 1000;

/**
 * Token count for usage accounting = size of the caller's text.
 * Public convention: ceil(utf8_bytes / 4). Never invent backend crumb counts.
 * 400_000_000 bytes of input => 100_000_000 prompt_tokens.
 */
export function estimateTokens(text) {
  if (text == null || text === "") return 0;
  const bytes = Buffer.byteLength(String(text), "utf8");
  if (bytes <= 0) return 0;
  return Math.ceil(bytes / 4);
}

/** Sum token counts of message contents only (the caller's input). */
export function estimateMessagesTokens(messages) {
  let total = 0;
  for (const msg of messages || []) {
    if (msg && msg.content != null) total += estimateTokens(msg.content);
  }
  return total;
}

export class HourlyLimiter {
  constructor({
    reqPerHour = DEFAULT_REQ_PER_HOUR,
    tokensPerHour = DEFAULT_TOKENS_PER_HOUR,
  } = {}) {
    this.reqPerHour = reqPerHour;
    this.tokensPerHour = tokensPerHour;
    /** @type {Map<string, Array<{t:number, tokens:number}>>} */
    this.events = new Map();
  }

  prune(key, now = Date.now()) {
    const cutoff = now - HOUR_MS;
    const list = this.events.get(key) || [];
    const kept = list.filter((e) => e.t >= cutoff);
    this.events.set(key, kept);
    return kept;
  }

  snapshot(key, now = Date.now()) {
    const list = this.prune(key, now);
    const tokensUsed = list.reduce((sum, e) => sum + e.tokens, 0);
    const resetMs = list.length ? HOUR_MS - (now - list[0].t) : HOUR_MS;
    return {
      requests_used: list.length,
      requests_limit: this.reqPerHour,
      tokens_used: tokensUsed,
      tokens_limit: this.tokensPerHour,
      tokens_remaining: Math.max(0, this.tokensPerHour - tokensUsed),
      reset_seconds: Math.max(1, Math.ceil(resetMs / 1000)),
    };
  }

  check(key, tokens) {
    const info = this.snapshot(key);
    if (info.requests_used >= this.reqPerHour) {
      return { ok: false, reason: "rate_limit_requests", info };
    }
    if (info.tokens_used + Math.max(0, tokens) > this.tokensPerHour) {
      return { ok: false, reason: "rate_limit_tokens", info };
    }
    return { ok: true, reason: "ok", info };
  }

  commit(key, tokens) {
    const now = Date.now();
    const list = this.prune(key, now);
    list.push({ t: now, tokens: Math.max(0, Math.floor(tokens)) });
    this.events.set(key, list);
    return this.snapshot(key, now);
  }
}

export class GlobalSingleFlight {
  constructor() {
    this.holder = null;
  }

  tryAcquire(holder) {
    if (this.holder != null) return false;
    this.holder = holder;
    return true;
  }

  release(holder) {
    if (this.holder === holder) this.holder = null;
  }

  busy() {
    return this.holder != null;
  }
}

export class BandwidthThrottle {
  constructor(bytesPerSec = DEFAULT_BYTES_PER_SEC) {
    this.bytesPerSec = Math.max(1, Math.floor(bytesPerSec));
    this.tokens = this.bytesPerSec;
    this.updated = performance.now();
    this.chain = Promise.resolve();
  }

  refill() {
    const now = performance.now();
    const elapsed = (now - this.updated) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(
        this.bytesPerSec,
        this.tokens + elapsed * this.bytesPerSec,
      );
      this.updated = now;
    }
  }

  async wait(nbytes) {
    if (nbytes <= 0) return;
    let remaining = nbytes;
    while (remaining > 0) {
      this.refill();
      if (this.tokens >= 1) {
        const take = Math.min(remaining, this.tokens);
        this.tokens -= take;
        remaining -= take;
        continue;
      }
      const need = Math.min(remaining, this.bytesPerSec);
      const sleepFor = Math.min(250, (need / this.bytesPerSec) * 1000);
      await new Promise((r) => setTimeout(r, Math.max(1, sleepFor)));
    }
  }

  /** Serialize paced writes/reads through one queue. */
  schedule(nbytes) {
    const run = this.chain.then(() => this.wait(nbytes));
    this.chain = run.catch(() => {});
    return run;
  }
}

export async function readThrottled(req, limit, throttle) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limit) {
      const err = new Error("payload_too_large");
      err.code = "payload_too_large";
      throw err;
    }
    await throttle.schedule(buf.length);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export async function writeThrottled(res, body, throttle) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const chunkSize = 64 * 1024;
  for (let offset = 0; offset < buf.length; offset += chunkSize) {
    const slice = buf.subarray(offset, offset + chunkSize);
    await throttle.schedule(slice.length);
    await new Promise((resolve, reject) => {
      res.write(slice, (err) => (err ? reject(err) : resolve()));
    });
  }
}
