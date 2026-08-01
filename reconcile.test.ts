// Closing out runs abandoned by a process that is gone.
//
// Runs execute in the server process and nothing writes a terminal status when
// that process goes away, so a deploy or a crash mid-run left `running` on
// disk forever. Those entries are not stale, they are false: the dashboard
// renders them as live and nothing distinguishes them from a step that is
// genuinely still thinking.
//
//   node --test tests/reconcile.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reconcileRuns } from "../packages/core/src/runner.ts";

const HOUR = 60 * 60 * 1000;

/** A workspace with one run on disk, and core pointed at it. */
function withRun(run: unknown, body: (now: number) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdagent-reconcile-"));
  const previous = process.env.MDAGENT_DATA;
  process.env.MDAGENT_DATA = root;
  try {
    const ws = path.join(root, "acme/workspaces/desk");
    fs.mkdirSync(path.join(ws, "runs"), { recursive: true });
    fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
    fs.writeFileSync(
      path.join(ws, "runs", `${(run as { id: string }).id}.json`),
      JSON.stringify(run, null, 2),
    );
    body(Date.now());
  } finally {
    if (previous === undefined) delete process.env.MDAGENT_DATA;
    else process.env.MDAGENT_DATA = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const read = (id: string) => {
  const f = path.join(process.env.MDAGENT_DATA!, "acme/workspaces/desk/runs", `${id}.json`);
  return JSON.parse(fs.readFileSync(f, "utf8"));
};

const step = (agent: string, status: string, at?: number) => ({
  agent,
  instruction: "do the thing",
  group: 1,
  optional: false,
  status,
  events: at ? [{ t: new Date(at).toISOString(), type: "text", text: "working" }] : [],
  result: null,
  costUsd: null,
});

test("an abandoned run is closed, and says why", () => {
  const started = Date.now() - 3 * HOUR;
  withRun(
    {
      id: "r1",
      flow: "publish",
      status: "running",
      startedAt: new Date(started).toISOString(),
      finishedAt: null,
      steps: [step("writer", "completed", started), step("checker", "running", started)],
    },
    (now) => {
      const closed = reconcileRuns("acme", now);
      assert.equal(closed.length, 1);
      assert.deepEqual(closed[0].interrupted, ["checker"]);

      const run = read("r1");
      assert.equal(run.status, "failed");
      assert.ok(run.finishedAt, "a closed run must have an end");
      assert.equal(run.steps[0].status, "completed", "finished work is not rewritten");
      assert.equal(run.steps[1].status, "failed");
      assert.match(
        run.steps[1].events.at(-1).text,
        /went away before it finished/,
        "the trace must say what happened, not just that it failed",
      );
    },
  );
});

test("steps that never started are skipped, not failed", () => {
  // They did not fail — nothing ran them. Saying "failed" would send someone
  // looking for a defect in an agent that was never invoked.
  const started = Date.now() - 3 * HOUR;
  withRun(
    {
      id: "r2",
      flow: "publish",
      status: "running",
      startedAt: new Date(started).toISOString(),
      finishedAt: null,
      steps: [step("writer", "running", started), step("checker", "pending")],
    },
    (now) => {
      reconcileRuns("acme", now);
      const run = read("r2");
      assert.equal(run.steps[1].status, "skipped");
      assert.match(run.steps[1].skipReason, /interrupted before this step started/);
    },
  );
});

test("a run with recent activity is left alone", () => {
  // The protection is an idle window, not a lock, so this has to be safe to
  // call while real runs are in flight — a slow model call is not a dead one.
  const started = Date.now() - 3 * HOUR;
  withRun(
    {
      id: "r3",
      flow: "publish",
      status: "running",
      startedAt: new Date(started).toISOString(),
      finishedAt: null,
      steps: [step("writer", "running", Date.now() - 60_000)], // a minute ago
    },
    (now) => {
      assert.deepEqual(reconcileRuns("acme", now), []);
      assert.equal(read("r3").status, "running");
    },
  );
});

test("awaiting-approval survives a restart untouched", () => {
  // Waiting for a person legitimately outlives any process. This is the one
  // status that must not be reconciled away.
  const started = Date.now() - 5 * HOUR;
  withRun(
    {
      id: "r4",
      flow: "sign-off",
      status: "awaiting-approval",
      startedAt: new Date(started).toISOString(),
      finishedAt: null,
      steps: [step("publisher", "awaiting-approval", started)],
    },
    (now) => {
      assert.deepEqual(reconcileRuns("acme", now), []);
      const run = read("r4");
      assert.equal(run.status, "awaiting-approval");
      assert.equal(run.steps[0].status, "awaiting-approval");
    },
  );
});

test("finished runs are never touched", () => {
  const started = Date.now() - 5 * HOUR;
  for (const status of ["completed", "failed"]) {
    withRun(
      {
        id: `r-${status}`,
        flow: "publish",
        status,
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date(started + 1000).toISOString(),
        steps: [step("writer", status === "completed" ? "completed" : "failed", started)],
      },
      (now) => {
        assert.deepEqual(reconcileRuns("acme", now), []);
        assert.equal(read(`r-${status}`).status, status);
      },
    );
  }
});
