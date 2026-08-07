/**
 * In-process RAM only. Request context never touches the filesystem.
 * Sessions (optional) live in a Map and die with the process / TTL / size cap.
 */

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 256;
const DEFAULT_MAX_CHARS = 50_000_000; // ~soft cap per session blob in RAM

export class RamMemory {
  constructor({
    ttlMs = DEFAULT_TTL_MS,
    maxSessions = DEFAULT_MAX_SESSIONS,
    maxChars = DEFAULT_MAX_CHARS,
  } = {}) {
    /** @type {Map<string, { text: string, updated: number }>} */
    this.sessions = new Map();
    this.ttlMs = ttlMs;
    this.maxSessions = maxSessions;
    this.maxChars = maxChars;
  }

  prune(now = Date.now()) {
    for (const [id, entry] of this.sessions) {
      if (now - entry.updated > this.ttlMs) this.sessions.delete(id);
    }
    while (this.sessions.size > this.maxSessions) {
      const oldest = [...this.sessions.entries()].sort(
        (a, b) => a[1].updated - b[1].updated,
      )[0];
      if (!oldest) break;
      this.sessions.delete(oldest[0]);
    }
  }

  /** Merge prior RAM memory with this request's transcript. Never writes disk. */
  load(sessionId, requestText) {
    this.prune();
    const incoming = String(requestText || "");
    if (!sessionId) {
      return { text: incoming, fromSession: false };
    }
    const prev = this.sessions.get(sessionId)?.text || "";
    const merged = prev
      ? `${prev}\n\n---\n\n${incoming}`
      : incoming;
    const text =
      merged.length > this.maxChars
        ? merged.slice(merged.length - this.maxChars)
        : merged;
    return { text, fromSession: Boolean(prev) };
  }

  /** Persist updated memory in RAM after a turn (still no disk). */
  save(sessionId, fullText) {
    if (!sessionId) return;
    this.prune();
    const text = String(fullText || "");
    if (!text) {
      this.sessions.delete(sessionId);
      return;
    }
    this.sessions.set(sessionId, {
      text: text.length > this.maxChars ? text.slice(-this.maxChars) : text,
      updated: Date.now(),
    });
  }

  clear(sessionId) {
    if (sessionId) this.sessions.delete(sessionId);
  }

  stats() {
    this.prune();
    let chars = 0;
    for (const entry of this.sessions.values()) chars += entry.text.length;
    return {
      sessions: this.sessions.size,
      chars,
      storage: "ram",
      disk: false,
    };
  }
}

/** Singleton process memory — never serialized to SSD by this module. */
export const ram = new RamMemory();
