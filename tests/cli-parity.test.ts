// What the dashboard could do and the terminal could not: evals on the
// platform, promote, bulk stop/rerun, runs rm, archived files, observe,
// usage, the billing pages, a workspace's settings, notify test, history,
// the repository, webhook rotation, the account export, storage previews —
// and the smaller gaps: invoke's tags, `flow run`, and the help lines that
// were missing. Each against a fake platform, asserting the request as well
// as what was printed; each destructive one also asserting it sends nothing
// without --yes on a pipe.
//
//   node --test tests/cli-parity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, at, cli, raw, failing, WORKSPACES } from "./fake-platform.ts";

const posts = (s: { seen: { method: string; url: string; body: string }[] }, method = "POST") =>
  s.seen.filter((x) => x.method === method).map((x) => ({ url: x.url, body: x.body ? JSON.parse(x.body) : null }));
const tmpFile = (name: string) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-parity-")), name);

const done = { id: "run-1", flow: "hourly", status: "completed", startedAt: "2026-09-29T01:00:00Z", finishedAt: "2026-09-29T01:05:00Z", steps: [] };

// ------------------------------------------------------------------ evals

test("eval --to runs the deployed evals on the platform and exits on the verdict", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/evals": () => ({ evals: [{ name: "quality", cases: [{}, {}] }, { name: "other", cases: [{}] }] }),
    "POST /api/workspaces/blog-desk/evals/quality/run": () => ({
      eval: "quality", passed: 1, failed: 1, costUsd: 0.12,
      cases: [
        { name: "short", passed: true, assertions: [] },
        { name: "cites", passed: false, assertions: [{ passed: false, assertion: { type: "contains", value: "$34" }, detail: "not found" }] },
      ],
    }),
  });
  const r = await at(s.url, "eval", "quality", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /quality 2 cases · blog-desk/);
  assert.match(r.out, /✓ short/);
  assert.match(r.out, /✗ cites[\s\S]*contains: \$34 — not found/);
  assert.match(r.out, /1\/2 passing · \$0\.1200/);
  assert.deepEqual(posts(s).map((p) => p.url), ["/api/workspaces/blog-desk/evals/quality/run"]);
});

test("eval --to starts the run and polls for its verdict, past a proxy's patience", async () => {
  let polls = 0;
  const s = await serve({
    "/api/workspaces/blog-desk/evals": () => ({ evals: [{ name: "quality", cases: [{}] }] }),
    "POST /api/workspaces/blog-desk/evals/quality/run": () => ({ __status: 202, body: { started: true, eval: "quality", runId: "abc123", startedAt: "2026-10-21T07:00:00Z" } }),
    "GET /api/workspaces/blog-desk/evals/quality/run": (_b: string, q: URLSearchParams) => {
      assert.equal(q.get("run"), "abc123", "polled by its own run id");
      return ++polls < 2
        ? { runId: "abc123", state: "running", running: true, startedAt: "2026-10-21T07:00:00Z" }
        : { runId: "abc123", state: "done", running: false, result: { eval: "quality", passed: 1, failed: 0, costUsd: 0.05, cases: [{ name: "short", passed: true, assertions: [] }] } };
    },
  });
  process.env.FOLDRUN_EVAL_POLL_MS = "10";
  const r = await at(s.url, "eval", "quality", "--to", "blog-desk");
  delete process.env.FOLDRUN_EVAL_POLL_MS;
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /✓ short/);
  assert.equal(polls, 2);
  assert.deepEqual(posts(s).map((p) => p.body), [{ async: true }]);
});

test("eval --to --last reads the latest result and starts nothing", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/evals": () => ({ evals: [{ name: "quality", cases: [{}] }] }),
    "GET /api/workspaces/blog-desk/evals/quality/run": () => ({ running: false, result: { eval: "quality", passed: 0, failed: 1, costUsd: 0, cases: [{ name: "short", passed: false, assertions: [] }] } }),
  });
  const r = await at(s.url, "eval", "quality", "--to", "blog-desk", "--last");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /✗ short/);
  assert.deepEqual(posts(s), []);
});

test("eval --to --run reads that run's verdict; a lost run exits 1, never passes", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/evals": () => ({ evals: [{ name: "quality", cases: [{}] }] }),
    "GET /api/workspaces/blog-desk/evals/quality/run": (_b: string, q: URLSearchParams) =>
      q.get("run") === "gone"
        ? { runId: "gone", state: "lost", running: false, error: "the run stopped reporting before it saved a result" }
        : { runId: "ok1", state: "done", running: false, result: { eval: "quality", passed: 1, failed: 0, costUsd: 0, cases: [{ name: "short", passed: true, assertions: [] }] } },
  });
  const ok = await at(s.url, "eval", "quality", "--to", "blog-desk", "--run", "ok1");
  const lost = await at(s.url, "eval", "quality", "--to", "blog-desk", "--run", "gone");
  assert.equal(ok.code, 0, ok.out);
  assert.equal(lost.code, 1, lost.out);
  assert.match(lost.out, /stopped reporting/);
  const bare = await at(s.url, "eval", "quality", "--to", "blog-desk", "--run");
  const unnamed = await at(s.url, "eval", "--to", "blog-desk", "--run", "ok1");
  s.close();
  assert.equal(bare.code, 1);
  assert.match(bare.out, /--run takes the run id/);
  assert.equal(unnamed.code, 1);
  assert.match(unnamed.out, /name it/);
  assert.deepEqual(posts(s), [], "nothing is ever started by --run");
});

