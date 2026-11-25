// The web tool's browse, run in a cloud browser (FOL-267): `/where browser cloud` in foldrun code. One page per
// call through the gateway's POST /v1/foldrun/browse (FOL-313) — the same door every app uses, with the session's
// own key, priced per call. Never retried by itself: a call whose outcome is unknown may have run (and cost).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STEP_KINDS = ["click", "dblclick", "hover", "fill", "type", "press", "select", "check", "uncheck", "wait", "scroll", "goto", "back", "forward", "reload", "focus", "clear"];
const STEPS_MAX = 5;
const TIMEOUT_MS = 180_000;

export const CLOUD_WEB_DEFINITION = {
  description: [
    "Open one web page in a browser in foldrun's cloud and read it (action=browse). Each call is a fresh browser: nothing stays open between calls, and no sign-in is kept.",
    `Up to ${STEPS_MAX} steps run on the page first, in order — each one of: ${STEP_KINDS.join(", ")} — with a CSS selector or visible text as its value, and text/value/key where it needs one (fill: {"fill": "#email", "text": "a@b.c"}; press: {"press": "Enter"}; wait: {"wait": 1000} or {"wait": "#done"}).`,
    "mode: markdown (default), text, or screenshot (a PNG saved on this computer; its path is given).",
    "Each call is paid for. A call that failed with 'outcome unknown' may have run: do not repeat it unless the person agrees.",
  ].join("\n"),
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["browse"], description: "browse" },
      url: { type: "string", description: "The page, http(s)" },
      steps: { type: "array", maxItems: STEPS_MAX, items: { type: "object" }, description: "What to do on the page before reading it" },
      mode: { type: "string", enum: ["markdown", "text", "screenshot"], description: "What comes back. Default: markdown" },
    },
    required: ["action", "url"],
    additionalProperties: false,
  },
};

/**
 * The agent's web.browse block in a cloud browser: its site lock is sent with every call and its denied actions are
 * held here; any other setting is not kept by this door and is named, never silently dropped.
 * @param {{ settings?: Record<string, any>, rest?: unknown, error?: string }} read core readBrowseSettings
 * @returns {{ allowed?: string[], deny?: string[], notes: string[] } | { problem: string }}
 */
export function cloudBrowseBlock(read) {
  if (read?.error) return { problem: `this agent's web.browse block: ${read.error}` };
  if (read?.rest !== undefined) return { problem: "this agent's web.browse block names a browser vendor, which the cloud browse door does not take — browse in a cloud turn (/where cloud)" };
  const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : null);
  /** @type {string[] | undefined} */ let allowed;
  /** @type {string[] | undefined} */ let deny;
  const notes = [];
  for (const [k, v] of Object.entries(read?.settings ?? {})) {
    if (k === "allowed_domains") {
      const l = list(v);
      if (!l) return { problem: "this agent's web.browse allowed_domains is not a list of sites" };
      // The door holds a site with its sub-domains: a lock to one host alone would be widened, so it is refused (Codex).
      const exact = l.find((d) => !d.startsWith("*."));
      if (exact) return { problem: `this agent's web.browse allowed_domains names ${exact} alone, and the cloud browse door would also let its sub-domains through — write *.${exact} if they may be reached, or browse on this computer (/where browser here)` };
      allowed = l;
    } else if (k === "deny") {
      // Actions it may not take (core WEB_BROWSE_ACTIONS): a step of one of them is refused before the call (Codex).
      const l = list(v);
      if (!l) return { problem: "this agent's web.browse deny is not a list of actions" };
      deny = l.map((x) => x.toLowerCase());
    } else notes.push(`${k}: not applied by the cloud browse door`);
  }
  return { ...(allowed ? { allowed } : {}), ...(deny ? { deny } : {}), notes };
}

/**
 * The request body for one call, or why it may not go.
 * @param {any} input @param {{ allowed?: string[], deny?: string[] }} block
 * @returns {{ body: Record<string, unknown> } | { problem: string }}
 */
