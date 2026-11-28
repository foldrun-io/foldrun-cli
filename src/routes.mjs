// Which address of the API this computer calls (FOL-402, 27 Nov 2026).
//
// Iran's filter freezes a connection to a little-known foreign name once it
// has carried ~20–30 KB, so the API is also served under a CloudFront name
// (a "front"). A small call (sign-in, /v1/version) still gets through to the
// main name, a coding agent's request does not. So:
//
//   - The fronts this CLI will send a credential to are written HERE, exact
//     origins, per API (FRONTS). Nothing a server says adds one.
//   - A front is used only while the API has also named it — /v1/version's
//     urls.api / urls.fronts, asked without a credential, of the main name or
//     of the front itself — within NAMED_TTL_MS.
//   - The last address that worked is kept per API (routes.json in the
//     state folder). A connection that stalls or is cut switches the NEXT
//     request to the next approved address; the request that stalled is never
//     sent again by us — whether it was done is unknown, and the person is
//     told so.
//
// No redirect is followed to another origin anywhere a credential goes.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** The built-in list: an API's own origin → the fronts approved for it.
 *  A new front is a CLI release. Production's front: prod/terraform/iran-front.tf (27 Nov 2026). */
export const FRONTS = Object.freeze({
  "https://api.foldrun.dev": Object.freeze(["https://dmdw0aty3jgf6.cloudfront.net"]),
  "https://api.foldrun.io": Object.freeze(["https://d3c69doqudkyqv.cloudfront.net"]),
});

/** A dashboard's own origin → the API it belongs to. A profile signed in at
 *  the dashboard (as the foldrun.ir setup does) has the API's fronts too, and
 *  is never itself handed to Claude Code as a gateway: the dashboard answers
 *  404 to /v1/messages (28 Nov 2026, a tester in Iran). */
export const DASHBOARDS = Object.freeze({
  "https://dash.foldrun.dev": "https://api.foldrun.dev",
  "https://dash.foldrun.io": "https://api.foldrun.io",
});

/** The API origin for `origin`: its API when it is a dashboard, else itself. */
export function apiOf(origin) {
  const o = originOf(origin);
  if (!o) return origin;
  return Object.hasOwn(DASHBOARDS, o) ? DASHBOARDS[o] : o;
}

/** How long an API's naming of a front holds without being asked again. */
export const NAMED_TTL_MS = 7 * 86_400_000;
/** How long a switch to a front holds before the main name is tried again. */
export const ROUTE_TTL_MS = 7 * 86_400_000;

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

/** The list in force: the built-in one, plus — for tests, and loopback
 *  origins only, so no environment can approve a real address — the JSON
 *  map in FOLDRUN_TEST_FRONTS. */
export function frontList(env = process.env) {
  /** @type {Record<string, readonly string[]>} */
  const out = { ...FRONTS };
  const raw = env.FOLDRUN_TEST_FRONTS;
  if (raw) {
    try {
      const m = JSON.parse(raw);
      for (const [k, v] of Object.entries(m ?? {})) {
        if (!LOOPBACK.test(k) || !Array.isArray(v) || !v.every((x) => typeof x === "string" && LOOPBACK.test(x))) continue;
        out[k] = v;
      }
    } catch {
      /* not JSON: ignored */
    }
  }
  return out;
}

/** An origin, or null for anything that is not one. */
export function originOf(u) {
  try {
    const x = new URL(String(u));
    if (x.protocol !== "https:" && !(x.protocol === "http:" && LOOPBACK.test(x.origin))) return null;
    return x.origin;
  } catch {
    return null;
  }
}

/** The API an origin belongs to — its main origin and every approved
 *  address of it, main first — or null when it has no front. */
export function groupOf(origin, list = frontList()) {
  const o = originOf(origin);
  if (!o) return null;
  for (const [main, fronts] of Object.entries(list)) {
    if (!fronts.length) continue;
    if (o === main || fronts.includes(o)) return { main, members: [main, ...fronts] };
  }
  return null;
}

/** Is `to` an address this CLI may send a credential meant for `from`? */
export function approved(from, to, list = frontList()) {
  const g = groupOf(apiOf(from), list);
  const t = originOf(to);
  return !!g && !!t && g.members.includes(t);
}

// ------------------------------------------------------------- the state

/** @param {string} dir */
const fileIn = (dir) => path.join(dir, "routes.json");

/** @returns {Record<string, { route?: string, since?: number, why?: string, named?: string[], namedAt?: number }>} */
export function readRoutes(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(fileIn(dir), "utf8"));
    return j && typeof j === "object" && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}

