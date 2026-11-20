// The CLI keeps itself current (owner, 20 Nov 2026: "auto-update").
//
// Install beside, switch at start — never replace a live install:
//   - Once a day a detached child asks npm for foldrun@latest. A newer minor
//     or patch is installed into a folder of its own (`npm install
//     --prefix`, --ignore-scripts), smoke-tested (its own `--version` must
//     exit 0 and say <v>), and only then made active.
//   - Each start of the installed foldrun hands over to its active version
//     when that is newer (bin/foldrun.mjs, in the same process). Nothing a
//     running command has loaded is replaced, and a download cut off leaves
//     only a temporary folder.
//   - The next start says so in one line. A new MAJOR may break what worked:
//     it is only announced; `foldrun update` takes it.
//   - The version before stays, and a replaced version is kept a week (a
//     session still open on it after that may fail to load a file).
//     FOLDRUN_NO_AUTO_UPDATE=1 turns all of it off, hand-over included —
//     the way back if a release misbehaves.
// Every installation keeps its own record, versions and notices under
// ~/.foldrun/updates/<id> (two Node versions with a global foldrun each
// never roll each other back). Only for the copy `npm i -g` installed:
// never a git checkout, an npx cache or a version a project pins. The
// background check never runs in CI or without a terminal.
//
// npm is the one that ships with this Node or the first on an absolute PATH
// entry (never a project's own: it runs from the home folder, so no
// project .npmrc either), without FOLDRUN_* variables in its environment
// (Codex review, 20 Nov 2026).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const LOCK_STALE_MS = 30 * 60 * 1000;
/** A week after a version stops being the active one, it may be deleted. */
const RETIRED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const OWN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Set by the global copy for the staged one it hands over to. */
export const HANDED_OVER = "FOLDRUN_HANDED_OVER_FROM";

/** ~/.foldrun, or FOLDRUN_HOME — the same place the credentials live; always absolute. */
export function homeDir(env = process.env) {
  return path.resolve(env.FOLDRUN_HOME || path.join(os.homedir(), ".foldrun"));
}

/** A copy's identity: its real folder (a symlinked global bin resolves to it). */
const copyId = (/** @type {string} */ root) => {
  try {
    return fs.realpathSync(root);
  } catch {
    return path.resolve(root);
  }
};

const updatesRoot = (env = process.env) => path.join(homeDir(env), "updates");

// A staged copy runs on behalf of the global copy that handed over: it
// checks, stages and announces as that copy, so it updates itself later.
// Read once and taken out of the environment, so a command an agent runs (a
// project's own pinned foldrun, say) never inherits it.
const handedFrom = process.env[HANDED_OVER];
delete process.env[HANDED_OVER];
const PKG_ROOT =
  handedFrom && path.isAbsolute(handedFrom) && copyId(OWN_ROOT).startsWith(copyId(updatesRoot()) + path.sep) ? handedFrom : OWN_ROOT;

/** The copy this one checks, stages and announces as (tests). */
export const actingFor = () => PKG_ROOT;

/** This installation's own folder: record, versions, notices, lock. */
export function installDir(env = process.env, pkgRoot = PKG_ROOT) {
  return path.join(updatesRoot(env), crypto.createHash("sha256").update(copyId(pkgRoot)).digest("hex").slice(0, 16));
}
export const versionsDir = (env = process.env, pkgRoot = PKG_ROOT) => path.join(installDir(env, pkgRoot), "versions");
export const stateFile = (env = process.env, pkgRoot = PKG_ROOT) => path.join(installDir(env, pkgRoot), "state.json");
const activeFile = (env = process.env, pkgRoot = PKG_ROOT) => path.join(versionsDir(env, pkgRoot), "active.json");

/** @returns {Record<string, any>} */
function readJson(/** @type {string} */ file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
}
export const readState = (env = process.env, pkgRoot = PKG_ROOT) => readJson(stateFile(env, pkgRoot));

