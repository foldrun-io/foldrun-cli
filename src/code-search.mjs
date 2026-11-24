// Searching the `foldrun code` conversations kept on this computer
// (`/search`, `foldrun sessions search`, FOL-250).
//
// A turn on this computer keeps its whole conversation — what the person
// wrote, what the agent answered, every tool call and what it printed — in
// ~/.foldrun/code-engine/<hash>.json, named by a hash. This file keeps the
// list that says which conversation each of those is
// (~/.foldrun/code-conversations.json), and reads them for words.
//
// Only conversations worked on this computer are here: a turn in the cloud
// keeps its conversation on the platform. And where a long conversation's
// older part was summarised, the summary is what is kept, not the text.

import fs from "node:fs";
import path from "node:path";
import { credentialsDir, withFileLock } from "./credentials.mjs";
import { writePrivate } from "./code-session.mjs";

const folder = () => path.join(credentialsDir(), "code-engine");
// Beside the folder, not in it: the folder holds conversations alone.
const indexFile = () => path.join(credentialsDir(), "code-conversations.json");
const FILE = /^[0-9a-f]{64}\.json$/;
/** The newest conversations listed; a file no longer listed is still on disk until its conversation is cleared. */
const MAX_LISTED = 2_000;

/**
 * @typedef {{ file: string, context: string, ws: string, dir: string, url: string, account: string, agent: string, localOnly: boolean, at: string, name?: string }} Listed
 * `file`: the conversation's file name in code-engine; `name`: what the person called it, else its first message.
 * `account` and `agent`: whose conversation it is — the same checkout can hold another account's, or another agent's.
 */

