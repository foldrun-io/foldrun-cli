// Commands a person allowed for good in one folder (`foldrun code`, on
// this computer): "always in this folder", answered at a question.
//
// A rule is the exact command, or — confirmed separately — everything that
// starts with its first words (`npm test`). Rules are kept under ~/.foldrun,
// keyed by the folder, never inside the folder: the project cannot write
// its own permissions.
//
// A command joined from several (`&&`, `||`, `;`, `|`) is allowed only when
// every part is. Some commands are never matched, whatever the rules say,
// and are asked every time: one with a subshell or a group, one that runs
// in the background, a here-document, control characters or more than one
// line, and a redirect that leaves the folder.

import fs from "node:fs";
import path from "node:path";
import { credentialsDir, withFileLock } from "./credentials.mjs";

/** @typedef {{ kind: "exact" | "prefix", text: string, at: string }} Rule */

const MAX_RULES = 200;
const MAX_TEXT = 2_000;

/** Programs whose arguments are another command: never the start of a prefix rule. */
const WRAPPERS = new Set(["sh", "bash", "zsh", "dash", "fish", "ksh", "csh", "tcsh", "env", "sudo", "doas", "su", "xargs", "eval", "exec", "command", "builtin", "nohup", "time", "timeout", "watch", "nice", "ionice", "ssh", "find", "source", ".", "parallel", "script", "strace", "busybox", "osascript", "open", "start", "coproc", "trap", "alias", "unalias", "set", "export", "unset", "declare", "typeset", "local", "readonly", "enable", "hash", "ulimit", "umask", "wait", "kill", "bg", "fg", "disown"]);
/** Programs that run code given on the command line: a prefix needs a second plain word. */
const INTERPRETERS = /^(python[0-9.]*|node|nodejs|deno|bun|ruby|perl|php|lua|awk|gawk|sed|tclsh|Rscript|pwsh|powershell|npx|pnpx|bunx|uvx|pipx|make|just)$/;

