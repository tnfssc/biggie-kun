import { randomUUID } from "node:crypto";
import { LocalBlockIndex } from "./block_index.js";
import { runAgent } from "./agent.js";
import { estimateMessagesTokens, estimateTokens } from "./limits.js";
import { ram } from "./memory.js";
import { ollamaChat } from "./ollama.js";
import { isInternalProbe, presentAnswer, presentDirect } from "./presenter.js";

export const PRODUCT = "biggie-kun";
export const CONTEXT_WINDOW = 1_000_000_000;
export const DIRECT_TOKEN_THRESHOLD = 24_000;

export function messageText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          if (item.type === "text" && typeof item.text === "string") return item.text;
          if (typeof item.content === "string") return item.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(content);
}

export function normalizeMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("messages must be a non-empty array");
  }
  const messages = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      throw new Error("each message must be an object");
    }
    const role = item.role;
    if (!["system", "user", "assistant", "tool"].includes(role)) {
      throw new Error("message.role must be system|user|assistant|tool");
    }
    messages.push({ role, content: messageText(item.content).replace(/\0/g, "") });
  }
  if (!messages.some((m) => m.content.trim())) {
    throw new Error("messages contain no text");
  }
  return messages;
}

export function transcriptOf(messages) {
  return messages
    .filter((m) => m.content.trim())
    .map((m) => `[${m.role}]\n${m.content.trim()}`)
    .join("\n\n");
}

export function splitQuestionAndDocument(messages) {
  let lastUser = "";
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && messages[i].content.trim()) {
      lastUser = messages[i].content.trim();
      lastUserIndex = i;
      break;
    }
  }
  if (!lastUser) {
    lastUser = messages[messages.length - 1].content.trim();
    lastUserIndex = messages.length - 1;
  }
  const parts = [];
  for (let i = 0; i < messages.length; i++) {
    if (i === lastUserIndex) continue;
    if (!messages[i].content.trim()) continue;
    parts.push(`[${messages[i].role}]\n${messages[i].content.trim()}`);
  }
  return { question: lastUser, document: parts.join("\n\n") };
}

/**
 * usage.prompt_tokens = the caller's input size (what they put in).
 * If they send ~100M tokens of content, we report ~100_000_000 — never backend crumbs.
 * usage.completion_tokens = size of the assistant output only.
 */
export function buildUsage(inputText, completionText) {
  const prompt_tokens = Math.min(CONTEXT_WINDOW, estimateTokens(inputText));
  const completion_tokens = estimateTokens(completionText);
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens: Math.min(
      CONTEXT_WINDOW + completion_tokens,
      prompt_tokens + completion_tokens,
    ),
  };
}

/**
 * @param {object} opts
 * @param {string} opts.model
 * @param {string} opts.content - assistant output
 * @param {string} opts.inputText - caller's full input text for this turn's window
 * @param {string|null} [opts.memoryId]
 */
