// @ts-check
// `foldrun code` on this computer: taking back what the agent's Write and
// Edit did (/rewind). Designed with Codex over three rounds, 24 Nov 2026.
//
// A copy of the file as it was is kept before each change the agent's file
// tools make, and what is on disk is looked at again right after the tool
// ran — before the next call of the same reply — through the engine's own
// after-tool hook. So a record says what one tool call did to one file:
// never what a command run after it did, never what the person saved
// meanwhile.
//
// Taking back is strict. A file is put back only when every step between
// then and now is one this journal recorded: the file is as the agent last
// left it, and nothing else touched it in between. One file that does not
// fit stops the whole rewind before anything is changed; there is no force.
//
// Not covered, and said to the person: what a command (Bash) changed, a
// patch from the cloud (/undo), files outside the folder, folders a write
// created. One known gap: something saving the very file in the instant
// between the copy and the agent's own write.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { credentialsDir } from "./credentials.mjs";
import { writePrivate } from "./code-session.mjs";

/** Turns kept per conversation; the oldest go first. */
export const TURNS_KEPT = 20;
/** Bytes of copies kept per conversation. */
export const BYTES_KEPT = 50 * 1024 * 1024;
/** A file larger than this is not copied: its change cannot be taken back. */
export const FILE_MAX = 5 * 1024 * 1024;
/** Journals not touched for this long are removed when another opens. */
const STALE_MS = 14 * 24 * 3600 * 1000;

/**
 * @typedef {{ absent: true } | { hash: string, mode: number }} State  what a path held
 * @typedef {{ turn: number, label: string, id: string, path: string, tool: string, state: "pending" | "applied" | "unknown", why?: string, before: State | null, expect: { hash: string, mode: number | null } | null, after?: State, at: string }} Entry
 * @typedef {{ root: string, home: string, entries: Entry[], intent: { turn: number } | null, seq?: number, off?: string }} Journal
 */

const sha = (/** @type {Buffer | string} */ b) => crypto.createHash("sha256").update(b).digest("hex");

/** Whether the path, as the file system reads its folder now, is inside the root. */
function insideRoot(/** @type {string} */ root, /** @type {string} */ abs) {
  let at = path.dirname(abs);
  // The nearest folder that exists: a write may be about to create the rest.
  for (;;) {
    try {
      const real = fs.realpathSync(at);
      const rel = path.relative(root, real);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    } catch {
      const up = path.dirname(at);
      if (up === at) return false;
      at = up;
    }
  }
}

/**
 * What a path holds now, read through one descriptor that does not follow
 * a link: its bytes and mode, that it is not there, or why it cannot be
 * checkpointed (a link, a file with a second name, not a plain file, too
 * large).
 * @returns {{ absent: true } | { bytes: Buffer, hash: string, mode: number } | { odd: string }}
 */