function writeRoutes(dir, all) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.routes.${process.pid}.${crypto.randomBytes(4).toString("hex")}`);
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, fileIn(dir));
  } catch {
    /* a folder that cannot be written: the main name, as before */
  }
}

/** The fronts of `main` the API named (and this CLI approves), if fresh. */
export function namedFronts(dir, main, now = Date.now(), list = frontList()) {
  const e = readRoutes(dir)[main];
  if (!e || !Array.isArray(e.named) || typeof e.namedAt !== "number" || now - e.namedAt > NAMED_TTL_MS || e.namedAt > now + 60_000) return [];
  return e.named.filter((f) => approved(main, f, list) && f !== main);
}

/** Keep what an API's /v1/version said about its fronts: only those this
 *  CLI approves for it. */
export function noteNamed(dir, main, answer, now = Date.now(), list = frontList()) {
  const g = groupOf(main, list);
  if (!g) return [];
  const urls = answer?.urls ?? {};
  const said = /** @type {string[]} */ ([urls.api, ...(Array.isArray(urls.fronts) ? urls.fronts : [])].map(originOf).filter(Boolean));
  const named = [...new Set(said)].filter((f) => f !== g.main && approved(g.main, f, list));
  const all = readRoutes(dir);
  all[g.main] = { ...(all[g.main] ?? {}), named, namedAt: now };
  writeRoutes(dir, all);
  return named;
}

/** Where a call meant for `origin` goes now: the kept route when it is an
 *  approved address the API named and not too old, else `origin` if it is
 *  the main name or a named front, else the main name. */
export function routeFor(dir, origin, now = Date.now(), list = frontList()) {
  const o = originOf(origin);
  const g = o && groupOf(o, list);
  if (!g) return o ?? origin;
  const e = readRoutes(dir)[g.main];
  const r = e?.route;
  // A front is used only while it is kept AND named; otherwise the API's main
  // name — even when the call was meant for a front (a profile saved at one).
  const named = namedFronts(dir, g.main, now, list);
  if (!r || typeof e.since !== "number" || now - e.since > ROUTE_TTL_MS) return o === g.main || named.includes(o) ? o : g.main;
  // Kept at the main name (a front stalled): the main name, even for a call meant for that front.
  if (r === g.main) return g.main;
  return named.includes(r) ? r : g.main;
}

/** A call through `route` worked: it is the one kept. */
export function noteWorked(dir, origin, route, now = Date.now(), list = frontList()) {
  const g = groupOf(origin, list);
  const r = originOf(route);
  if (!g || !r || !g.members.includes(r)) return;
  const all = readRoutes(dir);
  if (all[g.main]?.route === r) return;
  all[g.main] = { ...(all[g.main] ?? {}), route: r, since: now, why: "worked" };
  writeRoutes(dir, all);
}

/**
 * A connection to `stalled` stalled or was cut: ask (credential-free, small)
 * which fronts the API names — of its main name first, then of each front —
 * and keep the next approved, named address for the next request. Returns
 * it, or null when there is none.
 * @param {string} dir @param {string} origin @param {string} stalled
 * @param {{ fetchImpl?: typeof fetch, now?: number, list?: Record<string, readonly string[]>, seconds?: number }} [o]
 */
export async function switchAfterStall(dir, origin, stalled, o = {}) {
  const list = o.list ?? frontList();
  const g = groupOf(origin, list);
  if (!g) return null;
  const now = o.now ?? Date.now();
  const doFetch = o.fetchImpl ?? fetch;
  let named = namedFronts(dir, g.main, now, list);
  if (!named.length) {
    for (const at of g.members) {
      const answer = await askVersion(doFetch, at, o.seconds ?? 6);
      if (!answer) continue;
      named = noteNamed(dir, g.main, answer, now, list);
      if (named.length) break;
    }
  }
  const s = originOf(stalled);
  const order = [g.main, ...named];
  const at = order.indexOf(s ?? "");
  // The next one after the stalled address, round the list; never itself.
  const next = [...order.slice(at + 1), ...order.slice(0, Math.max(0, at))].find((x) => x !== s) ?? null;
  if (!next) return null;
  const all = readRoutes(dir);
  all[g.main] = { ...(all[g.main] ?? {}), route: next, since: now, why: `stalled at ${s}` };
  writeRoutes(dir, all);
  return next;
}

/** GET <origin>/v1/version, no credential, no redirect, bounded. */
export async function askVersion(doFetch, origin, seconds = 6) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), seconds * 1000);
  try {
    const res = await doFetch(`${origin}/v1/version`, { redirect: "manual", signal: ctl.signal, headers: { accept: "application/json" } });
    if (res.status !== 200) return null;
    const text = await res.text();
    if (text.length > 64 * 1024) return null;
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** A failure that is the road, not an answer: a stall, a reset, a refused
 *  or timed-out connection. */
export function roadFailure(err) {
  if (!err) return false;
  const text = [err.message, err.code, err.cause?.code, err.cause?.message, err.name].filter(Boolean).join(" ");
  return /\bterminated\b|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|ENETUNREACH|EHOSTUNREACH|ENETDOWN|UND_ERR_(SOCKET|CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT)|fetch failed|socket hang up|other side closed|TimeoutError|stalled/i.test(text);
}

/** The host of an origin, for a sentence. */
export const hostOf = (o) => {
  try {
    return new URL(o).host;
  } catch {
    return String(o);
  }
};
