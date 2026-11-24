// Where `foldrun login` puts what it was given.
//
// `~/.foldrun/credentials.json`, 0600. A PROFILE is one signed-in account on
// one platform: a name, the URL, the key, and who that key turned out to be.
// `current` names the one a bare command talks to. The shape every CLI that
// signs in keeps, so the person who has used Vercel's or Fly's finds nothing
// to learn. FOLDRUN_HOME moves the directory, for tests and for machines
// where HOME is not where things should be kept.
//
// It was one credential per URL, which is the same thing until somebody
// looks after more than one customer on the same platform — an agency, a
// reseller, us. Then a second account on the same host had nowhere to live
// and every command needed --token pasted in. Profiles are keyed by name,
// so two accounts on one platform are two profiles.
//
// The old shape is still read, and still written for the newest profile on
// each URL, so a machine that moves between CLI versions keeps working.
//
// The value stored is an ordinary API key, minted at approval and listed on
// Settings → API keys with the machine's name. Nothing here is a second
// kind of credential; `--token` and FOLDRUN_TOKEN still win over it, so a
// CI job with a key in the environment never reads a file.

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { foldrunDirs } from "./dirs.mjs";

/**
 * Where the sign-in, the keys and everything foldrun keeps for itself live:
 * `~/.foldrun`, FOLDRUN_HOME, or the XDG state folder (dirs.mjs, FOL-254).
 */
export const credentialsDir = () => foldrunDirs().state;
/** What the person writes — mcp.json, agents/, code-prefs.json: the same folder, or the XDG config folder. */
export const configDir = () => foldrunDirs().config;
/** What can be fetched again — the gallery, the version check: the same folder, or the XDG cache folder. */
export const cacheDir = () => foldrunDirs().cache;
const file = () => path.join(credentialsDir(), "credentials.json");

/** A platform URL as the map keys it: scheme and host, no trailing slash. */
export const normaliseUrl = (url) => {
  const u = new URL(url);
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
};

function readRaw() {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), "utf8"));
    return {
      current: parsed.current ?? null,
      default: parsed.default ?? null,
      platforms: parsed.platforms ?? {},
      profiles: parsed.profiles ?? {},
    };
  } catch {
    return { current: null, default: null, platforms: {}, profiles: {} };
  }
}

/**
 * Every profile, with the old per-URL entries folded in under the account
 * name they carry. Reading migrates; nothing is written until a command
 * that changes something writes.
 */
export function readCredentials() {
  const raw = readRaw();
  const profiles = { ...raw.profiles };
  for (const [url, entry] of Object.entries(raw.platforms)) {
    if (Object.values(profiles).some((p) => normaliseUrl(p.url) === url && p.token === entry.token)) continue;
    profiles[nameFor(profiles, entry.account, url)] = { ...entry, url };
  }
  const names = Object.keys(profiles);
  let current = raw.current && profiles[raw.current] ? raw.current : null;
  if (!current && raw.default) {
    current = names.find((n) => normaliseUrl(profiles[n].url) === normaliseUrl(raw.default)) ?? null;
  }
  return { current: current ?? names[0] ?? null, profiles };
}

/** A name nobody is using: the account, else the account and the host —
 *  two customers called "acme" on two platforms are two profiles. */
function nameFor(profiles, account, url) {
  const base = (account ?? "account").trim() || "account";
  if (!profiles[base]) return base;
  const host = new URL(url).host;
  const withHost = `${base}@${host}`;
  if (!profiles[withHost]) return withHost;
  for (let i = 2; ; i++) if (!profiles[`${withHost}-${i}`]) return `${withHost}-${i}`;
}

/** One process at a time changes the file: each change reads it and writes
 *  it whole, so two at once (a renewal beside `workspaces use`, two logins)
 *  could each undo the other (Codex review, 19 Nov 2026). The lock is a file
 *  linked into place beside it already holding its owner's pid and a token.
 *  It is stale only when that process is gone (an empty one, left by an
 *  older CLI, after LOCK_EMPTY_STALE_MS); see takeOver for how a
 *  stale one changes hands. Released only by the owner whose token it holds. Synchronous, like the
 *  rest of this module. */
const LOCK_EMPTY_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const readLock = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
function ownerGone(content, lockPath) {
  const pid = Number(/^(\d+):/.exec(content ?? "")?.[1]);
  if (!pid) {
    try {
      return Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_EMPTY_STALE_MS;
    } catch {
      return false;
    }
  }
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return err?.code === "ESRCH";
  }
}
/**
 * `fn` with the lock of another file kept under ~/.foldrun (the folder
 * permission rules): the same protocol as the credentials file's.
 * @template T @param {string} target @param {() => T} fn @returns {T}
 */
export function withFileLock(target, fn) {
  return locked(fn, target);
}