test("promote sends the eval, the case and every --expect line", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/runs/run-1": () => done,
    "POST /api/workspaces/blog-desk/runs/run-1/promote": () => ({ ok: true, file: "evals/pricing.md", created: true, caseName: "run-1" }),
  });
  const r = await at(s.url, "promote", "run-1", "--to", "blog-desk", "--eval", "pricing", "--expect", "contains: $34", "--expect", "judge: names the buyer");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(posts(s)[0].body, { evalName: "pricing", expect: ["contains: $34", "judge: names the buyer"] });
  assert.match(r.out, /created evals\/pricing\.md/);
  assert.match(r.out, /foldrun eval pricing --to blog-desk/);
});

// ------------------------------------------------------------------ bulk

function bulkPlatform(matched: Record<string, string[]>) {
  const routes: Record<string, (b: string) => unknown> = { "/api/workspaces": () => WORKSPACES };
  for (const ws of ["blog-desk", "rank-desk"]) {
    routes[`POST /api/workspaces/${ws}/runs/bulk`] = (b) => {
      const body = JSON.parse(b);
      if (body.dryRun) return { ok: true, dryRun: true, matched: matched[ws] ?? [] };
      return { ok: true, runs: body.runIds.map((id: string) => ({ runId: id, ok: true, ...(body.action === "rerun" ? { newRunId: `${id}-again` } : {}) })) };
    };
  }
  return serve(routes);
}

test("stop with a filter lists every match across the account, asks, and stops only those", async () => {
  const s = await bulkPlatform({ "blog-desk": ["run-a", "run-b"], "rank-desk": ["run-c"] });
  const r = await at(s.url, "stop", "--status", "running,queued", "--since", "2h", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /blog-desk\s+2 runs[\s\S]*run-a[\s\S]*rank-desk\s+1 run/);
  const sent = posts(s);
  const dry = sent.filter((p) => p.body.dryRun);
  assert.equal(dry.length, 2);
  assert.deepEqual(dry[0].body.status, ["running", "queued"]);
  assert.ok(Date.now() - Date.parse(dry[0].body.since) > 7_100_000, "since is two hours back, as an instant");
  const real = sent.filter((p) => !p.body.dryRun);
  assert.deepEqual(real.map((p) => p.body), [{ action: "stop", runIds: ["run-a", "run-b"] }, { action: "stop", runIds: ["run-c"] }]);
  assert.match(r.out, /3 of 3 stopped/);
});

test("bulk rerun --dry-run and a pipe without --yes touch nothing", async () => {
  const s = await bulkPlatform({ "blog-desk": ["run-a"] });
  const dry = await at(s.url, "rerun", "--status", "failed", "--flow", "hourly", "--to", "blog-desk", "--from", "2", "--dry-run");
  const piped = await at(s.url, "rerun", "--status", "failed", "--to", "blog-desk");
  s.close();
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /1 run would be rerun from step 2; nothing touched/);
  assert.equal(piped.code, 1);
  assert.match(piped.out, /needs a person/);
  assert.ok(posts(s).every((p) => p.body.dryRun), "only dry runs were sent");
  assert.deepEqual(posts(s)[0].body, { action: "rerun", status: ["failed"], flow: "hourly", from: 2, dryRun: true });
});

test("bulk rerun --yes reports each new run", async () => {
  const s = await bulkPlatform({ "blog-desk": ["run-a"] });
  const r = await at(s.url, "rerun", "--status", "failed", "--to", "blog-desk", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /run-a → run-a-again/);
  assert.deepEqual(posts(s).at(-1)!.body, { action: "rerun", runIds: ["run-a"], from: 1 });
});

// ------------------------------------------------------------------ runs rm, report get

test("runs rm asks, and deletes only with --yes", async () => {
  const routes = {
    "/api/workspaces/blog-desk/runs/run-1": () => done,
    "DELETE /api/workspaces/blog-desk/runs/run-1": () => ({ ok: true, deleted: "run-1" }),
  };
  const s = await serve(routes);
  const piped = await at(s.url, "runs", "rm", "run-1", "--to", "blog-desk");
  const yes = await at(s.url, "runs", "rm", "run-1", "--to", "blog-desk", "--yes");
  s.close();
  assert.equal(piped.code, 1);
  assert.match(piped.out, /runs rm needs a person/);
  assert.equal(yes.code, 0, yes.out);
  assert.match(yes.out, /run-1 deleted from blog-desk/);
  assert.equal(s.seen.filter((x) => x.method === "DELETE").length, 1);
});

test("runs doctor asks the assistant about that run (FOL-22), and needs a run id", async () => {
  const s = await serve({
    "POST /api/workspaces/blog-desk/assistant": () => ({
      reply: "Cause: check\nThe verify graded the wording.",
      files: [],
      issues: [],
      sources: [],
      supply: "provider",
      workspace: null,
      usage: null,
      chargedUsd: null,
    }),
  });
  const ok = await at(s.url, "runs", "doctor", "run-1", "--to", "blog-desk");
  const bad = await at(s.url, "runs", "doctor", "--to", "blog-desk");
  s.close();
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /Cause: check/);
  const sent = posts(s).at(-1)!.body as { messages: { role: string; content: string }[] };
  assert.match(sent.messages.at(-1)!.content, /^Doctor: why did run run-1 fail/);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /foldrun runs doctor <run-id>/);
});