/** Words that are the shell's grammar when they stand first. */
const SHELL_WORDS = new Set(["{", "}", "!", "[[", "]]", "if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "function", "select", "time", "coproc", "in"]);

/** A second word that reads as a subcommand (`test`, `status`, `run-script`), not as a file or an option. */
const SUBCOMMAND = /^[a-z][a-z0-9:-]*$/;

const file = () => path.join(credentialsDir(), "code-permissions.json");

/**
 * Spaces and tabs off both ends, as the shell drops them — nothing else:
 * another kind of space is part of a word to the shell, and a space after a
 * backslash is an argument (Codex).
 */
const shTrim = (/** @type {string} */ s) => s.replace(/^[ \t]+/, "").replace(/(?<!\\)[ \t]+$/, "");

/**
 * One change to the file at a time, across every session on this computer:
 * read, change, write under the lock the credentials file uses (written
 * whole, linked into place, taken over only from a session that is gone) —
 * a rule one session removed is not put back by another that read the file
 * before (Codex).
 * @template T @param {() => T} change @returns {T}
 */
const locked = (change) => withFileLock(file(), change);

/** The folder as its rules are keyed: its real path. */
function keyOf(/** @type {string} */ dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

/**
 * Every folder's rules. A file that is not there is no rules; one that
 * cannot be read or is not the shape written here gives none either when
 * a command is checked (asked, then) — but `strict`, for a change, throws:
 * a rule is never added by writing over a file that could not be read (Codex).
 * @param {boolean} [strict]
 * @returns {Record<string, Rule[]>}
 */
function readAll(strict = false) {
  try {
    /** @type {string} */
    let raw;
    try {
      raw = fs.readFileSync(file(), "utf8");
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") return {};
      throw err;
    }
    const doc = JSON.parse(raw);
    if (strict && !(doc && typeof doc === "object" && doc.folders && typeof doc.folders === "object" && !Array.isArray(doc.folders))) throw new Error("not the file foldrun wrote");
    /** @type {Record<string, Rule[]>} */
    const out = {};
    const folders = doc && typeof doc === "object" && doc.folders && typeof doc.folders === "object" && !Array.isArray(doc.folders) ? doc.folders : {};
    for (const [k, v] of Object.entries(folders)) {
      if (!path.isAbsolute(k) || !Array.isArray(v)) continue;
      const rules = [];
      for (const r of v) {
        if (!r || typeof r !== "object") continue;
        const kind = r.kind === "prefix" ? "prefix" : r.kind === "exact" ? "exact" : null;
        if (!kind || typeof r.text !== "string" || !shTrim(r.text) || r.text.length > MAX_TEXT) continue;
        // A prefix that is no longer one this version would offer is dropped, not obeyed.
        if (kind === "prefix" && !prefixOk(r.text)) continue;
        rules.push({ kind: /** @type {Rule["kind"]} */ (kind), text: r.text, at: typeof r.at === "string" ? r.at : "" });
      }
      if (rules.length) out[k] = rules.slice(0, MAX_RULES);
    }
    return out;
  } catch (err) {
    if (strict) throw new Error(`${file()} cannot be read (${err instanceof Error ? err.message : String(err)}) — mend or remove it first`);
    return {};
  }
}

function writeAll(/** @type {Record<string, Rule[]>} */ all) {
  fs.mkdirSync(credentialsDir(), { recursive: true, mode: 0o700 });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ folders: all }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file());
}

/** The folder's rules, in the order they were made. @returns {Rule[]} */
export function folderRules(/** @type {string} */ dir) {
  return readAll()[keyOf(dir)] ?? [];
}

/**
 * Keeps one more rule for the folder.
 * @param {string} dir @param {{ kind: Rule["kind"], text: string }} rule
 * @returns {{ ok: true } | { ok: false, why: string }}
 */
export function addFolderRule(dir, rule) {
  // An exact rule is the command as it was run, to the character.
  const text = rule.kind === "exact" ? rule.text : shTrim(rule.text);
  if (!shTrim(text) || text.length > MAX_TEXT) return { ok: false, why: "the command is too long to keep as a rule" };
  if (rule.kind === "prefix" && !prefixOk(text)) return { ok: false, why: "that start is too wide to allow ahead" };
  if ("never" in commandParts(rule.kind === "exact" ? text : `${text} x`, dir)) return { ok: false, why: "that command is asked every time, whatever the rules" };
  try {
    return locked(() => {
      const all = readAll(true);
      const k = keyOf(dir);
      const list = all[k] ?? [];
      if (list.some((r) => r.kind === rule.kind && r.text === text)) return { ok: /** @type {const} */ (true) };
      if (list.length >= MAX_RULES) return { ok: /** @type {const} */ (false), why: `this folder already has ${MAX_RULES} rules — /permissions rm <n> removes one` };
      all[k] = [...list, { kind: rule.kind, text, at: new Date().toISOString() }];
      writeAll(all);
      return { ok: /** @type {const} */ (true) };
    });
  } catch (err) {
    return { ok: false, why: `the rule was not kept: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Removes the folder's rule at `n` (1 = the first listed) — the one the
 * person was shown: when `shown` is given and the rule there is no longer
 * that one (another session changed the list), nothing is removed.
 * @param {string} dir @param {number} n @param {Rule[]} [shown] the list as it was last shown
 * @returns {Rule | null | "changed"} the one removed; null when there is none at `n`
 */
export function removeFolderRule(dir, n, shown) {
  try {
    return locked(() => {
      const all = readAll(true);
      const k = keyOf(dir);
      const list = all[k] ?? [];
      if (!Number.isInteger(n) || n < 1) return null;
      const want = shown?.[n - 1];
      const has = list[n - 1];
      if (shown && (shown.length !== list.length || !want || !has || want.kind !== has.kind || want.text !== has.text)) return shown.length >= n || list.length >= n ? "changed" : null;
      if (n > list.length) return null;
      const [gone] = list.splice(n - 1, 1);
      if (list.length) all[k] = list;
      else delete all[k];
      writeAll(all);
      return gone;
    });
  } catch {
    return null;
  }
}

/** Inside the folder by the path alone; the caller may pass one that follows links. */
function plainInside(/** @type {string} */ dir, /** @type {string} */ target) {
  const rel = path.relative(path.resolve(dir), path.resolve(dir, target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * A command as its parts, or why it is never matched.
 * @param {string} command
 * @param {string} dir
 * @param {(file: string) => boolean} [inside] whether a redirect's target is inside the folder
 * @returns {{ parts: string[] } | { never: string }}
 */
export function commandParts(command, dir, inside = (f) => plainInside(dir, f)) {
  const text = String(command ?? "");
  if (!shTrim(text)) return { never: "an empty command" };
  if (/[\r\n]/.test(text)) return { never: "more than one line" };
  if (/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(text)) return { never: "control characters" };
  // A space that is not the plain one: a word boundary here, part of a word to the shell (Codex).
  if (/[^\S \t]|[\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]/.test(text)) return { never: "a space that is not a plain space" };
  /** @type {string[]} */
  const parts = [];
  /** Whether a part opens or writes a file (not /dev/null, not one of its own streams). */
  let fileRedirect = false;
  let cur = "";
  /** @type {"'" | '"' | null} */
  let quote = null;
  const split = () => {
    parts.push(shTrim(cur));
    cur = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1] ?? "";
    if (quote === "'") {
      cur += ch;
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === "`" || (ch === "$" && next === "(")) return { never: "a command inside the command ($(…) or `…`)" };
    // $'…' and $"…": quoting with rules of its own (a backslash can hide a quote) — not read here, so not matched (Codex).
    if (ch === "$" && (next === "'" || next === '"')) return { never: "a quoting this check does not read ($'…')" };
    if (quote === '"') {
      if (ch === "\\" && next) {
        cur += ch + next;
        i++;
        continue;
      }
      cur += ch;
      if (ch === '"') quote = null;
      continue;
    }
    if (ch === "\\") {
      if (!next) return { never: "a line that goes on" };
      cur += ch + next;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === ")") return { never: "a subshell or a group" };
    if (ch === "&") {
      if (next === "&") {
        split();
        i++;
        continue;
      }
      // `&>file` is a redirect to bash and "in the background, then a redirect" to sh: not matched (Codex).
      if (next === ">") return { never: "&>, which shells read differently" };
      return { never: "a command left running in the background (start one with run_in_background instead)" };
    }
    if (ch === "|") {
      split();
      if (next === "|" || next === "&") i++;
      continue;
    }
    if (ch === ";") {
      split();
      continue;
    }
    if (ch === ">" || ch === "<") {
      if (ch === "<" && next === "<") return { never: "a here-document" };
      let j = i + 1;
      let op = ch;
      if (ch === ">" && (text[j] === ">" || text[j] === "|")) op += text[j++];
      const dup = text[j] === "&";
      if (dup) op += text[j++];
      while (text[j] === " " || text[j] === "\t") j++;
      let target = "";
      if (text[j] === "'" || text[j] === '"') {
        const q = text[j];
        const end = text.indexOf(q, j + 1);
        if (end < 0) return { never: "an open quote" };
        target = text.slice(j + 1, end);
        // Inside double quotes a variable or a command would still be read.
        if (q === '"' && /[$`\\]/.test(target)) return { never: "a redirect whose target is not a plain path" };
        j = end + 1;
        // More glued to the quoted word (`"a"b`) is not a plain path either.
        if (text[j] !== undefined && !/[\s;|&<>]/.test(text[j])) return { never: "a redirect whose target is not a plain path" };
      } else {
        const start = j;
        while (j < text.length && !/[\s;|&<>()]/.test(text[j])) j++;
        target = text.slice(start, j);
        if (/[$`\\'"*?[\]{}~!]/.test(target)) return { never: "a redirect whose target is not a plain path" };
      }
      if (!target) return { never: "a redirect with no target" };
      // `2>&1`, `>&2`, `<&-`: one of the command's own streams.
      const stream = dup && /^(\d+|-)$/.test(target);
      if (!stream && target !== "/dev/null" && !inside(target)) return { never: "a redirect to a file outside this folder" };
      if (!stream && target !== "/dev/null") fileRedirect = true;
      cur += text.slice(i, j);
      i = j - 1;
      continue;
    }
    cur += ch;
  }
  if (quote) return { never: "an open quote" };
  split();
  if (parts.some((p) => !p)) return { never: "an empty part" };
  // After a change of directory the folder is no longer where a later part
  // runs: what its redirects and paths mean cannot be told from here (Codex).
  // A word the shell reads as its own grammar, not a program: a group, a
  // loop, a test, a job left running (`{ …; }`, `coproc`, `if`, `time`…).
  for (const p of parts) {
    const bare = p.split(/[ \t]+/)[0].replace(/['"\\]/g, "");
    if (SHELL_WORDS.has(bare)) return { never: "the shell's own grammar (a group, a loop, a test or a job)" };
  }
  // Where a later part's redirect lands can be changed by an earlier part
  // (a link made on its path): only the shell could hold it to the folder,
  // and it does not (Codex).
  if (parts.length > 1 && fileRedirect) return { never: "a joined command that writes or reads a file by redirect" };
  // The first word is read as the shell would after quotes and backslashes
  // are taken off; one that names another command to run, sets a variable
  // first or comes from a variable cannot be told at all.
  if (parts.length > 1) {
    for (const p of parts) {
      const first = p.split(/[ \t]+/)[0];
      const bare = first.replace(/['"\\]/g, "");
      if (/[$=]/.test(first) || /^(cd|pushd|popd|chdir|command|builtin|eval|exec|source|\.)$/.test(bare)) return { never: "a joined command whose folder cannot be told (a change of directory, or a command named another way)" };
    }
  }
  return { parts };
}

/** Whether `text` may be kept as "everything that starts with this". */
function prefixOk(/** @type {string} */ text) {
  const words = text.trim().split(/\s+/);
  if (!words[0] || words.length > 2) return false;
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(words[0]) || WRAPPERS.has(words[0])) return false;
  if (words.length === 1) return !INTERPRETERS.test(words[0]);
  return SUBCOMMAND.test(words[1]);
}

/**
 * The start of a command that may be offered as a prefix rule — its first
 * word and, when it is a plain one, the second (`npm test`, `git status`,
 * `cargo build`) — or null: a joined command, one that starts with a
 * program that runs another (`sh`, `sudo`, `env`, `xargs`…), or with an
 * interpreter and no plain second word (`python -c …`).
 * @param {string} command @param {string} dir
 * @returns {string | null}
 */
export function prefixFor(command, dir) {
  const p = commandParts(command, dir);
  if ("never" in p || p.parts.length !== 1) return null;
  const words = p.parts[0].split(/\s+/);
  const two = words[1] && SUBCOMMAND.test(words[1]) ? `${words[0]} ${words[1]}` : words[0];
  return prefixOk(two) ? two : null;
}

/** A prefix rule is its words, then a space or a tab or the end — however the command spaced them. */
function fits(/** @type {Rule} */ r, /** @type {string} */ part) {
  if (r.kind === "exact") return part === r.text;
  const want = r.text.split(" ");
  const have = part.split(/[ \t]+/);
  return want.every((w, i) => have[i] === w);
}

/**
 * Whether the folder's rules allow this command without a question. Only
 * for a command run inside the sandbox, or with none: one sent outside the
 * sandbox (bash_outside) is asked every time — a kept yes there would run,
 * with the person's full access, whatever a script has since become.
 * @param {string} command
 * @param {Rule[]} rules
 * @param {string} dir
 * @param {(file: string) => boolean} [inside]
 */
export function rulesAllow(command, rules, dir, inside) {
  if (!rules.length) return false;
  const p = commandParts(command, dir, inside);
  if ("never" in p) return false;
  // The whole command, to the character: nothing is trimmed away that the shell would read.
  const whole = String(command);
  if (rules.some((r) => r.kind === "exact" && r.text === whole)) return true;
  return p.parts.every((part) => rules.some((r) => fits(r, part)));
}
