// `foldrun observe` with the account Observe page's analysis (GET /api/observe):
// the window against the one before, why runs went wrong, agents and tools to
// watch — 7 days unasked, as the page; and `foldrun eval trends` (GET
// …/evals/trends), the workspace Observe page's evals by change.
//
//   node --test tests/cli-observe-analysis.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, WORKSPACES } from "./fake-platform.ts";

// Past the "acting with --token" line on stderr, which the helper merges in.
const json = (out: string) => JSON.parse(out.slice(out.indexOf("{")));

const observation = (ws: string, failedRuns: number) => ({
  workspace: ws, sinceDays: 7, from: null, runs: 10, failedRuns, steps: 30, costUsd: 1.5,
  flows: [], agents: [], tools: [], days: [],
  failures: failedRuns ? [{ runId: `run-${ws}`, flow: "hourly", agent: "writer", at: "2026-11-04T01:00:00Z", attempts: 1, text: "HTTP 500 from serp" }] : [],
});
const ref = (workspace: string, id: string) => ({ workspace, id, what: "hourly", outcome: "failed", startedAt: "2026-11-04T01:00:00Z", finishedAt: "2026-11-04T01:01:00Z", failure: { agent: "writer", reason: "x" } });
const analysis = (days: number) => ({
  days,
  timezone: "Australia/Sydney",
  window: { from: "2026-10-29T00:00:00Z", to: "2026-11-05T00:00:00Z" },
  previous: { from: "2026-10-22T00:00:00Z", to: "2026-10-29T00:00:00Z", runs: 18 },
  kpis: { runs: 20, finished: 20, succeeded: 16, rate: 0.8, prevRate: 0.95, failed: 3, platformFailures: 1, deskFailures: 3, spendUsd: 4.5, prevSpendUsd: 3, medianSecs: 90 },
  causes: [
    { kind: "platform", key: "sandbox", label: "Run sandboxes cannot start", platform: true, count: 1, desks: ["rank-desk"], sample: "writer: pod never became ready", newest: ref("rank-desk", "run-p") },
    { kind: "error", key: "error", label: "A step errored", platform: false, count: 2, desks: ["blog-desk"], sample: "writer: HTTP 500 from serp", newest: ref("blog-desk", "run-e") },
  ],
  desks: [
    { workspace: "blog-desk", runs: 10, rate: 0.7, prevRate: 0.9, deskFailures: 2, platformFailures: 0, spendUsd: 2, medianSecs: 80, worst: { what: "hourly", count: 2 }, lastBad: ref("blog-desk", "run-e") },
    { workspace: "rank-desk", runs: 10, rate: 0.9, prevRate: 0.9, deskFailures: 0, platformFailures: 1, spendUsd: 2.5, medianSecs: 100, worst: null, lastBad: ref("rank-desk", "run-p") },
  ],
  agents: [
    { workspace: "blog-desk", agent: "writer", steps: 10, failed: 2, retried: 1, costUsd: 1, chargedUsd: 1.2, seconds: { n: 10, p50: 30, p95: 60, max: 61 } },
    { workspace: "rank-desk", agent: "quiet-one", steps: 4, failed: 0, retried: 0, costUsd: 0.1, chargedUsd: 0.1, seconds: { n: 4, p50: null, p95: null, max: 5 } },
  ],
  tools: [
    { name: "serp_check", calls: 40, errors: 4, workspaces: ["blog-desk"], p95ms: 1200 },
    { name: "Read", calls: 90, errors: 0, workspaces: ["blog-desk", "rank-desk"], p95ms: null },
  ],
  daily: [],
});

