// One door for local runs: a signed-in account's `foldrun run`, `eval` and
// `probe` send model calls through its platform's model API, not a key in
// the shell; --own-key keeps the shell's key.
//
//   node --test tests/cli-run-door.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, cli } from "./fake-platform.ts";

const me = (modelAccess: boolean) => ({ account: "acme", modelsUrl: "https://models.example.test/", actor: { id: "u1", modelAccess } });
const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-run-door-"));
const run = (url: string, extra: string[] = [], env: Record<string, string> = {}) =>
  cli(["run", "ghost", "--url", url, "--token", "k", ...extra], { cwd: folder(), env: { ANTHROPIC_API_KEY: "sk-shell", ...env } });

test("signed in with model access: the run's models go through the platform's door", async () => {
  const s = await serve({ "/v1/me": () => me(true) });
  const r = await run(s.url);
  s.close();
  assert.match(r.out, /models: through https:\/\/models\.example\.test as acme/);
  assert.ok(s.seen.some((x) => x.url.startsWith("/v1/me")), "it asked the platform");
});

test("--own-key keeps the shell's key and asks nothing", async () => {
  const s = await serve({ "/v1/me": () => me(true) });
  const r = await run(s.url, ["--own-key"]);
  s.close();
  assert.doesNotMatch(r.out, /models: through/);
  assert.ok(!s.seen.some((x) => x.url.startsWith("/v1/me")));
});

test("a sign-in without model access changes nothing: no shell key is still refused", async () => {
  const s = await serve({ "/v1/me": () => me(false) });
  const r = await run(s.url, [], { ANTHROPIC_API_KEY: "" });
  s.close();
  assert.doesNotMatch(r.out, /models: through/);
  assert.match(r.out, /no model credential/);
});

test("no key in the shell is fine when the door answers: the sign-in is the model key", async () => {
  const s = await serve({ "/v1/me": () => me(true) });
  const r = await run(s.url, [], { ANTHROPIC_API_KEY: "", CLAUDE_CODE_OAUTH_TOKEN: "" });
  s.close();
  assert.match(r.out, /models: through/);
  assert.doesNotMatch(r.out, /no model credential/);
  assert.match(r.out, /no agent or flow called "ghost"/, "it got past the credential check to the run itself");
});

test("end to end: the model API sees the sign-in as a bearer; the run itself holds only a loopback key", { timeout: 180_000 }, async () => {
  const { fakeMessagesApi } = await import("./model-credential.test.ts");
  const api = await fakeMessagesApi();
  const s = await serve({ "/v1/me": () => ({ account: "acme", modelsUrl: api.url, actor: { id: "u1", modelAccess: true } }) });
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-run-door-ws-"));
  fs.mkdirSync(path.join(ws, "agents/a"), { recursive: true });
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
  fs.writeFileSync(path.join(ws, "agents/a/agent.md"), "---\nname: a\ndescription: says done\nmodel: fast\n---\n\nSay done.\n");
  try {
    const r = await cli(["run", "a", "--workspace", ws, "--url", s.url, "--token", "sign-in-token"], {
      env: { ANTHROPIC_API_KEY: "sk-shell", FOLDRUN_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-run-door-data-")), FOLDRUN_EXECUTOR: "sandbox" },
    });
    assert.match(r.out, /models: through http:\/\/127\.0\.0\.1:\d+ as acme/, r.out);
    assert.ok(api.seen.length > 0, `the model was never called:\n${r.out}`);
    for (const call of api.seen) {
      assert.equal(call.bearer, "sign-in-token", "the forwarder adds the sign-in");
      assert.equal(call.apiKey, null, "the shell's key never reaches the model API");
    }
    const runs = path.join(ws, "runs");
    const record = fs.readFileSync(path.join(runs, fs.readdirSync(runs).find((f) => f.endsWith(".json"))!), "utf8");
    assert.ok(!record.includes("sign-in-token"), "the run's record holds no foldrun credential");
    assert.ok(!record.includes("sk-shell"));
  } finally {
    api.close();
    s.close();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("signed in but the platform refuses: the run stops, it does not go around the door", async () => {
  const s = await serve({ "/v1/me": () => ({ __status: 401, body: { error: "expired" } }) });
  const r = await run(s.url);
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--own-key/);
});

test("the loopback forwarder passes model calls only: the platform's other routes never see the sign-in", async () => {
  const { startModelForwarder } = await import("../src/commands.mjs");
  const hits: { method: string; url: string; auth: string }[] = [];
  const http = await import("node:http");
  const upstream = http.createServer((req, res) => {
    hits.push({ method: req.method ?? "", url: req.url ?? "", auth: String(req.headers.authorization ?? "") });
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
  const up = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const f = await startModelForwarder(up, "sign-in-token");
  try {
    const call = (method: string, p: string, key = f.key) => fetch(`${f.baseUrl}${p}`, { method, headers: { "x-api-key": key, "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
    assert.equal((await call("POST", "/v1/messages")).status, 200);
    assert.equal((await call("POST", "/v1/messages/count_tokens")).status, 200);
    assert.equal((await call("GET", "/v1/workspaces")).status, 403, "a platform route is refused");
    assert.equal((await call("DELETE", "/v1/keys/abc")).status, 403);
    assert.equal((await call("POST", "/v1/messages", "fr-local-wrong-key-of-the-same-len")).status, 401);
    assert.deepEqual(hits.map((h) => `${h.method} ${h.url}`), ["POST /v1/messages", "POST /v1/messages/count_tokens"], "only the model calls reached upstream");
    assert.ok(hits.every((h) => h.auth === "Bearer sign-in-token"));
  } finally {
    upstream.close();
  }
});

test("a 200 that is not the platform's answer is refused, not read as 'no model access'", async () => {
  const s = await serve({ "/v1/me": () => ({}) });
  const r = await run(s.url);
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--own-key/);
});

test("model access with no models address is refused, not sent around the door", async () => {
  const s = await serve({ "/v1/me": () => ({ account: "acme", actor: { id: "u1", modelAccess: true } }) });
  const r = await run(s.url);
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /names no models address/);
});

test("an empty --token is refused, not read as 'not signed in'", async () => {
  const r = await cli(["run", "ghost", "--token", "", "--url", "http://127.0.0.1:9"], { cwd: folder(), env: { ANTHROPIC_API_KEY: "sk-shell" } });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--token is empty/);
});

test("a bare --token with no value is refused too", async () => {
  const r = await cli(["run", "ghost", "--url", "http://127.0.0.1:9", "--token"], { cwd: folder(), env: { ANTHROPIC_API_KEY: "sk-shell" } });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--token needs a value/);
});
