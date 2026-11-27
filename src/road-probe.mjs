// `foldrun doctor`'s road test (FOL-402, 27 Nov 2026): is the way from this
// computer to the API whole, or does something on it freeze a connection
// once it has carried enough (Iran's filter does, ~20–30 KB, to a
// little-known foreign name)?
//
// Three probes per address, none with a credential, each bounded: a small
// download (1 KiB), a big one (64 KiB) and a big upload (64 KiB), against
// GET/POST /v1/network/bytes (random bytes, never cached, so nothing on the
// way can answer from a cache or squeeze them). Each says how far it got —
// the phase, the bytes, the time.

import crypto from "node:crypto";

export const SMALL = 1024;
export const BIG = 65536;

/**
 * One probe. Phases: "connect" (no answer at all), "headers" (answered, the
 * body never came), "body" (part of it), "done".
 * @param {typeof fetch} doFetch @param {string} url
 * @param {{ method?: "GET" | "POST", body?: Uint8Array, expect?: number, seconds?: number, idleSeconds?: number }} o
 */
export async function probe(doFetch, url, o = {}) {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const ctl = new AbortController();
  const overall = setTimeout(() => ctl.abort(), (o.seconds ?? 20) * 1000);
  /** @type {ReturnType<typeof setTimeout> | null} */
  let idle = null;
  const fed = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => ctl.abort(), (o.idleSeconds ?? 10) * 1000);
  };
  /** @type {"connect" | "headers" | "body" | "done"} */
  let phase = "connect";
  let bytes = 0;
  try {
    fed();
    const res = await doFetch(url, {
      method: o.method ?? "GET",
      body: o.body,
      redirect: "manual",
      cache: "no-store",
      signal: ctl.signal,
      headers: o.body ? { "content-type": "application/octet-stream" } : { accept: "application/octet-stream" },
    });
    phase = "headers";
    fed();
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, phase, bytes, ms: ms(), status: res.status, why: `answered ${res.status}` };
    }
    if (o.method === "POST") {
      const j = /** @type {any} */ (await res.json().catch(() => null));
      phase = "done";
      const got = Number(j?.received);
      const ok = got === (o.body?.byteLength ?? 0);
      return { ok, phase, bytes: o.body?.byteLength ?? 0, ms: ms(), status: 200, why: ok ? "" : `the API received ${Number.isFinite(got) ? got : "?"} bytes` };
    }
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        phase = "body";
        bytes += value.byteLength;
        fed();
      }
    }
    phase = "done";
    const ok = bytes === (o.expect ?? bytes);
    return { ok, phase, bytes, ms: ms(), status: 200, why: ok ? "" : `ended at ${bytes} of ${o.expect} bytes` };
  } catch (err) {
    const timedOut = ctl.signal.aborted;
    const e = /** @type {any} */ (err);
    const why = timedOut ? "stalled" : String(e?.cause?.code ?? e?.code ?? e?.message ?? err).slice(0, 80);
    return { ok: false, phase, bytes, ms: ms(), status: 0, why, stalled: timedOut };
  } finally {
    clearTimeout(overall);
    if (idle) clearTimeout(idle);
  }
}

/**
 * The three probes against one address of the API.
 * @param {typeof fetch} doFetch @param {string} origin
 * @param {{ seconds?: number, idleSeconds?: number }} [o]
 */
export async function probeRoute(doFetch, origin, o = {}) {
  const at = `${origin.replace(/\/+$/, "")}/v1/network/bytes`;
  const small = await probe(doFetch, `${at}?size=${SMALL}`, { expect: SMALL, ...o });
  const down = await probe(doFetch, `${at}?size=${BIG}`, { expect: BIG, ...o });
  const up = await probe(doFetch, at, { method: "POST", body: crypto.randomBytes(BIG), ...o });
  return { route: origin, small, down, up, ok: small.ok && down.ok && up.ok };
}

/** One probe as a few words: `64 KiB down 412 ms` / `stalled after 24576 bytes (body, 10031 ms)`. */
export function probeText(/** @type {string} */ label, /** @type {any} */ p) {
  if (p.ok) return `${label} ${p.ms} ms`;
  return `${label} ${p.why || "failed"} at ${p.phase}, ${p.bytes} bytes, ${p.ms} ms`;
}

/**
 * What the probes of every address add up to. "Consistent with Iran's
 * filter" only when, on one address, the small probe passed and a big one
 * stalled, while on another every probe completed — the shape of a filter
 * that freezes a connection after it has carried enough, and of nothing
 * else this test can tell apart.
 * @param {Array<{ route: string, small: any, down: any, up: any, ok: boolean }>} rs
 */
export function verdict(rs) {
  const whole = rs.filter((r) => r.ok);
  const frozen = rs.filter((r) => r.small.ok && ((!r.down.ok && r.down.stalled) || (!r.up.ok && r.up.stalled)));
  if (frozen.length && whole.length) return { kind: /** @type {const} */ ("filter"), frozen: frozen.map((r) => r.route), whole: whole.map((r) => r.route) };
  if (whole.length === rs.length) return { kind: "whole" };
  if (!whole.length && rs.every((r) => !r.small.ok)) return { kind: "unreachable" };
  return { kind: "broken", whole: whole.map((r) => r.route) };
}
