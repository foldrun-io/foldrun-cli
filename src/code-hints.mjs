// Token hints in a foldrun code session (FOL-262). The owner, 24 Nov 2026:
// "suggestion for saving tokens ... specially when switching ... or when
// coming back after 1 hour and things that makes them burn more token".
//
// One short line before the turn that would pay more than it seems, with
// the size and what it costs at the model's listed price, and the cheaper
// way. Each kind at most once a session; `/cost tips off` turns them off.
//
// Why each one costs (Anthropic's prompt-caching docs, read 24 Nov 2026):
// a cache read is billed at about a tenth of input, a write a quarter more
// (5 min) or twice (1 h); the lifetime is refreshed on every hit. Changing
// the tools invalidates the whole cache; changing effort or thinking can
// invalidate the messages' part; a cache belongs to one model.

/** foldrun's gateway keeps every cache mark for an hour (foldrun-platform src/gateway-door.ts). */
export const CACHE_TTL_MS = 60 * 60 * 1000;

/** A conversation this long is said once: every call reads it all (no percentage — windows differ by model, Codex). */
export const BIG_TOKENS = 120_000;

/** Below this a re-read costs too little to mention. */
export const HINT_MIN_TOKENS = 5_000;

/** A message this long is said before it goes. */
export const PASTE_TOKENS = 20_000;

/** The kinds, in the order /cost explain lists them. */
export const HINT_KINDS = /** @type {const} */ (["break", "model", "tools", "place", "big", "paste"]);

/** "12.3k" for 12_345. */
const k = (/** @type {number} */ n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(Math.round(n)));

/** "$0.04", or "" when there is no price. */
const usd = (/** @type {number} */ tokens, /** @type {{ inputPerMTok: number } | null | undefined} */ price) => {
  if (!price || !Number.isFinite(price.inputPerMTok)) return "";
  const v = (tokens * price.inputPerMTok) / 1_000_000;
  return v < 0.01 ? "under $0.01" : `$${v.toFixed(2)}`;
};

/**
 * The line for one kind, or null when there is nothing worth saying.
 * @param {typeof HINT_KINDS[number]} kind
 * @param {{ tokens?: number, price?: { inputPerMTok: number } | null, minutes?: number, what?: string, side?: "local" | "cloud" }} o
 */
export function hintLine(kind, o = {}) {
  const tokens = Math.max(0, Math.round(Number(o.tokens) || 0));
  const cost = usd(tokens, o.price);
  const size = `about ${k(tokens)} tokens${cost ? ` (~${cost})` : ""}`;
  // /compact shortens only a conversation kept on this computer; in the cloud the way is a new one (Codex).
  const shorter = o.side === "cloud" ? "/clear starts a new conversation" : "/compact shortens it";
  switch (kind) {
    case "break":
      if (tokens < HINT_MIN_TOKENS) return null;
      return `back after ${Math.round(o.minutes ?? 0)} min: the cache has expired, so this message reads the conversation again at full price — ${size}. ${o.side === "cloud" ? "/clear starts fresh" : "/compact makes later turns read a summary instead; /clear starts fresh"}`;
    case "model":
      if (tokens < HINT_MIN_TOKENS) return null;
      return `another model has no cache of this conversation: your next message reads it all at full price — ${size}. ${o.side === "cloud" ? "/clear makes that nothing" : "/compact first, or /clear, makes that smaller"}`;
    case "tools":
      if (tokens < HINT_MIN_TOKENS) return null;
      return `${o.what ?? "that"} changes what the model is sent ahead of the conversation, so your next message reads it all again once — ${size}`;
    case "place":
      // What the other side reads is its own conversation and a short note of this one, not this one whole (Codex): no figure.
      return "the other side keeps its own conversation: if it has had no message for an hour, its first message there reads it at full price";
    case "big":
      if (tokens < BIG_TOKENS) return null;
      return `the conversation is ${size} — every call reads it all; ${shorter}`;
    case "paste":
      if (tokens < PASTE_TOKENS) return null;
      return `this message is ${size} by itself — every later call reads it again; a path the agent opens when it needs it costs less`;
    default:
      return null;
  }
}

/**
 * Say a hint, once for its kind in this session, unless hints are off.
 * `s.hints` keeps what was said, for /cost explain.
 * @param {any} s @param {typeof HINT_KINDS[number]} kind @param {Parameters<typeof hintLine>[1]} o
 * @param {{ off: boolean, print: (line: string) => void, now?: number }} io
 * @returns {string | null} the line said
 */
export function giveHint(s, kind, o, io) {
  if (io.off) return null;
  s.hints ??= [];
  if (s.hints.some((/** @type {any} */ h) => h.kind === kind)) return null;
  const line = hintLine(kind, o);
  if (!line) return null;
  s.hints.push({ kind, line, at: new Date(io.now ?? Date.now()).toISOString() });
  io.print(line);
  return line;
}
