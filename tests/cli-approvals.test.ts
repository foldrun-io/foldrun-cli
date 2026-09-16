// The four commands that answer "what is waiting for me, and what happened":
// approvals, approve, reject, runs and report — pinned through the real
// binary against a fake platform.
//
// Approving is the one outward thing this CLI can do: the step behind a gate
// is the one that publishes, sends or posts. So the tests that matter most
// here are the ones about NOT doing it — no confirmation, no approval; not a
// terminal, no approval; a run with nothing waiting, no approval.
//
//   node --test tests/cli-approvals.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, cli, at, failing, WORKSPACES } from "./fake-platform.ts";

// ------------------------------------------------------------- the fixtures

const gate = {
  workspace: "blog-desk",
  runId: "run-aaa",
  flow: "publish",
  step: 2,
  agent: "publisher",
  question: "Publish this draft to the site?",
  asked: true,
  startedAt: "2026-09-16T01:00:00.000Z",
  waitingSince: "2026-09-16T01:05:00.000Z",
};

const waitingRun = {
  id: "run-aaa",
  flow: "publish",
  status: "awaiting-approval",
  startedAt: "2026-09-16T01:00:00.000Z",
  finishedAt: null,
  summary: null,
  steps: [
    { agent: "researcher", group: 1, status: "completed", attempts: 1, costUsd: 0.01, events: [], result: "Found three sources.", startedAt: "2026-09-16T01:00:00.000Z", finishedAt: "2026-09-16T01:01:00.000Z" },
    { agent: "writer", group: 2, status: "completed", attempts: 1, costUsd: 0.02, events: [], result: "Drafted it.", startedAt: "2026-09-16T01:01:00.000Z", finishedAt: "2026-09-16T01:02:00.000Z" },
    { agent: "publisher", group: 3, status: "awaiting-approval", attempts: 0, costUsd: null, events: [], result: null, instruction: "publish the draft", ask: "Publish this draft to the site?", preview: ["draft/post.mdx"], previewFiles: ["draft/post.mdx"] },
  ],
};

const completedRun = {
  id: "run-ok",
  flow: "rankings",
  status: "completed",
  startedAt: "2026-09-15T19:00:00.000Z",
  finishedAt: "2026-09-15T19:09:00.000Z",
  summary: "GOOD — 12 cases closed, report at https://example.test/report",
  steps: [
    {
      agent: "position-tracker",
      group: 1,
      status: "completed",
      attempts: 1,
      costUsd: 0.0434,
      tokens: { input: 12648, output: 1381 },
      startedAt: "2026-09-15T19:00:00.000Z",
      finishedAt: "2026-09-15T19:01:00.000Z",
      verify: "matches: GOOD|BAD",
      result: "## Report\n\nTwo thousand keywords ranking.",
      conclusion: "Two thousand keywords ranking.",
      events: [{ t: "2026-09-15T19:01:00.000Z", type: "info", text: "files: saved positions.md, drop-cases.md" }],
    },
  ],
};

const failedRun = {
  id: "run-bad",
  flow: "rankings",
  status: "failed",
  startedAt: "2026-09-15T19:00:00.000Z",
  finishedAt: "2026-09-15T19:09:00.000Z",
  summary: "BAD — the case keeper could not close",
  steps: [
    {
      agent: "case-keeper",
      group: 3,
      status: "failed",
      attempts: 2,
      costUsd: 0.0967,
      startedAt: "2026-09-15T19:08:00.000Z",
      finishedAt: "2026-09-15T19:09:00.000Z",
      verify: "matches: GOOD|BAD",
      result: null,
      events: [
        { t: "2026-09-15T19:08:30.000Z", type: "tool", text: "read state/drops/index.md" },
        { t: "2026-09-15T19:09:00.000Z", type: "error", text: "the ledger row had no run id" },
      ],
      tries: [
        { n: 1, status: "failed", error: "verify `matches: GOOD|BAD` → no match" },
        { n: 2, status: "failed", error: "verify `matches: GOOD|BAD` → no match" },
      ],
    },
    { agent: "reporter", group: 4, status: "skipped", attempts: 0, costUsd: null, events: [], result: null },
  ],
};

const runsIn = (runs: any[]) => ({ runs: runs.map((r) => ({ ...r, steps: r.steps.map((s: any) => ({ agent: s.agent, status: s.status, costUsd: s.costUsd })) })) });

// ------------------------------------------------------------- approvals

test("approvals says so plainly when nothing is waiting", async () => {
  const s = await serve({ "/api/approvals": () => ({ approvals: [] }) });
  const r = await at(s.url, "approvals");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /nothing is waiting on a person/);
});

