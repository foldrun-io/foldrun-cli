// The parts of `foldrun code` that make a session easy to work in (19 Nov
// 2026): a prompt that remembers what you typed (↑, kept between
// sessions), Tab completion of /commands and @paths, a paste of many lines
// kept as one message, a trailing \ to go on to the next line, `!command`
// run in the folder with its output sent along with the next message, a
// colored diff before applying, and the last conversation of a folder kept
// so `--continue` picks it up. Pure helpers here; commands.mjs wires them.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Every slash command, with what it does — /help prints this list. */
export const CODE_COMMANDS = [
  ["/help", "these commands"],
  ["/diff", "what is changed in the folder now (git diff)"],
  ["/undo", "take back the last patch this session applied"],
  ["/status", "this session: turns, cost, model, conversation"],
  ["/model", "choose the model: Default, Max or Fast (/model max sets it straight away)"],
  ["/new", "a fresh conversation — the agent forgets the earlier turns"],
  ["/send <conversation> <text>", "message another session"],
  ["/messages", "what other sessions sent this one"],
  ["/quit", "leave (Ctrl-D too)"],
];

/** The tips under the commands. */
export const CODE_TIPS = [
  "!<command>  run it in the folder; its output goes with your next message",
  "@<path>     Tab completes a file of the folder, to point the agent at it",
  "\\ at the end of a line goes on to the next; a paste of many lines is one message",
  "↑ ↓         what you typed before, in this folder and others",
  "Ctrl-R      search what you typed before (Ctrl-R again: older; Enter: put it on the line)",
  "typing while a turn runs keeps it for your next message (never sent mid-turn)",
];

export function helpText() {
  const w = Math.max(...CODE_COMMANDS.map(([c]) => c.length));
  return [...CODE_COMMANDS.map(([c, d]) => `${c.padEnd(w)}  ${d}`), "", ...CODE_TIPS].join("\n");
}

// ------------------------------------------------------------- history

const HISTORY_MAX = 500;

/** What was typed before, newest first, as readline wants it. */
export function readHistory(file) {
  try {
    // readline draws these unguarded (↑): a line holding a control
    // character is dropped, never shown.
    const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l && !/[\x00-\x1f\x7f-\x9f]/.test(l));
    return lines.slice(-HISTORY_MAX).reverse();
  } catch {
    return [];
  }
}

/** Adds one entry (a multi-line one on one line), private to the person. */
export function appendHistory(file, entry) {
  const one = String(entry).replace(/\s*\n\s*/g, " ").trim();
  if (!one) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const old = (() => {
      try {
        return fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      } catch {
        return [];
      }
    })();
    const next = [...old.filter((l) => l !== one), one].slice(-HISTORY_MAX);
    writePrivate(file, `${next.join("\n")}\n`);
  } catch {
    /* a history that cannot be kept is not worth stopping for */
  }
}

/**
 * A file only its owner reads, written whole: a fresh private file renamed
 * over the old one — never readable in between, and a link planted at the
 * path is replaced, not followed (Codex).
 */