test("observe: 7 days unasked, and the analysis under the table — the window before, causes, agents and tools to watch", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/observe": () => observation("blog-desk", 2),
    "/api/workspaces/rank-desk/observe": () => observation("rank-desk", 0),
    "/api/observe": (_b, q) => analysis(Number(q.get("days"))),
  });
  const r = await at(s.url, "observe");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.ok(s.seen.filter((x) => x.url.endsWith("/observe")).every((x) => x.query.get("days") === "7"), "every call asks for 7 days");
  assert.ok(s.seen.some((x) => x.url === "/api/observe"));
  assert.match(r.out, /last 7 days/);
  // Each workspace's trend against the window before.
  assert.match(r.out, /blog-desk.*▼ 20 pts/);
  assert.match(r.out, /rank-desk.*steady/);
  assert.match(r.out, /80% completed\s+▼ 15 pts vs the 7 days before/);
  assert.match(r.out, /20 runs \(18 the 7 days before\) · 4 went wrong \(3 desk · 1 platform\) · charged \$4\.50 ▲ \$1\.50/);
  assert.match(r.out, /why runs went wrong/);
  assert.match(r.out, /platform\s+Run sandboxes cannot start ×1\s+rank-desk/);
  assert.match(r.out, /desk\s+A step errored ×2\s+blog-desk/);
  assert.match(r.out, /no desk edit fixes a platform cause/);
  // Agents to watch: the ones that failed or retried, not every agent.
  assert.match(r.out, /writer\s+blog-desk\s+2\/10\s+1\s+30s\s+\$1\.20/);
  assert.doesNotMatch(r.out, /quiet-one/);
  // Tools to watch: the ones that errored.
  assert.match(r.out, /serp_check\s+40\s+4 10%\s+1\.2s\s+blog-desk/);
  assert.doesNotMatch(r.out, /^\s*Read\s+90/m);
});

test("observe --since and --days still pick any window, for the table and the analysis alike", async () => {
  const routes = {
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/observe": () => observation("blog-desk", 0),
    "/api/workspaces/rank-desk/observe": () => observation("rank-desk", 0),
    "/api/observe": (_b: string, q: URLSearchParams) => analysis(Number(q.get("days"))),
  };
  for (const flag of ["--since", "--days"]) {
    const s = await serve(routes);
    const r = await at(s.url, "observe", flag, "30");
    s.close();
    assert.equal(r.code, 0, r.out);
    assert.ok(s.seen.filter((x) => x.url.endsWith("/observe")).every((x) => x.query.get("days") === "30"), flag);
    assert.match(r.out, /vs the 30 days before/);
  }
});

test("observe --to keeps 30 days unasked, as a workspace's Observe page, and asks for no account analysis", async () => {
  const s = await serve({ "/api/workspaces/blog-desk/observe": () => observation("blog-desk", 0) });
  const r = await at(s.url, "observe", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen[0].query.get("days"), "30");
  assert.ok(!s.seen.some((x) => x.url === "/api/observe"));
});

test("observe --json is one document: the window, the analysis, and every workspace's report", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/observe": () => observation("blog-desk", 2),
    "/api/workspaces/rank-desk/observe": () => observation("rank-desk", 0),
    "/api/observe": (_b, q) => analysis(Number(q.get("days"))),
  });
  const r = await at(s.url, "observe", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  const doc = json(r.out);
  assert.equal(doc.days, 7);
  assert.equal(doc.account.kpis.prevRate, 0.95);
  assert.equal(doc.account.causes[0].kind, "platform");
  assert.deepEqual(doc.workspaces.map((w: { workspace: string }) => w.workspace).sort(), ["blog-desk", "rank-desk"]);
});

test("observe against a platform with no account analysis yet: the table alone, and account: null in --json", async () => {
  const routes = {
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/observe": () => observation("blog-desk", 1),
    "/api/workspaces/rank-desk/observe": () => observation("rank-desk", 0),
  };
  let s = await serve(routes);
  const r = await at(s.url, "observe");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /✗ blog-desk/);
  assert.doesNotMatch(r.out, /why runs went wrong|vs before/);
  s = await serve(routes);
  const j = await at(s.url, "observe", "--json");
  s.close();
  assert.equal(json(j.out).account, null);
});

// ------------------------------------------------------------------ eval trends

const entry = (evalName: string, commit: string | null, passed: number, failed: number) => ({ eval: evalName, at: "2026-11-03T00:00:00Z", commit, passed, failed, costUsd: 0.1 });

test("eval trends prints each eval against its last run on a different commit, and exits 1 on a drop", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/evals/trends": () => ({
      workspace: "blog-desk",
      trends: [
        { eval: "quality", latest: entry("quality", "bbbbbbbbbbbb", 2, 2), previous: entry("quality", "aaaaaaaaaaaa", 4, 0), delta: -2 },
        { eval: "edited", latest: entry("edited", "r-20261103-abcdef", 3, 0), previous: entry("edited", "cccccccccc", 2, 1), delta: 1 },
        { eval: "tone", latest: entry("tone", null, 2, 0), previous: null, delta: null },
      ],
    }),
  });
  const r = await at(s.url, "eval", "trends", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.equal(s.seen[0].url, "/api/workspaces/blog-desk/evals/trends");
  assert.match(r.out, /quality\s+2\/4\s+bbbbbbb\s+4\/4 aaaaaaa\s+-2 — this change made it worse/);
  // A revision id keeps enough to name it; a git sha its short form.
  assert.match(r.out, /edited\s+3\/3\s+r-20261103-a\s+2\/3 ccccccc\s+\+1/);
  assert.match(r.out, /tone\s+2\/2\s+no change on record\s+first commit with a run\s+—/);
});