export function cloudBrowseBody(input, block) {
  const action = String(input?.action ?? "").trim().toLowerCase();
  if (action !== "browse") return { problem: `web action=${action || "(none)"}: in a cloud browser from this computer the web tool browses (action=browse)` };
  const url = typeof input?.url === "string" ? input.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) return { problem: "url is an http(s) address" };
  for (const k of Object.keys(input ?? {})) if (!["action", "url", "steps", "mode"].includes(k)) return { problem: `web action=browse in a cloud browser does not take ${k}` };
  const mode = input?.mode ?? "markdown";
  if (!["markdown", "text", "screenshot"].includes(mode)) return { problem: "mode is markdown, text or screenshot" };
  const steps = input?.steps;
  if (steps !== undefined && (!Array.isArray(steps) || steps.length > STEPS_MAX)) return { problem: `steps is a list of at most ${STEPS_MAX}` };
  const denied = new Set(block.deny ?? []);
  if (mode === "screenshot" && denied.has("screenshot")) return { problem: "this agent's web.browse deny holds screenshot — it may not take one" };
  for (const st of Array.isArray(steps) ? steps : []) {
    if (!st || typeof st !== "object" || Array.isArray(st)) return { problem: "each step is an object" };
    const kind = Object.keys(st).find((k) => STEP_KINDS.includes(k));
    if (!kind) return { problem: `each step is one of ${STEP_KINDS.join(", ")}` };
    if (denied.has(kind)) return { problem: `this agent's web.browse deny holds ${kind} — a ${kind} step is not run` };
  }
  return {
    body: {
      url, mode,
      ...(Array.isArray(steps) && steps.length ? { steps } : {}),
      ...(block.allowed?.length ? { allowed_domains: block.allowed } : {}),

    },
  };
}

/**
 * One call. Never throws, never retries. A screenshot is saved under `shotsDir`.
 * @param {{ gatewayUrl: string, key: string, userAgent?: string, shotsDir: string, fetchImpl?: typeof fetch, timeoutMs?: number }} o
 * @param {Record<string, unknown>} body @param {AbortSignal} [signal]
 * @returns {Promise<{ text: string, isError: boolean }>}
 */
export async function cloudBrowse(o, body, signal) {
  const doFetch = o.fetchImpl ?? fetch;
  const timer = new AbortController();
  const t = setTimeout(() => timer.abort(), o.timeoutMs ?? TIMEOUT_MS);
  const both = signal ? AbortSignal.any([signal, timer.signal]) : timer.signal;
  let res;
  try {
    res = await doFetch(`${o.gatewayUrl.replace(/\/+$/, "")}/v1/foldrun/browse`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": o.key,
        // One key per call: a retry by a proxy in between is answered from the first, never charged twice.
        "idempotency-key": crypto.randomUUID(),
        ...(o.userAgent ? { "user-agent": o.userAgent } : {}),
      },
      body: JSON.stringify(body),
      // The key never follows a redirect to another host (Codex).
      redirect: "error",
      signal: both,
    });
  } catch (err) {
    clearTimeout(t);
    if (signal?.aborted) return { text: "stopped — if the request had already left, the page may have been opened and paid for", isError: true };
    // Sent, maybe run: said so, and not repeated.
    return { text: `the cloud browser's answer did not arrive (${err instanceof Error ? err.message : String(err)}) — the call may have run and cost; it was not repeated`, isError: true };
  }
  let raw = "";
  try {
    raw = await res.text();
  } catch (err) {
    clearTimeout(t);
    if (signal?.aborted) return { text: "stopped — the page may already have been opened and paid for", isError: true };
    // The call ran; its answer was lost on the way: said so, never a reason to send it again (Codex).
    return { text: `the cloud browser's answer was cut off (${err instanceof Error ? err.message : String(err)}) — the page was probably opened and paid for; it was not repeated`, isError: true };
  }
  clearTimeout(t);
  /** @type {any} */
  let j = null;
  try {
    j = JSON.parse(raw);
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const code = j?.error?.code ? String(j.error.code) : "";
    const msg = typeof j?.error?.message === "string" ? j.error.message : raw.slice(0, 300) || `HTTP ${res.status}`;
    const unknown = code === "outcome_unknown" || res.status === 502 && !code;
    return { text: `the cloud browser refused (${res.status}${code ? ` ${code}` : ""}): ${msg}${unknown ? " — the outcome is unknown: the page may have been opened and paid for; not repeated" : ""}`, isError: true };
  }
  if (!j || typeof j !== "object") return { text: "the cloud browser answered with something that is not a page — it may have run and cost; it was not repeated", isError: true };
  const at = typeof j.url === "string" ? j.url : String(body.url);
  if (j.screenshot && typeof j.screenshot.data === "string") {
    try {
      fs.mkdirSync(o.shotsDir, { recursive: true, mode: 0o700 });
      const file = path.join(o.shotsDir, `shot-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.png`);
      fs.writeFileSync(file, Buffer.from(j.screenshot.data, "base64"), { flag: "wx", mode: 0o600 });
      return { text: `${at}\nscreenshot saved: ${file} (read it with Read to look at it)`, isError: false };
    } catch (err) {
      return { text: `${at}\nthe screenshot came back but could not be saved: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  }
  return { text: `${at}\n\n${typeof j.text === "string" ? j.text : ""}`, isError: false };
}
