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
  assert.match(r.out, /serp_check\s+20\s+2\s+900ms\s+writer/);
  assert.match(r.out, /recent failures/);
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

// ------------------------------------------------------------------ workspace, notify, history, repo

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

test("repo ls, and deploy/merge ask before they change what is live", async () => {
  const s = await serve({
    "GET /api/workspaces/blog-desk/repo": () => ({ main: "abcdef1234", branches: [{ name: "main", sha: "abcdef1234", subject: "deploy", at: "2026-09-29T01:00:00Z" }, { name: "tweak", sha: "1234567890", subject: "tighten", at: "2026-09-29T02:00:00Z" }], tags: [], settings: {} }),
    "POST /api/workspaces/blog-desk/repo": (b) => (JSON.parse(b).action === "merge" ? { applied: false, issues: [{ where: "flows/x.md", message: "no steps" }] } : { applied: true, sha: "1234567", main: "9999999aaa" }),
  });
  const ls = await at(s.url, "repo", "ls", "--to", "blog-desk");
  const piped = await at(s.url, "repo", "deploy", "1234567", "--to", "blog-desk");
  const deploy = await at(s.url, "repo", "deploy", "1234567", "--to", "blog-desk", "--yes");
  const merge = await at(s.url, "repo", "merge", "tweak", "--to", "blog-desk", "--yes");
  s.close();
  assert.match(ls.out, /main abcdef1/);
  assert.match(ls.out, /tweak\s+1234567\s+tighten/);
  assert.equal(piped.code, 1);
  assert.match(deploy.out, /1234567 is live in blog-desk · main 9999999/);
  assert.equal(merge.code, 1);
  assert.match(merge.out, /flows\/x\.md\s+no steps/);
  assert.deepEqual(posts(s).map((p) => p.body), [{ action: "deploy", ref: "1234567" }, { action: "merge", branch: "tweak" }]);
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
  for (const args of [["observe"], ["usage"], ["billing", "portal"], ["repo", "deploy", "x"], ["runs", "rm", "run-1"], ["stop", "--status", "running"], ["account", "export"], ["workspace", "set", "name", "x"], ["notify", "test"], ["flow", "rotate-hook", "x"]]) {
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
