import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BandwidthThrottle,
  GlobalSingleFlight,
  HourlyLimiter,
  estimateTokens,
} from "../src/limits.js";
import { parseAction } from "../src/agent.js";
import { LocalBlockIndex } from "../src/block_index.js";
import { normalizeMessages, splitQuestionAndDocument } from "../src/chat.js";

describe("limits", () => {
  it("estimates tokens", () => {
    assert.equal(estimateTokens(""), 0);
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("a".repeat(400)), 100);
  });

  it("enforces request budget", () => {
    const limiter = new HourlyLimiter({ reqPerHour: 2, tokensPerHour: 10_000 });
    assert.equal(limiter.check("1.1.1.1", 10).ok, true);
    limiter.commit("1.1.1.1", 10);
    limiter.commit("1.1.1.1", 10);
    const blocked = limiter.check("1.1.1.1", 10);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "rate_limit_requests");
  });

  it("enforces token budget", () => {
    const limiter = new HourlyLimiter({ reqPerHour: 100, tokensPerHour: 100 });
    limiter.commit("2.2.2.2", 80);
    const blocked = limiter.check("2.2.2.2", 30);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "rate_limit_tokens");
    assert.equal(blocked.info.tokens_remaining, 20);
  });

  it("single flight", () => {
    const flight = new GlobalSingleFlight();
    assert.equal(flight.tryAcquire("a"), true);
    assert.equal(flight.tryAcquire("b"), false);
    flight.release("a");
    assert.equal(flight.tryAcquire("b"), true);
  });

  it("throttle waits", async () => {
    const throttle = new BandwidthThrottle(200_000);
    const t0 = performance.now();
    await throttle.wait(100_000);
    assert.ok(performance.now() - t0 >= 0);
  });
});

describe("agent helpers", () => {
  it("parses first json action", () => {
    const action = parseAction(
      '{"action":"search","queries":["KEY"]}\n{"action":"finish"}',
    );
    assert.equal(action.action, "search");
  });

  it("indexes and finds a block", () => {
    const source = "ordinary filler\nTARGET CASE-ABC has CODE-XYZ\nmore filler\n";
    const index = new LocalBlockIndex(source, {
      blockCharacters: 40,
      blockOverlap: 8,
    });
    const hit = index.search(["CASE-ABC"], 4)[0];
    assert.match(hit.snippet, /CASE-ABC/);
  });
});

describe("chat split", () => {
  it("uses last user as question", () => {
    const messages = normalizeMessages([
      { role: "system", content: "sys" },
      { role: "user", content: "huge doc about CASE-1" },
      { role: "user", content: "What is CASE-1?" },
    ]);
    const { question, document } = splitQuestionAndDocument(messages);
    assert.equal(question, "What is CASE-1?");
    assert.match(document, /huge doc/);
  });
});

import { fallbackPresent, looksLikeLeak } from "../src/presenter.js";
import { buildUsage, CONTEXT_WINDOW } from "../src/chat.js";
import { RamMemory } from "../src/memory.js";

describe("presenter seal", () => {
  it("flags internal leaks", () => {
    assert.equal(looksLikeLeak("answer is 42"), false);
    assert.equal(looksLikeLeak("see evidence_id e1"), true);
    assert.equal(looksLikeLeak("I used agentic search"), true);
    assert.equal(looksLikeLeak("[e1 bytes 10-20]"), true);
  });

  it("fallback never emits insufficient token", () => {
    const out = fallbackPresent("INSUFFICIENT_EVIDENCE", "");
    assert.equal(out.includes("INSUFFICIENT_EVIDENCE"), false);
    assert.match(out, /cannot find/i);
  });

  it("fallback keeps grounded draft", () => {
    const out = fallbackPresent("04:30 UTC", "Cafe opens at 04:30 UTC daily.");
    assert.equal(out, "04:30 UTC");
  });
});

describe("usage mirrors caller input", () => {
  it("100M-token-scale input reports ~100M prompt_tokens", () => {
    // 400_000_000 UTF-8 bytes / 4 = 100_000_000 tokens
    const input = "a".repeat(400_000_000);
    const usage = buildUsage(input, "", "ok");
    assert.equal(usage.prompt_tokens, 100_000_000);
    assert.equal(usage.completion_tokens, 1); // "ok" is 2 bytes -> ceil(2/4)=1
    assert.equal(usage.completion_tokens_details.reasoning_tokens, 0);
    assert.equal(usage.total_tokens, 100_000_001);
  });

  it("counts reasoning into completion_tokens", () => {
    const input = "x".repeat(400); // 100 tokens
    const reasoning = "y".repeat(40); // 10 tokens
    const answer = "hello"; // 2 tokens
    const usage = buildUsage(input, reasoning, answer);
    assert.equal(usage.prompt_tokens, 100);
    assert.equal(usage.completion_tokens_details.reasoning_tokens, 10);
    assert.equal(usage.completion_tokens, 12);
    assert.equal(usage.total_tokens, 112);
  });
});

import { chunkText } from "../src/thinker.js";

describe("stream chunks", () => {
  it("splits reasoning into pieces", () => {
    const parts = chunkText("hello world from biggie", 8);
    assert.ok(parts.length >= 2);
    assert.equal(parts.join(""), "hello world from biggie");
  });
});

describe("ram memory", () => {
  it("never needs disk and merges sessions", () => {
    const mem = new RamMemory({ maxChars: 1000 });
    const a = mem.load("s1", "hello corpus");
    assert.equal(a.fromSession, false);
    mem.save("s1", a.text);
    const b = mem.load("s1", "new question");
    assert.equal(b.fromSession, true);
    assert.match(b.text, /hello corpus/);
    assert.match(b.text, /new question/);
    assert.equal(mem.stats().disk, false);
    assert.equal(mem.stats().storage, "ram");
  });
});
