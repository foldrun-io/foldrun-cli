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
  rerunFrom,
} from "../packages/core/src/queue.ts";
import { driveRun } from "../packages/core/src/runner.ts";
import { readRun, writeRun, runMeter, type RunRecord } from "../packages/core/src/store.ts";

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

// --------------------------------------------------------- the run meter

test("the meter counts steps that ran, not steps that were written", () => {
  const run = {
    id: "run-a",
    flow: "f",
    status: "completed",
    startedAt: "2026-08-26T00:00:00.000Z",
    finishedAt: "2026-08-26T00:10:00.000Z",
    steps: [
      { status: "completed", costUsd: 0.01, computeSecs: 12.5 },
      { status: "failed", costUsd: 0.02, computeSecs: 3.5 },
      { status: "skipped", costUsd: null, computeSecs: 99 }, // `when` said no
      { status: "pending", costUsd: null, computeSecs: 99 }, // never reached
      { status: "completed", costUsd: null, computeSecs: null }, // in-process
    ],
  } as unknown as RunRecord;

  assert.deepEqual(runMeter(run), { tokenCostUsd: 0.03, steps: 3, computeSecs: 16 });
});

// ------------------------------------------------------------ re-running

test("a re-run carries the finished steps and resets the rest", () =>
  withWorkspace(() => {
    const source = {
      id: "run-src",
      flow: "extract-and-send",
      status: "completed",
      startedAt: "2026-08-26T00:00:00.000Z",
      finishedAt: "2026-08-26T00:10:00.000Z",
      steps: [
        {
          agent: "extractor", instruction: "extract", group: 1, optional: false,
          status: "completed", events: [], result: "100 firms extracted",
          costUsd: 0.5, computeSecs: 120, startupSecs: 2,
        },
        {
          agent: "emailer", instruction: "send", group: 2, optional: false,
          status: "completed", events: [], result: "found nothing to send",
          costUsd: 0.02, computeSecs: 15, startupSecs: 2,
          approvedAt: "2026-08-26T00:05:00.000Z",
        },
      ],
    } as unknown as RunRecord;
    writeRun("acme", "desk", source);

    const rerun = rerunFrom("acme", "desk", "run-src", { agent: "emailer" });
    assert.notEqual(rerun.id, "run-src");
    assert.equal(rerun.status, "queued");

    const [carried, fresh] = rerun.steps;
    // The extraction is context, not work: result kept, billing zeroed,
    // provenance stamped.
    assert.equal(carried.status, "completed");
    assert.equal(carried.result, "100 firms extracted");
    assert.equal(carried.carriedFrom, "run-src");
    assert.equal(carried.costUsd, null);
    // The emailer runs again from scratch — including asking for approval
    // again, because the question changed with the fresh upstream result.
    assert.equal(fresh.status, "pending");
    assert.equal(fresh.result, null);
    assert.equal(fresh.approvedAt, undefined);

    // The original record is history, untouched.
    const untouched = readRun("acme", "desk", "run-src")!;
    assert.equal(untouched.steps[0].costUsd, 0.5);
    assert.equal(untouched.status, "completed");

    // And the meter never bills the carried step again.
    assert.deepEqual(
      runMeter({
        ...rerun,
        steps: [
          { ...carried },
          { ...fresh, status: "completed", costUsd: 0.03, computeSecs: 10 },
        ],
      } as RunRecord),
      { tokenCostUsd: 0.03, steps: 1, computeSecs: 10 },
    );
  }));

test("a live run cannot be re-run from, and a missing agent is refused", () =>
  withWorkspace(() => {
    const live = {
      id: "run-live", flow: "f", status: "running",
      startedAt: "2026-08-26T00:00:00.000Z", finishedAt: null,
      steps: [{ agent: "a", instruction: "", group: 1, optional: false,
        status: "running", events: [], result: null, costUsd: null }],
    } as unknown as RunRecord;
    writeRun("acme", "desk", live);
    assert.throws(() => rerunFrom("acme", "desk", "run-live", { agent: "a" }), /only a finished run/);

    live.status = "failed";
    live.steps[0].status = "failed";
    writeRun("acme", "desk", live);
    assert.throws(() => rerunFrom("acme", "desk", "run-live", { agent: "nope" }), /no step in run/);
  }));

// ------------------------------------------- orphaned steps never skipped

test("a step orphaned mid-run is re-run, not stepped over", () =>
  withWorkspace(async () => {
    // The deploy-mid-run shape: the driver died while step 1 was running,
    // recovery re-queued the job, and the next drive must not treat the
    // half-done step as finished work.
    const run = {
      id: "run-orphan", flow: "f", status: "running",
      startedAt: "2026-08-26T00:00:00.000Z", finishedAt: null,
      steps: [{
        agent: "missing-agent", instruction: "x", group: 1, optional: false,
        status: "running", events: [], result: null, costUsd: null,
      }],
    } as unknown as RunRecord;
    writeRun("acme", "desk", run);

    // The agent doesn't exist, so the re-run fails fast — the point is that
    // the step was picked up at all instead of skipped as already-running.
    await driveRun("acme", "desk", run, null, [], { parkOnApproval: true });
    const after = readRun("acme", "desk", "run-orphan")!;
    assert.equal(after.status, "failed");
    assert.ok(
      after.steps[0].events.some((e) => e.text.includes("interrupted mid-step")),
      "the orphan was noticed and restarted rather than stepped over",
    );
  }));
