// `sandbox: own` on this computer (FOL-244): a sub-agent of `foldrun code`
// whose definition says `sandbox: own` works in a sandbox of its own, on a
// private copy of the folder, and hands back one patch — the same promise
// the field makes in the cloud (foldrun-infra docs/sub-agent-sandbox-plan.md).
//
//   1. Admit: one of the computer's worker slots (two, shared by every
//      foldrun session on it), decided under a short mutex. A slot is held
//      while its session (by id AND start time) or its worker is alive; one
//      held for processes a stop could not end, while any of them is. A stop
//      while waiting starts nothing.
//   2. Capture: the files git would list (tracked, and untracked ones not
//      ignored), never .env files, .git folders or links, each read through a
//      handle that follows no link, every folder on its way checked to be a
//      folder, within a byte budget. Two copies: the worker's (its working
//      folder), and the baseline, a git repository in foldrun's cache folder,
//      which the worker's walls cannot read or write.
//   3. Start: a separate process (the sandbox runtime holds one set of walls
//      per process, and the session's are on the person's folder), started
//      with a short list of plain variables; the job, model key included,
//      goes on its input; its id is written to the slot before the job is
//      sent. Its walls are on its copy: it writes there, in its own temp
//      folder and its own package cache only; the person's folder and
//      foldrun's own folders cannot be read; sites off the list are refused.
//   4. Stop: its process tree is sampled (id, group, start time) from the
//      moment it starts; a stop, or its end, ends every process seen and
//      every process of their groups, signalled by id only while the id still
//      names the process seen, and waits until none is left. Then any process
//      still holding the copy (lsof) blocks the patch: it is not signalled (it
//      cannot be told from the person's own editor), and the slot stays held
//      until it lets go. Anything that will not die, or a check that cannot
//      answer, keeps the slot held, and no patch is taken.
//      On macOS this is sampled, not held: a process that leaves its group
//      and its parent between two looks, and holds nothing in the copy, is
//      not seen (on Linux bubblewrap's own process namespace holds it).
//   5. Patch: only once nothing of the worker is left. Its tree is walked
//      without following a link, the folder's own ignore rules (asked of the
//      folder's repository: .gitignore files, info/exclude, the person's
//      global excludes) prune what is new before it is read, and the rest is
//      laid over the baseline — removals first. git makes the patch in the
//      baseline, never in the copy; the parent changes nothing in the copy.
//
// Refused before it starts, never run with less: no sandbox on this computer
// (or the person turned it off), a folder not in git (the patch is applied
// with git), a /plan turn, its own MCP servers, or a Node older than 22.13
// (whose built-in SQLite holds the lock the slots are shared under).

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { packageCacheFor } from "./code-sandbox.mjs";

/** Workers that may run at once on this computer, across sessions. */
export const WORKER_SLOTS = 2;
/** The most one copy may hold. */
export const COPY_MAX_FILES = 20_000;
export const COPY_MAX_BYTES = 512 * 1024 * 1024;

const stateBase = (env = process.env, home = os.homedir()) =>
  path.join(typeof env.XDG_STATE_HOME === "string" && path.isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : path.join(home, ".local", "state"), "foldrun");
/** Where the slots are kept: one file each, shared by every session. */
export const slotDir = (env = process.env, home = os.homedir()) => path.join(stateBase(env, home), "worker-slots");
/** Where workers' copies are made. */
export const copyRoot = (env = process.env, home = os.homedir()) => path.join(stateBase(env, home), "workers");

/** git with no repository of the caller's environment, no hooks, no signing. */
function git(/** @type {string} */ cwd, /** @type {string[]} */ args, /** @type {Record<string, any>} */ more = {}) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string" && !k.startsWith("GIT_")) env[k] = v;
  return spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "core.fsmonitor=false", ...args], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...env, GIT_CONFIG_NOSYSTEM: "1" }, ...more });
}

// ---------------------------------------------------------------------------
// Processes.

/** Programs by their own path: while the session's walls are up, this process's PATH is narrowed to core's helpers,
 *  which have neither — and a ps not found would read as "no processes", so nothing would be stopped. */
const PS = ["/bin/ps", "/usr/bin/ps"].find((p) => fs.existsSync(p)) ?? "ps";
const LSOF = ["/usr/sbin/lsof", "/usr/bin/lsof", "/bin/lsof"].find((p) => fs.existsSync(p)) ?? null;

/** @typedef {{ pgid: number, start: string }} Seen */

/** Every process: id, parent, group, start time. Throws when it cannot be read: an empty table must never mean "all gone". */
// A zombie (state Z) is a process that has ended and waits to be reaped by its parent — in a container with no init,
// forever. It runs nothing and holds nothing, so here it is gone; `kill(pid, 0)` alone would call it alive and a reap
// would wait on it to its deadline.
function processTable() {
  const out = spawnSync(PS, ["-axo", "pid=,ppid=,pgid=,stat=,lstart="], { encoding: "utf8", env: { LC_ALL: "C", TZ: "UTC" } });
  if (out.status !== 0 || out.error) throw new Error(`the process list could not be read (${out.error?.message ?? String(out.stderr).trim()})`);
  /** @type {Map<number, { ppid: number, pgid: number, start: string }>} */
  const rows = new Map();
  for (const line of String(out.stdout).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (m && !ended(Number(m[1]), m[4])) rows.set(Number(m[1]), { ppid: Number(m[2]), pgid: Number(m[3]), start: m[5] });
  }
  return rows;
}

/** A process's start time as ps says it: with its id, what tells it from a later process given the same id. */
export function processStart(/** @type {number} */ pid) {
  const out = spawnSync(PS, ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { LC_ALL: "C", TZ: "UTC" } });
  return out.status === 0 ? String(out.stdout).trim() || null : null;
}

/** Ended and not reaped: state Z — and on Linux one thread or none, because a thread-group leader that called
 *  pthread_exit() also shows Z while its other threads run on. A count that cannot be read is "running". */
function ended(/** @type {number} */ pid, /** @type {string} */ stat) {
  if (!stat.startsWith("Z")) return false;
  if (process.platform !== "linux") return true;
  try {
    const line = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    // Fields after the name's closing ")": state is the first, num_threads the 18th (field 20 of proc(5)).
    const fields = line.slice(line.lastIndexOf(")") + 2).split(" ");
    const threads = Number(fields[17]);
    return fields[0] === "Z" && Number.isInteger(threads) && threads <= 1;
  } catch {
    return false;
  }
}

