// FOL-402: the address this computer calls the API at (routes.mjs), koder's
// model relay that sees a stalled call (model-relay.mjs), and moving Claude
// Code's address (claude-route.mjs).
//
//   node --test tests/cli-routes.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import * as routes from "../src/routes.mjs";
import { startRelay } from "../src/model-relay.mjs";
import * as cc from "../src/claude-route.mjs";
import { verdict } from "../src/road-probe.mjs";

const MAIN = "https://api.foldrun.dev";
const FRONT = "https://dmdw0aty3jgf6.cloudfront.net";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-routes-"));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("only a front in the CLI's own list, for that API, is approved; the environment adds loopback test fronts only", () => {
  assert.ok(routes.approved(MAIN, FRONT));
  assert.ok(routes.approved(FRONT, MAIN));
  assert.ok(!routes.approved(MAIN, "https://evil.cloudfront.net"));
  assert.ok(!routes.approved("https://api.foldrun.io", FRONT), "the dev front is not prod's");
  assert.ok(!routes.approved(MAIN, `${FRONT}:8443`));
  assert.ok(routes.approved("https://api.foldrun.io", "https://d3c69doqudkyqv.cloudfront.net"), "prod's own front (prod/terraform/iran-front.tf)");
  assert.ok(!routes.approved(MAIN, "https://d3c69doqudkyqv.cloudfront.net"), "prod's front is not dev's");
  const list = routes.frontList({ FOLDRUN_TEST_FRONTS: JSON.stringify({ "https://api.foldrun.io": ["https://evil.example"], "http://127.0.0.1:1": ["http://127.0.0.1:2"] }) });
  assert.deepEqual(list["https://api.foldrun.io"], ["https://d3c69doqudkyqv.cloudfront.net"], "no environment approves a real address");
  assert.deepEqual(list["http://127.0.0.1:1"], ["http://127.0.0.1:2"]);
});

test("a front is used only while the API has named it; the last that worked is kept", () => {
  const dir = tmp();
  const now = Date.parse("2026-11-27T00:00:00Z");
  assert.equal(routes.routeFor(dir, MAIN, now), MAIN);
  routes.noteWorked(dir, MAIN, FRONT, now);
  assert.equal(routes.routeFor(dir, MAIN, now), MAIN, "worked, but the API never named it: not used");
  assert.deepEqual(routes.noteNamed(dir, MAIN, { urls: { api: FRONT, fronts: [FRONT, "https://evil.cloudfront.net"] } }, now), [FRONT], "an unlisted front is never kept");
  assert.equal(routes.routeFor(dir, MAIN, now), FRONT);
  assert.equal(routes.routeFor(dir, MAIN, now + routes.ROUTE_TTL_MS + 1), MAIN, "old: the main name is tried again");
  assert.equal(routes.routeFor(dir, "https://api.foldrun.io", now), "https://api.foldrun.io");
  const fresh = tmp();
  assert.equal(routes.routeFor(fresh, FRONT, now), MAIN, "a profile saved at a front the API no longer names: the main name");
});

test("a stall switches the NEXT request: the fronts are asked of the API, without a credential", async () => {
  const dir = tmp();
  const asked: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    asked.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
    return json({ urls: { api: MAIN, fronts: [FRONT] } });
  }) as typeof fetch;
  assert.equal(await routes.switchAfterStall(dir, MAIN, MAIN, { fetchImpl }), FRONT);
  assert.equal(asked[0].url, `${MAIN}/v1/version`);
  assert.ok(!Object.keys(asked[0].headers).some((k) => /authorization|api-key/i.test(k)), "no credential on the question");
  assert.equal(routes.routeFor(dir, MAIN), FRONT);
  assert.equal(await routes.switchAfterStall(dir, MAIN, FRONT, { fetchImpl }), MAIN, "a stall at the front goes back to the main name");
  assert.equal(routes.routeFor(dir, FRONT), MAIN, "kept at the main name: even a call meant for the front goes there");
  const lone = tmp();
  assert.equal(await routes.switchAfterStall(lone, MAIN, MAIN, { fetchImpl: (async () => json({ urls: { api: MAIN } })) as typeof fetch }), null, "the API names no front: nowhere to go");
  assert.ok(routes.roadFailure(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })));
  assert.ok(!routes.roadFailure(new Error("the API answered 401")));
});