test("eval trends: no drop exits 0; --json is the document; no history says how to make one", async () => {
  const s = await serve({
    "GET /api/workspaces/blog-desk/evals/trends": () => ({ workspace: "blog-desk", trends: [{ eval: "q", latest: entry("q", "b1", 3, 0), previous: entry("q", "a1", 3, 0), delta: 0 }] }),
    "/api/workspaces/rank-desk/evals/trends": () => ({ workspace: "rank-desk", trends: [] }),
  });
  const r = await at(s.url, "eval", "trends", "--to", "blog-desk");
  const j = await at(s.url, "eval", "trends", "--to", "blog-desk", "--json");
  const none = await at(s.url, "eval", "trends", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /unchanged/);
  assert.equal(j.code, 0);
  assert.equal(json(j.out).trends[0].delta, 0);
  assert.equal(none.code, 0, none.out);
  assert.match(none.out, /no eval has run in rank-desk yet/);
});

test("an eval called trends is still read with --last, not taken for the verb", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/evals": () => ({ evals: [{ name: "trends", agent: "writer", trigger: "manual" }] }),
    "/api/workspaces/blog-desk/evals/trends/run": () => ({ running: false, result: null }),
  });
  await at(s.url, "eval", "trends", "--to", "blog-desk", "--last");
  s.close();
  assert.ok(!s.seen.some((x) => x.url === "/api/workspaces/blog-desk/evals/trends"));
  assert.ok(s.seen.some((x) => x.url === "/api/workspaces/blog-desk/evals"));
});

test("eval trends --help names it and calls nothing", async () => {
  const r = await at("http://127.0.0.1:9", "eval", "trends", "--help");
  assert.match(r.out, /eval trends --to <ws>/);
});

test("FOL-74: observe --to shows an overlapped start-up as the platform placed it — services in parallel, go held for it", async () => {
  const sp = (p50: number, max = p50) => ({ n: 6, p50, p95: max, max });
  const report = {
    ...observation("blog-desk", 0),
    startup: [
      { phase: "services", took: sp(8), from: sp(0), at: sp(8), parallel: 5, waited: sp(0) },
      { phase: "room", took: sp(0.1), from: sp(0), at: sp(0.1), parallel: 0, waited: sp(0) },
      { phase: "ready", took: sp(2.5), from: sp(0.5), at: sp(3), parallel: 0, waited: sp(0) },
      { phase: "files", took: sp(1), from: sp(3), at: sp(4), parallel: 0, waited: sp(0) },
      { phase: "go", took: sp(0.1), from: sp(8), at: sp(8.1), parallel: 0, waited: sp(4) },
    ],
  };
  const s = await serve({ "/api/workspaces/blog-desk/observe": () => report });
  const r = await at(s.url, "observe", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /start-up\s+n\s+took p50\s+p95\s+from p50\s+done by p50\s+p95/);
  assert.match(r.out, /services\s+6\s+8\.00s\s+8\.00s\s+0ms\s+8\.00s\s+8\.00s\s+in parallel on 5 of 6/);
  // the phases services overlapped keep their own shares
  assert.match(r.out, /room\s+6\s+100ms\s+100ms\s+0ms\s+100ms/);
  assert.match(r.out, /ready\s+6\s+2\.50s/);
  assert.match(r.out, /go\s+6\s+100ms\s+100ms\s+8\.00s\s+8\.10s\s+8\.10s\s+held 4\.00s\/4\.00s for services/);
});

test("observe --to against a platform from before FOL-74: the start-up table without lanes", async () => {
  const sp = (v: number) => ({ n: 6, p50: v, p95: v, max: v });
  const s = await serve({ "/api/workspaces/blog-desk/observe": () => ({ ...observation("blog-desk", 0), startup: [{ phase: "ready", took: sp(1), at: sp(1) }] }) });
  const r = await at(s.url, "observe", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ready\s+6\s+1\.00s\s+1\.00s\s+—\s+1\.00s\s+1\.00s\s*$/m);
  assert.doesNotMatch(r.out, /in parallel|held/);
});
