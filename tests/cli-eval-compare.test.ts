// `foldrun eval compare` — an eval under several models, side by side —
// against a fake platform: what it sends, how it waits, what it prints.
//
//   node --test tests/cli-eval-compare.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, cli, WORKSPACES } from "./fake-platform.ts";

process.env.FOLDRUN_EVAL_POLL_MS = "10";
const base = "/api/workspaces/blog-desk/evals/writer-quality/compare";

const result = {
  eval: "writer-quality",
  target: { flow: null, agent: "writer" },
  judge: { model: "fast", effort: null },
  startedAt: "2026-10-24T01:00:00.000Z",
  finishedAt: "2026-10-24T01:10:00.000Z",
  repeat: 1,
  maxUsd: 5,
  spentUsd: 0.42,
  stopped: null,
  configs: [
    { model: "fast", effort: "low", agent: null, label: "fast · low", trials: 2, passed: 1, notRun: 0, rate: 0.5, costUsd: 0.02, judgeCostUsd: 0.002, avgCostUsd: 0.01, avgSecs: 12, runIds: ["run-1", "run-2"] },
    { model: "max", effort: null, agent: null, label: "max", trials: 2, passed: 2, notRun: 0, rate: 1, costUsd: 0.4, judgeCostUsd: 0.002, avgCostUsd: 0.2, avgSecs: 30, runIds: ["run-3", "run-4"] },
  ],
  cases: [
    { case: "mentions the audience", passed: [0, 1], trials: [1, 1] },
    { case: "quotes the price", passed: [1, 1], trials: [1, 1] },
  ],
};

test("eval compare sends the settings, waits, and prints the table and where they differ", async () => {
  let polls = 0;
  const fake = await serve({
    "/api/workspaces": () => WORKSPACES,
    [`POST ${base}`]: () => ({ started: true, eval: "writer-quality", runId: "a".repeat(24), startedAt: "x", trials: 4, maxUsd: 2 }),
    [`GET ${base}`]: () => (++polls < 2 ? { runId: "a".repeat(24), state: "running", progress: { done: 2, total: 4 }, running: true } : { runId: "a".repeat(24), state: "done", result, running: false }),
  });
  try {
    const r = await cli(["eval", "compare", "writer-quality", "--models", "fast:low,max", "--repeat", "1", "--max-usd", "2", "--to", "blog-desk", "--url", fake.url, "--token", "k"], { env: { FOLDRUN_EVAL_POLL_MS: "10" } });
    assert.equal(r.code, 0, r.out);
    const sent = JSON.parse(fake.seen.find((s) => s.method === "POST")!.body);
    assert.deepEqual(sent, { configs: [{ model: "fast", effort: "low" }, { model: "max" }], repeat: 1, maxUsd: 2 });
    assert.match(r.out, /4 test runs, at most \$2.00/);
    assert.match(r.out, /2\/4 runs done/);
    assert.match(r.out, /fast · low\s+50%/);
    assert.match(r.out, /max\s+100%/);
    assert.match(r.out, /where they differ:\n\s+mentions the audience: fast · low 0\/1 · max 1\/1/);
    assert.doesNotMatch(r.out, /quotes the price:/, "a case where they agree is not listed");
  } finally {
    fake.close();
  }
});

test("--effort and --agent apply to every setting that names none; --models is required", async () => {
  const fake = await serve({
    "/api/workspaces": () => WORKSPACES,
    [`POST ${base}`]: () => ({ started: true, runId: "b".repeat(24), trials: 2, maxUsd: 5 }),
    [`GET ${base}`]: () => ({ state: "done", result }),
  });
  try {
    await cli(["eval", "compare", "writer-quality", "--models", "fast,max:high", "--effort", "low", "--agent", "writer", "--to", "blog-desk", "--url", fake.url, "--token", "k"], { env: { FOLDRUN_EVAL_POLL_MS: "10" } });
    const sent = JSON.parse(fake.seen.find((s) => s.method === "POST")!.body);
    assert.deepEqual(sent.configs, [{ model: "fast", effort: "low", agent: "writer" }, { model: "max", effort: "high", agent: "writer" }]);
    const none = await at(fake.url, "eval", "compare", "writer-quality", "--to", "blog-desk");
    assert.notEqual(none.code, 0);
    assert.match(none.out, /--models takes two to four settings/);
  } finally {
    fake.close();
  }
});

test("--list shows the kept comparisons; --run reads one", async () => {
  const fake = await serve({
    "/api/workspaces": () => WORKSPACES,
    [`GET ${base}`]: (_b, q) =>
      q.get("run")
        ? { runId: q.get("run"), state: "done", result }
        : { running: false, comparisons: [{ runId: "c".repeat(24), startedAt: "2026-10-24T01:00:00.000Z", finishedAt: "x", status: "done", result }] },
  });
  try {
    const list = await at(fake.url, "eval", "compare", "writer-quality", "--to", "blog-desk", "--list");
    assert.equal(list.code, 0, list.out);
    assert.match(list.out, /c{24}.*fast · low 50% · max 100%/);
    const one = await at(fake.url, "eval", "compare", "writer-quality", "--to", "blog-desk", "--run", "c".repeat(24));
    assert.equal(one.code, 0, one.out);
    assert.match(one.out, /max\s+100%/);
    assert.ok(!fake.seen.some((s) => s.method === "POST"), "reading never starts one");
  } finally {
    fake.close();
  }
});

test("a bare --run is refused, never read as starting a comparison", async () => {
  const fake = await serve({ "/api/workspaces": () => WORKSPACES, [`POST ${base}`]: () => ({ started: true, runId: "x", trials: 2, maxUsd: 5 }) });
  try {
    const r = await at(fake.url, "eval", "compare", "writer-quality", "--models", "fast,max", "--to", "blog-desk", "--run");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /--run takes the comparison id/);
    assert.ok(!fake.seen.some((s) => s.method === "POST"), "nothing started");
  } finally {
    fake.close();
  }
});

test("--run --json on a comparison still running prints its view as JSON", async () => {
  const fake = await serve({ "/api/workspaces": () => WORKSPACES, [`GET ${base}`]: () => ({ runId: "r", state: "running", running: true, progress: { done: 1, total: 4 } }) });
  try {
    const r = await at(fake.url, "eval", "compare", "writer-quality", "--to", "blog-desk", "--run", "r", "--json");
    assert.equal(r.code, 1);
    assert.deepEqual(JSON.parse(r.out.slice(r.out.indexOf("{"))).progress, { done: 1, total: 4 });
  } finally {
    fake.close();
  }
});