/** Written whole or not at all; throws when it could not be. */
function writeJsonOrThrow(/** @type {string} */ file, /** @type {Record<string, any>} */ s) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(s) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
function writeJson(/** @type {string} */ file, /** @type {Record<string, any>} */ s) {
  try {
    writeJsonOrThrow(file, s);
  } catch {}
}
const writeState = (/** @type {Record<string, any>} */ s, env = process.env, pkgRoot = PKG_ROOT) => writeJson(stateFile(env, pkgRoot), s);

const parse = (/** @type {unknown} */ v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(String(v ?? "").trim());
  return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: Boolean(m[4]) } : null;
};

/**
 * What to do about `latest` when `current` runs: "install" (a newer minor or
 * patch), "notice" (a newer major), or null. A pre-release is never taken
 * by a stable install, and nothing unparseable is ever newer.
 * @param {unknown} latest @param {unknown} current
 */
export function updateKind(latest, current) {
  if (!VERSION.test(String(latest ?? "").trim())) return null;
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b || (a.pre && !b.pre)) return null;
  // Same numbers: a release is newer than its own pre-release.
  let newer = b.pre && !a.pre && a.n.every((x, i) => x === b.n[i]);
  for (let i = 0; i < 3; i++)
    if (a.n[i] !== b.n[i]) {
      newer = a.n[i] > b.n[i];
      break;
    }
  if (!newer) return null;
  return a.n[0] > b.n[0] ? "notice" : "install";
}

/** Whether a copy sits where npm puts packages (not a git checkout). */
export const npmShaped = (/** @type {string} */ root) => root.split(path.sep).includes("node_modules");

const off = (/** @type {NodeJS.ProcessEnv} */ env) => env.FOLDRUN_NO_AUTO_UPDATE === "1" || env.FOLDRUN_NO_AUTO_UPDATE === "true";

/** Why no background check runs now, or null when one may. */
export function skipReason({ env = process.env, tty = Boolean(process.stdout.isTTY && process.stderr.isTTY), now = Date.now(), pkgRoot = PKG_ROOT, state = readState(env, pkgRoot) } = {}) {
  if (off(env)) return "turned off";
  if (env.CI && env.CI !== "0" && env.CI !== "false") return "CI";
  if (!tty) return "no terminal";
  if (!npmShaped(pkgRoot)) return "not an npm install";
  const at = Date.parse(state.checkedAt ?? "");
  if (Number.isFinite(at) && now - at < CHECK_EVERY_MS && now >= at) return "checked today";
  return null;
}

/**
 * The staged version this copy hands over to: its bin, when this
 * installation staged it, it is newer than `own` and still on disk. Null
 * for a git checkout, with FOLDRUN_NO_AUTO_UPDATE, or when there is none.
 * @param {string} own
 */
export function activeBin(own, env = process.env, pkgRoot = PKG_ROOT) {
  if (off(env) || !npmShaped(pkgRoot)) return null;
  const a = readJson(activeFile(env, pkgRoot));
  if (a.for !== copyId(pkgRoot)) return null;
  if (!VERSION.test(String(a.version ?? "")) || !updateKind(a.version, own)) return null;
  const bin = path.join(versionsDir(env, pkgRoot), String(a.version), "node_modules", "foldrun", "bin", "foldrun.mjs");
  return fs.existsSync(bin) ? bin : null;
}

/**
 * What the last update did, said once at the next start: the line to print,
 * or null. Claimed with an exclusive file, so two terminals starting at
 * once do not both say it.
 * @param {string} current
 */
export function announcement(current, env = process.env, pkgRoot = PKG_ROOT) {
  const s = readState(env, pkgRoot);
  /** @type {string | null} */
  let line = null;
  if (s.state === "updated" && s.to === current) line = `foldrun updated ${s.from} → ${s.to}`;
  else if (s.state === "failed" && s.to && updateKind(s.to, current)) line = `foldrun ${s.to} is out, but updating to it failed (${String(s.error ?? "").slice(0, 120)}) — foldrun update tries again`;
  else if (s.state === "major" && s.to && updateKind(s.to, current) === "notice") line = `foldrun ${s.to} is out — a major version, which may change what worked: foldrun update takes it`;
  if (!line) return null;
  try {
    const dir = installDir(env, pkgRoot);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, `said-${String(s.state)}-${String(s.to).replace(/[^0-9A-Za-z.-]/g, "")}`), "", { flag: "wx", mode: 0o600 });
  } catch {
    return null;
  }
  return line.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