test("issues doctor asks the run doctor about the issue's newest run, in that run's workspace", async () => {
  const issue = (kind: string, runs: unknown[]) => ({ issue: { id: "iss_abc123", kind, status: "open", workspace: "rank-desk", workspaces: ["rank-desk"], what: "rankings", runs, history: [] } });
  const s = await serve({
    "/api/issues/iss_abc123": () => issue("blocked", [{ workspace: "rank-desk", id: "run-new", at: "2026-10-19T01:00:00Z" }, { workspace: "rank-desk", id: "run-old", at: "2026-10-18T01:00:00Z" }]),
    "/api/issues/iss_missed1": () => ({ issue: { ...issue("missed", [{ workspace: "rank-desk", id: "miss-1", at: "2026-10-19T01:00:00Z", missed: true }]).issue, id: "iss_missed1" } }),
    "POST /api/workspaces/rank-desk/assistant": () => ({ reply: "Cause: outside\nThe balance is empty.", files: [], issues: [], sources: [], supply: "provider", workspace: null, usage: null, chargedUsd: null }),
  });
  const ok = await at(s.url, "issues", "doctor", "iss_abc123");
  const missed = await at(s.url, "issues", "doctor", "iss_missed1");
  const bad = await at(s.url, "issues", "doctor");
  s.close();
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /Cause: outside/);
  // The newest run, worded as the run page's Doctor words a BLOCKED one, sent
  // to that run's workspace with no --to given.
  const sent = posts(s).at(-1)!.body as { messages: { role: string; content: string }[] };
  assert.equal(sent.messages.at(-1)!.content, "Doctor: why did run run-new end BLOCKED, and how do I fix it?");
  assert.equal(missed.code, 1);
  assert.match(missed.out, /missed schedule: no run started/);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /foldrun issues doctor <issue-id>/);
});

test("report get downloads an archived file, and will not clobber one", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/runs/run-1": () => done,
    "/api/workspaces/blog-desk/runs/run-1/archive": (_b, q) => (q.get("agent") === "writer" && q.get("path") === "draft/post.md" ? raw("# hello\n", "text/plain") : failing(404, { error: "no such output" })),
  });
  const file = tmpFile("post.md");
  const r = await at(s.url, "report", "run-1", "get", "writer/draft/post.md", "--to", "blog-desk", "--file", file);
  const again = await at(s.url, "report", "run-1", "get", "writer/draft/post.md", "--to", "blog-desk", "--file", file);
  const missing = await at(s.url, "report", "run-1", "get", "writer/nope.md", "--to", "blog-desk", "--file", tmpFile("x"));
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(file, "utf8"), "# hello\n");
  assert.match(again.out, /already exists/);
  assert.match(missing.out, /no such output/);
});

// ------------------------------------------------------------------ observe, usage

const observation = (ws: string, failedRuns: number) => ({
  workspace: ws, sinceDays: 30, from: null, runs: 10, failedRuns, steps: 30, costUsd: 1.5,
  flows: [{ flow: "hourly", runs: 10, failed: failedRuns, seconds: { n: 10, p50: 60, p95: 120, max: 200 }, costUsd: 1.5 }],
  agents: [{ agent: "writer", steps: 10, failed: failedRuns, retried: 1, skipped: 0, costUsd: 1, inputTokens: 1, outputTokens: 1, seconds: { n: 10, p50: 5, p95: 9, max: 9 } }],
  tools: [{ name: "serp_check", calls: 20, errors: 2, measured: 20, ms: { n: 20, p50: 100, p95: 900, max: 1000 }, agents: ["writer"] }],
  days: [],
  failures: failedRuns ? [{ runId: `run-${ws}`, flow: "hourly", agent: "writer", at: "2026-09-29T01:00:00Z", attempts: 2, text: "HTTP 500 from serp" }] : [],
});

test("observe, account-wide: one row per workspace and the recent failures", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/observe": () => observation("blog-desk", 2),
    "/api/workspaces/rank-desk/observe": () => observation("rank-desk", 0),
  });
  const r = await at(s.url, "observe", "--since", "7");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /✗ blog-desk\s+10\s+2 20%/);
  assert.match(r.out, /✓ rank-desk/);
  assert.match(r.out, /HTTP 500 from serp/);
  assert.ok(s.seen.filter((x) => x.url.endsWith("/observe")).every((x) => x.query.get("days") === "7"));
});

test("observe --to prints the flows, agents and tools of one workspace", async () => {
  const s = await serve({ "/api/workspaces/blog-desk/observe": () => observation("blog-desk", 1) });
  const r = await at(s.url, "observe", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /hourly\s+10\s+1\s+1m\s+2m\s+\$1\.50/);
  // No result sizes recorded (a record from before 18 Oct 2026): dashes, not zeros.
  assert.match(r.out, /serp_check\s+20\s+2\s+900ms\s+—\s+—\s+writer/);
  assert.match(r.out, /recent failures/);
});