/** Is it a zombie that has fully ended? False when ps cannot say: then it is taken to be running. */
function isZombie(/** @type {number} */ pid) {
  const out = spawnSync(PS, ["-o", "stat=", "-p", String(pid)], { encoding: "utf8", env: { LC_ALL: "C" } });
  return out.status === 0 && ended(pid, String(out.stdout).trim());
}

/** A process that exists and has not ended (a zombie has). */
const pidAlive = (/** @type {number} */ pid) => {
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (/** @type {any} */ (err).code !== "EPERM") return false;
  }
  return !isZombie(pid);
};

/** A process that is still the one recorded: same id, same start (one whose start cannot be read now counts as it). */
const sameAlive = (/** @type {{ pid: number, start?: string | null }} */ p) => Number.isInteger(p?.pid) && p.pid > 0 && pidAlive(p.pid) && (!p.start || [p.start, null].includes(processStart(p.pid)));

/** A process and everything below it, now: id → group and start. With `rootStart`, nothing unless the root is still
 *  that process (an id given again to another process is not walked). */
export function treeOf(/** @type {number} */ root, rows = processTable(), /** @type {string | undefined} */ rootStart = undefined) {
  if (rootStart !== undefined && rows.get(root)?.start !== rootStart) return new Map();
  /** @type {Map<number, number[]>} */
  const kids = new Map();
  for (const [pid, r] of rows) kids.set(r.ppid, [...(kids.get(r.ppid) ?? []), pid]);
  /** @type {Map<number, Seen>} */
  const found = new Map();
  const todo = rows.has(root) ? [root] : [];
  while (todo.length) {
    const pid = /** @type {number} */ (todo.pop());
    if (found.has(pid)) continue;
    const r = /** @type {{ ppid: number, pgid: number, start: string }} */ (rows.get(pid));
    found.set(pid, { pgid: r.pgid, start: r.start });
    todo.push(...(kids.get(pid) ?? []));
  }
  return found;
}

/**
 * End the worker's processes and wait until none is left: TERM, a grace,
 * KILL, then poll. Signalled: every process recorded that is still the one
 * recorded (same id, same start), and every member of a group one of those
 * is in now — a live process vouches for its group. A member of a group seen
 * earlier whose recorded members are all gone (a child forked after the last
 * look, say) is never signalled: its group's id may have been given to
 * another since. It is returned as left, so the slot stays held while it
 * lives and no patch is taken.
 * @param {number} root
 * @param {Map<number, Seen>} seen the worker's processes as last seen
 * @param {{ rootStart?: string, groups?: Set<number>, graceMs?: number, waitMs?: number }} [o] rootStart: the root as it was
 *   started, walked from only while it is still that process; groups: every group any of them was ever seen in
 * @returns {Promise<{ pid: number, start: string }[]>} what is still alive, as it is now (empty: all gone)
 */
