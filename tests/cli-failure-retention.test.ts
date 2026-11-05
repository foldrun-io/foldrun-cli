// FOL-124 on the CLI: a failed run says why — the sentence and the fix the
// dashboard and the API give — in `foldrun report` and `foldrun runs`; and
// `foldrun runs rm --until` erases run content sooner than the retention
// window, through the bulk route's delete, asking first.
//
//   node --test tests/cli-failure-retention.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, WORKSPACES } from "./fake-platform.ts";

const FAILURE = {
  agent: "writer",
  reason: "sandbox ended: OOMKilled (exit 137)",
  class: "oom",
  kind: "memory",
  message: "The step ran out of memory. Memory limit: 4 GiB; last recorded peak: 3.9 GiB.",
  fix: "Give it more with a larger size: (large, heavy) or resources: { memory: … }.",
  used: 3.9,
  allowed: 4,
  unit: "GiB",
  scope: "step",
};
const RUN = { id: "run-x", flow: "daily", status: "failed", startedAt: "2026-11-04T09:00:00Z", finishedAt: "2026-11-04T09:01:00Z", steps: [{ agent: "writer", status: "failed", events: [{ type: "error", text: FAILURE.reason }] }], failure: FAILURE };

test("report prints why a run failed and what to do, beside the step's own words", async () => {
  const s = await serve({ "/api/workspaces": () => WORKSPACES, "/api/workspaces/blog-desk/runs/run-x": () => RUN });
  const r = await at(s.url, "report", "run-x", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 1, "a failed run exits 1");
  const flat = r.out.replace(/\s+/g, " ");
  assert.match(flat, /writer: The step ran out of memory\. Memory limit: 4 GiB; last recorded peak: 3\.9 GiB\./);
  assert.match(flat, /fix: Give it more with a larger size:/);
  assert.match(r.out, /OOMKilled/, "the step's own error is still shown");
});

test("report from a platform before FOL-124 (no failure on one run) prints as before", async () => {
  const { failure: _f, ...old } = RUN;
  const s = await serve({ "/api/workspaces": () => WORKSPACES, "/api/workspaces/blog-desk/runs/run-x": () => old });
  const r = await at(s.url, "report", "run-x", "--to", "blog-desk");
  s.close();
  assert.doesNotMatch(r.out, /fix:/);
  assert.match(r.out, /OOMKilled/);
});

test("runs lists a failed run with its sentence; an older platform's row with its reason", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/runs": () => ({ runs: [RUN, { ...RUN, id: "run-old", failure: { agent: "editor", reason: "exit code 2" } }], next: null }),
  });
  const r = await at(s.url, "runs", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /✗ writer: The step ran out of memory\. Memory limit: 4 GiB/);
  assert.match(r.out, /✗ editor: exit code 2/);
});

test("runs rm --until counts what would go, asks, then deletes a workspace's runs until none match", async () => {
  let left = 150;
  const bodies: { action: string; until: string; dryRun?: boolean }[] = [];
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "POST /api/workspaces/blog-desk/runs/bulk": (body) => {
      const b = JSON.parse(body);
      bodies.push(b);
      const share = Math.min(100, left);
      if (b.dryRun) return { ok: true, dryRun: true, action: "delete", matched: Array.from({ length: share }, (_, i) => `r${i}`), remaining: left - share };
      left -= share;
      return { ok: true, action: "delete", matched: share, succeeded: share, failed: 0, remaining: left, runs: [] };
    },
    "POST /api/workspaces/rank-desk/runs/bulk": () => ({ ok: true, dryRun: true, action: "delete", matched: [], remaining: 0 }),
  });
  const dry = await at(s.url, "runs", "rm", "--until", "30d", "--dry-run");
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /blog-desk\s+150 finished runs/);
  assert.match(dry.out, /150 runs started before .* would be deleted; nothing touched/);
  const asked = await at(s.url, "runs", "rm", "--until", "30d");
  assert.notEqual(asked.code, 0, "no terminal and no --yes: nothing deleted");
  assert.equal(left, 150);
  const r = await at(s.url, "runs", "rm", "--until", "2026-08-01", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(left, 0, "asked again until nothing matched");
  assert.match(r.out, /150 deleted/);
  const real = bodies.filter((b) => !b.dryRun);
  assert.equal(real.length, 2, "100, then 50");
  assert.ok(real.every((b) => b.action === "delete" && b.until === "2026-08-01T00:00:00.000Z"), JSON.stringify(real));
  const thirty = Date.parse(bodies[0].until);
  assert.ok(Math.abs(Date.now() - 30 * 86_400_000 - thirty) < 120_000, "30d is thirty days ago");
});

test("runs rm takes ids or --until, not both", async () => {
  const s = await serve({});
  const r = await at(s.url, "runs", "rm", "run-x", "--until", "30d");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /not both/);
});
