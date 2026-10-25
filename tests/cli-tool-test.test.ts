// `foldrun tool test` — one tool, exercised alone, before a flow depends on it.
//
// The three answers that matter are the three a developer actually meets: it
// works, it ran and failed with something on stderr, and it could not run
// because a secret was never set. The third is the one worth printing by
// NAME — "which one didn't you set" is the useful half — and the CLI must
// never print a value it was not sent.
//
//   node --test tests/cli-tool-test.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, at, cli } from "./fake-platform.ts";

const route = "POST /api/workspaces/rank-desk/tools/serp_check/test";

test("a tool that works prints its transport, its time and what it printed", async () => {
  const s = await serve({
    [route]: () => ({
      ok: true,
      transport: "script",
      summary: "exited 0",
      detail: "ran from agents/tracker/, where a run runs\n\n{\"rank\": 4}",
      ms: 1840,
      missingSecrets: [],
    }),
  });
  const r = await at(s.url, "tool", "test", "serp_check", "--to", "rank-desk", "keyword=building inspection");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /✓ serp_check\s+script · rank-desk · 1s/);
  assert.match(r.out, /exited 0/);
  assert.match(r.out, /"rank": 4/);
  assert.match(r.out, /it works — a flow can depend on it/);

  // key=value pairs reach the platform as args, unsplit on the value's space.
  const body = JSON.parse(s.seen.find((x) => x.method === "POST")!.body);
  assert.deepEqual(body.args, { keyword: "building inspection" });
});

test("a tool that fails says so, prints stderr, and exits 1", async () => {
  const s = await serve({
    [route]: () => ({
      ok: false,
      transport: "script",
      summary: "exited 2",
      detail: "ran from agents/tracker/, where a run runs\n\nTraceback…\nKeyError: 'tasks'",
      ms: 620,
      missingSecrets: [],
    }),
  });
  const r = await at(s.url, "tool", "test", "serp_check", "--to", "rank-desk", "keyword=x");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /✗ serp_check/);
  assert.match(r.out, /exited 2/);
  assert.match(r.out, /KeyError: 'tasks'/);
  assert.match(r.out, /not working yet/);
});

test("a missing secret is named, never valued, and told how to set", async () => {
  const s = await serve({
    [route]: () => ({
      ok: false,
      transport: "http",
      summary: "GET /v3/serp → 401, but sent without DATAFORSEO_KEY",
      detail: "unset secrets: DATAFORSEO_KEY",
      ms: 210,
      missingSecrets: ["DATAFORSEO_KEY"],
    }),
  });
  const r = await at(s.url, "tool", "test", "serp_check", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /DATAFORSEO_KEY is not set — foldrun secrets set DATAFORSEO_KEY/);
  assert.match(r.out, /401/);
  // A tool that takes arguments and got none is told so.
  assert.match(r.out, /key=value/);
});

test("an http tool's probe path rides along as path:", async () => {
  const s = await serve({
    [route]: () => ({ ok: true, transport: "http", summary: "GET /v3/status → 200 OK", detail: "{}", ms: 90, missingSecrets: [] }),
  });
  const r = await at(s.url, "tool", "test", "serp_check", "--to", "rank-desk", "--path", "/v3/status");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(s.seen.find((x) => x.method === "POST")!.body).path, "/v3/status");
});

test("a bare word instead of key=value is refused before anything is posted", async () => {
  const s = await serve({ [route]: () => ({ ok: true, transport: "script", summary: "", detail: "", ms: 1, missingSecrets: [] }) });
  const r = await at(s.url, "tool", "test", "serp_check", "--to", "rank-desk", "keyword");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /is not an argument/);
  assert.equal(s.seen.filter((x) => x.method === "POST").length, 0);
});

test("a tool with no name says what to type", async () => {
  const s = await serve({});
  const r = await at(s.url, "tool", "test");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /which tool\?/);
});

test("standing in a workspace folder is enough; standing nowhere asks", async () => {
  const s = await serve({
    "POST /api/workspaces/rank-desk/tools/serp_check/test": () => ({
      ok: true, transport: "script", summary: "exited 0", detail: "", ms: 12, missingSecrets: [],
    }),
  });

  // A flat workspace folder names itself.
  const desk = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-flat-"));
  const ws = path.join(desk, "rank-desk");
  fs.mkdirSync(path.join(ws, "agents", "tracker"), { recursive: true });
  fs.writeFileSync(path.join(ws, "agents", "tracker", "agent.md"), "---\nname: tracker\n---\n\nYou track.\n");
  const here = await cli(["tool", "test", "serp_check", "--url", s.url, "--token", "k"], { cwd: ws });
  assert.equal(here.code, 0, here.out);
  assert.match(here.out, /rank-desk/);

  // An empty folder is not a workspace, so it has to be told which one.
  const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-nowhere-"));
  const away = await cli(["tool", "test", "serp_check", "--url", s.url, "--token", "k"], { cwd: nowhere });
  s.close();
  fs.rmSync(desk, { recursive: true, force: true });
  fs.rmSync(nowhere, { recursive: true, force: true });
  assert.equal(away.code, 1, away.out);
  assert.match(away.out, /which workspace/);
});

test("tool new still works, and an unknown verb names both", async () => {
  const s = await serve({});
  const r = await at(s.url, "tool", "wibble", "serp_check", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /new, test are the verbs, not "wibble"/);
});
