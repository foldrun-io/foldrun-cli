// Where `foldrun login` puts what it was given.
//
// `~/.foldrun/credentials.json`, 0600, one entry per platform URL, and a
// `default` naming the one a bare command talks to — the same shape every
// CLI that signs in keeps, so the person who has used Vercel's or Fly's
// finds nothing to learn. FOLDRUN_HOME moves the directory, for tests and
// for machines where HOME is not where things should be kept.
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

export function readCredentials() {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), "utf8"));
    return { default: parsed.default ?? null, platforms: parsed.platforms ?? {} };
  } catch {
    return { default: null, platforms: {} };
  }
}

function writeCredentials(creds) {
  fs.mkdirSync(credentialsDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file(), JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
}

/** Remember a platform; it becomes the default unless one is already set
 *  and the caller says to leave it. */
export function saveCredential(url, entry, { makeDefault = true } = {}) {
  const key = normaliseUrl(url);
  const creds = readCredentials();
  creds.platforms[key] = { ...entry, loggedInAt: new Date().toISOString() };
  if (makeDefault || !creds.default) creds.default = key;
  writeCredentials(creds);
  return key;
}

/** Forget a platform. Returns what was there, for a best-effort revoke. */
export function removeCredential(url) {
  const key = normaliseUrl(url);
  const creds = readCredentials();
  const gone = creds.platforms[key] ?? null;
  delete creds.platforms[key];
  if (creds.default === key) creds.default = Object.keys(creds.platforms)[0] ?? null;
  writeCredentials(creds);
  return gone;
}

/** The stored entry for a URL, or null. */
export function credentialFor(url) {
  if (!url) return null;
  try {
    return readCredentials().platforms[normaliseUrl(url)] ?? null;
  } catch {
    return null;
  }
}

/** The platform a bare command talks to: the last one signed in to. */
export function defaultPlatform() {
  return readCredentials().default;
}