/** @returns {Record<string, any>} */
function readIndex() {
  try {
    const v = JSON.parse(fs.readFileSync(indexFile(), "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

const text = (/** @type {unknown} */ v, /** @type {number} */ max) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Say which conversation a kept file is. Called when the file is written;
 * never stops a turn.
 * @param {string} file the conversation's file (its full path or its name)
 * @param {{ context: string, ws: string, dir: string, url: string, account?: string, agent?: string, localOnly?: boolean, name?: string }} what
 */
export async function listConversation(file, what) {
  const name = path.basename(file);
  if (!FILE.test(name)) return;
  try {
    fs.mkdirSync(folder(), { recursive: true, mode: 0o700 });
    await withFileLock(indexFile(), async () => {
      const all = readIndex();
      const was = all[name];
      all[name] = { context: text(what.context, 200), ws: text(what.ws, 200), dir: path.resolve(what.dir), url: text(what.url, 300), account: text(what.account, 200) || text(was?.account, 200), agent: text(what.agent, 200) || text(was?.agent, 200), ...(what.localOnly === true || (what.localOnly === undefined && was?.localOnly === true) ? { localOnly: true } : {}), at: new Date().toISOString(), ...(what.name ? { name: text(what.name, 80) } : was?.name ? { name: was.name } : {}) };
      const keep = Object.entries(all)
        .sort((a, b) => String(b[1]?.at ?? "").localeCompare(String(a[1]?.at ?? "")))
        .slice(0, MAX_LISTED);
      writePrivate(indexFile(), JSON.stringify(Object.fromEntries(keep)));
    });
  } catch {
    /* not listed this time: the next turn lists it */
  }
}

/** The conversations listed, newest first; only those whose file is still there. @returns {Listed[]} */
export function listedConversations() {
  /** @type {Listed[]} */
  const out = [];
  for (const [file, e] of Object.entries(readIndex())) {
    if (!FILE.test(file) || !e || typeof e !== "object" || typeof e.context !== "string" || !e.context) continue;
    if (!fs.existsSync(path.join(folder(), file))) continue;
    out.push({ file, context: e.context, ws: text(e.ws, 200), dir: text(e.dir, 4096), url: text(e.url, 300), account: text(e.account, 200), agent: text(e.agent, 200), localOnly: e.localOnly === true, at: text(e.at, 40), ...(typeof e.name === "string" && e.name ? { name: e.name.slice(0, 80) } : {}) });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// ------------------------------------------------------------------ reading

/** @typedef {"you" | "agent" | "tool call" | "tool output"} Who */

/** The text of a tool result's content: a string, or its text blocks. */
function resultText(/** @type {unknown} */ content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (b && typeof b === "object" && b.type === "text" && typeof b.text === "string" ? b.text : "")).filter(Boolean).join("\n");
}

/**
 * A kept conversation as pieces of text, in order: who each is from and
 * which turn it is in (a turn begins at each message the person wrote).
 * The model's thinking is not among them.
 * @param {unknown} list
 * @returns {Array<{ turn: number, who: Who, text: string }>}
 */
export function conversationPieces(list) {
  /** @type {Array<{ turn: number, who: Who, text: string }>} */
  const out = [];
  if (!Array.isArray(list)) return out;
  let turn = 0;
  for (const m of list) {
    if (!m || typeof m !== "object") continue;
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? m.content : [];
    // A turn begins at a message the person wrote; one sent in while a tool ran sits beside that tool's result and is part of the turn it joined.
    if (m.role === "user" && blocks.some((/** @type {any} */ b) => b?.type === "text" && typeof b.text === "string" && b.text.trim()) && !blocks.some((/** @type {any} */ b) => b?.type === "tool_result")) turn++;
    for (const b of blocks) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text" && typeof b.text === "string") out.push({ turn: Math.max(1, turn), who: m.role === "user" ? "you" : "agent", text: b.text });
      else if (b.type === "tool_use") {
        // The tool's name, then each argument: a string as it is (a command, a file's new text), anything else as JSON.
        const args = b.input && typeof b.input === "object" ? Object.entries(b.input).map(([k, v]) => (typeof v === "string" ? v : `${k}: ${JSON.stringify(v)}`)) : [];
        out.push({ turn: Math.max(1, turn), who: "tool call", text: [typeof b.name === "string" ? b.name : "", ...args].filter(Boolean).join("\n") });
      } else if (b.type === "tool_result") {
        const t = resultText(b.content);
        if (t) out.push({ turn: Math.max(1, turn), who: "tool output", text: t });
      }
    }
  }
  return out;
}

/** The most words one search takes; more is refused by the caller, never dropped. */
export const MAX_WORDS = 32;

/** What was typed as the words to look for, every one of them: lower-cased; a "quoted phrase" is one. */
export function searchWords(/** @type {string} */ typed) {
  const out = [];
  for (const m of String(typed ?? "").matchAll(/"([^"]+)"|(\S+)/g)) {
    const w = (m[1] ?? m[2]).trim().toLowerCase();
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

/** A line cut to what fits, around the first word found, without control characters. */
function around(/** @type {string} */ line, /** @type {string} */ word, max = 160) {
  // eslint-disable-next-line no-control-regex
  const clean = line.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "").replace(/\t/g, " ");
  if (clean.length <= max) return clean.trim();
  const at = Math.max(0, clean.toLowerCase().indexOf(word));
  const from = Math.max(0, Math.min(at - 40, clean.length - max));
  return `${from > 0 ? "…" : ""}${clean.slice(from, from + max).trim()}${from + max < clean.length ? "…" : ""}`;
}

/** A file larger than this is not read: nothing a person typed or read makes one. */
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * The lines of the kept conversations that hold every word (in any case,
 * on one line), newest conversation first.
 * @param {string[]} words from searchWords
 * @param {{ only?: (c: Listed) => boolean, perConversation?: number, max?: number }} [o]
 * @returns {{ hits: Array<{ conversation: Listed, turn: number, who: Who, line: string }>, searched: number, more: boolean }}
 */
export function searchConversations(words, o = {}) {
  const per = o.perConversation ?? 3;
  const max = o.max ?? 30;
  /** @type {Array<{ conversation: Listed, turn: number, who: Who, line: string }>} */
  const hits = [];
  let searched = 0;
  let more = false;
  if (!words.length) return { hits, searched, more };
  for (const conversation of listedConversations()) {
    if (o.only && !o.only(conversation)) continue;
    /** @type {unknown} */
    let list;
    try {
      const file = path.join(folder(), conversation.file);
      if (fs.statSync(file).size > MAX_BYTES) continue;
      list = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    searched++;
    let found = 0;
    let full = false;
    for (const piece of conversationPieces(list)) {
      const low = piece.text.toLowerCase();
      if (!words.every((w) => low.includes(w))) continue;
      for (const line of piece.text.split("\n")) {
        const l = line.toLowerCase();
        if (!words.every((w) => l.includes(w))) continue;
        // One more line matches than is shown: said, so the person narrows it.
        if (found >= per || hits.length >= max) {
          more = true;
          full = true;
          break;
        }
        hits.push({ conversation, turn: piece.turn, who: piece.who, line: around(line, words[0]) });
        found++;
      }
      if (full) break;
    }
    if (hits.length >= max && full) break;
  }
  return { hits, searched, more };
}