export function writePrivate(/** @type {string} */ file, /** @type {string} */ text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ------------------------------------------------------------ completion

/** The folder's files as git sees them (tracked and untracked, not ignored). */
export function folderFiles(dir) {
  const r = spawnSync("git", ["-C", dir, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) return [];
  // A name with a control character in it is never offered: readline would
  // print it to the terminal as it is (Codex).
  return [...new Set(String(r.stdout).split("\0").filter((f) => f && !/[\x00-\x1f\x7f-\x9f]/.test(f)))].sort();
}

/**
 * readline's completer: /commands at the start of the line, @paths
 * anywhere. Returns [candidates, the part being completed].
 * @param {() => string[]} files
 */
export function codeCompleter(files) {
  return (line) => {
    if (/^\/\S*$/.test(line)) {
      const names = CODE_COMMANDS.map(([c]) => c.split(" ")[0]);
      const hits = names.filter((n) => n.startsWith(line));
      return [hits.length ? hits : names, line];
    }
    const m = /(?:^|\s)@([^\s]*)$/.exec(line);
    if (m) {
      const part = m[1];
      const all = files();
      // Files under the part, and the folders on the way to them: Tab twice
      // walks down a tree instead of listing it all.
      const hits = new Set();
      for (const f of all) {
        if (!f.startsWith(part)) continue;
        const rest = f.slice(part.length);
        const slash = rest.indexOf("/");
        hits.add(`@${slash >= 0 ? f.slice(0, part.length + slash + 1) : f}`);
        if (hits.size > 200) break;
      }
      return [[...hits], `@${part}`];
    }
    return [[], line];
  };
}

// ---------------------------------------------------------- the message

/** A paste arrives as many lines within a few milliseconds of each other. */
export const PASTE_GAP_MS = 30;

/**
 * Lines as they came in, into what the person meant as one message: a line
 * ending in \ goes on; lines that came together (a paste) stay together.
 * Returns the message, or null when it is not finished (the last line ends
 * in \).
 * @param {string[]} lines
 */
export function joinMessage(lines) {
  const out = [];
  for (const l of lines) out.push(l);
  const last = out[out.length - 1] ?? "";
  if (/\\$/.test(last)) return null;
  return out.map((l) => l.replace(/\\$/, "")).join("\n").trim();
}

// ----------------------------------------------------------------- !shell

const NOTE_CHARS = 6_000;

/** The note a shell run leaves for the next message, cut from the front. */
export function shellNote(command, result) {
  let text = result.error ? `could not run it: ${result.error}` : result.output;
  if (text.length > NOTE_CHARS) text = `[… ${text.length - NOTE_CHARS} characters cut]\n${text.slice(-NOTE_CHARS)}`;
  return `The person ran \`${command}\` in the folder (exit ${result.code}):\n\`\`\`\n${text.trimEnd()}\n\`\`\``;
}

/** The message as sent: the notes from `!` runs first, then what was typed. */
export function withNotes(notes, task) {
  return notes.length ? `${notes.join("\n\n")}\n\n${task}` : task;
}

// ------------------------------------------------------------------- diff

/**
 * A patch for the terminal: + green, - red, hunk heads cyan, file heads
 * bold. The text has already had terminal controls taken out by the
 * caller; only these colors are added.
 * @param {string} patch
 * @param {{ green: (s: string) => string, red: (s: string) => string, cyan?: (s: string) => string, bold: (s: string) => string, dim: (s: string) => string }} c
 */
export function colorPatch(patch, c) {
  const cyan = c.cyan ?? c.dim;
  // A binary file's body is base85 — noise on a screen: one line instead.
  let binary = false;
  return patch
    .split("\n")
    .flatMap((l) => {
      if (l.startsWith("diff --git")) binary = false;
      else if (l === "GIT binary patch" || /^Binary files .* differ$/.test(l)) {
        if (binary) return [];
        binary = true;
        return [c.dim("  (a binary file — not shown)")];
      }
      if (binary) return [];
      return [l];
    })
    .map((l) => {
      if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity|rename )/.test(l)) return c.bold(l);
      if (l.startsWith("@@")) return cyan(l);
      if (l.startsWith("+")) return c.green(l);
      if (l.startsWith("-")) return c.red(l);
      return l;
    })
    .join("\n");
}

// --------------------------------------------------------------- sessions

