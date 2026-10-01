// The API conventions from the CLI's side: every call says which API
// version it was written for, every write carries one Idempotency-Key that
// its own retry reuses, a 429 is waited out once, and `foldrun api spec`
// saves the platform's OpenAPI document.
//
//   node --test tests/cli-api-standards.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, at, raw, WORKSPACES } from "./fake-platform.ts";
import { API_VERSION } from "../src/commands.mjs";

const running = {
  id: "run-live",
  flow: "hourly",
  status: "running",
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  finishedAt: null,
  steps: [{ agent: "sender", group: 1, status: "running", attempts: 1, costUsd: 0.01, events: [], result: null }],
};

const limited = () => raw(JSON.stringify({ error: "rate limit: this API key may make 60 writes a minute — retry in 0s", retry_after: 0 }), "application/json", { "retry-after": "0", "x-ratelimit-limit": "60" }, 429);

test("the API version this CLI was built for goes out on every call", async () => {
  assert.match(API_VERSION, /^\d{4}-\d{2}-\d{2}$/);
  const s = await serve({ "/api/workspaces": () => WORKSPACES, "/api/workspaces/blog-desk/runs/run-live": () => running, "POST /api/workspaces/blog-desk/runs/run-live/stop": () => ({ ok: true, runId: "run-live", status: "failed" }) });
  const r = await at(s.url, "stop", "run-live", "--to", "blog-desk", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.ok(s.seen.length > 0);
  for (const x of s.seen) assert.equal(x.headers["foldrun-version"], API_VERSION, `${x.method} ${x.url}`);
  const post = s.seen.find((x) => x.method === "POST")!;
  assert.match(String(post.headers["idempotency-key"]), /^[0-9a-f-]{36}$/, "a write carries an Idempotency-Key");
  assert.equal(s.seen.find((x) => x.method === "GET")!.headers["idempotency-key"], undefined, "a read does not");
});

test("a 429 is waited out once, and the retry reuses the same Idempotency-Key", async () => {
  let n = 0;
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-live": () => running,
    "POST /api/workspaces/blog-desk/runs/run-live/stop": () => (++n === 1 ? limited() : { ok: true, runId: "run-live", status: "failed" }),
  });
  const r = await at(s.url, "stop", "run-live", "--to", "blog-desk", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  const posts = s.seen.filter((x) => x.method === "POST");
  assert.equal(posts.length, 2, "asked twice");
  assert.equal(posts[0].headers["idempotency-key"], posts[1].headers["idempotency-key"], "one key per invocation");
});

test("a second 429 is a clear message, not a loop", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-live": () => running,
    "POST /api/workspaces/blog-desk/runs/run-live/stop": limited,
  });
  const r = await at(s.url, "stop", "run-live", "--to", "blog-desk", "--yes");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /rate limit/);
  assert.match(r.out, /already waited once/);
  assert.equal(s.seen.filter((x) => x.method === "POST").length, 2, "one retry, then stop");
});

test("api spec: stdout, or --out <file>", async () => {
  const doc = { openapi: "3.1.0", info: { title: "foldrun API", version: "2026-10-01" }, paths: { "/api/healthz": { get: {} }, "/api/keys": { get: {}, post: {} } } };
  const s = await serve({ "/api/openapi.json": () => doc });
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-spec-")), "openapi.json");
  const r = await at(s.url, "api", "spec", "--out", out);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, "utf8")), doc);
  assert.match(r.out, /2 paths, 3 operations/);
  const piped = await at(s.url, "api", "spec");
  s.close();
  assert.deepEqual(JSON.parse(piped.out), doc);
  const bad = await at(s.url, "api", "nope");
  assert.equal(bad.code, 1);
});