/**
 * npm's own npm-cli.js, run with this Node: beside the binary (Unix
 * `<prefix>/lib/node_modules/npm`, Windows `<dir>/node_modules/npm`), else
 * the npm on the first absolute PATH entry that has one (Homebrew keeps it
 * apart from the Cellar's node). Never the current folder. FOLDRUN_NPM
 * names another npm program (tests, odd setups). Null: none found.
 * @returns {{ file: string, pre: string[] } | null}
 */
export function npmCommand(env = process.env) {
  if (env.FOLDRUN_NPM) return { file: env.FOLDRUN_NPM, pre: [] };
  const cli = (/** @type {string} */ p) => (fs.existsSync(p) ? { file: process.execPath, pre: [p] } : null);
  const dir = path.dirname(process.execPath);
  const beside = cli(path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")) ?? cli(path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"));
  if (beside) return beside;
  for (const d of String(process.env.PATH ?? "").split(path.delimiter)) {
    if (!d || !path.isAbsolute(d)) continue;
    if (process.platform === "win32") {
      const w = cli(path.join(d, "node_modules", "npm", "bin", "npm-cli.js"));
      if (w) return w;
      continue;
    }
    try {
      const real = fs.realpathSync(path.join(d, "npm"));
      if (real.endsWith(`${path.sep}npm-cli.js`)) return { file: process.execPath, pre: [real] };
    } catch {}
  }
  return null;
}

/** npm, from the home folder, with a hard time limit; its output. */
function npm(/** @type {string[]} */ args, /** @type {number} */ timeoutMs, env = process.env) {
  const cmd = npmCommand(env);
  if (!cmd) return { ok: false, out: "", err: "no npm found beside node or on PATH" };
  /** @type {NodeJS.ProcessEnv} */
  const clean = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^FOLDRUN_/i.test(k)) clean[k] = v;
  const r = spawnSync(cmd.file, [...cmd.pre, ...args], {
    encoding: "utf8",
    cwd: os.homedir(),
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...clean, npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false", npm_config_dry_run: "false" },
  });
  if (r.status !== 0 || r.error) return { ok: false, out: String(r.stdout ?? ""), err: (String(r.stderr || r.error?.message || `exit ${r.status}`).trim().split("\n").pop() ?? "").slice(0, 300) };
  return { ok: true, out: String(r.stdout ?? "").trim(), err: "" };
}

/** Whether this copy is the one `npm i -g` put there (not an npx cache, not
 *  a version a project pins in its own node_modules). */
export function isGlobalInstall(pkgRoot = PKG_ROOT, env = process.env) {
  if (!npmShaped(pkgRoot)) return false;
  const root = npm(["root", "-g"], 20_000, env);
  if (!root.ok || !root.out) return false;
  return copyId(path.join((root.out.split("\n").pop() ?? "").trim(), "foldrun")) === copyId(pkgRoot);
}