test("observe --to prints turns per agent and result sizes per tool", async () => {
  const base = observation("blog-desk", 0);
  const s = await serve({
    "/api/workspaces/blog-desk/observe": () => ({
      ...base,
      agents: [{ agent: "reader", steps: 6, failed: 0, retried: 0, skipped: 0, costUsd: 1, seconds: { n: 6, p50: 30, p95: 60, max: 61 }, turns: { n: 6, p50: 12, p95: 40, max: 41 }, cacheHitRate: 0.8 }],
      tools: [{ name: "Read", calls: 30, errors: 0, measured: 0, ms: { n: 0, p50: null, p95: null, max: null }, resultSize: { n: 30, p50: 1200, p95: 52_000, max: 90_000 }, resultChars: 400_000, heavyCalls: 4, agents: ["reader"] }],
    }),
  });
  const r = await at(s.url, "observe", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /reader\s+6\s+0\s+0\s+0\s+\S+\s+12\/40\s+80%/);
  assert.match(r.out, /Read\s+30\s+0\s+—\s+1k\/52k\s+4\s+reader/);
});

test("observe --to prints where the steps' first seconds went, phase by phase", async () => {
  const startup = [
    { phase: "ready", took: { n: 30, p50: 0.86, p95: 3.4, max: 9 }, at: { n: 30, p50: 1.2, p95: 4, max: 9 } },
    { phase: "model", took: { n: 3, p50: null, p95: null, max: 5 }, at: { n: 3, p50: null, p95: null, max: 12 } },
  ];
  const s = await serve({ "/api/workspaces/blog-desk/observe": () => ({ ...observation("blog-desk", 0), startup }) });
  const r = await at(s.url, "observe", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /start-up\s+n\s+took p50/);
  assert.match(r.out, /ready\s+30\s+860ms\s+3\.40s\s+1\.20s\s+4\.00s/);
  // too few samples for a percentile: an em dash, never a made-up number
  assert.match(r.out, /model\s+3\s+—\s+—\s+—\s+—/);
});

test("usage prints what was consumed and what was charged", async () => {
  const s = await serve({
    "/api/usage": () => ({
      tenant: "acme", totals: { runs: 12, steps: 40, inputTokens: 1000, outputTokens: 500, computeSecs: 600, modelUsd: 2, platformUsd: 1, storageBytes: 2048 },
      workspaces: [{ workspace: "blog-desk", runs: 12, modelUsd: 2, platformUsd: 1, storage: { sourceBytes: 1024, filesBytes: 0, runsBytes: 1024 } }],
      ledger: { balanceUsd: 40 }, waived: [],
    }),
    "/api/usage/history": () => ({
      from: "2026-08-05T00:00:00Z", to: "2026-09-30T00:00:00Z", bucket: "week", periods: [], byFlow: [], byAgent: [],
      byWorkspace: [{ name: "blog-desk", totalUsd: 3, runs: 12, periods: [], change: 0.5 }],
      unattributedUsd: 0, totalUsd: 3, modelUsd: 2, platformUsd: 1, unsplitUsd: 0,
    }),
  });
  const r = await at(s.url, "usage", "--days", "28");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /12 runs · 40 steps/);
  assert.match(r.out, /blog-desk\s+12 runs\s+\$3\.00/);
  assert.match(r.out, /\+50% vs the week before/);
  assert.equal(s.seen.find((x) => x.url === "/api/usage/history")!.query.get("days"), "28");
});

// ------------------------------------------------------------------ billing

test("billing statement: the table, and --csv writes the file", async () => {
  const s = await serve({
    "/api/billing/statement": (_b, q) =>
      q.get("format") === "csv"
        ? raw("# foldrun statement,2026-09\n", "text/csv", { "content-disposition": 'attachment; filename="foldrun-acme-2026-09.csv"' })
        : { month: q.get("month"), spentUsd: 4, addedUsd: 50, removedUsd: 0, rows: [{ t: "2026-09-02T00:00:00Z", kind: "run", label: "Run", usd: -4, workspace: "blog-desk", flow: "hourly" }] },
  });
  const table = await at(s.url, "billing", "statement", "2026-09");
  const file = tmpFile("s.csv");
  const csv = await at(s.url, "billing", "statement", "2026-09", "--csv", "--file", file);
  const bad = await at(s.url, "billing", "statement", "Sept");
  s.close();
  assert.equal(table.code, 0, table.out);
  assert.match(table.out, /statement 2026-09.*spent \$4\.00 · added \$50\.00/);
  assert.match(table.out, /blog-desk\/hourly/);
  assert.equal(fs.readFileSync(file, "utf8"), "# foldrun statement,2026-09\n");
  assert.match(bad.out, /YYYY-MM/);
});

