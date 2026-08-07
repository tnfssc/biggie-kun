import { createHash } from "node:crypto";

const TERM_RE = /[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*/g;
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "exact", "for",
  "from", "in", "is", "it", "of", "on", "only", "passcode", "return",
  "the", "this", "to", "was", "what", "with",
]);

export function terms(text) {
  const out = [];
  const src = String(text);
  TERM_RE.lastIndex = 0;
  let m;
  while ((m = TERM_RE.exec(src)) !== null) out.push(m[0].toLowerCase());
  return out;
}

export class LocalBlockIndex {
  constructor(
    source,
    {
      blockCharacters = 16_384,
      maxPostings = 4096,
      blockOverlap = 512,
      maxTerms = 250_000,
    } = {},
  ) {
    this.source = source;
    this.blocks = [];
    this.postings = new Map();
    this.droppedTerms = 0;

    let start = 0;
    let previousStartChar = 0;
    let previousStartByte = 0;
    const encoder = new TextEncoder();

    while (start < source.length) {
      let end = Math.min(source.length, start + blockCharacters);
      if (end < source.length) {
        const nearby = source.indexOf("\n", end);
        if (nearby >= 0 && nearby < end + blockOverlap) end = nearby + 1;
      }
      const startByte =
        previousStartByte +
        encoder.encode(source.slice(previousStartChar, start)).length;
      const blockText = source.slice(start, end);
      const endByte = startByte + encoder.encode(blockText).length;
      const block = {
        block_id: this.blocks.length,
        start_char: start,
        end_char: end,
        start_byte: startByte,
        end_byte: endByte,
        text: blockText,
      };
      this.blocks.push(block);

      const unique = new Set(terms(blockText));
      for (const term of unique) {
        if (!this.postings.has(term) && this.postings.size >= maxTerms) {
          this.droppedTerms += 1;
          continue;
        }
        let current = this.postings.get(term);
        if (this.postings.has(term) && current === null) continue;
        if (current === undefined) {
          current = [];
          this.postings.set(term, current);
        }
        if (current.length < maxPostings) current.push(block.block_id);
        else this.postings.set(term, null);
      }

      if (end >= source.length) break;
      previousStartChar = start;
      previousStartByte = startByte;
      start = Math.max(start + 1, end - blockOverlap);
    }
  }

  search(queries, topK = 12) {
    const scores = new Map();
    const queryTerms = [];
    for (const q of queries) {
      for (const token of terms(q)) {
        if (!STOPWORDS.has(token)) queryTerms.push(token);
      }
    }
    for (const token of new Set(queryTerms)) {
      const posting = this.postings.get(token);
      if (!posting) continue;
      const idf = Math.log1p(this.blocks.length / posting.length);
      for (const blockId of posting) {
        scores.set(blockId, (scores.get(blockId) || 0) + idf);
      }
    }

    const normalized = queries
      .map((q) => String(q).toLowerCase().trim())
      .filter(Boolean);
    for (let blockId = 0; blockId < this.blocks.length; blockId++) {
      const lowered = this.blocks[blockId].text.toLowerCase();
      let exact = 0;
      for (const q of normalized) if (lowered.includes(q)) exact += 1;
      if (exact) scores.set(blockId, (scores.get(blockId) || 0) + 20 * exact);
    }

    if (scores.size === 0) {
      for (let i = 0; i < Math.min(topK, this.blocks.length); i++) scores.set(i, 0);
    }

    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, topK);

    return ranked.map(([blockId, score], i) => {
      const block = this.blocks[blockId];
      const lowered = block.text.toLowerCase();
      let hit = 0;
      for (const q of normalized) {
        const at = lowered.indexOf(q);
        if (at >= 0) {
          hit = at;
          break;
        }
      }
      const left = Math.max(0, hit - 320);
      const right = Math.min(block.text.length, hit + 960);
      return {
        result_id: `r${i + 1}`,
        block_id: blockId,
        start_char: block.start_char,
        end_char: block.end_char,
        start_byte: block.start_byte,
        end_byte: block.end_byte,
        score: Math.round(score * 1000) / 1000,
        snippet: block.text.slice(left, right),
      };
    });
  }

  readBlocks(blockIds, { neighborBlocks = 0, maxCharacters = 80_000 } = {}) {
    const expanded = new Set();
    for (const id of blockIds) {
      for (let c = id - neighborBlocks; c <= id + neighborBlocks; c++) {
        if (c >= 0 && c < this.blocks.length) expanded.add(c);
      }
    }
    const evidence = [];
    let used = 0;
    for (const blockId of [...expanded].sort((a, b) => a - b)) {
      const block = this.blocks[blockId];
      if (used + block.text.length > maxCharacters) break;
      evidence.push({
        block_id: blockId,
        start_char: block.start_char,
        end_char: block.end_char,
        start_byte: block.start_byte,
        end_byte: block.end_byte,
        text: block.text,
        sha256: sha256Hex(block.text),
      });
      used += block.text.length;
    }
    return evidence;
  }
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function fallbackQuery(question) {
  const candidates = [];
  TERM_RE.lastIndex = 0;
  let m;
  const src = String(question);
  while ((m = TERM_RE.exec(src)) !== null) {
    if (!STOPWORDS.has(m[0].toLowerCase())) candidates.push(m[0]);
  }
  candidates.sort(
    (a, b) =>
      Number(!a.includes("-") && !a.includes("_")) -
        Number(!b.includes("-") && !b.includes("_")) ||
      b.length - a.length,
  );
  return (candidates.slice(0, 8).length ? candidates.slice(0, 8) : [question]);
}