export async function reapTree(root, seen, o = {}) {
  const graceMs = o.graceMs ?? 2000;
  const waitMs = o.waitMs ?? 10_000;
  const groups = o.groups ?? new Set();
  const mine = processTable().get(process.pid)?.pgid ?? -1;
  /** @type {Map<number, string>} what was alive at the last look, with its start now */
  let now = new Map();
  /** Members of groups seen before, vouched for by no live process: kept, never signalled. */
  /** @type {Set<number>} */
  const unvouched = new Set();
  const gather = () => {
    const rows = processTable();
    for (const [pid, s] of treeOf(root, rows, o.rootStart)) seen.set(pid, s);
    for (const s of seen.values()) groups.add(s.pgid);
    const live = [...seen].filter(([pid, s]) => pid !== process.pid && rows.get(pid)?.start === s.start).map(([pid]) => pid);
    const vouched = new Set(live.map((pid) => /** @type {any} */ (rows.get(pid)).pgid).filter((g) => g > 1 && g !== mine));
    for (const g of vouched) groups.add(g);
    unvouched.clear();
    for (const [pid, r] of rows) {
      if (pid === process.pid || live.includes(pid)) continue;
      // A member of a group a live one vouches for is the worker's, whatever was recorded under its id before (by id and start).
      if (vouched.has(r.pgid)) {
        seen.set(pid, { pgid: r.pgid, start: r.start });
        live.push(pid);
      } else if (groups.has(r.pgid) && r.pgid > 1 && r.pgid !== mine) unvouched.add(pid);
    }
    now = new Map([...live, ...unvouched].map((pid) => [pid, /** @type {any} */ (rows.get(pid)).start]));
    return live;
  };
  const hit = (/** @type {NodeJS.Signals} */ sig) => {
    for (const pid of gather()) {
      try {
        process.kill(pid, sig);
      } catch {
        /* gone */
      }
    }
  };
  if (gather().length) {
    hit("SIGTERM");
    const until = Date.now() + graceMs;
    while (gather().length && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    const end = Date.now() + waitMs;
    while (gather().length && Date.now() < end) {
      hit("SIGKILL");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  gather();
  return [...now].map(([pid, start]) => ({ pid, start }));
}

/**
 * What lsof said that leaves the answer for `dir` in doubt. A mount lsof could
 * not stat elsewhere on the machine says nothing about the folder: with Docker
 * running, a person's lsof always warns about /run/docker/netns/default, and
 * the copy then counted as held forever — the slot never came back (the dev CI
 * runner, 25 Nov 2026). Such a line is dropped when its mount is neither in the
 * folder nor above it, and "may be incomplete" with it when nothing else is
 * left; anything else stays a doubt.
 */
export function lsofWarnings(/** @type {string} */ stderr, /** @type {string} */ dir) {
  const within = (/** @type {string} */ a, /** @type {string} */ b) => a === b || a.startsWith(b.endsWith("/") ? b : `${b}/`);
  // lsof names mounts by their real path; a folder reached through a link is compared both ways, and unresolvable keeps every warning (Codex).
  /** @type {string[]} */
  let names;
  try {
    names = [...new Set([dir, fs.realpathSync(dir)])];
  } catch {
    return stderr.trim();
  }
  const kept = [];
  let dropped = false;
  for (const line of stderr.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const m = /^lsof: WARNING: can't stat\(\) \S+ file system (\/.*)$/.exec(t);
    if (m && names.every((d) => !within(m[1], d) && !within(d, m[1]))) {
      dropped = true;
      continue;
    }
    kept.push(t);
  }
  const rest = dropped && kept.every((t) => t === "Output information may be incomplete.") ? [] : kept;
  return rest.join("\n");
}

/**
 * Processes holding anything inside a folder (its cwd, an open file, a
 * mapped one): their ids and starts. The folder (ours: a worker's copy) is
 * made readable first, so no part of it is skipped. Throws when it cannot
 * tell: lsof warned (a part it could not read), timed out or is missing, or
 * /proc could not be read — an empty answer means nothing holds it, never
 * "could not look".
 */
export function holdersOf(/** @type {string} */ dir, /** @type {{ lsof?: string | null, proc?: string }} */ o = {}) {
  const lsof = o.lsof === undefined ? LSOF : o.lsof;
  const proc = o.proc ?? "/proc";
  openFolders(dir);
  const rows = processTable();
  /** @type {Set<number>} */
  const pids = new Set();
  if (lsof) {
    // Warnings on: -t would silence the one that says a part was skipped. Its exit status is no guide (1 even when it finds one).
    const out = spawnSync(lsof, ["-F", "p", "+D", dir], { encoding: "utf8", timeout: 20_000 });
    const warned = lsofWarnings(String(out.stderr), dir);
    if (out.error || out.signal || warned) throw new Error(`what holds the copy could not be checked (${out.error?.message ?? out.signal ?? warned.slice(0, 200)})`);
    for (const line of String(out.stdout).split("\n")) if (/^p\d+$/.test(line)) pids.add(Number(line.slice(1)));
  } else if (fs.existsSync(path.join(proc, "self", "fd"))) {
    const inside = (/** @type {string} */ t) => t === dir || t.startsWith(`${dir}/`);
    const uid = process.getuid?.();
    for (const pid of rows.keys()) {
      const at = path.join(proc, String(pid));
      // Whose it is: another person's process cannot be the worker, which runs as this person.
      let owner;
      try {
        const m = /^Uid:\s+(\d+)/m.exec(fs.readFileSync(path.join(at, "status"), "utf8"));
        if (!m) throw Object.assign(new Error("no Uid line"), { code: "EBADUID" });
        owner = Number(m[1]);
      } catch (err) {
        if (/** @type {any} */ (err).code === "ENOENT") continue; // gone
        throw new Error(`what holds the copy could not be checked (${pid}: ${/** @type {any} */ (err).code ?? err})`);
      }
      if (uid !== undefined && owner !== uid) continue;
      // Each source on its own: one this person's process will not show is no answer, never "nothing there".
      const look = (/** @type {() => void} */ fn) => {
        try {
          fn();
        } catch (err) {
          if (/** @type {any} */ (err).code === "ENOENT") return; // gone, or closed meanwhile
          throw new Error(`what holds the copy could not be checked (${pid}: ${/** @type {any} */ (err).code ?? err})`);
        }
      };
      for (const l of ["cwd", "root"]) look(() => inside(fs.readlinkSync(path.join(at, l))) && pids.add(pid));
      look(() => {
        for (const f of fs.readdirSync(path.join(at, "fd"))) look(() => inside(fs.readlinkSync(path.join(at, "fd", f))) && pids.add(pid));
      });
      // A file it mapped and then closed is still held.
      look(() => {
        for (const line of fs.readFileSync(path.join(at, "maps"), "utf8").split("\n")) {
          const slash = line.indexOf("/");
          if (slash >= 0 && inside(line.slice(slash).replace(/ \(deleted\)$/, ""))) pids.add(pid);
        }
      });
    }
  } else throw new Error("neither lsof nor /proc is on this computer, so what holds the copy cannot be checked");
  /** @type {Map<number, Seen>} */
  const found = new Map();
  for (const pid of pids) {
    if (pid === process.pid) continue;
    const r = rows.get(pid);
    if (r) {
      found.set(pid, { pgid: r.pgid, start: r.start });
      continue;
    }
    // Started after the process list was read: looked up on its own; one that is alive but cannot be named is no answer.
    if (!pidAlive(pid)) continue;
    const start = processStart(pid);
    if (!start) throw new Error(`a process holding the copy (${pid}) could not be identified`);
    found.set(pid, { pgid: pid, start });
  }
  return found;
}

/** Every folder under `dir` (ours: a worker's copy) made enterable and readable by us — folders only, never a file's
 *  mode, and never through a link. Throws when one cannot be. */
function openFolders(/** @type {string} */ dir) {
  const st = fs.lstatSync(dir);
  if (!st.isDirectory()) return;
  if ((st.mode & 0o700) !== 0o700) fs.chmodSync(dir, (st.mode & 0o7777) | 0o700);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) openFolders(path.join(dir, e.name));
}

// ---------------------------------------------------------------------------
// Slots.

/** Replace a slot's record whole: written beside it and renamed over it, so a crash mid-write leaves the old record, never
 *  an empty or partial one (which would read as free). */
function writeRecord(/** @type {string} */ file, /** @type {unknown} */ value) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** node:sqlite, whose locks are the operating system's: held while the holder lives (paused or not), let go when it
 *  dies. Built in from Node 22.13; its "experimental" warning is not shown. */
let sqlite = /** @type {any} */ (null);
export function lockSupport() {
  if (sqlite) return sqlite;
  const warn = process.emitWarning;
  process.emitWarning = /** @type {any} */ ((/** @type {any} */ w, /** @type {any[]} */ ...rest) => {
    if (!/sqlite/i.test(String(w?.message ?? w))) warn.call(process, w, ...rest);
  });
  try {
    sqlite = createRequire(import.meta.url)("node:sqlite");
  } catch {
    throw new Error(`a worker of its own needs Node 22.13 or later (this is ${process.version}), for the lock its slots are shared under`);
  } finally {
    process.emitWarning = warn;
  }
  return sqlite;
}

/** Temp files of writeRecord whose writer is gone (its id is in the name): nothing will rename them, so they go. One whose
 *  writer lives — paused between writing and renaming, say — is left alone, however old. */
function clearTemps(/** @type {string} */ dir) {
  /** @type {string[]} */
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const f of names) {
    const m = /\.(\d+)\.[0-9a-f]{8}\.tmp$/.exec(f);
    if (m && !pidAlive(Number(m[1]))) fs.rmSync(path.join(dir, f), { force: true });
  }
}

const BUSY = Symbol("busy");
const STOPPED = Symbol("stopped");

/** One try at the slots' lock (an exclusive lock on a small database beside them, which the operating system holds for
 *  as long as this process lives and lets go of when it dies): fn's answer, or BUSY at once when another holds it. */
function tryMutex(/** @type {string} */ dir, /** @type {() => any} */ fn) {
  const db = new (lockSupport().DatabaseSync)(path.join(dir, "slots.lock.db"));
  try {
    db.exec("PRAGMA busy_timeout = 0");
    try {
      db.exec("BEGIN EXCLUSIVE");
    } catch (err) {
      if (/locked|busy/i.test(String(/** @type {any} */ (err)?.message))) return BUSY;
      throw err;
    }
    try {
      return fn();
    } finally {
      db.exec("COMMIT");
    }
  } finally {
    db.close();
  }
}

/** Hold the slots' lock for fn, tried again every 20 ms without ever blocking this process (a stop is heard while it
 *  waits): a paused holder keeps it, a dead one frees it, and no one has to judge which.
 *  @returns {Promise<any>} fn's answer; STOPPED when the signal stopped the wait */
async function withMutex(/** @type {string} */ dir, /** @type {() => any} */ fn, /** @type {{ signal?: AbortSignal, waitMs?: number }} */ o = {}) {
  const until = Date.now() + (o.waitMs ?? 30_000);
  for (;;) {
    if (o.signal?.aborted) return STOPPED;
    const r = tryMutex(dir, fn);
    if (r !== BUSY) return r;
    if (Date.now() > until) throw new Error("the worker slots are locked by another foldrun that does not let go");
    await pause(20, o.signal);
  }
}

/** Wait ms, or until the signal stops it; its listener is removed either way. */
function pause(/** @type {number} */ ms, /** @type {AbortSignal | undefined} */ signal) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve(undefined);
    };
    const t = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Is a slot's (or a copy's) holder still there? Held for leftovers: while
 * any of them lives. Otherwise: while its session or its worker does.
 */