test("billing wallet shows the runway, and set auto-top-up sends the settings", async () => {
  const s = await serve({
    "GET /api/billing/wallet": () => ({ enabled: true, summary: { balanceUsd: 20, burnPerDayUsd: 4, spend7dUsd: 28, spend30dUsd: 100, daysLeft: 5, emptyOn: "2026-10-05", monthToDateUsd: 90, suggestedTopUpUsd: 120 }, cardSaved: true, autoTopUp: null }),
    "PUT /api/billing/wallet": () => ({ ok: true }),
  });
  const show = await at(s.url, "billing", "wallet");
  const set = await at(s.url, "billing", "wallet", "set", "auto-top-up", "--threshold", "10", "--amount", "50");
  const off = await at(s.url, "billing", "wallet", "set", "auto-top-up", "off");
  const bad = await at(s.url, "billing", "wallet", "set", "auto-top-up", "--threshold", "10", "--amount", "900");
  s.close();
  assert.match(show.out, /about 5 days left at this burn — empty on 2026-10-05/);
  assert.match(show.out, /auto top-up\s+off/);
  assert.equal(set.code, 0, set.out);
  assert.deepEqual(posts(s, "PUT").map((p) => p.body), [{ autoTopUp: { enabled: true, thresholdUsd: 10, amountUsd: 50 } }, { autoTopUp: null }]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /between 5 and 500/);
});

test("billing details set merges with what is there, and a 403 says it is the owner's", async () => {
  let refuse = false;
  const s = await serve({
    "GET /api/billing/details": () => ({ details: { legalName: "Acme Pty Ltd", email: "ap@acme.test" }, stripe: true, customer: true, tax: false }),
    "PUT /api/billing/details": (b) => (refuse ? failing(403, { error: "forbidden" }) : { ok: true, details: JSON.parse(b), synced: true }),
  });
  const r = await at(s.url, "billing", "details", "set", "--abn", "51824753556", "--address", "1 Main St, Sydney, NSW, 2000, au");
  refuse = true;
  const no = await at(s.url, "billing", "details", "set", "--name", "X");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(posts(s, "PUT")[0].body, {
    legalName: "Acme Pty Ltd", email: "ap@acme.test", abn: "51824753556",
    address: { line1: "1 Main St", city: "Sydney", state: "NSW", postcode: "2000", country: "AU" },
  });
  assert.match(r.out, /made out to Acme Pty Ltd · ABN 51824753556/);
  assert.equal(no.code, 1);
  assert.match(no.out, /the account owner's alone/);
});

test("billing portal prints the URL, and a 403 is said plainly", async () => {
  let refuse = false;
  const s = await serve({ "POST /api/billing/portal": () => (refuse ? failing(403, { error: "forbidden: needs billing:manage" }) : { ok: true, url: "https://billing.stripe.test/session/x" }) });
  const r = await at(s.url, "billing", "portal");
  refuse = true;
  const no = await at(s.url, "billing", "portal");
  s.close();
  assert.match(r.out, /https:\/\/billing\.stripe\.test\/session\/x/);
  assert.match(no.out, /the billing portal is the account owner's alone/);
});

// ------------------------------------------------------------------ workspace, notify, history

test("workspace set timezone PATCHes it; set notify merges with the file; rename asks", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/source": () => ({ path: "AGENTS.md", content: "---\nnotify:\n  url: https://hooks.test/x\n  events: [failed]\n---\n" }),
    "PATCH /api/workspaces/blog-desk": (b) => ({ ok: true, name: JSON.parse(b).name ?? "blog-desk", renamed: !!JSON.parse(b).name, defaults: { timezone: "Australia/Sydney", budget: null, notify: null }, brokeWebhooks: JSON.parse(b).name ? ["inbound"] : [] }),
  });
  const tz = await at(s.url, "workspace", "set", "timezone", "Australia/Sydney", "--to", "blog-desk");
  const notify = await at(s.url, "workspace", "set", "notify", "email", "ops@acme.test", "--to", "blog-desk");
  const piped = await at(s.url, "workspace", "set", "name", "blog", "--to", "blog-desk");
  const rename = await at(s.url, "workspace", "set", "name", "blog", "--to", "blog-desk", "--yes");
  const clear = await at(s.url, "workspace", "clear", "budget", "--to", "blog-desk");
  s.close();
  assert.equal(tz.code, 0, tz.out);
  assert.deepEqual(posts(s, "PATCH").map((p) => p.body), [
    { timezone: "Australia/Sydney" },
    { notify: { url: "https://hooks.test/x", email: "ops@acme.test", events: ["failed"] } },
    { name: "blog" },
    { budget: null },
  ]);
  assert.equal(piped.code, 1);
  assert.match(piped.out, /renaming a workspace needs a person/);
  assert.match(rename.out, /renamed to blog/);
  assert.match(rename.out, /webhook URLs changed for inbound/);
  assert.match(clear.out, /budget cleared/);
});

test("notify test says where it went, and exits 1 when it did not", async () => {
  let ok = true;
  const s = await serve({ "POST /api/workspaces/blog-desk/notify/test": () => (ok ? { ok: true, destination: "ops@acme.test", detail: "accepted by Resend for delivery" } : { ok: false, destination: "ops@acme.test", detail: "HTTP 403 from Resend — domain not verified" }) });
  const good = await at(s.url, "notify", "test", "--to", "blog-desk");
  ok = false;
  const bad = await at(s.url, "notify", "test", "--to", "blog-desk");
  s.close();
  assert.equal(good.code, 0);
  assert.match(good.out, /✓ ops@acme\.test/);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /domain not verified/);
});

