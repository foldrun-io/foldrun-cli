// FOL-106: `--wait` on a run that fails says it failed, and why.
//
// The platform now answers a waited run that failed on its own terms with 200
// — `{ ok: false, status: "failed", failure: { agent, reason } }` — where it
// used to answer 500 with the same record. `invoke --wait` printed "✗ failed"
// and nothing about why; it now prints the reason, and exits 1 either way. A
// platform from before (500) is read the same.
//
//   node --test tests/cli-wait-failed.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, failing } from "./fake-platform.ts";

const FLOW = "/api/workspaces/blog-desk/flows/daily/run";
const AGENT = "/api/workspaces/blog-desk/agents/writer/run";
const REASON = "no model key: this account runs on its own API key, and none is set — add one in Settings → Model";
const failed = { ok: false, runId: "run-f1", status: "failed", result: null, failure: { agent: "writer", reason: REASON }, costUsd: 0, steps: [{ agent: "writer", status: "failed", skipReason: null }] };

test("invoke --wait: a 200 failed run prints the step, the reason and how to read it, and exits 1", async () => {
  const s = await serve({ [`POST ${FLOW}`]: () => failed });
  const r = await at(s.url, "invoke", "daily", "--to", "blog-desk", "--wait");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /why writer\s+no model key: this account runs on its own API key/);
  assert.match(r.out, /✗ writer\s+failed/);
  assert.match(r.out, /✗ failed .*foldrun logs run-f1 --to blog-desk/);
  assert.doesNotMatch(r.out, /HTTP \d{3}/);
});

test("invoke --wait: a platform from before FOL-106 (500 with the record) reads the same", async () => {
  const s = await serve({ [`POST ${FLOW}`]: () => failing(500, failed) });
  const r = await at(s.url, "invoke", "daily", "--to", "blog-desk", "--wait");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /why writer\s+no model key/);
  assert.doesNotMatch(r.out, /HTTP 500/);
});

test("invoke --wait: a completed run is still ✓ and exit 0", async () => {
  const s = await serve({ [`POST ${FLOW}`]: () => ({ ok: true, runId: "run-ok", status: "completed", result: "All done.", failure: null, costUsd: 0.01, steps: [{ agent: "writer", status: "completed" }] }) });
  const r = await at(s.url, "invoke", "daily", "--to", "blog-desk", "--wait");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /All done\./);
  assert.match(r.out, /✓ completed/);
  assert.doesNotMatch(r.out, /why/);
});

test("agent run --wait: a 200 failed run is reported from the record, exit 1", async () => {
  const s = await serve({
    [`POST ${AGENT}`]: () => failed,
    "/api/workspaces/blog-desk/runs/run-f1": () => ({
      id: "run-f1",
      flow: "adhoc:writer",
      status: "failed",
      startedAt: "2026-10-29T01:00:00.000Z",
      finishedAt: "2026-10-29T01:00:01.000Z",
      steps: [{ agent: "writer", group: 1, status: "failed", attempts: 1, events: [{ t: "2026-10-29T01:00:01.000Z", type: "error", text: REASON }], startedAt: "2026-10-29T01:00:00.000Z", finishedAt: "2026-10-29T01:00:01.000Z" }],
    }),
  });
  const r = await at(s.url, "agent", "run", "writer", "--to", "blog-desk", "--task", "go", "--wait");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /adhoc:writer\s+run-f1/);
  assert.match(r.out, /no model key/);
  assert.doesNotMatch(r.out, /HTTP \d{3}/);
});