export function stateOf(/** @type {string} */ abs) {
  let fd;
  try {
    fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (err) {
    const code = /** @type {{ code?: string }} */ (err).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { absent: true };
    if (code === "ELOOP" || code === "EMLINK") return { odd: "it is a link" };
    return { odd: `it cannot be read (${code ?? "error"})` };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { odd: "it is not a plain file" };
    if (st.nlink > 1) return { odd: "it has a second name (a hard link)" };
    if (st.size > FILE_MAX) return { odd: `it is larger than ${FILE_MAX / 1024 / 1024} MB` };
    const bytes = fs.readFileSync(fd);
    return { bytes, hash: sha(bytes), mode: st.mode & 0o777 };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Whether the recorded path still names the same place: every folder on
 * the way is itself, not a link put there since. A folder swapped for a
 * link to another folder of the workspace would otherwise pass as inside.
 */
function samePlace(/** @type {string} */ root, /** @type {string} */ rel) {
  let at = path.dirname(path.join(root, rel));
  // Folders the rewind would not need (a created file's folder since removed) are fine.
  for (;;) {
    try {
      return fs.realpathSync(at) === at;
    } catch {
      const up = path.dirname(at);
      if (up === at) return false;
      at = up;
    }
  }
}

/** The same content, existence and — where both are files — mode. */
function same(/** @type {any} */ a, /** @type {any} */ b) {
  if (!a || !b || a.odd || b.odd) return false;
  if (a.absent || b.absent) return Boolean(a.absent && b.absent);
  return a.hash === b.hash && a.mode === b.mode;
}

const slim = (/** @type {any} */ st) => (st.absent ? { absent: /** @type {const} */ (true) } : { hash: String(st.hash), mode: Number(st.mode) });

function save(/** @type {Journal} */ j) {
  fs.mkdirSync(path.join(j.home, "blobs"), { recursive: true, mode: 0o700 });
  writePrivate(path.join(j.home, "journal.json"), JSON.stringify({ root: j.root, entries: j.entries, intent: j.intent, seq: j.seq ?? 0 }));
}

/** What is on disk now: another terminal in the same conversation writes here too. */
function reload(/** @type {Journal} */ j) {
  let kept;
  try {
    kept = JSON.parse(fs.readFileSync(path.join(j.home, "journal.json"), "utf8"));
  } catch (err) {
    if (/** @type {{ code?: string }} */ (err).code === "ENOENT") {
      j.entries = [];
      j.intent = null;
      j.seq = 0;
      return;
    }
    throw err;
  }
  if (!kept || kept.root !== j.root || !Array.isArray(kept.entries)) throw new Error("the rewind journal of this conversation cannot be read");
  j.entries = kept.entries.filter((/** @type {any} */ e) => e && Number.isInteger(e.turn) && typeof e.path === "string" && typeof e.id === "string" && !path.isAbsolute(e.path) && !e.path.split(/[\\/]/).includes(".."));
  j.intent = kept.intent && Number.isInteger(kept.intent.turn) ? { turn: kept.intent.turn } : null;
  // Never below a turn already recorded (a journal written before the counter was kept).
  j.seq = Math.max(Number.isInteger(kept.seq) ? kept.seq : 0, ...j.entries.map((/** @type {Entry} */ e) => e.turn), 0);
}

/**
 * One change to the journal: under its lock, starting from what is on disk,
 * saved before the lock is let go. Two terminals in one conversation then
 * never write over each other's records or drop a copy the other needs.
 * @template T
 * @param {Journal} j
 * @param {() => T} change
 * @returns {T}
 */
function locked(j, change) {
  fs.mkdirSync(j.home, { recursive: true, mode: 0o700 });
  const lock = path.join(j.home, "lock");
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (let tries = 0; ; tries++) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (err) {
      if (/** @type {{ code?: string }} */ (err).code !== "EEXIST") throw err;
      // Left by a process that died: nothing holds a journal this long.
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) fs.rmdirSync(lock);
      } catch {
        /* gone meanwhile */
      }
      if (tries > 300) throw new Error("the rewind journal is held by another foldrun code session");
      Atomics.wait(wait, 0, 0, 10);
    }
  }
  try {
    reload(j);
    const out = change();
    save(j);
    return out;
  } finally {
    try {
      fs.rmdirSync(lock);
    } catch {
      /* already gone */
    }
  }
}

/**
 * A number for the turn that is starting, taken under the lock: two
 * terminals in one conversation never share one. 0 when the journal is off.
 */
export function nextTurn(/** @type {Journal} */ j) {
  if (j.off) return 0;
  try {
    return locked(j, () => {
      j.seq = (j.seq ?? 0) + 1;
      return j.seq;
    });
  } catch (err) {
    j.off = err instanceof Error ? err.message : String(err);
    return 0;
  }
}

/** Marks a rewind of `turn` as under way (apply does; a test of a rewind cut short does too). */
export function markIntent(/** @type {Journal} */ j, /** @type {number} */ turn) {
  locked(j, () => {
    j.intent = { turn };
  });
}