test("history lists revisions, and --id prints one as diffs", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/history": (_b, q) =>
      q.get("id")
        ? { id: "r-1", at: "2026-09-29T01:00:00Z", by: "dev@acme.test", message: "flow edited on the canvas", commit: null, files: [{ path: "flows/hourly.md", diff: [{ kind: "same", text: "1. [[a]]" }, { kind: "add", text: "2. [[b]]" }] }] }
        : { revisions: [{ id: "r-1", at: "2026-09-29T01:00:00Z", by: "dev@acme.test", message: "flow edited on the canvas", commit: null, paths: ["flows/hourly.md"] }] },
  });
  const list = await at(s.url, "history", "flows/hourly.md", "--to", "blog-desk");
  const one = await at(s.url, "history", "--id", "r-1", "--to", "blog-desk");
  s.close();
  assert.match(list.out, /r-1.*dev@acme\.test\s+flow edited on the canvas/);
  assert.equal(s.seen[0].query.get("path"), "flows/hourly.md");
  assert.match(one.out, /\+ 2\. \[\[b\]\]/);
});

test("repo is gone with the platform's own git, and says where history and rollback went", async () => {
  const s = await serve({});
  const r = await at(s.url, "repo", "ls", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 1);
  assert.match(r.out, /foldrun history/);
  assert.match(r.out, /foldrun restore/);
  assert.equal(s.seen.length, 0, "nothing was asked of the platform");
});

test("flow rotate-hook asks, then prints the new URL", async () => {
  const s = await serve({ "POST /api/workspaces/blog-desk/hooks/inbound/rotate": () => ({ ok: true, path: "/api/hooks/acme/blog-desk/inbound?token=new" }) });
  const piped = await at(s.url, "flow", "rotate-hook", "inbound", "--to", "blog-desk");
  const r = await at(s.url, "flow", "rotate-hook", "inbound", "--to", "blog-desk", "--yes");
  s.close();
  assert.equal(piped.code, 1);
  assert.match(piped.out, /rotating a webhook needs a person/);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\/api\/hooks\/acme\/blog-desk\/inbound\?token=new/);
  assert.equal(posts(s).length, 1);
});

test("flow hook prints the current URL with a GET and rotates nothing; --json is machine-readable", async () => {
  const s = await serve({
    "GET /api/workspaces/blog-desk/hooks/inbound": () => ({ ok: true, flow: "inbound", path: "/api/hooks/acme/blog-desk/inbound?token=cur", url: "https://dev.example/api/hooks/acme/blog-desk/inbound?token=cur" }),
  });
  const r = await at(s.url, "flow", "hook", "inbound", "--to", "blog-desk");
  const j = await at(s.url, "flow", "hook", "inbound", "--to", "blog-desk", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /https:\/\/dev\.example\/api\/hooks\/acme\/blog-desk\/inbound\?token=cur/);
  assert.equal(posts(s).length, 0, "reading a hook must never POST (rotate)");
  assert.deepEqual(JSON.parse(j.out.trim().split("\n").pop() ?? ""), { flow: "inbound", url: "https://dev.example/api/hooks/acme/blog-desk/inbound?token=cur", path: "/api/hooks/acme/blog-desk/inbound?token=cur" });
});

test("account export writes the file and counts what is in it; a 403 says owner only", async () => {
  let refuse = false;
  const body = JSON.stringify({ account: "acme", workspaces: [{}], members: [{}, {}], runs: [{}, {}, {}], ledger: [] });
  const s = await serve({ "/api/account/export": () => (refuse ? failing(403, { error: "forbidden" }) : raw(body, "application/json", { "content-disposition": 'attachment; filename="foldrun-acme-export.json"' })) });
  const file = tmpFile("export.json");
  const r = await at(s.url, "account", "export", "--file", file);
  refuse = true;
  const no = await at(s.url, "account", "export", "--file", tmpFile("x.json"));
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(file, "utf8"), body);
  assert.match(r.out, /1 workspaces · 3 runs · 2 members · 0 ledger lines/);
  assert.match(no.out, /account export is the account owner's alone/);
});

// ------------------------------------------------------------------ smaller gaps

test("invoke --tag sends tags, and flow run is invoke", async () => {
  const s = await serve({ "POST /api/workspaces/blog-desk/flows/hourly/run": () => ({ runId: "run-9" }) });
  const r = await at(s.url, "invoke", "hourly", "--to", "blog-desk", "--tag", "ci", "--tag", "nightly");
  const alias = await at(s.url, "flow", "run", "hourly", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(alias.out, /queued run-9/);
  const [first, second] = posts(s).map((p) => p.body);
  assert.deepEqual(first.tags, ["ci", "nightly"]);
  assert.equal(second.tags, undefined);
});

test("storage cat --preview prints a table and a deck as text", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/storage/preview": (_b, q) =>
      q.get("path") === "leads.xlsx"
        ? { kind: "table", sheets: [{ name: "Sheet1", rows: [["name", "suburb"], ["Ann", "Tarneit"]], truncated: false }] }
        : { kind: "slides", slides: [{ title: "Q3", lines: ["up 20%"] }] },
  });
  const t = await at(s.url, "storage", "cat", "leads.xlsx", "--preview", "--to", "blog-desk");
  const d = await at(s.url, "storage", "cat", "deck.pptx", "--preview", "--to", "blog-desk");
  s.close();
  assert.equal(t.code, 0, t.out);
  assert.match(t.out, /name\s+suburb\nAnn\s+Tarneit/);
  assert.match(d.out, /slide 1: Q3\n\s+up 20%/);
  assert.ok(!s.seen.some((x) => x.url.endsWith("/download")), "the file itself was not fetched");
});