function upstream(handler: http.RequestListener) {
  return new Promise<{ url: string; close: () => void; seen: Array<{ auth?: string; url?: string }> }>((resolve) => {
    const seen: Array<{ auth?: string; url?: string }> = [];
    const server = http.createServer((req, res) => {
      seen.push({ auth: req.headers.authorization, url: req.url });
      handler(req, res);
    });
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => (server.closeAllConnections(), server.close()), seen }));
  });
}

test("koder's relay: its own secret only, model calls only, the real key added, a stall refused unretried and the next call moved", async () => {
  const front = await upstream((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ via: "front" }));
  });
  const main = await upstream((req, res) => {
    if (req.url === "/v1/version") {
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ urls: { api: main.url, fronts: [front.url] } }));
    }
    // A big upload into a frozen road: never answered.
  });
  const prev = process.env.FOLDRUN_TEST_FRONTS;
  process.env.FOLDRUN_TEST_FRONTS = JSON.stringify({ [main.url]: [front.url] });
  const dir = tmp();
  const relay = (await startRelay({ dir, stallMs: 300, idleMs: 300 })) as any;
  try {
    relay.set({ main: main.url, origin: main.url, key: "fr_gw_real" });
    const call = (key: string, p = "/v1/messages", method = "POST") => fetch(`${relay.baseUrl}${p}`, { method, headers: { "x-api-key": key, "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
    assert.equal((await call("wrong")).status, 401);
    assert.equal((await call(relay.secret, "/v1/keys")).status, 403, "model calls only");
    const stalled = await call(relay.secret);
    assert.equal(stalled.status, 502);
    assert.equal(stalled.headers.get("x-should-retry"), "false", "the engine must not send it again");
    const said = relay.text(relay.takeStall());
    assert.match(said, /did not answer — whether the model finished this message is unknown, and it was not sent again; the next message goes through 127\.0\.0\.1:\d+/);
    assert.equal(main.seen.filter((s) => s.url === "/v1/messages").length, 1, "sent once, never replayed");
    assert.equal(routes.routeFor(dir, main.url), front.url);
    relay.set({ main: main.url, origin: routes.routeFor(dir, main.url), key: "fr_gw_real" });
    const ok = await call(relay.secret);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { via: "front" });
    assert.equal(front.seen[0].auth, "Bearer fr_gw_real", "the real key, only to the approved front");
  } finally {
    relay.close();
    main.close();
    front.close();
    if (prev === undefined) delete process.env.FOLDRUN_TEST_FRONTS;
    else process.env.FOLDRUN_TEST_FRONTS = prev;
  }
});

test("koder's relay: headers that came before a stalled body reach the engine at once, so it does not resend", async () => {
  const main = await upstream((req, res) => {
    if (req.url === "/v1/version") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ urls: { api: main.url } }));
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.flushHeaders(); // then the body freezes
  });
  const dir = tmp();
  const relay = (await startRelay({ dir, stallMs: 2000, idleMs: 300 })) as any;
  try {
    relay.set({ main: main.url, origin: main.url, key: "k" });
    const res = await fetch(`${relay.baseUrl}/v1/messages`, { method: "POST", headers: { "x-api-key": relay.secret }, body: "{}" });
    assert.equal(res.status, 200, "the answer had begun");
    await assert.rejects(res.text(), "then cut");
    assert.equal(main.seen.filter((x) => x.url === "/v1/messages").length, 1);
    const bad = await fetch(`${relay.baseUrl}/v1/messages`, { method: "POST", headers: { "x-api-key": "é".repeat(relay.secret.length) }, body: "{}" });
    assert.equal(bad.status, 401, "a key of other bytes is refused, never a crash");
  } finally {
    relay.close();
    main.close();
  }
});