/** The bytes of copies kept now. */
function weight(/** @type {Journal} */ j) {
  try {
    const blobs = path.join(j.home, "blobs");
    return fs.readdirSync(blobs).reduce((n, f) => n + fs.statSync(path.join(blobs, f)).size, 0);
  } catch {
    return 0;
  }
}

/** Keeps a copy; false when there is no room left for it. */
function keepBlob(/** @type {Journal} */ j, /** @type {Buffer} */ bytes, /** @type {string} */ hash, /** @type {number} */ turn) {
  const file = path.join(j.home, "blobs", hash);
  if (fs.existsSync(file)) return true;
  // Older turns give way first; the turn being written is never cut into.
  while (weight(j) + bytes.length > BYTES_KEPT) {
    const older = [...new Set(j.entries.map((e) => e.turn))].filter((n) => n < turn).sort((a, b) => a - b);
    if (!older.length) return false;
    j.entries = j.entries.filter((e) => e.turn !== older[0]);
    trim(j);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, bytes, { mode: 0o600, flag: "wx" });
  return true;
}

/** Copies no entry names any more are removed; the oldest turns go when there are too many or they weigh too much. */
function trim(/** @type {Journal} */ j) {
  const blobs = path.join(j.home, "blobs");
  const size = (/** @type {string} */ h) => {
    try {
      return fs.statSync(path.join(blobs, h)).size;
    } catch {
      return 0;
    }
  };
  const named = () => new Set(j.entries.flatMap((e) => (e.before && "hash" in e.before ? [e.before.hash] : [])));
  for (;;) {
    const turns = [...new Set(j.entries.map((e) => e.turn))].sort((a, b) => a - b);
    const weight = [...named()].reduce((n, h) => n + size(h), 0);
    if (turns.length <= TURNS_KEPT && weight <= BYTES_KEPT) break;
    if (turns.length <= 1) break;
    j.entries = j.entries.filter((e) => e.turn !== turns[0]);
  }
  const keep = named();
  try {
    for (const f of fs.readdirSync(blobs)) if (!keep.has(f)) fs.rmSync(path.join(blobs, f), { force: true });
  } catch {
    /* no copies yet */
  }
}

/**
 * The journal of one conversation in one folder. A record left pending by a
 * process that died between a write and its check is settled now from what
 * is on disk. `off` says why nothing can be recorded, when it cannot.
 * @returns {Journal}
 */
export function openJournal(/** @type {string} */ dir, /** @type {string} */ key) {
  let root = path.resolve(dir);
  try {
    root = fs.realpathSync(root);
  } catch {
    /* as given */
  }
  const all = path.join(credentialsDir(), "code-checkpoints");
  /** @type {Journal} */
  const j = { root, home: path.join(all, sha(JSON.stringify([root, key])).slice(0, 32)), entries: [], intent: null };
  try {
    fs.mkdirSync(all, { recursive: true, mode: 0o700 });
    // Conversations long left: their copies are not kept for ever.
    for (const name of fs.readdirSync(all)) {
      if (!/^[0-9a-f]{32}$/.test(name)) continue;
      const at = path.join(all, name);
      if (at !== j.home && Date.now() - fs.statSync(at).mtimeMs > STALE_MS) fs.rmSync(at, { recursive: true, force: true });
    }
    reload(j);
    // Left pending by a process that died between a write and its check.
    // Not one a live terminal is in the middle of: those are seconds old.
    if (j.entries.some((e) => e.state === "pending" && Date.now() - Date.parse(e.at) > 60_000)) {
      locked(j, () => {
        for (const e of j.entries.filter((x) => x.state === "pending" && Date.now() - Date.parse(x.at) > 60_000)) settleEntry(j, e);
      });
    }
  } catch (err) {
    j.off = err instanceof Error ? err.message : String(err);
  }
  return j;
}