test("help: every flag the CLI reads is listed, --from once per context, gallery names only web", async () => {
  const all = (await cli(["--help"])).out;
  for (const flag of ["--verdict", "--question", "--quiet", "--new-client", "--engine", "--tag", "--preview", "--expect"]) {
    assert.match(all, new RegExp(`^\\s+${flag}\\b`, "m"), `${flag} is in --help`);
  }
  assert.doesNotMatch(all, /web_browse|web_search|web_fetch/);
  const init = (await cli(["init", "--help"])).out;
  assert.equal(init.match(/--from/g)?.length, 1);
  assert.match(init, /--from <template>\s+init:/);
  const invoke = (await cli(["invoke", "--help"])).out;
  assert.match(invoke, /--from <n>\s+invoke/);
  assert.doesNotMatch(invoke, /--from <template>/);
  const runs = (await cli(["runs", "--help"])).out;
  assert.match(runs, /--local prints exactly what logs --local prints/);
  // A flag whose argument is quoted, or several flags on one line, still
  // shows under the command it names.
  assert.match((await cli(["approve", "--help"])).out, /--note "<text>"\s+approve, reject:/);
  assert.match((await cli(["billing", "--help"])).out, /--threshold \/ --amount/);
  const gallery = (await cli(["gallery", "--help"])).out;
  assert.match(gallery, /built-in tools \(web\)/);
});

test("--help on the new platform verbs contacts nothing", async () => {
  const s = await serve({});
  for (const args of [["observe"], ["usage"], ["billing", "portal"], ["repo", "deploy", "x"], ["runs", "rm", "run-1"], ["stop", "--status", "running"], ["account", "export"], ["workspace", "set", "name", "x"], ["notify", "test"], ["flow", "rotate-hook", "x"], ["flow", "hook", "x"]]) {
    const r = await at(s.url, ...args, "--help");
    assert.equal(r.code, 0, `${args.join(" ")}: ${r.out}`);
  }
  s.close();
  assert.deepEqual(s.seen, []);
});

test("workspace, bare, reads the settings out of the deployed AGENTS.md", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/source": () => ({ path: "AGENTS.md", content: "---\ndescription: The blog.\ntimezone: Australia/Sydney\nbudget: 20/week\n---\n" }),
  });
  const r = await at(s.url, "workspace", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /description\s+The blog\./);
  assert.match(r.out, /timezone\s+Australia\/Sydney/);
  assert.match(r.out, /budget\s+\$20 per week/);
  assert.match(r.out, /notify\s+the account's/);
});

test("runs --outcome (FOL-54) filters on the platform's outcome; needs-you is waiting; an unknown word is refused", async () => {
  const run = (id: string, outcome: string, status = "completed") => ({ id, flow: "daily", status, outcome, summary: `${outcome} run`, startedAt: "2026-10-19T00:00:00.000Z", finishedAt: "2026-10-19T00:01:00.000Z", costUsd: 0, steps: [] });
  const s = await serve({
    "/api/workspaces": () => ({ workspaces: [{ name: "blog-desk" }] }),
    "/api/workspaces/blog-desk/runs": () => ({ runs: [run("r1", "good"), run("r2", "blocked"), run("r3", "waiting", "awaiting-approval"), run("r4", "failed", "failed")] }),
  });
  const blocked = await at(s.url, "runs", "--outcome", "blocked,failed", "--to", "blog-desk");
  const needs = await at(s.url, "runs", "--outcome", "needs-you", "--to", "blog-desk");
  const bad = await at(s.url, "runs", "--outcome", "broken", "--to", "blog-desk");
  s.close();
  assert.equal(blocked.code, 0, blocked.out);
  assert.match(blocked.out, /r2/);
  assert.match(blocked.out, /r4/);
  assert.doesNotMatch(blocked.out, /\br1\b/);
  assert.match(needs.out, /r3/);
  assert.doesNotMatch(needs.out, /\br2\b/);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /--outcome takes running, queued/);
});

test("runs shows what a run was charged, in credits, once the ledger settled it (FOL-54)", async () => {
  const base = { flow: "daily", status: "completed", outcome: "good", summary: "", startedAt: "2026-10-19T00:00:00.000Z", finishedAt: "2026-10-19T00:01:00.000Z", steps: [{ agent: "a", status: "completed", costUsd: 0.5 }] };
  const s = await serve({
    "/api/workspaces": () => ({ workspaces: [{ name: "blog-desk" }] }),
    "/api/workspaces/blog-desk/runs": () => ({ runs: [{ ...base, id: "settled", chargedUsd: 1.23 }, { ...base, id: "fresh", chargedUsd: null }] }),
  });
  const r = await at(s.url, "runs", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /123 credits[^\n]*settled/);
  assert.match(r.out, /\$0\.50[^\n]*fresh/, "not settled: the token cost, in dollars");
});