test("koder's relay: a refusal whose body stalls is answered as a stall the engine does not retry", async () => {
  const main = await upstream((req, res) => {
    if (req.url === "/v1/version") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ urls: { api: main.url } }));
    res.writeHead(529, { "content-type": "application/json" });
    res.write('{"type":"error",'); // then nothing
  });
  const relay = (await startRelay({ dir: tmp(), stallMs: 2000, idleMs: 300 })) as any;
  try {
    relay.set({ main: main.url, origin: main.url, key: "k" });
    const res = await fetch(`${relay.baseUrl}/v1/messages`, { method: "POST", headers: { "x-api-key": relay.secret }, body: "{}" });
    assert.equal(res.status, 502);
    assert.equal(res.headers.get("x-should-retry"), "false");
  } finally {
    relay.close();
    main.close();
  }
});

test("the road verdict says Iran's filter only for small-passes, big-stalls on one address while another completes", () => {
  const ok = { ok: true };
  const stalled = { ok: false, stalled: true };
  const refused = { ok: false, stalled: false };
  assert.equal(verdict([{ route: "a", small: ok, down: stalled, up: ok, ok: false }, { route: "b", small: ok, down: ok, up: ok, ok: true }]).kind, "filter");
  assert.equal(verdict([{ route: "a", small: ok, down: stalled, up: ok, ok: false }]).kind, "broken", "no other address to compare: not claimed");
  assert.equal(verdict([{ route: "a", small: ok, down: refused, up: ok, ok: false }, { route: "b", small: ok, down: ok, up: ok, ok: true }]).kind, "broken", "a refusal is not a stall");
  assert.equal(verdict([{ route: "a", small: refused, down: refused, up: refused, ok: false }]).kind, "unreachable");
});

// ------------------------------------------------- Claude Code's address