/** What the agent's call will leave in the file, worked out the way core's Write and Edit do it. */
function expected(/** @type {string} */ tool, /** @type {any} */ input, /** @type {any} */ before) {
  if (tool === "Write") {
    if (typeof input?.content !== "string") return null;
    return { hash: sha(Buffer.from(input.content, "utf8")), mode: before.absent ? null : written(before.mode) };
  }
  if (tool !== "Edit" || before.absent) return null;
  // One file's part of an Edit `edits` list (FOL-294): its changes in order, each against what the last left.
  if (Array.isArray(input?.edits)) {
    let text = before.bytes.toString("utf8");
    for (const e of input.edits) {
      const f = e?.old_string;
      const t = e?.new_string;
      if (typeof f !== "string" || typeof t !== "string" || !f || f === t) return null;
      const at = text.indexOf(f);
      if (at < 0) return null;
      // The bound core holds the change to (EDIT_TEXT_MAX), measured before it is built (Codex).
      const n = e.replace_all === true ? text.split(f).length - 1 : 1;
      if (text.length + n * (t.length - f.length) > 16 * 1024 * 1024) return null;
      text = e.replace_all === true ? text.split(f).join(t) : text.slice(0, at) + t + text.slice(at + f.length);
    }
    return { hash: sha(Buffer.from(text, "utf8")), mode: written(before.mode) };
  }
  const from = input?.old_string;
  const to = input?.new_string;
  if (typeof from !== "string" || typeof to !== "string" || !from || from === to) return null;
  const text = before.bytes.toString("utf8");
  const at = text.indexOf(from);
  if (at < 0) return null;
  const after = input.replace_all === true ? text.split(from).join(to) : text.slice(0, at) + to + text.slice(at + from.length);
  return { hash: sha(Buffer.from(after, "utf8")), mode: written(before.mode) };
}

/** The mode core's writer leaves: the file's own, less what the process's umask takes from a new file. */
function written(/** @type {number} */ mode) {
  return mode & ~process.umask();
}

/**
 * Before a Write or Edit the person (or an earlier "always") allowed: the
 * file as it is, kept, and what the call should leave. Returns nothing; a
 * journal that cannot be written turns itself off and says why once.
 */
export function capture(/** @type {Journal} */ j, /** @type {{ turn: number, label: string, id: string, tool: string, file: unknown, input: unknown }} */ call) {
  if (j.off || typeof call.file !== "string") return;
  const abs = path.resolve(j.root, call.file);
  // Outside the folder: asked about on its own, and not rewind's to take back.
  if (!insideRoot(j.root, abs)) return;
  const rel = path.relative(j.root, path.join(fs.existsSync(path.dirname(abs)) ? fs.realpathSync(path.dirname(abs)) : path.dirname(abs), path.basename(abs)));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return;
  try {
    locked(j, () => {
      const before = stateOf(abs);
      /** @type {Entry} */
      const entry = { turn: call.turn, label: call.label, id: call.id, path: rel.split(path.sep).join("/"), tool: call.tool, state: "pending", before: null, expect: null, at: new Date().toISOString() };
      if ("odd" in before) {
        entry.state = "unknown";
        entry.why = before.odd;
      } else if ("bytes" in before && !keepBlob(j, before.bytes, before.hash, call.turn)) {
        // Never a turn that looks whole and is not: said, and refused at rewind.
        entry.state = "unknown";
        entry.why = `the copies kept for this conversation are at their limit (${BYTES_KEPT / 1024 / 1024} MB)`;
      } else {
        entry.before = slim(before);
        entry.expect = expected(call.tool, call.input, before);
      }
      j.entries.push(entry);
      trim(j);
    });
  } catch (err) {
    j.off = err instanceof Error ? err.message : String(err);
  }
}