test("runs searches by what happened inside a run, and opens a saved view (FOL-72 step 9)", async () => {
  const run = (id: string) => ({ id, flow: "daily", status: "completed", outcome: "good", summary: "", startedAt: "2026-10-19T00:00:00.000Z", finishedAt: "2026-10-19T00:01:00.000Z", costUsd: 0, steps: [] });
  const s = await serve({
    "/api/workspaces": () => ({ workspaces: [{ name: "blog-desk" }] }),
    "/api/workspaces/blog-desk/runs": () => ({ runs: [run("r1")] }),
    "/api/me/preferences": () => ({ theme: "system", runViews: [{ name: "web errors", query: "tool=web&tool_error=1" }, { name: "failed web", query: "status=failed&tool=web" }, { name: "today blog", query: "since=today&q=blog daily" }] }),
  });
  const flagged = await at(s.url, "runs", "--to", "blog-desk", "--tool", "web", "--tool-error", "--min-tokens", "50k");
  const viewed = await at(s.url, "runs", "--to", "blog-desk", "--view", "web errors");
  const missing = await at(s.url, "runs", "--to", "blog-desk", "--view", "nope");
  const views = await at(s.url, "runs", "views");
  const failedWeb = await at(s.url, "runs", "--to", "blog-desk", "--view", "failed web");
  const todayBlog = await at(s.url, "runs", "--to", "blog-desk", "--view", "today blog");
  s.close();
  assert.equal(flagged.code, 0, flagged.out);
  const asked = s.seen.filter((x) => x.url === "/api/workspaces/blog-desk/runs");
  assert.equal(asked[0]!.query.get("tool"), "web");
  assert.equal(asked[0]!.query.get("tool_error"), "1");
  assert.equal(asked[0]!.query.get("min_tokens"), "50k");
  assert.equal(asked[1]!.query.get("tool"), "web", "the view's filters reach the platform");
  assert.equal(viewed.code, 0, viewed.out);
  assert.equal(missing.code, 1);
  assert.match(missing.out, /yours: web errors/);
  assert.match(views.out, /web errors {2}tool=web&tool_error=1/);
  assert.doesNotMatch(failedWeb.out, /\br1\b/, "the view's status=failed applies: the completed run is not listed (Codex review)");
  assert.equal(todayBlog.code, 0, todayBlog.out);
  assert.equal(s.seen.filter((x) => x.url === "/api/workspaces/blog-desk/runs").at(-1)!.query.get("limit"), "500", "a text filter widens the fetch");
});

test("promote --should turns a run that went wrong into a test (FOL-72 step 10)", async () => {
  const s = await serve({ "POST /api/workspaces/blog-desk/runs/run-bad/promote": () => ({ ok: true, file: "evals/daily-regressions.md", created: true, caseName: "run run-bad (2026-10-19)" }) });
  const r = await at(s.url, "promote", "run-bad", "--to", "blog-desk", "--should", "quotes the two newest filings");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "POST")!.body), { should: "quotes the two newest filings" });
});

test("saved views match as the dashboard does: stopped is its own status, an error's words are searchable (Codex review)", async () => {
  const base = { flow: "daily", summary: "", startedAt: "2026-10-19T00:00:00.000Z", finishedAt: "2026-10-19T00:01:00.000Z", costUsd: 0, steps: [] };
  const s = await serve({
    "/api/workspaces/blog-desk/runs": () => ({ runs: [
      { ...base, id: "r-stopped", status: "failed", outcome: "stopped", failure: null },
      { ...base, id: "r-failed", status: "failed", outcome: "failed", failure: { agent: "writer", reason: "web: 403 forbidden" } },
    ] }),
    "/api/me/preferences": () => ({ runViews: [{ name: "stopped", query: "status=stopped" }, { name: "forbidden", query: "q=403 forbidden" }] }),
  });
  const stopped = await at(s.url, "runs", "--to", "blog-desk", "--view", "stopped");
  const failed = await at(s.url, "runs", "--to", "blog-desk", "--status", "failed");
  const forbidden = await at(s.url, "runs", "--to", "blog-desk", "--view", "forbidden");
  s.close();
  assert.match(stopped.out, /r-stopped/);
  assert.doesNotMatch(stopped.out, /r-failed/);
  assert.doesNotMatch(failed.out, /r-stopped/, "a stopped run is not a failed one");
  assert.match(forbidden.out, /r-failed/);
  assert.doesNotMatch(forbidden.out, /r-stopped/);
});

test("a saved view's flow names a direct agent or an eval as the dashboard does (Codex review)", async () => {
  const base = { status: "completed", outcome: "good", summary: "", startedAt: "2026-10-19T00:00:00.000Z", finishedAt: "2026-10-19T00:01:00.000Z", costUsd: 0, steps: [] };
  const s = await serve({
    "/api/workspaces/blog-desk/runs": () => ({ runs: [{ ...base, id: "r-agent", flow: "adhoc:writer" }, { ...base, id: "r-flow", flow: "daily" }] }),
    "/api/me/preferences": () => ({ runViews: [{ name: "writer", query: "flow=writer" }] }),
  });
  const r = await at(s.url, "runs", "--to", "blog-desk", "--view", "writer");
  s.close();
  assert.match(r.out, /r-agent/);
  assert.doesNotMatch(r.out, /r-flow/);
});