test("approvals names the workspace, the step, the question and what it previews", async () => {
  const s = await serve({
    "/api/approvals": () => ({ approvals: [gate] }),
    "/api/workspaces/blog-desk/runs/run-aaa": () => waitingRun,
  });
  const r = await at(s.url, "approvals");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /run-aaa/);
  assert.match(r.out, /blog-desk · publish/);
  assert.match(r.out, /step 3 · publisher/);
  assert.match(r.out, /Publish this draft to the site\?/);
  assert.match(r.out, /previews storage\/: draft\/post\.mdx/);
  assert.match(r.out, /waiting/);
  assert.match(r.out, /foldrun approve <run-id>/);
});

test("approvals --to keeps one workspace's gates", async () => {
  const other = { ...gate, workspace: "rank-desk", runId: "run-bbb" };
  const s = await serve({
    "/api/approvals": () => ({ approvals: [gate, other] }),
    "/api/workspaces/blog-desk/runs/run-aaa": () => waitingRun,
  });
  const r = await at(s.url, "approvals", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /run-aaa/);
  assert.doesNotMatch(r.out, /run-bbb/);
});

// ------------------------------------------------------ approve and reject

test("approve without --yes on a pipe refuses, and posts nothing", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-aaa": () => waitingRun,
  });
  const r = await at(s.url, "approve", "run-aaa", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /approving needs a person/);
  assert.equal(s.seen.filter((x) => x.method === "POST").length, 0, "nothing was approved");
});

test("approve --yes posts the decision, and says what it is about to release first", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-aaa": () => waitingRun,
    "POST /api/workspaces/blog-desk/runs/run-aaa/approve": () => ({ ok: true, decision: "approve", steps: [2] }),
  });
  const r = await at(s.url, "approve", "run-aaa", "--to", "blog-desk", "--yes", "--note", "skip the Sydney batch");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /publishes, sends or posts/, "it says what approving means");
  assert.match(r.out, /note the agent will read: skip the Sydney batch/);
  assert.match(r.out, /approved 1 step of run-aaa/);
  const post = s.seen.find((x) => x.method === "POST");
  assert.ok(post, "the decision was posted");
  assert.deepEqual(JSON.parse(post!.body), { decision: "approve", note: "skip the Sydney batch" });
});

test("reject sends the note as the reason too, and needs no confirmation", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-aaa": () => waitingRun,
    "POST /api/workspaces/blog-desk/runs/run-aaa/approve": () => ({ ok: true, decision: "reject", steps: [2] }),
  });
  const r = await at(s.url, "reject", "run-aaa", "--to", "blog-desk", "--note", "the draft names a price");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /rejected 1 step of run-aaa/);
  const post = s.seen.find((x) => x.method === "POST")!;
  assert.deepEqual(JSON.parse(post.body), { decision: "reject", note: "the draft names a price", reason: "the draft names a price" });
});

test("--step decides one gate, by the number the report prints", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-aaa": () => waitingRun,
    "POST /api/workspaces/blog-desk/runs/run-aaa/approve": () => ({ ok: true, decision: "approve", steps: [2] }),
  });
  const r = await at(s.url, "approve", "run-aaa", "--to", "blog-desk", "--yes", "--step", "3");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "POST")!.body), { decision: "approve", step: 2 });
});

test("a step that is not waiting is refused, with the ones that are", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-aaa": () => waitingRun,
  });
  const r = await at(s.url, "approve", "run-aaa", "--to", "blog-desk", "--yes", "--step", "1");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /step 1 of run-aaa is not waiting on a person — 3 is/);
  assert.equal(s.seen.filter((x) => x.method === "POST").length, 0);
});

test("a finished run has no gate, and says so instead of approving", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-ok": () => completedRun,
  });
  const r = await at(s.url, "approve", "run-ok", "--to", "blog-desk", "--yes");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no step of it is waiting on a person/);
  assert.equal(s.seen.filter((x) => x.method === "POST").length, 0);
});

test("without --to the run's workspace is found, and a run in none of them says which door was tried", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/rank-desk/runs/run-ok": () => completedRun,
  });
  const found = await at(s.url, "report", "run-ok");
  assert.equal(found.code, 0, found.out);
  assert.match(found.out, /rank-desk/);

  const missing = await at(s.url, "report", "run-nope");
  s.close();
  assert.equal(missing.code, 1, missing.out);
  assert.match(missing.out, /no run "run-nope" in any workspace/);
});

// ------------------------------------------------------------------ runs

test("runs merges every workspace, newest first, with the summary underneath", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs": () => runsIn([failedRun]),
    "/api/workspaces/rank-desk/runs": () => runsIn([completedRun]),
  });
  const r = await at(s.url, "runs");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /blog-desk/);
  assert.match(r.out, /rank-desk/);
  assert.match(r.out, /rankings/);
  assert.match(r.out, /1\/2/, "steps done over total");
  assert.match(r.out, /GOOD — 12 cases closed/);
  assert.match(r.out, /\$0\.10/, "the failed run's cost");
});

