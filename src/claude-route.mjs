// Moving Claude Code to the address that works (FOL-402, 27 Nov 2026).
//
// `foldrun keys create --gateway --claude-code` writes Claude Code's
// settings.json and, beside foldrun's own files, an ownership record
// (claude-code.json): which settings file, which address and which key it
// wrote. `foldrun gateway status-line` — which Claude Code runs every
// refreshInterval seconds — checks every CHECK_MS (RETRY_MS after a check
// that failed) whether the API names another address for this caller
// (/v1/version, no credential), and moves ANTHROPIC_BASE_URL there only when
// all of this holds:
//
//   - the new address is in the CLI's built-in list for this API
//     (routes.mjs) AND the API named it — a credential never goes anywhere
//     else;
//   - the setting is ours: the ownership record names this file, this
//     address and this key; or, for an install made before the record, our
//     status line is set, the address is one of the list's and the key is a
//     foldrun gateway key;
//   - the address Claude Code handed the status line is the file's (else a
//     shell variable or managed settings set it, and they are not ours), and
//     no managed-settings file sets it;
//   - the file did not change while we looked: one writer at a time (a lock
//     file), read fresh under the lock, the whole text compared, written to
//     an owner-only temp file and renamed. Any doubt: skipped.
//
// Claude Code reads its env at start, so a move takes effect at the next
// start; the line says so.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { approved, askVersion, groupOf, originOf, hostOf } from "./routes.mjs";

export const CHECK_MS = 10 * 60_000;
export const RETRY_MS = 60_000;
export const STATUS_LINE_COMMAND = "foldrun gateway status-line";
/** Seconds between Claude Code's runs of the status line. */
export const REFRESH_SECONDS = 60;
const GATEWAY_KEY = /^fr_(gw|api)_[0-9a-f]{48}$/;

/** Where Claude Code's admin-managed settings live: never written, and an
 *  ANTHROPIC_BASE_URL there is not ours to move. */
export function managedSettingsFiles(platform = process.platform) {
  if (platform === "darwin") return ["/Library/Application Support/ClaudeCode/managed-settings.json"];
  if (platform === "win32") return [path.join(process.env.ProgramData || "C:\\ProgramData", "ClaudeCode", "managed-settings.json")];
  return ["/etc/claude-code/managed-settings.json"];
}

const keyHash = (/** @type {string} */ k) => crypto.createHash("sha256").update(k).digest("hex").slice(0, 32);
const recordFile = (/** @type {string} */ dir) => path.join(dir, "claude-code.json");
const checkFile = (/** @type {string} */ dir) => path.join(dir, "claude-code-check.json");

function writePrivateJson(/** @type {string} */ file, /** @type {unknown} */ value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, file);
}

