// `foldrun stop` — the run kill switch, which used to be a hand-written curl.
//
// The tests that matter are the ones where it does NOT post: no --yes on a
// pipe, and a run that already finished. A stop that fires on the wrong run
// destroys a sandbox mid-step and keeps the charge.
//
//   node --test tests/cli-stop.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, WORKSPACES } from "./fake-platform.ts";

const running = {
  id: "run-live",
  flow: "hourly",
  status: "running",
  startedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  finishedAt: null,
  steps: [
    { agent: "collector", group: 1, status: "completed", attempts: 1, costUsd: 0.4, events: [], result: "done" },
    { agent: "sender", group: 2, status: "running", attempts: 1, costUsd: 0.02, events: [], result: null, instruction: "send the outreach batch" },
  ],
};

const finished = {
  id: "run-done",
  flow: "hourly",
  status: "completed",
  startedAt: "2026-09-15T19:00:00.000Z",
  finishedAt: "2026-09-15T19:09:00.000Z",
  steps: [{ agent: "collector", group: 1, status: "completed", attempts: 1, costUsd: 0.4, events: [], result: "done" }],
};

test("stop says what it is about to destroy, then posts it", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-live": () => running,
    "POST /api/workspaces/blog-desk/runs/run-live/stop": () => ({ ok: true, runId: "run-live", status: "failed" }),
  });
  const r = await at(s.url, "stop", "run-live", "--to", "blog-desk", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /step 2 of 2 · sender/);
  assert.match(r.out, /\$0\.4200 spent/);
  assert.match(r.out, /destroys the sandbox/);
  assert.match(r.out, /stopped run-live in blog-desk — now failed/);
  assert.ok(s.seen.some((x) => x.method === "POST" && x.url.endsWith("/stop")));
});

test("stop without --yes on a pipe posts nothing", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-live": () => running,
  });
  const r = await at(s.url, "stop", "run-live", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /stopping a run needs a person/);
  assert.equal(s.seen.filter((x) => x.method === "POST").length, 0);
});

test("a run that already finished is not an error, and is not stopped", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-done": () => finished,
  });
  const r = await at(s.url, "stop", "run-done", "--to", "blog-desk", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /already finished .* ago — nothing to stop/);
  assert.equal(s.seen.filter((x) => x.method === "POST").length, 0);
});

test("without --to the workspace is found from the run id", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/rank-desk/runs/run-live": () => running,
    "POST /api/workspaces/rank-desk/runs/run-live/stop": () => ({ ok: true, runId: "run-live", status: "failed" }),
  });
  const r = await at(s.url, "stop", "run-live", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /stopped run-live in rank-desk/);
});

test("no run id at all says which command lists them", async () => {
  const r = await at("http://127.0.0.1:1", "stop");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /which run\? `foldrun stop <run-id>`/);
});