test("runs --status keeps only those, and says so when nothing matches", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs": () => runsIn([failedRun]),
    "/api/workspaces/rank-desk/runs": () => runsIn([completedRun]),
  });
  const failed = await at(s.url, "runs", "--status", "failed");
  assert.equal(failed.code, 0, failed.out);
  assert.match(failed.out, /run-bad/);
  assert.doesNotMatch(failed.out, /run-ok/);

  const none = await at(s.url, "runs", "--status", "queued");
  s.close();
  assert.equal(none.code, 0, none.out);
  assert.match(none.out, /no runs matching status queued/);
});

test("runs --since drops what is older, and a bad span is refused before any call", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs": () => runsIn([failedRun]),
    "/api/workspaces/rank-desk/runs": () => runsIn([completedRun]),
  });
  const old = await at(s.url, "runs", "--since", "1h");
  assert.equal(old.code, 0, old.out);
  assert.match(old.out, /no runs matching the last 1h/);

  const wide = await at(s.url, "runs", "--since", "52w");
  assert.match(wide.out, /run-ok/);

  const bad = await at(s.url, "runs", "--since", "yesterday");
  s.close();
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /--since wants a span like 24h, 7d or 90m/);
});

test("runs --to asks one workspace and --limit caps the list", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/runs": () => runsIn([failedRun, { ...completedRun, id: "run-two", startedAt: "2026-09-14T19:00:00.000Z" }]),
  });
  const r = await at(s.url, "runs", "--to", "blog-desk", "--limit", "1");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /run-bad/);
  assert.doesNotMatch(r.out, /run-two/);
  assert.ok(!s.seen.some((x) => x.url === "/api/workspaces"), "--to asks for no workspace list");
});

test("a workspace that will not answer is named, and the rest still print", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs": () => failing(500, { error: "the box is mid-deploy" }),
    "/api/workspaces/rank-desk/runs": () => runsIn([completedRun]),
  });
  const r = await at(s.url, "runs");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /run-ok/);
  assert.match(r.out, /blog-desk/);
  assert.match(r.out, /mid-deploy/);
});

// ---------------------------------------------------------------- report

test("report reads a completed run end to end: header, step, verify, files, links", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-ok": () => completedRun,
  });
  const r = await at(s.url, "report", "run-ok", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /rankings/);
  assert.match(r.out, /blog-desk · completed/);
  assert.match(r.out, /9m/, "how long it took");
  assert.match(r.out, /\$0\.0434/);
  assert.match(r.out, /12,648 in \/ 1,381 out tokens/);
  assert.match(r.out, /g1 position-tracker/);
  assert.match(r.out, /verify: matches: GOOD\|BAD/);
  assert.match(r.out, /Two thousand keywords ranking\./);
  assert.match(r.out, /wrote  positions\.md, drop-cases\.md/);
  assert.match(r.out, /published  https:\/\/example\.test\/report/);
});

test("report on a failed run shows the error and the last events, and exits 1", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-bad": () => failedRun,
  });
  const r = await at(s.url, "report", "run-bad", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /2 attempts/);
  assert.match(r.out, /verify `matches: GOOD\|BAD` → no match/);
  assert.match(r.out, /the ledger row had no run id/, "the last events are there");
  assert.match(r.out, /skipped/, "the step that never ran is still listed");
});

test("report on a parked run ends with what is still waiting, and how to release it", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-aaa": () => waitingRun,
  });
  const r = await at(s.url, "report", "run-aaa", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /waiting on a person: Publish this draft to the site\?/);
  assert.match(r.out, /foldrun approve run-aaa --to blog-desk/);
});

test("report --json is the record itself, and nothing else", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-ok": () => completedRun,
  });
  const r = await at(s.url, "report", "run-ok", "--to", "blog-desk", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  const parsed = JSON.parse(r.out.slice(r.out.indexOf("{")));
  assert.equal(parsed.id, "run-ok");
  assert.equal(parsed.steps.length, 1);
});

// --------------------------------------------------- from any folder shape

test("every one of them works from an account folder, a flat one, and nowhere in particular", async () => {
  const s = await serve({
    "/api/approvals": () => ({ approvals: [] }),
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs": () => runsIn([failedRun]),
    "/api/workspaces/rank-desk/runs": () => runsIn([completedRun]),
  });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-approvals-"));
  const account = path.join(home, "acme");
  await cli(["init", account, "--workspace", "blog-desk"]);
  const flat = path.join(home, "solo");
  await cli(["init", flat, "--flat"]);

  for (const cwd of [account, path.join(account, "workspaces", "blog-desk"), flat, os.tmpdir()]) {
    for (const command of [["approvals"], ["runs"]]) {
      const r = await cli([...command, "--url", s.url, "--token", "k"], { cwd });
      assert.equal(r.code, 0, `${command[0]} in ${cwd}: ${r.out}`);
    }
  }
  s.close();
});

test("without a platform they say which door to open, rather than failing at a fetch", async () => {
  const r = await cli(["approvals"]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /`foldrun approvals` reads a running platform/);
});
