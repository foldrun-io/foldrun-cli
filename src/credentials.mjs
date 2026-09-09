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
import os from "node:os";
import path from "node:path";

export const credentialsDir = () => process.env.FOLDRUN_HOME ?? path.join(os.homedir(), ".foldrun");
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

function write(current, profiles) {
  // The old shape goes on being written for the newest profile on each URL,
  // so a machine that moves between CLI versions is not signed out by the
  // move. It is a mirror, never the source.
  const platforms = {};
  for (const p of Object.values(profiles).sort((a, b) => String(a.loggedInAt ?? "").localeCompare(String(b.loggedInAt ?? "")))) {
    platforms[normaliseUrl(p.url)] = { token: p.token, email: p.email ?? null, account: p.account, role: p.role, ...(p.minted ? { minted: true } : {}), loggedInAt: p.loggedInAt };
  }
  fs.mkdirSync(credentialsDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    file(),
    JSON.stringify({ current, default: current && profiles[current] ? normaliseUrl(profiles[current].url) : null, profiles, platforms }, null, 2) + "\n",
    { mode: 0o600 },
  );
}

/**
 * Remember a signed-in account. A second login to the same URL for the same
 * ACCOUNT replaces that profile rather than making a near-duplicate; a
 * different account on the same URL is a new one.
 */
export function saveCredential(url, entry, { makeDefault = true, name } = {}) {
  const key = normaliseUrl(url);
  const { current, profiles } = readCredentials();
  const existing = name ?? Object.keys(profiles).find((n) => normaliseUrl(profiles[n].url) === key && profiles[n].account === entry.account);
  const profileName = existing ?? nameFor(profiles, entry.account, key);
  profiles[profileName] = { ...entry, url: key, loggedInAt: new Date().toISOString() };
  write(makeDefault || !current ? profileName : current, profiles);
  return profileName;
}

/** Forget one. By name, else by URL (the newest there). Returns what was
 *  stored, for a best-effort revoke. */
export function removeCredential(urlOrName) {
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
  const { profiles } = readCredentials();
  if (!profiles[name]) return null;
  write(name, profiles);
  return { ...profiles[name], name };
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
