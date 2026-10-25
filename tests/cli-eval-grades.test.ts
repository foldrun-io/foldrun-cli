// `foldrun eval grades` and `foldrun eval grade` — what a grader (an eval with
// trigger: runs) found, and one run graded now — against a fake platform.
// And a grader is never run as cases by `foldrun eval --to`.
//
//   node --test tests/cli-eval-grades.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, WORKSPACES } from "./fake-platform.ts";

const grade = (runId: string, status: string, reason?: string) => ({
  eval: "digest-quality",
  runId,
  flow: "digest",
  at: "2026-10-24T01:00:00.000Z",
  status,
  checks: [
    { name: "cites a source", passed: status === "pass", assertions: [{ type: "judge", value: "names its sources", passed: status === "pass", detail: reason ?? "PASS" }] },
  ],
  costUsd: 0.0012,
  model: "fast",
  evalRevision: "abc",
  runRevision: null,
  runFinishedAt: null,
  by: "sample",
});

test("eval grades prints the rate and each graded run, and exits 1 on a failure", async () => {
  const fake = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/evals/digest-quality/grades": (_b, q) => ({
      eval: "digest-quality",
      flow: "digest",
      agent: null,
      sample: 25,
      improve: null,
      days: Number(q.get("days") ?? 30),
      summary: { graded: 2, passed: 1, failed: 1, errors: 0, rate: 0.5, costUsd: 0.0024, byDay: [] },
      grades: [grade("run-b", "fail", "nothing is attributed"), grade("run-a", "pass")].filter((g) => !q.get("status") || g.status === q.get("status")),
    }),
  });
  try {
    const r = await at(fake.url, "eval", "grades", "digest-quality", "--to", "blog-desk", "--days", "7");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /50% passing over 7 days — 2 graded, 1 passed, 1 failed/);
    assert.match(r.out, /run-b.*cites a source: nothing is attributed/);
    assert.match(r.out, /run-a/);
    const sent = fake.seen.find((s) => s.url.endsWith("/grades"));
    assert.equal(sent?.query.get("days"), "7");
    const only = await at(fake.url, "eval", "grades", "digest-quality", "--to", "blog-desk", "--status", "fail");
    assert.doesNotMatch(only.out, /run-a/);
  } finally {
    fake.close();
  }
});

test("eval grade grades one run now and exits 0 when it passed", async () => {
  const fake = await serve({
    "/api/workspaces": () => WORKSPACES,
    "POST /api/workspaces/blog-desk/evals/digest-quality/grade": (body) => grade(JSON.parse(body).run, "pass"),
  });
  try {
    const r = await at(fake.url, "eval", "grade", "digest-quality", "--run", "run-x", "--to", "blog-desk");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /✓ pass\s+run-x/);
    const need = await at(fake.url, "eval", "grade", "digest-quality", "--to", "blog-desk");
    assert.notEqual(need.code, 0);
    assert.match(need.out, /--run <run-id>/);
  } finally {
    fake.close();
  }
});

test("eval --to lists a grader and runs only the case evals", async () => {
  const fake = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/evals": () => ({ evals: [{ name: "digest-quality", trigger: "runs", cases: [] }] }),
  });
  try {
    const r = await at(fake.url, "eval", "--to", "blog-desk");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /digest-quality.*grades live runs/);
    assert.ok(!fake.seen.some((s) => s.url.endsWith("/run")), "a grader is never run as cases");
  } finally {
    fake.close();
  }
});
