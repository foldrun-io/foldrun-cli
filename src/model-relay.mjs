// koder's model calls on an API with fronts (FOL-402, 27 Nov 2026): a
// loopback relay between the engine and the address in use, so a stall is
// seen and the next call goes elsewhere.
//
// The engine retries a call whose connection fails before any answer, and
// would send a whole turn again into the same frozen road (Iran's filter
// freezes a big upload to a little-known name). The relay is the one place
// that sees the road: no answer within STALL_MS of sending, or no byte for
// IDLE_MS mid-reply, and it gives up on that call — answering the engine a
// refusal it does not retry (x-should-retry: false) or cutting the reply it
// had begun — and keeps the next approved address (routes.mjs) for the next
// call. The call that stalled is never sent again: whether the model got it
// is unknown, and the person is told so.
//
// It takes only model calls (POST /v1/messages, count_tokens, GET
// /v1/models), only with its own random secret, and sends them on only to
// the address set for the turn, with the turn's real key, never following a
// redirect. Unref'd: it never holds the CLI open.

import crypto from "node:crypto";
import http from "node:http";
import { hostOf, noteWorked, switchAfterStall } from "./routes.mjs";

const MODEL_ROUTES = new Set(["POST /v1/messages", "POST /v1/messages/count_tokens", "GET /v1/models"]);
const HOP = new Set(["host", "connection", "keep-alive", "transfer-encoding", "content-length", "authorization", "x-api-key", "proxy-authorization", "upgrade", "te", "trailer"]);

/**
 * @param {{ dir: string, stallMs?: number, idleMs?: number, fetchImpl?: typeof fetch }} o
 */
export function startRelay(o) {
  const stallMs = o.stallMs ?? Number(process.env.FOLDRUN_ROUTE_STALL_SECONDS || 90) * 1000;
  const idleMs = o.idleMs ?? Number(process.env.FOLDRUN_ROUTE_IDLE_SECONDS || 150) * 1000;
  const doFetch = o.fetchImpl ?? fetch;
  const secret = `fr-relay-${crypto.randomBytes(16).toString("hex")}`;
  /** @type {{ main: string, origin: string, key: string } | null} */
  let target = null;
  /** @type {{ from: string, to: string | null, phase: "waiting" | "reply" } | null} */
  let stall = null;

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json", "x-should-retry": "false" }).end('{"type":"error","error":{"type":"api_error","message":"koder\'s model relay failed","code":"relay_failed"}}');
      else res.destroy();
    });
  });
  const handle = async (/** @type {http.IncomingMessage} */ req, /** @type {http.ServerResponse} */ res) => {
    const refuse = (/** @type {number} */ status, /** @type {string} */ message, /** @type {string} */ code) => {
      if (res.headersSent) return void res.destroy();
      res.writeHead(status, { "content-type": "application/json", "x-should-retry": "false" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message, code } }));
    };
    const presented = Buffer.from(String(req.headers["x-api-key"] ?? String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "")));
    const want = Buffer.from(secret);
    if (presented.length !== want.length || !crypto.timingSafeEqual(presented, want)) return refuse(401, "wrong key for koder's model relay", "relay_key");
    const url = new URL(req.url ?? "/", "http://local");
    if (!MODEL_ROUTES.has(`${req.method} ${url.pathname}`)) return refuse(403, `koder's model relay passes model calls only, not ${req.method} ${url.pathname}`, "relay_route");
    const t = target;
    if (!t) return refuse(503, "koder's model relay has no address yet", "relay_unset");
    const chunks = [];
    try {
      for await (const c of req) chunks.push(c);
    } catch {
      return void res.destroy();
    }
    /** @type {Record<string, string>} */
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && typeof v === "string") headers[k] = v;
    headers.authorization = `Bearer ${t.key}`;
    const ctl = new AbortController();
    // The engine gave up (Ctrl-C, its own timeout): so does the call.
    res.on("close", () => {
      if (!res.writableEnded) ctl.abort();
    });
    /** @type {"waiting" | "reply"} */
    let phase = "waiting";
    let stalled = false;
    let timer = setTimeout(() => {
      stalled = true;
      ctl.abort();
    }, stallMs);
    const fed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        ctl.abort();
      }, idleMs);
    };
    const gaveUp = async () => {
      const to = await switchAfterStall(o.dir, t.main, t.origin, { fetchImpl: doFetch }).catch(() => null);
      stall = { from: t.origin, to, phase };
    };
    try {
      const up = await doFetch(`${t.origin}${url.pathname}${url.search}`, {
        method: req.method,
        headers,
        body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
        redirect: "error",
        signal: ctl.signal,
      });
      phase = "reply";
      fed();
      /** @type {Record<string, string>} */
      const out = {};
      up.headers.forEach((v, k) => {
        if (!["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"].includes(k)) out[k] = v;
      });
      // A refusal is read whole before the engine sees its status: an error
      // whose body then stalled would be retried by the engine on its status.
      if (!up.ok && up.body) {
        const parts = [];
        for await (const c of up.body) {
          fed();
          parts.push(c);
        }
        clearTimeout(timer);
        res.writeHead(up.status, out);
        return void res.end(Buffer.concat(parts));
      }
      res.writeHead(up.status, out);
      // Sent now, not with the first byte: once the engine has seen an
      // answer it never sends the call again, whatever happens to the body.
      res.flushHeaders();
      if (up.body) {
        for await (const c of up.body) {
          fed();
          res.write(c);
        }
      }
      clearTimeout(timer);
      res.end();
      if (up.ok) noteWorked(o.dir, t.main, t.origin);
    } catch (err) {
      clearTimeout(timer);
      if (res.destroyed && !stalled) return; // the engine left first
      const cut = stalled || /** @type {any} */ (err)?.name !== "AbortError";
      if (cut) await gaveUp();
      const s = stall;
      // The engine has seen nothing yet: a refusal it does not retry.
      if (!res.headersSent) return refuse(502, relayStallText(s), "route_stalled");
      // Mid-reply: the engine has seen part of it and will not send it again.
      res.destroy();
    }
  };
  server.unref();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`,
        secret,
        /** The address and key for the next calls. */
        set(/** @type {{ main: string, origin: string, key: string }} */ next) {
          target = next;
        },
        /** The last stall since it was read, once. */
        takeStall() {
          const s = stall;
          stall = null;
          return s;
        },
        text: relayStallText,
        close: () => server.close(),
      });
    });
  });
}

/** What the person is told after a stall: the call may have been done. */
export function relayStallText(/** @type {{ from: string, to: string | null, phase?: string } | null} */ s) {
  if (!s) return "the connection to foldrun's models was cut";
  const where = hostOf(s.from);
  const head = s.phase === "reply" ? `the reply from ${where} stopped coming` : `${where} did not answer`;
  const next = s.to ? `the next message goes through ${hostOf(s.to)}` : "`foldrun doctor` checks the road";
  return `${head} — whether the model finished this message is unknown, and it was not sent again; ${next}`;
}
