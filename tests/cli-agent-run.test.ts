// `foldrun agent run` — one agent, once, on the platform. No flow file.
//
// Two shapes: queued, where the answer is a run id and how to follow it, and
// --wait, where the CLI holds on in short pieces and then prints the same
// report `foldrun report` prints. The second matters because a waited run
// that FAILS comes back as HTTP 500 with the whole record — the answer to the
// question, not a broken platform — and a CLI that throws on it tells the
// reader to go hunting for an outage that never happened.
//
//   node --test tests/cli-agent-run.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, failing, WORKSPACES } from "./fake-platform.ts";

const RUN = "/api/workspaces/rank-desk/agents/tracker/run";

const record = (status: string) => ({
  id: "run-adhoc-1",
  flow: "adhoc:tracker",
  status,
  startedAt: "2026-09-16T01:00:00.000Z",
  finishedAt: "2026-09-16T01:02:00.000Z",
  summary: "Four targets slipped this week.",
  steps: [
    {
      agent: "tracker",
      group: 1,
      status: status === "completed" ? "completed" : "failed",
      attempts: 1,
      costUsd: 0.12,
      events: [],
      result: "Four targets slipped this week.",
      startedAt: "2026-09-16T01:00:00.000Z",
      finishedAt: "2026-09-16T01:02:00.000Z",
    },
  ],
});

test("queued: the run id, and the two ways to follow it", async () => {
  const s = await serve({ [`POST ${RUN}`]: () => ({ ok: true, runId: "run-adhoc-1", test: false }) });
  const r = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "check the target list");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /✓ queued run-adhoc-1\s+tracker · rank-desk/);
  assert.match(r.out, /foldrun report run-adhoc-1 --to rank-desk/);
  assert.match(r.out, /foldrun logs run-adhoc-1 --to rank-desk --follow/);
  const body = JSON.parse(s.seen.find((x) => x.method === "POST")!.body);
  assert.equal(body.task, "check the target list");
  assert.equal(body.test, undefined);
});

test("--test marks the run a test run, the way invoke does", async () => {
  const s = await serve({ [`POST ${RUN}`]: () => ({ ok: true, runId: "run-adhoc-1", test: true }) });
  const r = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "dry it", "--test");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /TEST/);
  assert.equal(JSON.parse(s.seen.find((x) => x.method === "POST")!.body).test, true);
});

test("--wait polls through a 202 and then prints the report", async () => {
  let asked = 0;
  const s = await serve({
    [`POST ${RUN}`]: () => ({ ok: false, runId: "run-adhoc-1", status: "running", timedOut: true, steps: [] }),
    // Two more 202s, then the finished run — and finally the full record,
    // which is what `report` asks for once the waiting is over.
    "/api/workspaces/rank-desk/runs/run-adhoc-1": (_body, query) =>
      query.get("wait") === "true" && ++asked === 1
        ? { ok: false, runId: "run-adhoc-1", status: "running", timedOut: true, steps: [] }
        : record("completed"),
  });
  const r = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "go", "--wait");
  s.close();
  assert.equal(r.code, 0, r.out);
  // The wait is asked in pieces, not one long request.
  assert.ok(s.seen.filter((x) => x.query.get("wait") === "true").length >= 3, r.out);
  // …and the last question is the report's own, unwaited.
  assert.match(r.out, /adhoc:tracker\s+run-adhoc-1/);
  assert.match(r.out, /Four targets slipped this week/);
});

test("--wait on a run that FAILS reports the run, not a broken platform", async () => {
  const s = await serve({
    [`POST ${RUN}`]: () => failing(500, { ok: false, runId: "run-adhoc-1", status: "failed", steps: [{ agent: "tracker", status: "failed" }] }),
    "/api/workspaces/rank-desk/runs/run-adhoc-1": () => record("failed"),
  });
  const r = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "go", "--wait");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /failed/);
  assert.doesNotMatch(r.out, /HTTP 500/);
});

test("no --task is refused before anything is started", async () => {
  const s = await serve({ [`POST ${RUN}`]: () => ({ ok: true, runId: "x" }) });
  const r = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /what should tracker do\?/);
  assert.equal(s.seen.filter((x) => x.method === "POST").length, 0);
});

test("agent new still works, and an unknown verb names both", async () => {
  const s = await serve({ "/api/workspaces": () => WORKSPACES });
  const r = await at(s.url, "agent", "wibble", "tracker", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /new, run are the verbs, not "wibble"/);
});