export function openaiResponse({ model, content, inputText, memoryId }) {
  const usage = buildUsage(inputText, content);
  const payload = {
    id: `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage,
  };
  if (memoryId) payload.memory_id = memoryId;
  return payload;
}

function evidenceBlob(evidence) {
  return Object.values(evidence || {})
    .map((item) => item?.text || "")
    .filter(Boolean)
    .join("\n---\n");
}

function sessionKey(body, reqHeaders) {
  const header =
    reqHeaders?.["x-memory-id"] ||
    reqHeaders?.["x-biggie-memory"] ||
    body?.memory_id;
  if (typeof header === "string" && header.trim()) return header.trim().slice(0, 128);
  // OpenAI `user` field is a stable end-user id — use as RAM memory key when set.
  if (typeof body?.user === "string" && body.user.trim()) {
    return `user:${body.user.trim().slice(0, 120)}`;
  }
  return null;
}

export async function handleChatCompletion(body, cfg, reqHeaders = {}) {
  const messages = normalizeMessages(body.messages);
  if (body.stream === true) {
    const err = new Error("stream=true is not supported");
    err.code = "bad_request";
    throw err;
  }

  const publicModel =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : "biggie-kun";
  const backendModel = cfg.model;
  const temperature = Number.isFinite(Number(body.temperature))
    ? Number(body.temperature)
    : 0;
  const maxTokens = Math.max(
    1,
    Math.min(Number.parseInt(body.max_tokens, 10) || 1024, 8192),
  );

  const memoryId = sessionKey(body, reqHeaders);
  // Caller's input = raw message contents (what they sent). Plus prior RAM memory.
  const requestInputText = messages.map((m) => m.content).join("");
  const requestTranscript = transcriptOf(messages);
  // One continuous memory blob in RAM (prior session + this request).
  const loaded = ram.load(memoryId, requestTranscript);
  const contextText = loaded.text;
  // prompt_tokens must reflect everything in the window that came from them.
  const inputForUsage = memoryId && loaded.fromSession
    ? loaded.text
        .replace(/^\[(?:system|user|assistant|tool)\]\n/gm, "")
        .replace(/\n\n---\n\n/g, "")
    : requestInputText;
  const contextTokens = estimateTokens(contextText);

  const { question, document: requestDoc } = splitQuestionAndDocument(messages);

  // Seal internals probes before any model / agent work.
  if (isInternalProbe(question)) {
    const content = "I can only help with the content in context.";
    return openaiResponse({
      model: publicModel,
      content,
      inputText: inputForUsage,
      memoryId,
    });
  }

  // Resolve the remembered corpus + current question.
  let doc = requestDoc;
  let q = question;
  if (memoryId && loaded.fromSession) {
    // Prior RAM memory is the long-term corpus; last user turn is the question.
    doc = loaded.text;
    q = question;
  } else if (!doc.trim()) {
    doc = contextText;
  }

  let content;

  // Always answer from the single RAM memory blob + latest question.
  // Small blobs go through one chat call; large blobs use in-RAM recall.
  // Either way usage/prompt counts the whole memory as one context window.
  const memoryMessages = [
    {
      role: "system",
      content:
        "You are a large-context assistant. MEMORY is everything you know for this conversation. Answer only from MEMORY. Do not invent facts.",
    },
    {
      role: "user",
      content: `MEMORY:\n${contextText}\n\nLATEST REQUEST:\n${question}`,
    },
  ];

  if (contextTokens <= cfg.directTokenThreshold) {
    const result = await ollamaChat({
      host: cfg.ollamaHost,
      model: backendModel,
      messages: memoryMessages,
      numCtx: cfg.numCtx,
      numPredict: maxTokens,
      temperature,
    });
    const draft = String(result?.message?.content ?? "");
    content = await presentAnswer({
      host: cfg.ollamaHost,
      model: backendModel,
      numCtx: cfg.numCtx,
      userQuestion: question,
      draftAnswer: draft,
      evidenceText: contextText,
      maxTokens,
    });
  } else {
    const corpus = doc.trim() ? doc : contextText;
    const index = new LocalBlockIndex(corpus, {
      blockCharacters: cfg.blockCharacters,
      maxPostings: cfg.maxPostings,
      blockOverlap: cfg.blockOverlap,
      maxTerms: cfg.maxTerms,
    });
    const agent = await runAgent(index, q, {
      host: cfg.ollamaHost,
      model: backendModel,
      maxTurns: cfg.maxTurns,
      numCtx: cfg.numCtx,
      scanCharacterBudget: cfg.scanCharacters,
    });
    const draft = agent.answer || "INSUFFICIENT_EVIDENCE";
    const evidenceText = evidenceBlob(agent.evidence) || corpus.slice(0, 120_000);
    content = await presentAnswer({
      host: cfg.ollamaHost,
      model: backendModel,
      numCtx: cfg.numCtx,
      userQuestion: question,
      draftAnswer: draft,
      evidenceText,
      maxTokens,
    });
    // Drop index — GC only, never flushed to disk.
    index.source = "";
    index.blocks.length = 0;
    index.postings.clear();
  }

  // Append assistant turn into RAM memory so it stays one continuous thing.
  if (memoryId) {
    const next = `${contextText}\n\n[assistant]\n${content}`;
    ram.save(memoryId, next);
  }

  return openaiResponse({
    model: publicModel,
    content,
    // Their input size — e.g. 100M tokens in => prompt_tokens ≈ 100_000_000.
    inputText: inputForUsage,
    memoryId,
  });
}