function settleEntry(/** @type {Journal} */ j, /** @type {Entry} */ e) {
  const now = stateOf(path.join(j.root, e.path));
  if (e.before && same(now, e.before)) {
    // Nothing was written: refused as stale, no match, or the same bytes.
    j.entries = j.entries.filter((x) => x !== e);
    return null;
  }
  if (e.before && e.expect && "hash" in now && now.hash === e.expect.hash && (e.expect.mode === null || now.mode === e.expect.mode)) {
    e.state = "applied";
    e.after = slim(now);
    return e;
  }
  // Not as it was and not as the call would leave it: something else wrote here.
  e.state = "unknown";
  e.why ??= "the file was changed by something else while the agent wrote it";
  return e;
}

/**
 * Right after the tool ran, before the next call: what is on disk decides
 * what the record says. Returns the path when the agent's change is there.
 */
export function settle(/** @type {Journal} */ j, /** @type {string} */ id) {
  try {
    return locked(j, () => {
      const e = j.entries.find((x) => x.id === id && x.state === "pending");
      if (!e) return null;
      const kept = settleEntry(j, e);
      trim(j);
      return kept && kept.state === "applied" ? kept.path : null;
    });
  } catch (err) {
    j.off = err instanceof Error ? err.message : String(err);
    return null;
  }
}

/** The turns that changed files, newest last: what /undo lists. */
export function turnsOf(/** @type {Journal} */ j) {
  try {
    reload(j);
  } catch {
    /* what this terminal has */
  }
  /** @type {Map<number, { turn: number, label: string, files: Map<string, string> }>} */
  const by = new Map();
  for (const e of j.entries) {
    if (e.state === "pending") continue;
    const t = by.get(e.turn) ?? { turn: e.turn, label: e.label, files: new Map() };
    // A file's line in a turn: what its first write there did, unless one of them could not be recorded.
    const op = e.state === "unknown" ? "cannot be taken back" : e.before && "absent" in e.before ? "created" : "changed";
    if (!t.files.has(e.path) || op === "cannot be taken back") t.files.set(e.path, op);
    by.set(e.turn, t);
  }
  return [...by.values()].sort((a, b) => a.turn - b.turn).map((t) => ({ turn: t.turn, label: t.label, files: [...t.files].map(([file, op]) => ({ path: file, op })) }));
}