const readJson = (/** @type {string} */ file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/** What `keys create --claude-code` wrote: kept so a later move knows it is ours. */
export function writeOwnership(/** @type {string} */ dir, /** @type {{ file: string, baseUrl: string, key: string }} */ o, now = Date.now()) {
  writePrivateJson(recordFile(dir), { settings: path.resolve(o.file), baseUrl: originOf(o.baseUrl) ?? o.baseUrl, key: keyHash(o.key), at: new Date(now).toISOString() });
}

export const readOwnership = (/** @type {string} */ dir) => readJson(recordFile(dir));

/**
 * Is the env block of `settings` ours to move? "record" (the record says
 * so), "legacy" (made before the record, and the evidence is clear) or null.
 */
export function ownedBy(/** @type {string} */ dir, /** @type {string} */ file, /** @type {any} */ settings) {
  const env = settings?.env ?? {};
  const base = originOf(env.ANTHROPIC_BASE_URL);
  const key = typeof env.ANTHROPIC_AUTH_TOKEN === "string" ? env.ANTHROPIC_AUTH_TOKEN : "";
  if (!base || !key) return null;
  // Another credential beside ours would go to the new address too: not ours to move.
  if ("ANTHROPIC_API_KEY" in env) return null;
  const r = readOwnership(dir);
  if (r && r.settings === path.resolve(file) && r.baseUrl === base && r.key === keyHash(key)) return "record";
  if (r && r.settings === path.resolve(file)) return null; // a record for this file that does not match: someone changed it
  if (settings?.statusLine?.command === STATUS_LINE_COMMAND && groupOf(base) && GATEWAY_KEY.test(key) && !("ANTHROPIC_API_KEY" in env)) return "legacy";
  return null;
}

/** A managed-settings file that sets the base URL (or cannot be read). */
function managedSetsBase(/** @type {string[]} */ files) {
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch (e) {
      if (/** @type {any} */ (e)?.code === "ENOENT") continue;
      return true;
    }
    try {
      const j = JSON.parse(text);
      if (j?.env && "ANTHROPIC_BASE_URL" in j.env) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** One foldrun writer at a time: a lock file beside the settings, taken or
 *  not. Its own random token: released only while it is still ours, and a
 *  stale one (over 30 s) is cleared only if it is the same one seen stale. */
export function takeLock(/** @type {string} */ file, now = Date.now()) {
  const lock = `${file}.foldrun-lock`;
  try {
    const st = fs.statSync(lock);
    if (now - st.mtimeMs > 30_000) {
      const seen = fs.readFileSync(lock, "utf8");
      const aside = `${lock}.${crypto.randomBytes(4).toString("hex")}.stale`;
      fs.renameSync(lock, aside);
      // Another writer took it meanwhile: put theirs back.
      if (fs.readFileSync(aside, "utf8") !== seen) fs.renameSync(aside, lock);
      else fs.rmSync(aside, { force: true });
    }
  } catch {
    /* none, or someone else cleared it */
  }
  const token = `${process.pid}.${crypto.randomBytes(8).toString("hex")}`;
  try {
    fs.writeFileSync(lock, token, { flag: "wx", mode: 0o600 });
  } catch {
    return null;
  }
  return () => {
    try {
      if (fs.readFileSync(lock, "utf8") === token) fs.rmSync(lock, { force: true });
    } catch {
      /* gone already */
    }
  };
}

/**
 * Should the settings move, and if so, move them. Throttled by the check
 * file. Returns what the status line should say about it, or "".
 * @param {{ dir: string, file: string, env: Record<string, string | undefined>, now?: number, fetchImpl?: typeof fetch, managed?: string[], force?: boolean }} o
 * @returns {Promise<{ said: string, moved?: string, notice?: any }>}
 */
export async function checkClaudeRoute(o) {
  const now = o.now ?? Date.now();
  const handed = originOf(o.env.ANTHROPIC_BASE_URL);
  if (!handed || !groupOf(handed)) return { said: "" };
  // What Claude Code runs with must be the file's alone: a token or key from
  // the shell (or managed settings) would follow the address elsewhere.
  const handedKey = o.env.ANTHROPIC_AUTH_TOKEN;
  const last = readJson(checkFile(o.dir));
  const pending = last?.moved && last?.from === handed ? `moved to ${hostOf(last.moved)} — takes effect at the next Claude Code start` : "";
  if (!o.force && last && typeof last.at === "number" && now - last.at < (last.ok ? CHECK_MS : RETRY_MS) && now >= last.at) return { said: pending, notice: last.notice ?? null };
  const note = (/** @type {Record<string, unknown>} */ v) => {
    try {
      writePrivateJson(checkFile(o.dir), { at: now, ...v });
    } catch {
      /* asked again next time */
    }
  };
  const doFetch = o.fetchImpl ?? fetch;
  const g = groupOf(handed);
  const answer = /** @type {any} */ ((await askVersion(doFetch, handed, 3)) ?? (g && g.main !== handed ? await askVersion(doFetch, g.main, 3) : null));
  if (!answer) {
    note({ ok: false, from: handed });
    return { said: pending };
  }
  const notice = answer.notice && typeof answer.notice.message === "string" ? answer.notice : null;
  const want = originOf(answer.urls?.gateway ?? answer.urls?.api);
  const named = new Set([answer.urls?.gateway, answer.urls?.api, ...(Array.isArray(answer.urls?.fronts) ? answer.urls.fronts : [])].map(originOf).filter(Boolean));
  if (!want || want === handed || !named.has(want) || !approved(handed, want)) {
    note({ ok: true, from: handed, notice, ...(want === handed ? {} : last?.moved ? { moved: last.moved } : {}) });
    return { said: want === handed ? "" : pending, notice };
  }
  const moved = moveSettings({ ...o, from: handed, to: want, now, handedKey, handedApiKey: !!o.env.ANTHROPIC_API_KEY });
  note({ ok: true, from: handed, notice, ...(moved ? { moved: want } : {}) });
  return moved ? { said: `moved to ${hostOf(want)} — takes effect at the next Claude Code start`, moved: want, notice } : { said: "", notice };
}

/** The write itself, under every condition in the header. True when moved. */
export function moveSettings(/** @type {{ dir: string, file: string, from: string, to: string, managed?: string[], now?: number, handedKey?: string, handedApiKey?: boolean }} */ o) {
  if (managedSetsBase(o.managed ?? managedSettingsFiles())) return false;
  let before;
  try {
    before = fs.readFileSync(o.file, "utf8");
  } catch {
    return false;
  }
  const release = takeLock(o.file, o.now);
  if (!release) return false;
  try {
    // Read fresh under the lock; the whole text must be what was read before.
    const text = fs.readFileSync(o.file, "utf8");
    if (text !== before) return false;
    /** @type {any} */
    let settings;
    try {
      settings = JSON.parse(text);
    } catch {
      return false;
    }
    if (!settings || typeof settings !== "object" || Array.isArray(settings) || !settings.env || typeof settings.env !== "object") return false;
    if (originOf(settings.env.ANTHROPIC_BASE_URL) !== o.from) return false;
    if (o.handedKey !== undefined && o.handedKey !== settings.env.ANTHROPIC_AUTH_TOKEN) return false;
    if (o.handedApiKey) return false;
    const owner = ownedBy(o.dir, o.file, settings);
    if (!owner) return false;
    const next = { ...settings, env: { ...settings.env, ANTHROPIC_BASE_URL: o.to } };
    const tmp = `${o.file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    try {
      // The last look before the rename: anything that changed it meanwhile wins.
      if (fs.readFileSync(o.file, "utf8") !== before) {
        fs.rmSync(tmp, { force: true });
        return false;
      }
      fs.renameSync(tmp, o.file);
    } catch {
      fs.rmSync(tmp, { force: true });
      return false;
    }
    try {
      fs.chmodSync(o.file, 0o600);
    } catch {
      /* Windows: no modes */
    }
    writeOwnership(o.dir, { file: o.file, baseUrl: o.to, key: settings.env.ANTHROPIC_AUTH_TOKEN }, o.now);
    return true;
  } finally {
    release();
  }
}

/** Claude Code's user settings file. */
export function claudeSettingsFile(env = process.env) {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "settings.json");
}

/** The notice as plain words for a line: no control or bidi characters. */
export function noticeWords(/** @type {any} */ n, max = 120) {
  if (!n || typeof n.message !== "string") return "";
  return n.message.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff<>]/g, "").trim().slice(0, max);
}
