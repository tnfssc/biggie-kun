import { randomUUID } from "node:crypto";
import { LocalBlockIndex } from "./block_index.js";
import { runAgent } from "./agent.js";
import { estimateTokens } from "./limits.js";
import { ram } from "./memory.js";
import { ollamaChat } from "./ollama.js";
import { isInternalProbe, presentAnswer } from "./presenter.js";
import { thinkAbout } from "./thinker.js";

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
 * prompt_tokens = caller's input size.
 * completion_tokens = reasoning + answer.
 * reasoning_tokens = reasoning only.
 */
export function buildUsage(inputText, reasoningText, completionText) {
  const prompt_tokens = Math.min(CONTEXT_WINDOW, estimateTokens(inputText));
  const reasoning_tokens = estimateTokens(reasoningText || "");
  const answer_tokens = estimateTokens(completionText || "");
  const completion_tokens = reasoning_tokens + answer_tokens;
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens: Math.min(
      CONTEXT_WINDOW + completion_tokens,
      prompt_tokens + completion_tokens,
    ),
    completion_tokens_details: {
      reasoning_tokens,
      accepted_prediction_tokens: 0,
    },
  };
}

export function openaiResponse({
  model,
  content,
  reasoning,
  inputText,
  memoryId,
  id,
  created,
}) {
  const usage = buildUsage(inputText, reasoning, content);
  const message = { role: "assistant", content };
  if (reasoning) message.reasoning_content = reasoning;
  else message.reasoning_content = null;

  const payload = {
    id: id || `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "chat.completion",
    created: created || Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
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
  if (typeof body?.user === "string" && body.user.trim()) {
    return `user:${body.user.trim().slice(0, 120)}`;
  }
  return null;
}

function wantReasoning(body) {
  if (body?.include_reasoning === false) return false;
  if (body?.reasoning === false) return false;
  return true; // default on
}

/**
 * Core completion. Returns fields for both JSON and SSE responses.
 */
export async function completeChat(body, cfg, reqHeaders = {}) {
  const messages = normalizeMessages(body.messages);
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
  const includeReasoning = wantReasoning(body);
  const id = `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);

  const memoryId = sessionKey(body, reqHeaders);
  const requestInputText = messages.map((m) => m.content).join("");
  const requestTranscript = transcriptOf(messages);
  const loaded = ram.load(memoryId, requestTranscript);
  const contextText = loaded.text;
  const inputForUsage =
    memoryId && loaded.fromSession
      ? loaded.text
          .replace(/^\[(?:system|user|assistant|tool)\]\n/gm, "")
          .replace(/\n\n---\n\n/g, "")
      : requestInputText;
  const contextTokens = estimateTokens(contextText);

  const { question, document: requestDoc } = splitQuestionAndDocument(messages);

  if (isInternalProbe(question)) {
    const content = "I can only help with the content in context.";
    return {
      id,
      created,
      model: publicModel,
      content,
      reasoning: "",
      inputText: inputForUsage,
      memoryId,
      usage: buildUsage(inputForUsage, "", content),
      sealed: true,
    };
  }

  let doc = requestDoc;
  let q = question;
  if (memoryId && loaded.fromSession) {
    doc = loaded.text;
    q = question;
  } else if (!doc.trim()) {
    doc = contextText;
  }

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

  let draft;
  let evidenceText;

  if (contextTokens <= cfg.directTokenThreshold) {
    const result = await ollamaChat({
      host: cfg.ollamaHost,
      model: backendModel,
      messages: memoryMessages,
      numCtx: cfg.numCtx,
      numPredict: maxTokens,
      temperature,
    });
    draft = String(result?.message?.content ?? "");
    evidenceText = contextText;
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
    draft = agent.answer || "INSUFFICIENT_EVIDENCE";
    evidenceText = evidenceBlob(agent.evidence) || corpus.slice(0, 120_000);
    index.source = "";
    index.blocks.length = 0;
    index.postings.clear();
  }

  const content = await presentAnswer({
    host: cfg.ollamaHost,
    model: backendModel,
    numCtx: cfg.numCtx,
    userQuestion: question,
    draftAnswer: draft,
    evidenceText,
    maxTokens,
  });

  let reasoning = "";
  if (includeReasoning) {
    reasoning = await thinkAbout({
      host: cfg.ollamaHost,
      model: backendModel,
      numCtx: cfg.numCtx,
      userQuestion: question,
      draftAnswer: draft,
      evidenceText,
      maxTokens: Math.min(512, maxTokens),
    });
  }

  if (memoryId) {
    const next = `${contextText}\n\n[assistant]\n${content}`;
    ram.save(memoryId, next);
  }

  return {
    id,
    created,
    model: publicModel,
    content,
    reasoning,
    inputText: inputForUsage,
    memoryId,
    usage: buildUsage(inputForUsage, reasoning, content),
    sealed: false,
  };
}

export async function handleChatCompletion(body, cfg, reqHeaders = {}) {
  const result = await completeChat(body, cfg, reqHeaders);
  return openaiResponse({
    id: result.id,
    created: result.created,
    model: result.model,
    content: result.content,
    reasoning: result.reasoning,
    inputText: result.inputText,
    memoryId: result.memoryId,
  });
}
