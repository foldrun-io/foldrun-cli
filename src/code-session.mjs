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
  ["/model [name]", "the agent's model; fast, default, max or an id changes it"],
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
function writePrivate(/** @type {string} */ file, /** @type {string} */ text) {
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
  Task: "Delegate", Agent: "Delegate", TodoWrite: "Plan", install: "Install", ask: "Ask you",
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