/** The last conversation of each folder, so `--continue` picks it up. */
export function readSessions(file) {
  try {
    const all = JSON.parse(fs.readFileSync(file, "utf8"));
    return all && typeof all === "object" && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

export function lastSession(file, dir, ws) {
  const s = readSessions(file)[path.resolve(dir)];
  if (!s || typeof s.context !== "string") return null;
  if (ws && s.ws && s.ws !== ws) return null;
  return s;
}

export function rememberSession(file, dir, entry) {
  try {
    const all = readSessions(file);
    all[path.resolve(dir)] = { ...entry, at: new Date().toISOString() };
    // At most 100 folders, the newest kept.
    const keep = Object.entries(all)
      .sort((a, b) => String(b[1]?.at ?? "").localeCompare(String(a[1]?.at ?? "")))
      .slice(0, 100);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writePrivate(file, JSON.stringify(Object.fromEntries(keep), null, 2));
  } catch {
    /* not worth stopping for */
  }
}

// ------------------------------------------------------------- appearance
// What a person sees of a turn (19 Nov 2026, owner: "so the user knows
// what is going on, without leaking technical information"): plain verbs,
// paths as the folder knows them, times and money a person reads at a
// glance. The sandbox's own paths, pods and run ids stay on /status and
// the run page.

const VERBS = /** @type {Record<string, string>} */ ({
  Bash: "Run", bash: "Run", Read: "Read", Edit: "Edit", MultiEdit: "Edit", Write: "Write", NotebookEdit: "Edit",
  Grep: "Search", Glob: "Find", LS: "List", WebFetch: "Fetch", WebSearch: "Search the web", web: "Web",
  Task: "Delegate", Agent: "Delegate", TodoWrite: "Plan", install: "Install", ask: "Ask you", cloud_agents: "Cloud agents",
});

/** A tool's name as a verb a person reads; unknown ones as they are. */
export function friendlyTool(/** @type {unknown} */ name) {
  const n = String(name ?? "").trim();
  if (VERBS[n]) return VERBS[n];
  // mcp__<server>__<tool>; a server's name may hold "_" (foldrun_install).
  const mcp = /^mcp__.+?__(.+)$/.exec(n);
  if (!mcp) return n;
  const words = mcp[1].replace(/_/g, " ");
  return `${words[0].toUpperCase()}${words.slice(1)}`;
}

/**
 * A path or command from the sandbox, as the person's folder knows it: the
 * sandbox's working folders taken off (…/snapshot/x → x), a leading
 * `cd snapshot &&` dropped.
 */
export function folderRelative(/** @type {unknown} */ text) {
  return String(text ?? "")
    .replace(/^cd\s+\S*snapshot\/?\S*\s*&&\s*/, "")
    .replace(/(?:\/[^\s'"`]*)?\/snapshot\/(?=\S)/g, "")
    .replace(/(?:\/[^\s'"`]*)?\/snapshot(?=$|\s)/g, ".")
    .trim();
}

/** 0.4 → "0.4s", 12.3 → "12s", 65 → "1m 05s", 3700 → "1h 01m". */
export function formatSecs(/** @type {number} */ secs) {
  if (!Number.isFinite(secs) || secs < 0) return "";
  if (secs < 10) return `${secs.toFixed(1)}s`;
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ${String(Math.round(secs % 60)).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** 20480 → "20 KB". */
export function formatBytes(/** @type {number} */ n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Dollars: 0.0421 → "$0.042", 1.5 → "$1.50", 0 → "$0.000". */
export function formatCost(/** @type {number} */ usd) {
  const n = Number.isFinite(usd) ? usd : 0;
  if (n > 0 && n < 0.001) return "<$0.001";
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

/** "claude-sonnet-5-5" → "Sonnet 5.5"; another model as it is named. */
export function shortModel(/** @type {unknown} */ model) {
  const m = /^(?:anthropic\/)?claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/.exec(String(model ?? ""));
  if (/^(opus|sonnet|haiku|fable)$/i.test(String(model ?? ""))) return `${String(model)[0].toUpperCase()}${String(model).slice(1).toLowerCase()}`;
  if (!m) return String(model ?? "");
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

/** 23456 → "23k". */
export const formatTokens = (/** @type {number} */ n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/**
 * An error event in a turn, for a person: a failed tool as its verb and exit
 * code ("Run failed · exit 1"), anything else as its first line — the agent
 * usually reads the rest and goes on, so the full text is the run page's.
 */
export function friendlyError(/** @type {unknown} */ text) {
  const t = String(text ?? "").trim();
  const tool = /^([A-Za-z][\w]*):\s*([\s\S]*)$/.exec(t);
  if (tool && (VERBS[tool[1]] || tool[1].startsWith("mcp__"))) {
    const code = /exit code (\d+)/i.exec(tool[2]);
    return `${friendlyTool(tool[1])} failed${code ? ` · exit ${code[1]}` : ""}`;
  }
  return t.split("\n")[0] ?? "";
}

/** A folder, with the home folder as ~. */
export function homeTilde(/** @type {string} */ dir, home = process.env.HOME ?? "") {
  return home && (dir === home || dir.startsWith(`${home}/`)) ? `~${dir.slice(home.length)}` : dir;
}

// ---------------------------------------------------------- screen width

/** The cells a character takes on screen: wide (CJK, emoji) 2, combining marks 0. */
function cells(/** @type {string} */ ch) {
  const cp = /** @type {number} */ (ch.codePointAt(0));
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
  return 1;
}

/** How many cells a text takes on screen. */
export const displayWidth = (/** @type {string} */ t) => [...t].reduce((n, ch) => n + cells(ch), 0);

/** At most n cells of a text, its start kept, … where cut. */
export function clipCells(/** @type {string} */ t, /** @type {number} */ n) {
  if (n <= 0) return "";
  if (displayWidth(t) <= n) return t;
  let out = "";
  let used = 0;
  for (const ch of t) {
    if (used + cells(ch) > n - 1) break;
    out += ch;
    used += cells(ch);
  }
  return `${out}…`;
}

/** At most n cells of a text, its END kept (what is being typed), … where cut. */
export function clipCellsEnd(/** @type {string} */ t, /** @type {number} */ n) {
  if (n <= 0) return "";
  if (displayWidth(t) <= n) return t;
  const chars = [...t];
  let out = "";
  let used = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = /** @type {string} */ (chars[i]);
    if (used + cells(ch) > n - 1) break;
    out = ch + out;
    used += cells(ch);
  }
  return `…${out}`;
}

// ---------------------------------------------------------- the reply

/**
 * The reply without the words the agent already said on the way (printed
 * live as "· …"): each one found whole in it is taken out, once.
 */
export function withoutSaid(/** @type {string} */ reply, /** @type {string[]} */ said) {
  let out = reply;
  for (const t of said) {
    if (t.length < 12) continue;
    const at = out.indexOf(t);
    if (at >= 0) out = out.slice(0, at) + out.slice(at + t.length);
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The agent's reply for the terminal (19 Nov 2026): **bold**, `code` and
 * headings drawn instead of shown as marks, lists as •, every paragraph
 * wrapped to the screen with a two-space margin (a list item's lines under
 * its text). Fenced code and tables are kept as written.
 * @param {string} text plain text, no terminal control in it
 * @param {number} columns
 * @param {{ bold: (s: string) => string, cyan: (s: string) => string, dim: (s: string) => string, head?: (s: string) => string, mark?: (s: string) => string }} c
 */
export function formatReply(text, columns, c) {
  const width = Math.max(20, columns - 4);
  const out = [];
  let fenced = false;
  for (const raw of text.split("\n")) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || /^\s*\|/.test(raw)) {
      out.push(`  ${fenced ? "  " : ""}${fenced ? c.dim(raw) : raw}`);
      continue;
    }
    if (!raw.trim()) {
      out.push("");
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(raw);
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    let lead = "";
    let body = raw.trim();
    if (heading && c.head) {
      out.push(`  ${c.head(heading[1].replace(/\*\*|`/g, ""))}`);
      continue;
    }
    if (heading) body = `**${heading[1].replace(/\*\*/g, "")}**`;
    else if (item) {
      const depth = Math.min(3, Math.floor(item[1].replace(/\t/g, "  ").length / 2));
      lead = `${"  ".repeat(depth)}${/^\d/.test(item[2]) ? item[2] : "•"} `;
      body = item[3];
    }
    const words = styledWords(body);
    const room = Math.max(10, width - displayWidth(lead));
    const lines = [];
    let line = [];
    let used = 0;
    for (const w of words) {
      const len = displayWidth(w.map((x) => x.t).join(""));
      if (line.length && used + 1 + len > room) {
        lines.push(line);
        line = [];
        used = 0;
      }
      line.push(w);
      used += (line.length > 1 ? 1 : 0) + len;
    }
    if (line.length) lines.push(line);
    lines.forEach((ws, k) => {
      const pad = k === 0 ? (lead && c.mark ? c.mark(lead) : lead) : " ".repeat(displayWidth(lead));
      out.push(`  ${pad}${ws.map((w) => w.map((x) => paint(x, c)).join("")).join(" ")}`);
    });
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** One run of characters and how it is drawn. @typedef {{ t: string, bold: boolean, code: boolean }} Piece */

/** @param {Piece} x @param {{ bold: (s: string) => string, cyan: (s: string) => string }} c */
const paint = (x, c) => (x.code ? c.cyan(x.bold ? c.bold(x.t) : x.t) : x.bold ? c.bold(x.t) : x.t);

/**
 * A line's words, each a list of pieces: ** and ` turn bold and code on and
 * off — only when they come in pairs; a lone one is shown as it is.
 * @returns {Piece[][]}
 */
function styledWords(/** @type {string} */ line) {
  const ticks = (line.match(/`/g) ?? []).length;
  const stars = (line.replace(/`[^`]*`/g, "").match(/\*\*/g) ?? []).length;
  const useTicks = ticks > 0 && ticks % 2 === 0;
  const useStars = stars > 0 && stars % 2 === 0;
  /** @type {Piece[][]} */
  const words = [];
  /** @type {Piece[]} */
  let word = [];
  let bold = false;
  let code = false;
  const put = (/** @type {string} */ ch) => {
    const last = word.at(-1);
    if (last && last.bold === bold && last.code === code) last.t += ch;
    else word.push({ t: ch, bold, code });
  };
  for (let i = 0; i < line.length; i++) {
    const ch = /** @type {string} */ (line[i]);
    if (useTicks && ch === "`") {
      code = !code;
      continue;
    }
    if (useStars && !code && ch === "*" && line[i + 1] === "*") {
      bold = !bold;
      i++;
      continue;
    }
    if (ch === " " && !code) {
      if (word.length) words.push(word);
      word = [];
      continue;
    }
    put(ch);
  }
  if (word.length) words.push(word);
  return words;
}

/**
 * The agent's words with the sandbox's folder name taken out: to the person
 * it is their folder (19 Nov 2026: "I built it in `snapshot/site/`").
 * snapshot/site/x → site/x; `snapshot/` alone → your folder.
 */
export function replyPaths(/** @type {unknown} */ text) {
  // Fenced code is left as written, and only a path — never a web address
  // — loses its sandbox part (Codex).
  let fenced = false;
  return String(text ?? "")
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line
        .replace(/(^|[\s`'"(\[])\/[^\s'"`:]*?\/snapshot\/(?=[^\s'"`)\]])/g, "$1")
        .replace(/(^|[\s`'"(\[])snapshot\/(?=[^\s`'")\],;:])/g, "$1")
        .replace(/`snapshot\/?`/g, "your folder")
        .replace(/(^|[\s(])snapshot\/(?=[\s.,;:)]|$)/g, "$1your folder");
    })
    .join("\n");
}

// ------------------------------------------------------------ local mode
// foldrun code on this computer: foldrun's own agent (core's engine loop)
// in the person's own folder, its model calls through a gateway key made for
// this computer (owner, 20 Nov 2026: one engine, foldrun's; Claude Code gone).

/** What a folder was last worked on with: its project and where. */
export function folderChoice(/** @type {string} */ file, /** @type {string} */ dir) {
  const s = readSessions(file)[path.resolve(dir)];
  if (!s || typeof s !== "object") return null;
  return {
    ws: typeof s.ws === "string" ? s.ws : null,
    mode: s.mode === "local" || s.mode === "cloud" ? s.mode : null,
    // Claude Code was an engine until 20 Nov 2026: such a folder reads as none.
    engine: s.engine === "foldrun" ? "foldrun" : null,
  };
}

/** A project name from a folder's name: lower case, letters, digits and dashes. */
export function projectNameFor(/** @type {string} */ dir) {
  const base = path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return /^[a-z]/.test(base) ? base : `code-${base || "project"}`;
}

/** The gateway key this computer's foldrun-engine turns use on a platform, if one was made. */
export function readLocalKey(/** @type {string} */ file, /** @type {string} */ url) {
  try {
    const all = JSON.parse(fs.readFileSync(file, "utf8"));
    const k = all?.[url];
    return k && typeof k.key === "string" && typeof k.gatewayUrl === "string" ? { id: String(k.id ?? ""), key: k.key, gatewayUrl: k.gatewayUrl } : null;
  } catch {
    return null;
  }
}

/** Keep (or, with null, forget) this computer's key for a platform; only its owner reads the file. */
export function saveLocalKey(/** @type {string} */ file, /** @type {string} */ url, /** @type {{ id: string, key: string, gatewayUrl: string } | null} */ entry) {
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(file, "utf8")) ?? {};
  } catch {
    /* none yet */
  }
  if (entry) all[url] = entry;
  else delete all[url];
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writePrivate(file, JSON.stringify(all, null, 2));
}

/**
 * Whether a conversation can be sent as it is: turns alternate from the
 * person's, none is empty, and every tool call the model made is answered
 * in the very next turn (Codex: a cut-off reply can hold a call with no
 * result, and the API refuses that).
 * @param {Array<{ role: string, content: Array<Record<string, unknown>> }>} list
 */
export function validConversation(list) {
  if (!Array.isArray(list) || list.length % 2 !== 0) return false;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m || m.role !== (i % 2 === 0 ? "user" : "assistant") || !Array.isArray(m.content) || !m.content.length) return false;
    if (!m.content.every((b) => b && typeof b.type === "string")) return false;
    if (m.role === "assistant") {
      const calls = m.content.filter((b) => b.type === "tool_use").map((b) => b.id);
      const next = list[i + 1];
      if (calls.length && !next) return false;
      const answered = new Set((next?.content ?? []).filter((b) => b.type === "tool_result").map((b) => b.tool_use_id));
      if (!calls.every((id) => answered.has(id))) return false;
    }
    if (m.role === "user" && i > 0) {
      const asked = new Set(list[i - 1].content.filter((b) => b.type === "tool_use").map((b) => b.id));
      if (!m.content.filter((b) => b.type === "tool_result").every((b) => asked.has(b.tool_use_id))) return false;
    }
  }
  return true;
}

/**
 * A conversation for the foldrun engine, cut from the front to fit in
 * bytes: whole turns go (a turn starts where the person said something),
 * so what is left still begins with the person and alternates. One turn
 * too big on its own leaves nothing.
 * @param {Array<{ role: string, content: Array<Record<string, unknown>> }>} list
 */
export function trimConversation(list, maxBytes = 1_500_000) {
  const size = (/** @type {unknown} */ x) => Buffer.byteLength(JSON.stringify(x));
  if (size(list) <= maxBytes) return list;
  const starts = list.map((m, i) => (m.role === "user" && m.content.some((b) => b.type === "text") ? i : -1)).filter((i) => i > 0);
  for (const at of starts) {
    const rest = list.slice(at);
    if (size(rest) <= maxBytes) return rest;
  }
  return [];
}

/** The tiers foldrun's agents name, as the model the engine asks the gateway for. */
export function localModelOf(/** @type {string | null} */ v) {
  const tier = { fast: "haiku", default: "sonnet", max: "opus" }[String(v ?? "default")];
  return tier ?? String(v);
}

/** What the agent is told when it works in the person's own folder. */
export function localPrompt(/** @type {string} */ dir) {
  return [
    "You are foldrun code, a coding agent working directly in the person's own folder on their computer:",
    dir,
    "",
    "Work in that folder. Read before you change; make the smallest change that does the job; run the project's own checks (tests, a build, a quick run) when there are any, and say what you ran and what it showed.",
    "Every change and command is shown to the person and may need their yes; if they say no, do not try the same thing another way — say what you wanted and why.",
    "Never read or print secrets (.env files, keys, tokens), and do not run commands that delete outside the folder, push, deploy or publish unless the person asked for exactly that.",
    "For long or heavy work that can be done on its own (a refactor across many files, an upgrade, a slow test suite to run and fix, two approaches to compare), you can hand it to agents in the cloud with the cloud_agents tool: each works on a copy of this folder, and its changes come back for the person to accept. Give each a complete task; it does not see this conversation.",
    "When you finish, say in a few plain sentences what you changed and how they can see it. Name files by their path inside the folder.",
  ].join("\n");
}

/** One local tool call, in a few words: the file inside the folder, the pattern, the command. */
export function localCallSummary(/** @type {string} */ name, /** @type {Record<string, unknown>} */ input, /** @type {string} */ dir) {
  const rel = (/** @type {unknown} */ p) => {
    const abs = path.resolve(dir, String(p ?? ""));
    const r = path.relative(dir, abs);
    return r && !r.startsWith("..") && !path.isAbsolute(r) ? r : abs;
  };
  if (name === "Read" || name === "Write" || name === "Edit") return rel(input.file_path);
  if (name === "Glob") return String(input.pattern ?? "");
  if (name === "Grep") return `${String(input.pattern ?? "")}${input.path ? ` in ${rel(input.path)}` : ""}`;
  if (name === "Bash") return String(input.command ?? "").replace(/\s+/g, " ").trim();
  if (name === "WebFetch") return String(input.url ?? "");
  if (name === "WebSearch") return String(input.query ?? "");
  if (name === "Task" || name === "Agent") return String(input.description ?? "");
  if (name === "NotebookEdit") return rel(input.notebook_path);
  if (name === "cloud_agents") {
    const n = Array.isArray(input.tasks) ? input.tasks.length : 0;
    return `${n} task${n === 1 ? "" : "s"} in the cloud`;
  }
  return "";
}

/**
 * Whether a path is inside the folder, read the way the file system reads
 * it: one part at a time, each link followed before a ".." goes up from it
 * (Codex). A part that does not exist yet keeps its name; a link that leads
 * nowhere, or any other error, is outside.
 */
export function insideFolder(/** @type {string} */ dir, /** @type {unknown} */ p) {
  if (typeof p !== "string" || !p || p.includes("\0")) return false;
  let root;
  try {
    root = fs.realpathSync(path.resolve(dir));
  } catch {
    return false;
  }
  const abs = path.isAbsolute(p) ? p : `${root}${path.sep}${p}`;
  const parsed = path.parse(abs);
  let cur = parsed.root;
  let missing = false;
  // POSIX: a backslash is part of a name, never a separator (Codex).
  for (const part of abs.slice(parsed.root.length).split(process.platform === "win32" ? /[\\/]+/ : /\/+/)) {
    if (!part || part === ".") continue;
    if (part === "..") {
      cur = path.dirname(cur);
      continue;
    }
    const next = path.join(cur, part);
    if (missing) {
      cur = next;
      continue;
    }
    let st;
    try {
      st = fs.lstatSync(next);
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== "ENOENT") return false;
      missing = true;
      cur = next;
      continue;
    }
    if (st.isSymbolicLink()) {
      try {
        cur = fs.realpathSync(next);
      } catch {
        return false;
      }
    } else cur = next;
  }
  const rel = path.relative(root, cur);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