function locked(fn, target = file()) {
  fs.mkdirSync(credentialsDir(), { recursive: true, mode: 0o700 });
  const lock = `${target}.lock`;
  const token = `${process.pid}:${crypto.randomBytes(8).toString("hex")}`;
  const until = Date.now() + LOCK_WAIT_MS;
  sweepClaims(lock);
  // The lock is written whole first, then hard-linked into place (atomic,
  // EEXIST when held): never an empty lock to be taken for a crashed one
  // while its maker is merely slow (Codex review).
  const mine = `${lock}.${token.replace(":", "-")}.own`;
  fs.writeFileSync(mine, token, { mode: 0o600 });
  try {
    for (;;) {
      try {
        fs.linkSync(mine, lock);
        break;
      } catch (err) {
        if (err?.code !== "EEXIST") throw err;
      }
      if (takeOver(lock, token)) break;
      if (Date.now() > until) throw new Error(`${lock} is held by another foldrun command — try again, or remove it if no foldrun is running`);
      pause(25);
    }
  } finally {
    fs.rmSync(mine, { force: true });
  }
  try {
    return fn();
  } finally {
    if (readLock(lock) === token) fs.rmSync(lock, { force: true });
  }
}

/** Take over a lock whose owner is gone, without the path ever standing
 *  empty (Codex review): one claim file per dead lock (keyed by its content,
 *  inode and time), made with O_EXCL and holding the claimant's pid, so
 *  exactly one contender wins it; the winner checks the lock is still that
 *  dead one and renames its own lock file over it. The claim stays while its
 *  claimant lives, so a late contender that saw the same dead lock cannot win
 *  it again; a claim whose claimant is gone (crashed mid-takeover) is cleared.
 *  Limit, accepted: without kernel file locks (Node has none) a claimant
 *  paused between its check and its rename while its claim is cleared as dead
 *  could still overlap — it needs a crash during another crash's recovery. */
function takeOver(lock, token) {
  let st;
  const seen = readLock(lock);
  try {
    st = fs.statSync(lock);
  } catch {
    return false;
  }
  if (seen === null || !ownerGone(seen, lock)) return false;
  const key = crypto.createHash("sha256").update(`${seen}\0${st.ino}\0${st.mtimeMs}`).digest("hex").slice(0, 16);
  const claim = `${lock}.claim-${key}`;
  let fd;
  try {
    fd = fs.openSync(claim, "wx", 0o600);
  } catch {
    // Another contender has this dead lock — unless it died too.
    const held = readLock(claim);
    if (held !== null && ownerGone(held, claim)) fs.rmSync(claim, { force: true });
    return false;
  }
  try {
    fs.writeSync(fd, `${process.pid}:claim`);
  } finally {
    fs.closeSync(fd);
  }
  let stillDead = false;
  try {
    stillDead = readLock(lock) === seen && fs.statSync(lock).ino === st.ino;
  } catch {
    /* gone: someone released it */
  }
  if (!stillDead) {
    fs.rmSync(claim, { force: true });
    return false;
  }
  const tmp = `${lock}.${token.replace(":", "-")}.tmp`;
  try {
    fs.writeFileSync(tmp, token, { mode: 0o600 });
    fs.renameSync(tmp, lock);
    return true;
  } catch {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(claim, { force: true });
    return false;
  }
}

/** Claims whose claimant is gone go: nobody is taking that lock over. */
function sweepClaims(lock) {
  const dir = path.dirname(lock);
  const base = `${path.basename(lock)}.claim-`;
  try {
    for (const n of fs.readdirSync(dir)) {
      if (!n.startsWith(base)) continue;
      const p = path.join(dir, n);
      try {
        const held = readLock(p);
        if (held !== null && ownerGone(held, p)) fs.rmSync(p, { force: true });
      } catch {
        /* gone meanwhile */
      }
    }
  } catch {
    /* an unreadable folder: the open below says so */
  }
}