const KEY = `fr_gw_${"a".repeat(48)}`;
function claudeHome(settings: unknown) {
  const dir = tmp();
  const file = path.join(dir, "claude", "settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return { dir, file };
}
const named = (async () => json({ urls: { api: FRONT, gateway: FRONT, fronts: [FRONT] }, notice: { id: "n1", message: "Iran's filter blocked our old address‮" } })) as typeof fetch;
const ours = { env: { ANTHROPIC_BASE_URL: MAIN, ANTHROPIC_AUTH_TOKEN: KEY }, statusLine: { type: "command", command: cc.STATUS_LINE_COMMAND }, theme: "dark" };

test("Claude Code: our own settings (the record) move to the named front, the rest kept, takes effect next start", async () => {
  const { dir, file } = claudeHome(ours);
  cc.writeOwnership(dir, { file, baseUrl: MAIN, key: KEY });
  const r = await cc.checkClaudeRoute({ dir, file, env: { ANTHROPIC_BASE_URL: MAIN }, fetchImpl: named, managed: [] });
  assert.equal(r.moved, FRONT);
  assert.match(r.said, /moved to dmdw0aty3jgf6\.cloudfront\.net — takes effect at the next Claude Code start/);
  assert.equal(cc.noticeWords(r.notice), "Iran's filter blocked our old address", "no bidi control reaches the line");
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(after.env.ANTHROPIC_BASE_URL, FRONT);
  assert.equal(after.env.ANTHROPIC_AUTH_TOKEN, KEY);
  assert.equal(after.theme, "dark");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(cc.readOwnership(dir).baseUrl, FRONT, "the record follows the move");
  // Throttled: asked again only after 10 minutes.
  let asked = 0;
  const counting = (async () => (asked++, json({ urls: { api: FRONT } }))) as typeof fetch;
  await cc.checkClaudeRoute({ dir, file, env: { ANTHROPIC_BASE_URL: MAIN }, fetchImpl: counting, managed: [], now: Date.now() + 60_000 });
  assert.equal(asked, 0);
  await cc.checkClaudeRoute({ dir, file, env: { ANTHROPIC_BASE_URL: MAIN }, fetchImpl: counting, managed: [], now: Date.now() + cc.CHECK_MS + 1 });
  assert.equal(asked, 1);
});

test("Claude Code: a legacy install moves only on clear evidence", async () => {
  const legacy = claudeHome(ours);
  assert.equal((await cc.checkClaudeRoute({ ...legacy, env: { ANTHROPIC_BASE_URL: MAIN }, fetchImpl: named, managed: [] })).moved, FRONT, "our status line, a listed address, a foldrun key");
  for (const settings of [
    { ...ours, statusLine: { type: "command", command: "my-own-line" } },
    { ...ours, env: { ...ours.env, ANTHROPIC_AUTH_TOKEN: "sk-ant-someone-else" } },
    { ...ours, env: { ...ours.env, ANTHROPIC_API_KEY: "x" } },
  ]) {
    const h = claudeHome(settings);
    const before = fs.readFileSync(h.file, "utf8");
    assert.equal((await cc.checkClaudeRoute({ ...h, env: { ANTHROPIC_BASE_URL: MAIN }, fetchImpl: named, managed: [] })).moved, undefined);
    assert.equal(fs.readFileSync(h.file, "utf8"), before, "left as it was");
  }
});

test("Claude Code: not moved when a shell variable or managed settings set the address, or the file is locked, or a record disagrees", async () => {
  const shell = claudeHome(ours);
  assert.equal((await cc.checkClaudeRoute({ ...shell, env: { ANTHROPIC_BASE_URL: FRONT.replace("dmdw0aty3jgf6", "x") }, fetchImpl: named, managed: [] })).moved, undefined);
  const elsewhere = claudeHome({ ...ours, env: { ...ours.env, ANTHROPIC_BASE_URL: "https://api.foldrun.io" } });
  assert.equal((await cc.checkClaudeRoute({ ...elsewhere, env: { ANTHROPIC_BASE_URL: MAIN }, fetchImpl: named, managed: [] })).moved, undefined, "Claude Code was handed another address than the file's");
  const managed = claudeHome(ours);
  const mfile = path.join(managed.dir, "managed-settings.json");
  fs.writeFileSync(mfile, JSON.stringify({ env: { ANTHROPIC_BASE_URL: MAIN } }));
  assert.equal(cc.moveSettings({ ...managed, from: MAIN, to: FRONT, managed: [mfile] }), false);
  const locked = claudeHome(ours);
  fs.writeFileSync(`${locked.file}.foldrun-lock`, "1");
  assert.equal(cc.moveSettings({ ...locked, from: MAIN, to: FRONT, managed: [] }), false, "another writer holds it");
  const other = claudeHome(ours);
  cc.writeOwnership(other.dir, { file: other.file, baseUrl: MAIN, key: `fr_gw_${"b".repeat(48)}` });
  assert.equal(cc.moveSettings({ ...other, from: MAIN, to: FRONT, managed: [] }), false, "the record is for another key: someone changed it");
  const unlisted = claudeHome(ours);
  const evil = (async () => json({ urls: { api: "https://evil.cloudfront.net", gateway: "https://evil.cloudfront.net" } })) as typeof fetch;
  assert.equal((await cc.checkClaudeRoute({ ...unlisted, env: { ANTHROPIC_BASE_URL: MAIN }, fetchImpl: evil, managed: [] })).moved, undefined, "an address not in the CLI's list is never written");
});

test("Claude Code: a failed check is retried after a minute, not ten", async () => {
  const { dir, file } = claudeHome(ours);
  let asked = 0;
  const down = (async () => {
    asked++;
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const t = Date.now();
  await cc.checkClaudeRoute({ dir, file, env: { ANTHROPIC_BASE_URL: MAIN }, fetchImpl: down, managed: [], now: t });
  const first = asked;
  await cc.checkClaudeRoute({ dir, file, env: { ANTHROPIC_BASE_URL: MAIN }, fetchImpl: down, managed: [], now: t + 30_000 });
  assert.equal(asked, first);
  await cc.checkClaudeRoute({ dir, file, env: { ANTHROPIC_BASE_URL: MAIN }, fetchImpl: down, managed: [], now: t + cc.RETRY_MS + 1 });
  assert.ok(asked > first);
});

test("a profile signed in at the dashboard has its API's fronts, and the dashboard is never a gateway (28 Nov 2026)", async () => {
  const DASH = "https://dash.foldrun.dev";
  assert.equal(routes.apiOf(DASH), MAIN);
  assert.equal(routes.apiOf(`${DASH}/`), MAIN);
  assert.equal(routes.apiOf("https://example.com"), "https://example.com");
  assert.equal(routes.approved(DASH, FRONT), true, "the setup signs in at the dashboard: the API's front is approved for it");
  assert.equal(routes.approved(DASH, "https://evil.cloudfront.net"), false);
  assert.equal(routes.approved("https://dash.foldrun.io", FRONT), false, "dev's front is not prod's");
  // Claude Code settings a CLI wrote with the dashboard as the gateway move to what the API names.
  const { dir, file } = claudeHome({ ...ours, env: { ANTHROPIC_BASE_URL: DASH, ANTHROPIC_AUTH_TOKEN: KEY } });
  cc.writeOwnership(dir, { file, baseUrl: DASH, key: KEY });
  const r = await cc.checkClaudeRoute({ dir, file, env: { ANTHROPIC_BASE_URL: DASH }, fetchImpl: named, managed: [] });
  assert.equal(r.moved, FRONT);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).env.ANTHROPIC_BASE_URL, FRONT);
  // Outside Iran the API names itself: the dashboard address moves to the API.
  const home = claudeHome({ ...ours, env: { ANTHROPIC_BASE_URL: DASH, ANTHROPIC_AUTH_TOKEN: KEY } });
  cc.writeOwnership(home.dir, { file: home.file, baseUrl: DASH, key: KEY });
  const plain = (async () => json({ urls: { api: MAIN, gateway: MAIN } })) as typeof fetch;
  assert.equal((await cc.checkClaudeRoute({ dir: home.dir, file: home.file, env: { ANTHROPIC_BASE_URL: DASH }, fetchImpl: plain, managed: [] })).moved, MAIN);
});

test("foldrun's own platforms use only their API or its listed fronts as the model address (28 Nov 2026)", () => {
  const PROD = "https://api.foldrun.io", PFRONT = "https://d3c69doqudkyqv.cloudfront.net";
  for (const profile of [PROD, "https://dash.foldrun.io"]) {
    assert.equal(routes.modelOrigin(profile, PFRONT), PFRONT, "the listed front");
    assert.equal(routes.modelOrigin(profile, PROD), PROD);
    assert.equal(routes.modelOrigin(profile, `${PROD}/`), PROD);
    assert.equal(routes.modelOrigin(profile, "https://dash.foldrun.io"), PROD, "never the dashboard");
    assert.equal(routes.modelOrigin(profile, "https://evil.example"), PROD, "another host the server names is refused");
    assert.equal(routes.modelOrigin(profile, "http://evil.example"), PROD, "not https");
    assert.equal(routes.modelOrigin(profile, "https://other.cloudfront.net"), PROD, "an unlisted front");
    assert.equal(routes.modelOrigin(profile, FRONT), PROD, "dev's front is not prod's");
    assert.equal(routes.modelOrigin(profile, "https://api.foldrun.dev"), PROD, "another platform");
  }
  // Self-hosted: the platform's own choice, but never an unlisted front.
  assert.equal(routes.modelOrigin("https://foldrun.acme.test", "https://models.acme.test/"), "https://models.acme.test");
  assert.equal(routes.modelOrigin("https://foldrun.acme.test", "https://x.cloudfront.net"), "https://foldrun.acme.test");
});