/** This installation's update lock: a release function, or null when held. */
function takeLock(env = process.env, pkgRoot = PKG_ROOT) {
  const dir = installDir(env, pkgRoot);
  const file = path.join(dir, "lock");
  const mine = `${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      // Only a very old lock is taken back. Two installs at once would cost
      // a second download, never a broken CLI: each stages in its own folder.
      if (Date.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS) fs.rmSync(file, { force: true });
    } catch {}
    fs.writeFileSync(file, mine, { flag: "wx", mode: 0o600 });
    return () => {
      try {
        if (fs.readFileSync(file, "utf8").trim() === mine) fs.rmSync(file, { force: true });
      } catch {}
    };
  } catch {
    return null;
  }
}

/** What every ordinary command needs from a release, as bin/foldrun.mjs
 *  calls it: these load and are functions, or the release is not made
 *  active (Codex). */
const LOAD_PROBE = `const c = await import("./src/commands.mjs");
const l = await import("@foldrun/core/layout");
for (const [m, k] of [[c, "run"], [c, "explain"], [l, "detectLayout"], [l, "installationDataRoot"]])
  if (typeof m[k] !== "function") throw new Error("missing " + k);
console.log("loaded");
`;

/**
 * Install `version` into this installation's versions/<version> and make it
 * active, after its own `--version` exits 0 naming it. A version folder,
 * once there, is never replaced. Keeps the active version, the one before
 * and any retired less than a week ago. Returns null, or why it failed.
 * @param {string} version
 */
export function stage(version, env = process.env, pkgRoot = PKG_ROOT) {
  if (!VERSION.test(version)) return "not a version";
  const root = versionsDir(env, pkgRoot);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const final = path.join(root, version);
  const binOf = (/** @type {string} */ d) => path.join(d, "node_modules", "foldrun", "bin", "foldrun.mjs");
  const run = (/** @type {string[]} */ args) =>
    spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL", cwd: os.homedir(), env: { ...process.env, FOLDRUN_NO_AUTO_UPDATE: "1", FOLDRUN_HOME: homeDir(env) } });
  // It names itself, and the code every ordinary command loads — its
  // commands and the core it was built with — loads, offline (Codex).
  const says = (/** @type {string} */ d) => {
    const v = run([binOf(d), "--version"]);
    if (v.status !== 0 || v.error || String(v.stdout ?? "").trim() !== `foldrun ${version}`) return false;
    const probe = path.join(d, "node_modules", "foldrun", `.load-probe-${crypto.randomBytes(4).toString("hex")}.mjs`);
    try {
      fs.writeFileSync(probe, LOAD_PROBE, { mode: 0o600 });
      const l = run([probe]);
      return l.status === 0 && !l.error && String(l.stdout ?? "").trim() === "loaded";
    } catch {
      return false;
    } finally {
      fs.rmSync(probe, { force: true });
    }
  };
  if (fs.existsSync(final)) {
    if (!says(final)) return `${version} is on disk but does not answer as foldrun ${version}`;
  } else {
    const tmp = path.join(root, `.staging-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
    try {
      fs.mkdirSync(tmp, { mode: 0o700 });
      const got = npm(["install", "--prefix", tmp, "--ignore-scripts", "--no-save", "--no-package-lock", `foldrun@${version}`], 5 * 60_000, env);
      if (!got.ok) return got.err || "npm install failed";
      if (!says(tmp)) return `the installed copy does not answer as foldrun ${version}`;
      fs.renameSync(tmp, final);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  const was = readJson(activeFile(env, pkgRoot));
  const before = VERSION.test(String(was.version ?? "")) && was.version !== version ? String(was.version) : null;
  /** @type {Record<string, string>} when each version stopped being the active one */
  const retired = { ...(was.retired && typeof was.retired === "object" ? was.retired : {}) };
  if (before) retired[before] = new Date().toISOString();
  delete retired[version];
  const record = { version, for: copyId(pkgRoot), before, at: new Date().toISOString(), retired };
  try {
    writeJsonOrThrow(activeFile(env, pkgRoot), record);
  } catch (e) {
    return `could not make it active: ${/** @type {Error} */ (e).message}`.slice(0, 300);
  }
  try {
    const now = Date.now();
    for (const d of fs.readdirSync(root)) {
      const full = path.join(root, d);
      if (VERSION.test(d) && d !== version && d !== before) {
        const gone = Date.parse(retired[d] ?? "");
        if (now - (Number.isFinite(gone) ? gone : fs.statSync(full).mtimeMs) > RETIRED_KEEP_MS) {
          fs.rmSync(full, { recursive: true, force: true });
          delete retired[d];
        }
      } else if (d.startsWith(".staging-") && now - fs.statSync(full).mtimeMs > LOCK_STALE_MS) fs.rmSync(full, { recursive: true, force: true });
    }
    writeJson(activeFile(env, pkgRoot), { ...record, retired });
  } catch {}
  return null;
}

/**
 * Ask npm for the latest foldrun and act on it. A newer minor or patch is
 * staged and made active (`major: true`, a person typing `foldrun update`,
 * takes a new major too); a new major is otherwise noted for the next
 * start. `install: false` only asks and changes nothing.
 * Only the global copy may stage (the caller checks: isGlobalInstall).
 * @param {{ current: string, install?: boolean, major?: boolean, env?: NodeJS.ProcessEnv, pkgRoot?: string }} o
 */
export function checkAndUpdate({ current, install = true, major = false, env = process.env, pkgRoot = PKG_ROOT }) {
  const release = takeLock(env, pkgRoot);
  if (!release) return { did: "busy" };
  try {
    const now = new Date().toISOString();
    const prev = readState(env, pkgRoot);
    const save = (/** @type {Record<string, any>} */ s) => writeState(s, env, pkgRoot);
    const view = npm(["view", "foldrun@latest", "version"], 30_000, env);
    if (!view.ok) {
      if (install) save({ ...prev, checkedAt: now });
      return { did: "unreachable", error: view.err };
    }
    const latest = (view.out.split("\n").pop() ?? "").trim();
    // Measured against what runs here: the newer of the caller and the
    // active version, read under the lock — an npm answer that moved back,
    // or a caller on an older copy, never rolls the active one back (Codex).
    const active = readJson(activeFile(env, pkgRoot));
    const base = active.for === copyId(pkgRoot) && VERSION.test(String(active.version ?? "")) && updateKind(active.version, current) ? String(active.version) : current;
    const kind = updateKind(latest, base);
    if (!install) return kind ? { did: "available", latest, major: kind === "notice" } : { did: "current", latest, running: base };
    if (!kind) {
      save({ ...prev, checkedAt: now, latest });
      return { did: "current", latest, running: base };
    }
    if (kind === "notice" && !major) {
      save({ checkedAt: now, latest, state: "major", from: base, to: latest });
      return { did: "major", latest };
    }
    const failed = stage(latest, env, pkgRoot);
    if (failed) {
      save({ checkedAt: now, latest, state: "failed", from: base, to: latest, error: failed });
      return { did: "failed", latest, error: failed };
    }
    save({ checkedAt: now, latest, state: "updated", from: base, to: latest, at: now });
    return { did: "updated", latest };
  } finally {
    release();
  }
}

/**
 * At the start of a command: say what the last update did, then — at most
 * once a day — start the check in a detached child. Never throws.
 * @param {string} current
 */
export function autoUpdate(current, { env = process.env, write = (/** @type {string} */ s) => void process.stderr.write(s) } = {}) {
  try {
    if (!npmShaped(PKG_ROOT)) return;
    if (process.stderr.isTTY || env.FOLDRUN_FORCE_TTY === "1") {
      const line = announcement(current, env);
      if (line) write(`  ${line}\n`);
    }
    if (skipReason({ env })) return;
    // Mark the check now, so two commands started together start one child.
    writeState({ ...readState(env), checkedAt: new Date().toISOString() }, env);
    // The child gets the home resolved here and, for a staged copy, the
    // installation it acts for.
    /** @type {NodeJS.ProcessEnv} */
    const childEnv = { ...env, FOLDRUN_HOME: homeDir(env) };
    if (PKG_ROOT !== OWN_ROOT) childEnv[HANDED_OVER] = PKG_ROOT;
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--background-check", current], { detached: true, stdio: "ignore", env: childEnv, cwd: os.homedir(), windowsHide: true });
    child.unref();
  } catch {}
}

// The detached child: the global copy only (an npx run or a project's own
// pinned copy asks nothing and stages nothing).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && process.argv[2] === "--background-check") {
  try {
    if (isGlobalInstall()) checkAndUpdate({ current: String(process.argv[3] ?? "") });
  } catch {}
}