/** A kept copy's bytes, only when they are still the bytes that were kept. */
function copyOf(/** @type {Journal} */ j, /** @type {string} */ hash) {
  try {
    const bytes = fs.readFileSync(path.join(j.home, "blobs", hash));
    return sha(bytes) === hash ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * What taking back turn `turn` and every turn after it would do, checked
 * against the disk now: each file's target, and every reason it cannot be
 * done. With one conflict nothing is to be changed.
 */
export function plan(/** @type {Journal} */ j, /** @type {number} */ turn) {
  try {
    reload(j);
  } catch {
    /* what this terminal has */
  }
  /** @type {Map<string, Entry[]>} */
  const by = new Map();
  for (const e of j.entries) if (e.turn >= turn) by.set(e.path, [...(by.get(e.path) ?? []), e]);
  /** @type {{ path: string, op: "restore" | "remove", done: boolean, hash?: string, mode?: number, now: any }[]} */
  const changes = [];
  /** @type {{ path: string, why: string }[]} */
  const conflicts = [];
  const resuming = j.intent?.turn === turn;
  for (const [file, es] of by) {
    const abs = path.join(j.root, file);
    const bad = es.find((e) => e.state !== "applied" || !e.before || !e.after);
    if (bad) {
      conflicts.push({ path: file, why: bad.state === "pending" ? `turn ${bad.turn}: a write to it is not settled yet — a turn is still running, or one ended abruptly less than a minute ago` : `turn ${bad.turn}: ${bad.why ?? "its change could not be recorded"}` });
      continue;
    }
    const gap = es.findIndex((e, i) => i > 0 && !same(es[i - 1].after, e.before));
    if (gap > 0) {
      conflicts.push({ path: file, why: `something else changed it between the agent's writes in turn ${es[gap - 1].turn} and turn ${es[gap].turn}` });
      continue;
    }
    if (!insideRoot(j.root, abs) || !samePlace(j.root, file)) {
      conflicts.push({ path: file, why: "a folder on its path is now a link somewhere else" });
      continue;
    }
    const now = stateOf(abs);
    const first = /** @type {State} */ (es[0].before);
    const last = es[es.length - 1].after;
    if ("odd" in now) {
      conflicts.push({ path: file, why: now.odd });
      continue;
    }
    const done = resuming && same(now, first);
    if (!done && !same(now, last)) {
      conflicts.push({ path: file, why: "it was changed since the agent last wrote it (by a command, by you, or by another program)" });
      continue;
    }
    if ("hash" in first && copyOf(j, first.hash) === null) {
      conflicts.push({ path: file, why: "its earlier copy is no longer kept, or is damaged" });
      continue;
    }
    changes.push("absent" in first ? { path: file, op: "remove", done, now: slim(now) } : { path: file, op: "restore", done, hash: first.hash, mode: first.mode, now: slim(now) });
  }
  return { turn, changes: changes.sort((a, b) => a.path.localeCompare(b.path)), conflicts: conflicts.sort((a, b) => a.path.localeCompare(b.path)) };
}

/**
 * Does what `plan` said, file by file, each through a new file moved into
 * place. The intent is written first: a rewind cut short is finished by
 * running the same one again, which skips what is already back. A file that
 * changed since the plan stops it there.
 * @returns {string[]} the paths put back
 */
export function apply(/** @type {Journal} */ j, /** @type {ReturnType<typeof plan>} */ p) {
  if (p.conflicts.length) throw new Error("nothing was changed: not every file can be taken back");
  const key = (/** @type {ReturnType<typeof plan>} */ x) => JSON.stringify(x.changes.map((c) => [c.path, c.op, c.done, c.hash ?? null, c.mode ?? null, c.now]));
  return locked(j, () => {
    // The person answered a question in between, and another terminal may
    // have written meanwhile: under the lock, every file is looked at again
    // and every copy read before the first one is touched. What differs
    // from what was shown stops it with nothing changed.
    const fresh = plan(j, p.turn);
    if (fresh.conflicts.length || key(fresh) !== key(p)) throw new Error(`nothing was changed: ${fresh.conflicts[0] ? `${fresh.conflicts[0].path} — ${fresh.conflicts[0].why}` : "the files changed since they were shown"} — /undo ${p.turn} shows it as it is now`);
    /** @type {Map<string, Buffer>} */
    const copies = new Map();
    for (const ch of fresh.changes) {
      if (ch.done || ch.op !== "restore") continue;
      const bytes = copyOf(j, /** @type {string} */ (ch.hash));
      if (bytes === null) throw new Error(`nothing was changed: the earlier copy of ${ch.path} is no longer kept, or is damaged`);
      copies.set(ch.path, bytes);
    }
    j.intent = { turn: p.turn };
    save(j);
    const put = [];
    for (const ch of fresh.changes) {
      if (ch.done) continue;
      const abs = path.join(j.root, ch.path);
      if (!insideRoot(j.root, abs) || !samePlace(j.root, ch.path) || !same(stateOf(abs), ch.now)) throw new Error(`${ch.path} changed while the rewind ran — stopped there; /undo ${p.turn} again shows what is left`);
      if (ch.op === "remove") fs.rmSync(abs, { force: true });
      else {
        const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${crypto.randomBytes(8).toString("hex")}.tmp`);
        try {
          fs.writeFileSync(tmp, /** @type {Buffer} */ (copies.get(ch.path)), { flag: "wx", mode: ch.mode });
          fs.chmodSync(tmp, /** @type {number} */ (ch.mode));
          fs.renameSync(tmp, abs);
        } catch (err) {
          fs.rmSync(tmp, { force: true });
          throw err;
        }
      }
      put.push(ch.path);
    }
    j.entries = j.entries.filter((e) => e.turn < p.turn);
    j.intent = null;
    trim(j);
    return put;
  });
}
