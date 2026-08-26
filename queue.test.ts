// The run queue: a job is a file, claiming it is renaming it.
//
// These tests never call a model. The park path is exercised through a flow
// whose first step needs approval — the gate fires before any step runs, so
// driveRun returns without touching the SDK.
//
//   node --test tests/queue.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  enqueueFlowRun,
  enqueueResume,
  claimNext,
  recoverQueue,
} from "../packages/core/src/queue.ts";
import { driveRun } from "../packages/core/src/runner.ts";
import { readRun, writeRun, type RunRecord } from "../packages/core/src/store.ts";

/** A tenant/workspace on disk, and core pointed at it. */
function withWorkspace(body: () => void | Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-queue-"));
  const previous = process.env.FOLDRUN_DATA;
  process.env.FOLDRUN_DATA = root;
  try {
    const ws = path.join(root, "acme/workspaces/desk");
    fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
    fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
    fs.writeFileSync(
      path.join(ws, "agents/writer/agent.md"),
      "---\nname: writer\ndescription: writes\n---\n\nWrite.\n",
    );
    const out = body();
    if (out && typeof (out as Promise<void>).then === "function") {
      return (out as Promise<void>).finally(() => cleanup(root, previous));
    }
    cleanup(root, previous);
  } catch (err) {
    cleanup(root, previous);
    throw err;
  }
}

function cleanup(root: string, previous: string | undefined) {
  if (previous === undefined) delete process.env.FOLDRUN_DATA;
  else process.env.FOLDRUN_DATA = previous;
  fs.rmSync(root, { recursive: true, force: true });
}

const STEP = { agent: "writer", instruction: "draft it", group: 1, optional: false };

const pendingDir = () => path.join(process.env.FOLDRUN_DATA!, "queue/pending");
const claimedDir = () => path.join(process.env.FOLDRUN_DATA!, "queue/claimed");
const pendingJobs = () =>
  fs.existsSync(pendingDir()) ? fs.readdirSync(pendingDir()).filter((f) => f.endsWith(".json")) : [];

test("enqueueing writes a queued record and one pending job", () => {
  withWorkspace(() => {
    const run = enqueueFlowRun("acme", "desk", [STEP], "publish");
    assert.equal(run.status, "queued");
    assert.equal(readRun("acme", "desk", run.id)!.status, "queued");
    assert.equal(pendingJobs().length, 1);
    assert.ok(pendingJobs()[0].endsWith(`-${run.id}.json`));
  });
});

test("claiming is first-in-first-out and moves the job, not copies it", () => {
  withWorkspace(() => {
    const first = enqueueFlowRun("acme", "desk", [STEP], "one");
    const second = enqueueFlowRun("acme", "desk", [STEP], "two");

    const a = claimNext();
    assert.equal(a!.job.runId, first.id);
    const b = claimNext();
    assert.equal(b!.job.runId, second.id);
    assert.equal(claimNext(), null);

    assert.equal(pendingJobs().length, 0);
    assert.equal(fs.readdirSync(claimedDir()).length, 2);
  });
});

test("re-enqueueing a run that is already pending does not duplicate it", () => {
  withWorkspace(() => {
    const run = enqueueFlowRun("acme", "desk", [STEP], "publish");
    enqueueResume("acme", "desk", run.id);
    enqueueResume("acme", "desk", run.id);
    assert.equal(pendingJobs().length, 1);
  });
});

test("recovery returns claimed jobs to pending", () => {
  withWorkspace(() => {
    const run = enqueueFlowRun("acme", "desk", [STEP], "publish");
    claimNext(); // a worker took it, then the process died
    assert.equal(pendingJobs().length, 0);

    const { requeued } = recoverQueue();
    assert.equal(requeued.length, 1);
    assert.equal(pendingJobs().length, 1);
    assert.equal(claimNext()!.job.runId, run.id);
  });
});

test("recovery re-creates the job for a queued run whose file was lost", () => {
  withWorkspace(() => {
    const run = enqueueFlowRun("acme", "desk", [STEP], "publish");
    fs.rmSync(pendingDir(), { recursive: true, force: true });

    const { requeued } = recoverQueue();
    assert.ok(requeued.includes(run.id));
    assert.equal(claimNext()!.job.runId, run.id);
  });
});

test("recovery drops a pending job whose run already finished", () => {
  withWorkspace(() => {
    const run = enqueueFlowRun("acme", "desk", [STEP], "publish");
    const record = readRun("acme", "desk", run.id)!;
    record.status = "completed";
    record.finishedAt = new Date().toISOString();
    writeRun("acme", "desk", record);

    const { dropped } = recoverQueue();
    assert.equal(dropped.length, 1);
    assert.equal(pendingJobs().length, 0);
  });
});

test("a worker-driven run parks at an approval gate instead of blocking", () =>
  withWorkspace(async () => {
    const run = enqueueFlowRun(
      "acme",
      "desk",
      [{ ...STEP, approve: true }],
      "sign-off",
    );
    const claim = claimNext()!;

    // What the worker does with a claim — and it must come back promptly,
    // not in 24 hours.
    await driveRun("acme", "desk", readRun("acme", "desk", run.id)!, null, [], {
      parkOnApproval: true,
    });

    const parked = readRun("acme", "desk", run.id)!;
    assert.equal(parked.status, "awaiting-approval");
    assert.ok(parked.parkedAt, "a parked run carries the marker the approval API keys on");
    assert.equal(parked.steps[0].status, "awaiting-approval");
    assert.equal(parked.finishedAt, null, "parked is paused, not finished");
    fs.rmSync(claim.claimedFile, { force: true });
  }));

test("an approved parked run drives to the end of what it can do without a model", () =>
  withWorkspace(async () => {
    // Park it.
    const run = enqueueFlowRun("acme", "desk", [{ ...STEP, approve: true }], "sign-off");
    claimNext();
    await driveRun("acme", "desk", readRun("acme", "desk", run.id)!, null, [], {
      parkOnApproval: true,
    });

    // Reject it — the decision path that needs no SDK call to complete.
    const parked = readRun("acme", "desk", run.id)!;
    parked.steps[0].status = "failed";
    parked.steps[0].events.push({
      t: new Date().toISOString(),
      type: "error",
      text: "rejected by a human",
    });
    writeRun("acme", "desk", parked);

    // Resume as the worker would.
    await driveRun("acme", "desk", readRun("acme", "desk", run.id)!, null, [], {
      parkOnApproval: true,
    });

    const done = readRun("acme", "desk", run.id)!;
    assert.equal(done.status, "failed", "a rejected required step fails the run");
    assert.ok(done.finishedAt, "a resumed run that ends gets an end");
    assert.equal(done.parkedAt, null, "resuming clears the parked marker");
  }));