function write(current, profiles) {
  // The old shape goes on being written for the newest profile on each URL,
  // so a machine that moves between CLI versions is not signed out by the
  // move. It is a mirror, never the source.
  const platforms = {};
  for (const p of Object.values(profiles).sort((a, b) => String(a.loggedInAt ?? "").localeCompare(String(b.loggedInAt ?? "")))) {
    platforms[normaliseUrl(p.url)] = { token: p.token, email: p.email ?? null, account: p.account, role: p.role, ...(p.minted ? { minted: true } : {}), loggedInAt: p.loggedInAt };
  }
  fs.mkdirSync(credentialsDir(), { recursive: true, mode: 0o700 });
  // Written beside it and renamed over it: a reader in another process sees
  // the old file or the new one, never half of one (Codex review, 19 Nov).
  const tmp = `${file()}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ current, default: current && profiles[current] ? normaliseUrl(profiles[current].url) : null, profiles, platforms }, null, 2) + "\n",
    { mode: 0o600 },
  );
  try {
    fs.renameSync(tmp, file());
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  // `mode` applies only when the file is created; one made before (or by
  // hand) keeps whatever it had. It holds tokens: owner-only, every write.
  try {
    fs.chmodSync(file(), 0o600);
  } catch {
    /* not ours to fix (Windows ACLs, a read-only home) */
  }
}

/**
 * Remember a signed-in account. A second login to the same URL for the same
 * ACCOUNT replaces that profile rather than making a near-duplicate; a
 * different account on the same URL is a new one.
 * @param {string} url
 * @param {Record<string, any>} entry
 * @param {{ makeDefault?: boolean, name?: string, alsoAt?: string[] }} [opts]
 *   alsoAt: the platform's other addresses (where the sign-in started, its
 *   dashboard) — the same account's profile at one of them is this one.
 */
export function saveCredential(url, entry, { makeDefault = true, name, alsoAt } = {}) {
  return locked(() => {
    const key = normaliseUrl(url);
    const { current, profiles } = readCredentials();
    // alsoAt: where the sign-in started, when the key is kept at the
    // platform's API address instead (21 Nov 2026). The same account's
    // profile there is this one moved, not a second profile beside it.
    const at = new Set([key, ...(alsoAt ?? []).filter(Boolean).map((u) => normaliseUrl(u))]);
    // A profile is at its API and at its saved dashboard (`app`) alike.
    const here = (p) => at.has(normaliseUrl(p.url)) || (typeof p.app === "string" && at.has(normaliseUrl(p.app)));
    const existing = name ?? Object.keys(profiles).find((n) => here(profiles[n]) && profiles[n].account === entry.account);
    const profileName = existing ?? nameFor(profiles, entry.account, key);
    // The default project (`foldrun workspaces use`) is what is stored NOW for
    // this account on this platform, never what the entry carries: a renewal
    // writes back a profile read before a `use` or `--clear` changed it, and a
    // re-login to the same account keeps it (Codex review, 19 Nov 2026).
    const prev = profiles[profileName];
    const kept = prev && here(prev) && prev.account === entry.account && typeof prev.workspace === "string" ? { workspace: prev.workspace } : {};
    const { workspace: _carried, ...fields } = entry;
    profiles[profileName] = { ...fields, ...kept, url: key, loggedInAt: new Date().toISOString() };
    write(makeDefault || !current ? profileName : current, profiles);
    return profileName;
  });
}

/** Forget one. By name, else by URL (the newest there). Returns what was
 *  stored, for a best-effort revoke. */
export function removeCredential(urlOrName) {
  return locked(() => {
    const { current, profiles } = readCredentials();
    const key = (() => {
      if (profiles[urlOrName]) return urlOrName;
      try {
        const u = normaliseUrl(urlOrName);
        const here = Object.keys(profiles).filter((n) => normaliseUrl(profiles[n].url) === u);
        return here.sort((a, b) => String(profiles[a].loggedInAt ?? "").localeCompare(String(profiles[b].loggedInAt ?? ""))).at(-1) ?? null;
      } catch {
        return null;
      }
    })();
    if (!key) return null;
    const gone = profiles[key];
    delete profiles[key];
    const names = Object.keys(profiles);
    write(current === key ? names[0] ?? null : current, profiles);
    return gone;
  });
}

/** The stored entry for a URL — the newest account signed in there. */
export function credentialFor(url) {
  if (!url) return null;
  try {
    const { profiles } = readCredentials();
    const here = Object.keys(profiles).filter((n) => normaliseUrl(profiles[n].url) === normaliseUrl(url));
    const newest = here.sort((a, b) => String(profiles[a].loggedInAt ?? "").localeCompare(String(profiles[b].loggedInAt ?? ""))).at(-1);
    return newest ? { ...profiles[newest], name: newest } : null;
  } catch {
    return null;
  }
}

/** One profile by name. */
export function profileByName(name) {
  if (!name) return null;
  const { profiles } = readCredentials();
  return profiles[name] ? { ...profiles[name], name } : null;
}

/** The profile a bare command talks as. */
export function currentProfile() {
  const { current, profiles } = readCredentials();
  return current && profiles[current] ? { ...profiles[current], name: current } : null;
}

/** Make one the profile a bare command talks as. */
export function useProfile(name) {
  return locked(() => {
    const { profiles } = readCredentials();
    if (!profiles[name]) return null;
    write(name, profiles);
    return { ...profiles[name], name };
  });
}

/** Save (or, with null, forget) the project a profile's commands use when
 *  they name none — `foldrun workspaces use`. Kept on the profile, so it is
 *  one account on one platform's, and never follows a --token. */
export function setProfileWorkspace(name, workspace, expect = {}) {
  return locked(() => {
    const { current, profiles } = readCredentials();
    if (!profiles[name]) return null;
    // Still the account and platform it was checked against: a sign-out or a
    // new sign-in under the same name meanwhile saves nothing.
    if (expect.url && normaliseUrl(profiles[name].url) !== normaliseUrl(expect.url)) return null;
    if (expect.account && profiles[name].account !== expect.account) return null;
    const next = { ...profiles[name] };
    if (workspace) next.workspace = workspace;
    else delete next.workspace;
    profiles[name] = next;
    write(current, profiles);
    return { ...next, name };
  });
}

/** All of them, newest sign-in last. */
export function listProfiles() {
  const { current, profiles } = readCredentials();
  return Object.entries(profiles)
    .map(([name, p]) => ({ ...p, name, current: name === current }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The platform a bare command talks to: the current profile's. */
export function defaultPlatform() {
  return currentProfile()?.url ?? null;
}