export function holderAlive(/** @type {any} */ h) {
  if (!h || typeof h !== "object") return false;
  // Its worker was reaped and only its files are left (a removal that failed): nothing holds it, so it is retried.
  if (h.cleanup === true) return false;
  const list = (/** @type {unknown} */ x) => (Array.isArray(x) ? x : []);
  if (h.held === true ? list(h.left).some((p) => sameAlive(p)) : sameAlive(h) || list(h.worker).some((p) => sameAlive(p))) return true;
  // Its processes are gone — but whatever else may hold its copy (a process the reap never saw, a session that died
  // before it could record a hold) is checked now: held while anything does, or while that cannot be told.
  if (typeof h.copy === "string" && fs.existsSync(h.copy)) {
    try {
      return holdersOf(h.copy).size > 0;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Take a slot, or wait for one. Each is a file holding its holder; the
 * choice is made under the mutex, so two sessions never take the same one.
 * @param {{ signal?: AbortSignal, dir?: string, slots?: number, every?: number, onWait?: (holders: number[]) => void }} [o]
 * @returns {Promise<{ n: number, worker: (p: { pid: number, start: string | null }, copy: string) => Promise<void>, hold: (left: { pid: number, start: string }[], copy: string) => Promise<void>, release: () => Promise<void> } | null>} null: stopped while waiting
 */
export async function takeSlot(o = {}) {
  const dir = o.dir ?? slotDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const slots = o.slots ?? WORKER_SLOTS;
  const me = { pid: process.pid, start: processStart(process.pid), token: crypto.randomBytes(8).toString("hex") };
  const fileOf = (/** @type {number} */ n) => path.join(dir, `slot-${n}.json`);
  const read = (/** @type {string} */ f) => {
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      return null;
    }
  };
  let told = false;
  for (;;) {
    if (o.signal?.aborted) return null;
    /** @type {number[]} */
    const holders = [];
    // Who holds each slot is checked outside the mutex (a check may scan the copy, which takes longer than the mutex is
    // held); a free one is claimed under it only if its record is still the one found free.
    const rawOf = (/** @type {number} */ i) => {
      try {
        return fs.readFileSync(fileOf(i), "utf8");
      } catch {
        return null;
      }
    };
    /** @type {{ i: number, raw: string | null }[]} */
    const free = [];
    for (let i = 0; i < slots; i++) {
      const raw = rawOf(i);
      /** @type {any} */
      let h = null;
      try {
        h = raw === null ? null : JSON.parse(raw);
      } catch {
        /* unreadable: free */
      }
      // Given back, or held for what a stop could not end: markers beside the record, written without the lock (so a lock
      // held by someone else never strands either). Given back: free. Held: as long as the leftovers, or anything holding
      // the copy, live — the session's own life no longer counts.
      const token = h && typeof h.token === "string" ? h.token : null;
      const given = token !== null && fs.existsSync(`${fileOf(i)}.done-${token}`);
      const heldFor = token === null ? null : read(`${fileOf(i)}.held-${token}`);
      const alive = given ? false : heldFor ? holderAlive({ ...heldFor, held: true }) : holderAlive(h);
      if (alive) holders.push(/** @type {any} */ (h).pid);
      else free.push({ i, raw });
    }
    clearTemps(dir);
    const got = free.length
      ? await withMutex(
          dir,
          () => {
            if (o.signal?.aborted) return -1;
            for (const f of free) {
              if (rawOf(f.i) !== f.raw) continue;
              writeRecord(fileOf(f.i), me);
              // The record it replaced is gone; so are its markers.
              for (const m of fs.readdirSync(dir)) if (/^slot-\d+\.json\.(done|held)-[0-9a-f]+$/.test(m) && m.startsWith(`slot-${f.i}.json.`)) fs.rmSync(path.join(dir, m), { force: true });
              return f.i;
            }
            return -1;
          },
          { signal: o.signal },
        )
      : -1;
    if (got === STOPPED || o.signal?.aborted) {
      if (typeof got === "number" && got >= 0) fs.writeFileSync(`${fileOf(got)}.done-${me.token}`, "");
      return null;
    }
    const n = /** @type {number} */ (got);
    if (n >= 0) {
      /** @returns {Promise<boolean>} whether the slot was still ours to update */
      const update = async (/** @type {Record<string, unknown>} */ more) =>
        (await withMutex(dir, () => {
          const h = read(fileOf(n));
          if (h?.token !== me.token) return false;
          writeRecord(fileOf(n), { ...h, ...more });
          return true;
        })) === true;
      return {
        n,
        // The worker, written before its job is sent: a session that dies leaves the slot held while its worker lives.
        // Not ours any more (taken over meanwhile): throws, and the worker is not given its job.
        worker: async (p, copy) => {
          if (!(await update({ worker: [p], copy }))) throw new Error("its worker slot was taken over meanwhile");
        },
        // What a stop could not end: the slot stays held while any of it lives, and then while anything holds the copy.
        // Written as a marker beside the record, without the lock: nothing can keep it from being written, and from then on
        // the slot is held for these leftovers and the copy — not for this session's life.
        hold: async (left, copy) => writeRecord(`${fileOf(n)}.held-${me.token}`, { left, copy, ...(left.length ? {} : { unchecked: true }) }),
        // Given back at once by a marker that needs no lock (so a lock held by someone else never keeps it), then the
        // record itself removed when the lock can be had within a few seconds; if not, the next taker removes it.
        release: async () => {
          fs.writeFileSync(`${fileOf(n)}.done-${me.token}`, "", { mode: 0o600 });
          try {
            await withMutex(
              dir,
              () => {
                if (read(fileOf(n))?.token === me.token) fs.unlinkSync(fileOf(n));
                fs.rmSync(`${fileOf(n)}.done-${me.token}`, { force: true });
              },
              { waitMs: 3000 },
            );
          } catch {
            /* the marker stands */
          }
        },
      };
    }
    if (!told) {
      told = true;
      o.onWait?.(holders);
    }
    await pause(o.every ?? 500, o.signal);
  }
}

// ---------------------------------------------------------------------------
// The copy and the patch.

/** A .env file somewhere in the tree: never copied, never handed back. Case-blind: macOS folders usually are. */
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/i;
/** A .git component, in any case: neither copied nor handed back, nor ever written through. */
const GIT_PART = /(^|\/)\.git(\/|$)/i;

/**
 * One file of a folder, read without following a link and within a budget:
 * every folder on its way checked to be a folder (not a link) before and
 * after, the file opened so that a link in its place fails, checked to be
 * the file it was, and read no further than the budget allows.
 * @returns {{ bytes: Buffer, exec: boolean } | { skip: string } | { tooBig: true } | null} null: gone
 */
function readConfined(/** @type {string} */ root, /** @type {string} */ rel, /** @type {number} */ budget) {
  if (path.isAbsolute(rel) || rel.split("/").some((p) => p === ".." || p === "." || p === "")) return { skip: "an odd path" };
  const parts = rel.split("/");
  const folders = () => {
    let at = root;
    for (const p of parts.slice(0, -1)) {
      at = path.join(at, p);
      const st = fs.lstatSync(at);
      if (st.isSymbolicLink() || !st.isDirectory()) return false;
    }
    return true;
  };
  const full = path.join(root, rel);
  try {
    if (!folders()) return { skip: "a link on its way" };
    const before = fs.lstatSync(full);
    if (before.isSymbolicLink()) return { skip: "a link" };
    if (!before.isFile()) return { skip: "not a file" };
    if (before.size > budget) return { tooBig: true };
    const fd = fs.openSync(full, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.ino !== before.ino || st.dev !== before.dev) return { skip: "changed while it was read" };
      if (st.size > budget) return { tooBig: true };
      // Read in pieces, never past the budget: a file that grows meanwhile is stopped at it.
      /** @type {Buffer[]} */
      const pieces = [];
      let got = 0;
      const chunk = Buffer.alloc(Math.min(1 << 20, budget + 1 || 1));
      for (;;) {
        const n = fs.readSync(fd, chunk, 0, chunk.length, null);
        if (n === 0) break;
        got += n;
        if (got > budget) return { tooBig: true };
        pieces.push(Buffer.from(chunk.subarray(0, n)));
      }
      if (!folders()) return { skip: "a link on its way" };
      return { bytes: Buffer.concat(pieces), exec: (st.mode & 0o111) !== 0 };
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    if (/** @type {any} */ (err).code === "ENOENT") return null;
    if (/** @type {any} */ (err).code === "ELOOP") return { skip: "a link" };
    throw err;
  }
}

/** Write a file under the baseline or a copy, folders ours alone: never through a .git component, in any case. */
function writeOurs(/** @type {string} */ root, /** @type {string} */ rel, /** @type {Buffer} */ bytes, /** @type {boolean} */ exec) {
  if (GIT_PART.test(rel) || path.isAbsolute(rel) || rel.split("/").some((p) => p === ".." || p === "")) throw new Error(`not written: ${rel}`);
  const to = path.join(root, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, bytes, { mode: exec ? 0o755 : 0o644 });
  fs.chmodSync(to, exec ? 0o755 : 0o644);
}

/** Remove a worker's copy, its baseline and owner note, and its package cache: a folder it left read-only included.
 *  Throws (after trying all of them) when one would not go. */
export function removeCopy(/** @type {string} */ copy, /** @type {string} */ base, /** @type {string | null} */ cache) {
  /** @type {string[]} */
  const failed = [];
  // The owner note last, and only once all the rest is gone: it is how a later sweep finds what is left to retry.
  for (const at of [copy, ...(cache ? [cache] : []), base]) {
    try {
      if (fs.existsSync(at)) openFolders(at);
      fs.rmSync(at, { recursive: true, force: true });
    } catch (err) {
      failed.push(`${at}: ${/** @type {any} */ (err).code ?? err}`);
    }
  }
  if (failed.length) throw new Error(`not removed: ${failed.join("; ")}`);
  fs.rmSync(`${base}.owner`, { force: true });
}

/**
 * Copies and baselines whose session and worker are gone (a crash, a kill):
 * removed, each on its own — one that will not go blocks no other capture.
 * One with no owner note, after a day.
 * @param {(copy: string) => string} [cacheOf] where a copy's package cache is
 */
export function sweepLeftovers(/** @type {string} */ copies, /** @type {string} */ baselines, cacheOf = undefined) {
  /** @type {string[]} */
  let names = [];
  try {
    names = fs.readdirSync(baselines);
  } catch {
    return;
  }
  clearTemps(baselines);
  const ids = new Set(names.map((n) => n.replace(/\.owner$/, "")).filter((n) => /^[0-9a-f]{16}$/.test(n)));
  for (const id of ids) {
    const note = path.join(baselines, `${id}.owner`);
    let gone = false;
    try {
      gone = !holderAlive(JSON.parse(fs.readFileSync(note, "utf8")));
    } catch {
      try {
        gone = Date.now() - fs.statSync(path.join(baselines, id)).mtimeMs > 86_400_000;
      } catch {
        gone = true;
      }
    }
    if (!gone) continue;
    // Whatever its note says (a session may have died between writing its slot and its note), a copy something still
    // holds — or one that cannot be checked — is not removed.
    const copy = path.join(copies, id);
    if (fs.existsSync(copy)) {
      try {
        if (holdersOf(copy).size) continue;
      } catch {
        continue;
      }
    }
    try {
      removeCopy(path.join(copies, id), path.join(baselines, id), cacheOf ? cacheOf(path.join(copies, id)) : null);
    } catch {
      /* tried again next time; it blocks nothing */
    }
  }
}

/** Write who a copy is for, beside its baseline (where the worker cannot write). */
export function noteOwner(/** @type {string} */ base, /** @type {Record<string, unknown>} */ more = {}) {
  const note = `${base}.owner`;
  let was = {};
  try {
    was = JSON.parse(fs.readFileSync(note, "utf8"));
  } catch {
    /* new */
  }
  writeRecord(note, { pid: process.pid, start: processStart(process.pid), ...was, ...more });
}

/**
 * The folder as it is now: the worker's copy, and the baseline (a git
 * repository the worker cannot reach) with the same files committed. Paths
 * are the folder's own, so the patch made in the baseline applies to it.
 * @param {string} dir the person's folder
 * @param {{ copies?: string, baselines: string }} where `baselines`: a folder the worker's walls cannot read (foldrun's cache)
 * @returns {{ id: string, copy: string, base: string, source: string, files: number, bytes: number, left: string[] } | { problem: string }} left: what was not copied, and why
 */
export function captureFolder(dir, where) {
  const cacheOf = (/** @type {string} */ c) => packageCacheFor(c);
  const real = fs.realpathSync(dir);
  const copies = where.copies ?? copyRoot();
  fs.mkdirSync(copies, { recursive: true, mode: 0o700 });
  fs.mkdirSync(where.baselines, { recursive: true, mode: 0o700 });
  sweepLeftovers(copies, where.baselines, cacheOf);
  const realCopies = fs.realpathSync(copies);
  const within = (/** @type {string} */ a, /** @type {string} */ b) => a === b || a.startsWith(`${b}${path.sep}`);
  if (within(realCopies, real) || within(real, realCopies)) return { problem: `the folder and where workers' copies are made (${realCopies}) are one inside the other` };
  if (git(real, ["rev-parse", "--show-toplevel"]).status !== 0) return { problem: "the folder is not in a git repository, and a worker's changes come back as a patch git applies" };
  const listed = git(real, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."]);
  if (listed.status !== 0) return { problem: `git could not list the folder's files: ${String(listed.stderr).trim().slice(0, 200)}` };
  const names = [...new Set(String(listed.stdout).split("\0").filter(Boolean))];
  if (names.length > COPY_MAX_FILES) return { problem: `the folder has ${names.length} files, more than a worker's copy holds (${COPY_MAX_FILES})` };
  const id = crypto.randomBytes(8).toString("hex");
  const copy = path.join(realCopies, id);
  const base = path.join(fs.realpathSync(where.baselines), id);
  fs.mkdirSync(copy, { mode: 0o700 });
  fs.mkdirSync(base, { mode: 0o700 });
  noteOwner(base);
  /** @type {string[]} */
  const left = [];
  let bytes = 0;
  let files = 0;
  try {
    for (const rel of names) {
      if (ENV_FILE.test(rel)) {
        left.push(`${rel} (a .env file)`);
        continue;
      }
      if (GIT_PART.test(rel)) continue;
      const got = readConfined(real, rel, COPY_MAX_BYTES - bytes);
      if (!got) continue; // listed by git, gone from the folder: absent in the copy too
      if ("tooBig" in got) throw new Error(`the folder's files are more than a worker's copy holds (${COPY_MAX_BYTES / 1024 / 1024} MiB)`);
      if ("skip" in got) {
        if (got.skip !== "not a file") left.push(`${rel} (${got.skip})`);
        continue;
      }
      bytes += got.bytes.length;
      writeOurs(copy, rel, got.bytes, got.exec);
      writeOurs(base, rel, got.bytes, got.exec);
      files += 1;
    }
    for (const step of [
      ["init", "-q", "-b", "snapshot"],
      ["add", "-A", "-f", "."],
      ["-c", "user.name=foldrun", "-c", "user.email=worker@foldrun.invalid", "commit", "-q", "--allow-empty", "--no-verify", "-m", "the folder as the worker got it"],
    ]) {
      const r = git(base, step);
      if (r.status !== 0) throw new Error(`git ${step[0]} of the baseline failed: ${String(r.stderr).trim().slice(0, 200)}`);
    }
  } catch (err) {
    fs.rmSync(copy, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(`${base}.owner`, { force: true });
    return { problem: err instanceof Error ? err.message : String(err) };
  }
  return { id, copy, base, source: real, files, bytes, left };
}

/** Which of these paths (relative to the folder) the folder's repository ignores: its .gitignore files, info/exclude, the global excludes. */
function ignoredBy(/** @type {string} */ source, /** @type {string[]} */ paths) {
  if (!paths.length) return new Set();
  const r = git(source, ["check-ignore", "-z", "--stdin"], { input: paths.join("\0") });
  // 0: some are ignored, 1: none is; anything else is git failing, which must not read as "none".
  if (r.status !== 0 && r.status !== 1) throw new Error(`git could not say which files the folder ignores: ${String(r.stderr).trim().slice(0, 200)}`);
  return new Set(String(r.stdout).split("\0").filter(Boolean));
}

/**
 * What the worker changed, as one git patch against the baseline (binary
 * files included, no renames, as the folder names them). Call it only once
 * nothing of the worker is left: the copy is read, never changed. Links,
 * .env files, .git folders and odd entries are left out; a new file or
 * folder the folder's own ignore rules leave out is not even read.
 * @param {{ copy: string, base: string, source: string }} w
 * @returns {{ patch: Buffer, files: string[], left: string[] }}
 */
export function workerPatch(w) {
  /** @type {string[]} */
  const left = [];
  /** @type {Map<string, { bytes: Buffer, exec: boolean }>} */
  const found = new Map();
  let bytes = 0;
  const tracked = new Set(String(git(w.base, ["ls-files", "-z"]).stdout).split("\0").filter(Boolean));
  /** Folders that hold a tracked file: walked whatever the ignore rules say. */
  const trackedDirs = new Set();
  for (const t of tracked) for (let d = path.posix.dirname(t); d !== "."; d = path.posix.dirname(d)) trackedDirs.add(d);
  // Level by level: what is new at a level is asked about once, and an ignored folder is never entered.
  /** @type {string[]} */
  let level = [""];
  while (level.length) {
    /** @type {{ rel: string, dir: boolean }[]} */
    const here = [];
    for (const parent of level) {
      for (const e of fs.readdirSync(path.join(w.copy, parent), { withFileTypes: true })) {
        const r = parent ? `${parent}/${e.name}` : e.name;
        if (e.name.toLowerCase() === ".git") continue;
        if (e.isSymbolicLink()) left.push(`${r} (a link)`);
        else if (e.isDirectory()) here.push({ rel: r, dir: true });
        else if (!e.isFile()) left.push(`${r} (not a file)`);
        else if (ENV_FILE.test(r)) left.push(`${r} (a .env file)`);
        else here.push({ rel: r, dir: false });
      }
    }
    const ask = here.filter((x) => (x.dir ? !trackedDirs.has(x.rel) : !tracked.has(x.rel))).map((x) => (x.dir ? `${x.rel}/` : x.rel));
    const ignored = ignoredBy(w.source, ask);
    /** @type {string[]} */
    const next = [];
    for (const x of here) {
      if (ignored.has(x.dir ? `${x.rel}/` : x.rel) || (x.dir && ignored.has(x.rel))) continue;
      if (x.dir) {
        next.push(x.rel);
        continue;
      }
      const got = readConfined(w.copy, x.rel, COPY_MAX_BYTES - bytes);
      if (!got) continue;
      if ("tooBig" in got || found.size >= COPY_MAX_FILES) throw new Error("the worker's copy grew past what can come back");
      if ("skip" in got) {
        left.push(`${x.rel} (${got.skip})`);
        continue;
      }
      bytes += got.bytes.length;
      found.set(x.rel, got);
    }
    level = next;
  }
  // A tracked file it removed is removed — unless what is there now was left out (a link in its place, or in its folder's, keeps it).
  const keptOut = left.map((l) => l.replace(/ \([^)]*\)$/, ""));
  const underKept = (/** @type {string} */ r) => keptOut.some((k) => r === k || r.startsWith(`${k}/`));
  /** @type {string[]} */
  const paths = [];
  // Removals first: a file that became a folder (a → a/b) has its file gone before the folder is made.
  for (const r of tracked) {
    if (found.has(r) || underKept(r)) continue;
    fs.rmSync(path.join(w.base, r), { force: true });
    paths.push(r);
  }
  for (const [r, got] of found) {
    const at = path.join(w.base, r);
    let same = false;
    try {
      same = tracked.has(r) && fs.readFileSync(at).equals(got.bytes) && ((fs.statSync(at).mode & 0o111) !== 0) === got.exec;
    } catch {
      /* new */
    }
    if (same) continue;
    // The baseline is ours alone: a file in the way of a folder, or a folder in the way of a file (a/b → a), is cleared first.
    for (let p = path.posix.dirname(r); p !== "."; p = path.posix.dirname(p)) {
      const st = fs.lstatSync(path.join(w.base, p), { throwIfNoEntry: false });
      if (st && !st.isDirectory()) fs.rmSync(path.join(w.base, p), { force: true });
    }
    const st = fs.lstatSync(at, { throwIfNoEntry: false });
    if (st?.isDirectory()) fs.rmSync(at, { recursive: true, force: true });
    writeOurs(w.base, r, got.bytes, got.exec);
    paths.push(r);
  }
  if (paths.length) {
    const add = git(w.base, ["add", "-A", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"], { input: paths.join("\0") });
    if (add.status !== 0) throw new Error(`git could not take what the worker changed: ${String(add.stderr).trim().slice(0, 200)}`);
  }
  const diff = git(w.base, ["diff", "--cached", "--binary", "--no-renames", "--no-color", "--no-ext-diff", "HEAD"], { encoding: "buffer" });
  if (diff.status !== 0) throw new Error(`git could not make the worker's patch: ${String(diff.stderr).trim().slice(0, 200)}`);
  const files = String(git(w.base, ["diff", "--cached", "--name-only", "-z", "--no-renames", "HEAD"]).stdout).split("\0").filter(Boolean);
  // Checked again on the patch's own names: nothing that must never come back.
  const bad = files.filter((f) => ENV_FILE.test(f) || GIT_PART.test(f));
  if (bad.length) throw new Error(`the worker's patch names what never comes back: ${bad.join(", ")}`);
  return { patch: /** @type {Buffer} */ (/** @type {unknown} */ (diff.stdout)), files, left };
}

// ---------------------------------------------------------------------------
// The worker.

/** The variables the worker process starts with: plain ones, never a key or a loader setting. */
const WORKER_ENV = /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|LANG|LANGUAGE|LC_[A-Z]+|TERM|TZ|XDG_[A-Z_]+|FOLDRUN_HOME|FOLDRUN_DATA)$/;
export function workerEnv(/** @type {Record<string, string | undefined>} */ env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string" && WORKER_ENV.test(k)) out[k] = v;
  return out;
}

/**
 * Run one worker: a process of its own, given the job on its input once
 * `onSpawn` has recorded it; every message its conversation makes comes back
 * to `onMessage`. Its tree is sampled from the start; when it ends or the
 * signal stops it, every process seen, and then any still holding the copy,
 * is ended and waited for.
 * @param {{ job: Record<string, unknown>, env: Record<string, string>, copy: string, signal: AbortSignal, onSpawn?: (p: { pid: number, start: string | null }) => void | Promise<void>, onMessage: (m: any) => void }} o
 * @returns {Promise<{ result: any, left: { pid: number, start: string }[], unchecked: boolean, stderr: string, error?: string }>} left: what would not die; unchecked: whether they are gone could not be told
 */
export function runWorker(o) {
  return new Promise((resolve) => {
    /** @type {Map<number, Seen>} */
    const seen = new Map();
    /** Every group any of its processes was ever seen in: one moved out of is still searched for what it left. */
    /** @type {Set<number>} */
    const groups = new Set();
    /** @type {any} */
    let result = null;
    let stderr = "";
    let buf = "";
    /** @type {Promise<{ left: { pid: number, start: string }[], unchecked: boolean }> | null} */
    let reaping = null;
    let settled = false;
    /** Why the job was not sent, when it was not. */
    let refused = "";
    /** @type {import("node:child_process").ChildProcess} */
    let child;
    try {
      child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker"], { stdio: ["pipe", "pipe", "pipe"], detached: true, env: o.env });
    } catch (err) {
      resolve({ result: null, left: [], unchecked: false, stderr: "", error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const root = child.pid ?? 0;
    // Its identity, fixed at spawn: every later walk from it first checks the id still names this process.
    let rootStart = "";
    try {
      rootStart = (root && processTable().get(root)?.start) || "";
    } catch {
      /* checked below */
    }
    const look = () => {
      try {
        if (root && rootStart) {
          for (const [pid, s] of treeOf(root, undefined, rootStart)) {
            seen.set(pid, s);
            groups.add(s.pgid);
          }
        }
      } catch {
        /* the next look, or the reap, tries again */
      }
    };
    // Seeded at once: the worker is its own group, known before it can start anything.
    look();
    const sample = setInterval(look, 250);
    const reap = () =>
      (reaping ??= (async () => {
        if (!root) return { left: [], unchecked: false };
        if (!rootStart) throw new Error("the worker's start could not be read");
        const left = await reapTree(root, seen, { rootStart, groups });
        if (left.length) return { left, unchecked: false };
        // Anything still holding the copy (a process that left its group and parent between looks, with the copy open or
        // as its folder) is not signalled — it cannot be told from a person's editor — but no patch is taken while it holds it.
        return { left: [...holdersOf(o.copy)].map(([pid, s]) => ({ pid, start: s.start })), unchecked: false };
      })()
        // A reap that cannot see the processes, or what holds the copy, has not shown they are gone: everything known of the
        // worker that may still live is kept, and the copy is checked again before its slot or the copy itself is reused.
        .catch(() => ({ left: [...seen].filter(([pid]) => pidAlive(pid)).map(([pid, s]) => ({ pid, start: s.start })), unchecked: true }))
        // However it ended — the worker exited, or a stop reaped it while it would not die — the run is settled soon after:
        // close may never come while something holds its output open.
        .then((r) => {
          setTimeout(() => void finish(undefined), 2000);
          return r;
        }));
    const onStop = () => {
      void reap();
    };
    const finish = async (/** @type {string | undefined} */ error) => {
      if (settled) return;
      settled = true;
      clearInterval(sample);
      o.signal.removeEventListener("abort", onStop);
      const { left, unchecked } = await reap();
      const why = error ?? refused;
      resolve({ result: refused ? null : result, left, unchecked, stderr, ...(why ? { error: why } : {}) });
    };
    o.signal.addEventListener("abort", onStop, { once: true });
    child.on("error", (err) => void finish(err.message));
    child.stdin?.on("error", () => undefined);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (d) => {
      buf += d;
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m?.t === "result") result = m;
        else if (m?.t === "m") o.onMessage(m.m);
      }
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (d) => {
      stderr = (stderr + d).slice(-4000);
    });
    // The reap starts when the worker itself exits: a process it left may hold its output open, and close waits for that.
    child.on("exit", () => void reap());
    child.on("close", () => void finish(undefined));
    // Recorded before the job goes: from here a session that dies leaves the slot and the copy held while the worker lives.
    // If it cannot be recorded, the job is not sent (the worker, given no input, does nothing and is reaped).
    void (async () => {
      try {
        if (!root || !rootStart) throw new Error("the worker's process could not be identified");
        await o.onSpawn?.({ pid: root, start: rootStart });
      } catch (err) {
        refused = `the worker could not be recorded, so it was not given the job: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (refused) {
        child.stdin?.end();
        void finish(undefined);
      } else if (o.signal.aborted) {
        child.stdin?.end();
        onStop();
      } else child.stdin?.end(JSON.stringify(o.job));
    })();
  });
}

// ---------------------------------------------------------------------------
// The worker process.

async function workerMain() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  if (!input.trim()) return;
  const job = JSON.parse(input);
  const send = (/** @type {any} */ m) => process.stdout.write(`${JSON.stringify(m)}\n`);
  const copy = fs.realpathSync(job.copy);
  process.chdir(copy);
  const inside = (/** @type {string} */ f) => {
    const abs = path.resolve(copy, String(f ?? ""));
    return abs === copy || abs.startsWith(`${copy}${path.sep}`);
  };
  const { sandboxFor, sandboxEnv } = await import("./code-sandbox.mjs");
  // No asker: there is no one here to ask, so a site off the list is refused. The person's folder and foldrun's own folders cannot be read.
  const box = sandboxFor({ dir: copy, sites: () => (Array.isArray(job.sites) ? job.sites : []), denyRead: () => (Array.isArray(job.denyRead) ? job.denyRead : []) });
  const walls = await box.open();
  if (!walls) {
    send({ t: "result", ok: false, error: `no sandbox: ${box.refusal()?.refused ?? "it did not start"}` });
    return;
  }
  const abort = new AbortController();
  process.on("SIGTERM", () => abort.abort());
  try {
    const engine = await import("@foldrun/core/engine-loop");
    const q = engine.foldrunQuery({
      prompt: job.prompt,
      options: {
        cwd: copy,
        env: job.env,
        shellEnv: sandboxEnv(job.shellEnv ?? {}).env,
        userAgent: job.userAgent,
        model: job.model,
        ...(job.effort ? { effort: job.effort } : {}),
        systemPrompt: job.systemPrompt,
        tools: job.tools,
        localSandbox: walls,
        readable: (/** @type {string} */ f) => inside(f),
        maxTurns: job.maxTurns,
        // Its own tools, on its own copy: nothing it does reaches the person's folder, so nothing is asked.
        canUseTool: async (/** @type {string} */ name, /** @type {Record<string, any>} */ inp) => {
          if (!job.tools.includes(name)) return { behavior: "deny", message: `${name} is not one of your tools (${job.tools.join(", ")}).` };
          const targets = [inp?.file_path, inp?.path, inp?.notebook_path, ...(Array.isArray(inp?.edits) ? inp.edits.map((/** @type {any} */ e) => e?.file_path) : [])].filter((t) => typeof t === "string");
          if (targets.some((t) => !inside(t))) return { behavior: "deny", message: "That is outside your copy of the folder. Work inside it." };
          return { behavior: "allow", updatedInput: inp };
        },
        abortController: abort,
      },
    });
    for await (const m of /** @type {AsyncIterable<any>} */ (q)) {
      send({ t: "m", m });
      if (m.type === "result") send({ t: "result", ok: m.subtype === "success" && !m.is_error });
    }
  } catch (err) {
    send({ t: "result", ok: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    await box.close();
  }
}

if (process.argv[2] === "--worker" && process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  workerMain().then(
    () => process.exit(0),
    (err) => {
      process.stdout.write(`${JSON.stringify({ t: "result", ok: false, error: err instanceof Error ? err.message : String(err) })}\n`);
      process.exit(1);
    },
  );
}
