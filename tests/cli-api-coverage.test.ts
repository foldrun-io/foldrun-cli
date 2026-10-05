// The platform routes the CLI had no verb for (5 Oct 2026): what a workspace
// holds, its agents and flows, what could be imported, New for every kind
// (agents, flows, evals, assets, the library, a workspace), the restore
// requests, the status page's history, the team, runs/bulk's `until`, and
// the manual billing credit. Each test asserts the request the dashboard
// sends — method, path, body — against a fake platform.
//
//   node --test tests/cli-api-coverage.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, at, cli, failing, WORKSPACES } from "./fake-platform.ts";

const writes = (s: { seen: { method: string; url: string; body: string }[] }) =>
  s.seen.filter((x) => x.method !== "GET").map((x) => ({ method: x.method, url: x.url, body: x.body ? JSON.parse(x.body) : null }));
const json = (out: string) => JSON.parse(out.slice(out.search(/[[{]/)));

const AGENTS = [
  { name: "researcher", description: "Finds sources.", model: "fast", effort: null, tools: [] },
  { name: "writer", description: "Drafts it.", model: "max", effort: "high", tools: [] },
];
const FLOWS = [
  { name: "publish", file: "flows/publish.md", trigger: "manual", schedule: null, timezone: null },
  { name: "nightly", file: "flows/nightly.md", trigger: "schedule", schedule: "0 3 * * *", timezone: "Australia/Sydney" },
];

// ------------------------------------------------------------ reading a workspace

test("workspaces show <name> reads GET /api/workspaces/<name>: agents, flows, files by folder", async () => {
  const doc = { name: "blog desk", agents: AGENTS, flows: FLOWS, files: ["AGENTS.md", "agents/researcher/agent.md", "agents/writer/agent.md", "flows/publish.md", "flows/nightly.md"] };
  const s = await serve({ "/api/workspaces/blog%20desk": () => doc });
  const r = await at(s.url, "workspaces", "show", "blog desk");
  const j = await at(s.url, "workspaces", "show", "blog desk", "--json");
  const none = await at(s.url, "workspaces", "show");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen[0].method, "GET");
  assert.equal(s.seen[0].url, "/api/workspaces/blog%20desk", "the name is encoded");
  assert.match(r.out, /2 agents, 2 flows, 5 files/);
  assert.match(r.out, /researcher\s+fast\s+Finds sources\./);
  assert.match(r.out, /nightly\s+schedule 0 3 \* \* \* Australia\/Sydney/);
  assert.match(r.out, /agents\/ 2\s+flows\/ 2/);
  assert.deepEqual(json(j.out), doc);
  assert.equal(none.code, 1);
  assert.match(none.out, /which workspace\?/);
});

test("agent ls / flow ls read GET …/agents and …/flows of the workspace --to names", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/agents": () => ({ agents: AGENTS }),
    "/api/workspaces/blog-desk/flows": () => ({ flows: FLOWS }),
  });
  const a = await at(s.url, "agent", "ls", "--to", "blog-desk");
  const f = await at(s.url, "flow", "ls", "--to", "blog-desk");
  const aj = await at(s.url, "agent", "ls", "--to", "blog-desk", "--json");
  s.close();
  assert.equal(a.code, 0, a.out);
  assert.match(a.out, /writer\s+max\s+Drafts it\./);
  assert.match(a.out, /2 agents · blog-desk/);
  assert.equal(f.code, 0, f.out);
  assert.match(f.out, /publish\s+manual/);
  assert.match(f.out, /nightly\s+schedule 0 3 \* \* \*/);
  assert.deepEqual(json(aj.out), AGENTS);
  assert.deepEqual(s.seen.map((x) => `${x.method} ${x.url}`), ["GET /api/workspaces/blog-desk/agents", "GET /api/workspaces/blog-desk/flows", "GET /api/workspaces/blog-desk/agents"]);
});

test("agent import --list reads GET …/agents/import and imports nothing", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/agents/import": () => ({ workspaces: [{ name: "rank-desk", agents: [{ name: "auditor", description: "Audits pages." }] }] }),
  });
  const r = await at(s.url, "agent", "import", "--list", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /rank-desk\/auditor\s+Audits pages\./);
  assert.match(r.out, /foldrun agent import <workspace>\/<agent> --to blog-desk/);
  assert.deepEqual(writes(s), [], "a list, never a POST");
});

// ------------------------------------------------------------ New, on the platform

test("agent new --platform posts { name, description, model } to …/agents; nothing written here", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cov-"));
  const s = await serve({ "POST /api/workspaces/blog-desk/agents": () => ({ ok: true, path: "agents/checker/agent.md" }) });
  const r = await cli(["agent", "new", "checker", "--platform", "--to", "blog-desk", "--description", "Checks facts.", "--model", "max", "--url", s.url, "--token", "k"], { cwd });
  const bare = await cli(["agent", "new", "editor", "--platform", "--to", "blog-desk", "--url", s.url, "--token", "k"], { cwd });
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /created agent checker in blog-desk/);
  assert.match(r.out, /agents\/checker\/agent\.md/);
  assert.deepEqual(writes(s), [
    { method: "POST", url: "/api/workspaces/blog-desk/agents", body: { name: "checker", description: "Checks facts.", model: "max" } },
    { method: "POST", url: "/api/workspaces/blog-desk/agents", body: { name: "editor" } },
  ]);
  assert.equal(bare.code, 0, bare.out);
  assert.deepEqual(fs.readdirSync(cwd), [], "the folder is untouched");
});

test("flow new --platform posts { name, pattern } to …/flows, and refuses a shape the platform lacks", async () => {
  const s = await serve({ "POST /api/workspaces/blog-desk/flows": (b) => ({ ok: true, path: `flows/${JSON.parse(b).name}.md`, pattern: JSON.parse(b).pattern ?? "pipeline" }) });
  const r = await at(s.url, "flow", "new", "review", "--platform", "--to", "blog-desk", "--pattern", "review-loop");
  const bad = await at(s.url, "flow", "new", "x", "--platform", "--to", "blog-desk", "--pattern", "spiral");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /flows\/review\.md · review-loop/);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /--pattern takes pipeline, review-loop, fan-out, debate, router/);
  assert.deepEqual(writes(s), [{ method: "POST", url: "/api/workspaces/blog-desk/flows", body: { name: "review", pattern: "review-loop" } }]);
});

test("tool new --platform posts kind tools to …/assets — a script tool by default, as here", async () => {
  const s = await serve({ "POST /api/workspaces/blog-desk/assets": () => ({ ok: true, path: "tools/uuid/tool.md", type: null }) });
  const r = await at(s.url, "tool", "new", "uuid", "--platform", "--to", "blog-desk", "--language", "python");
  const http = await at(s.url, "tool", "new", "crm", "--platform", "--to", "blog-desk", "--transport", "http");
  const web = await at(s.url, "tool", "new", "browse", "--platform", "--to", "blog-desk", "--template", "web");
  s.close();
  for (const x of [r, http, web]) assert.equal(x.code, 0, x.out);
  assert.deepEqual(writes(s), [
    { method: "POST", url: "/api/workspaces/blog-desk/assets", body: { kind: "tools", name: "uuid", template: "script", language: "python" } },
    { method: "POST", url: "/api/workspaces/blog-desk/assets", body: { kind: "tools", name: "crm", template: "http" } },
    { method: "POST", url: "/api/workspaces/blog-desk/assets", body: { kind: "tools", name: "browse", template: "web" } },
  ]);
});

test("without --platform, agent new --to still names a workspace of this folder", async () => {
  const s = await serve({});
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cov-"));
  const r = await cli(["agent", "new", "checker", "--to", "nowhere", "--url", s.url, "--token", "k"], { cwd });
  s.close();
  assert.equal(r.code, 1);
  assert.match(r.out, /no workspace called "nowhere" here.*--platform makes it in the deployed one/);
  assert.equal(s.seen.length, 0);
});

test("eval new <name> --to posts { name } to …/evals", async () => {
  const s = await serve({ "POST /api/workspaces/blog-desk/evals": () => ({ ok: true, path: "evals/writer-quality.md" }) });
  const r = await at(s.url, "eval", "new", "writer-quality", "--to", "blog-desk");
  const bad = await at(s.url, "eval", "new", "Bad_Name", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /created eval writer-quality in blog-desk/);
  assert.match(r.out, /foldrun eval writer-quality --to blog-desk/);
  assert.equal(bad.code, 1);
  assert.deepEqual(writes(s), [{ method: "POST", url: "/api/workspaces/blog-desk/evals", body: { name: "writer-quality" } }]);
});

test("source new <kind> <name> posts to …/assets — at workspace scope, or inside one agent", async () => {
  const s = await serve({ "POST /api/workspaces/blog-desk/assets": (b) => ({ ok: true, path: JSON.parse(b).agent ? `agents/${JSON.parse(b).agent}/skills/house-style/SKILL.md` : "knowledge/brand.md" }) });
  const k = await at(s.url, "source", "new", "knowledge", "brand", "--to", "blog-desk");
  const sk = await at(s.url, "source", "new", "skills", "house-style", "--agent", "writer", "--to", "blog-desk");
  const bad = await at(s.url, "source", "new", "widgets", "x", "--to", "blog-desk");
  s.close();
  assert.equal(k.code, 0, k.out);
  assert.match(k.out, /blog-desk\/knowledge\/brand\.md/);
  assert.equal(sk.code, 0, sk.out);
  assert.match(sk.out, /for writer/);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /kind is tools, knowledge, memory, skills, scripts/);
  assert.deepEqual(writes(s), [
    { method: "POST", url: "/api/workspaces/blog-desk/assets", body: { kind: "knowledge", name: "brand" } },
    { method: "POST", url: "/api/workspaces/blog-desk/assets", body: { kind: "skills", name: "house-style", agent: "writer" } },
  ]);
});

test("library new <kind>/<name> posts { name, template, language } to /api/library/<kind>; memory is a kind", async () => {
  const s = await serve({
    "POST /api/library/tools": () => ({ ok: true, path: "uuid/tool.md" }),
    "POST /api/library/memory": () => ({ ok: true, path: "lessons.md" }),
    "/api/library/memory": () => ({ kind: "memory", entries: [{ name: "lessons", description: "What runs learned." }] }),
  });
  const t = await at(s.url, "library", "new", "tools/uuid", "--template", "script", "--language", "bash");
  const m = await at(s.url, "library", "new", "memory/lessons");
  const ls = await at(s.url, "library", "ls", "memory");
  const bad = await at(s.url, "library", "new", "skills/a/b");
  s.close();
  assert.equal(t.code, 0, t.out);
  assert.match(t.out, /library\/tools\/uuid\/tool\.md/);
  assert.equal(m.code, 0, m.out);
  assert.match(ls.out, /memory 1[\s\S]*lessons\s+What runs learned\./);
  assert.equal(bad.code, 1);
  assert.deepEqual(writes(s), [
    { method: "POST", url: "/api/library/tools", body: { name: "uuid", template: "script", language: "bash" } },
    { method: "POST", url: "/api/library/memory", body: { name: "lessons" } },
  ]);
});

test("workspaces new <name> --platform posts { name, template: true } — or { name, starter: true }", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cov-"));
  const s = await serve({ "POST /api/workspaces": (b) => ({ ok: true, name: JSON.parse(b).name, tenant: "default", agents: JSON.parse(b).starter ? 2 : 0, flows: JSON.parse(b).starter ? 1 : 0 }) });
  const blank = await cli(["workspaces", "new", "ads-desk", "--platform", "--url", s.url, "--token", "k"], { cwd });
  const starter = await cli(["workspaces", "new", "seo-desk", "--platform", "--starter", "--url", s.url, "--token", "k"], { cwd });
  s.close();
  assert.equal(blank.code, 0, blank.out);
  assert.match(blank.out, /ads-desk.*0 agents, 0 flows/);
  assert.equal(starter.code, 0, starter.out);
  assert.match(starter.out, /seo-desk.*2 agents, 1 flow\b/);
  assert.deepEqual(writes(s), [
    { method: "POST", url: "/api/workspaces", body: { name: "ads-desk", template: true } },
    { method: "POST", url: "/api/workspaces", body: { name: "seo-desk", starter: true } },
  ]);
  assert.deepEqual(fs.readdirSync(cwd), [], "nothing made here");
});

// ------------------------------------------------------------ the account

test("backups requests reads GET /api/account/backups/requests", async () => {
  const requests = [{ id: "rr-1", tenant: "t", workspace: "blog-desk", target: "yesterday 9am", backupId: null, what: "runs", note: "lost a run", by: "me@x.com", at: "2026-10-04T09:00:00Z", status: "open", notified: true }];
  const s = await serve({ "/api/account/backups/requests": () => ({ requests }) });
  const r = await at(s.url, "backups", "requests");
  const j = await at(s.url, "backups", "requests", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /open\s+runs · blog-desk · to yesterday 9am\s+rr-1 · me@x\.com/);
  assert.match(r.out, /lost a run/);
  assert.deepEqual(json(j.out), requests);
});

test("status --platform --history reads the open GET /api/status/history?days=n, no key sent", async () => {
  const day = (date: string, k: Partial<Record<string, number>>, uptime: number | null) => ({ date, samples: 288, operational: 0, degraded: 0, outage: 0, maintenance: 0, ...k, uptime });
  const doc = {
    days: 3,
    sampleMinutes: 5,
    components: [{ id: "api", name: "Dashboard and API", uptime: 0.99, days: [day("2026-10-03", { operational: 288 }, 1), day("2026-10-04", { outage: 3, operational: 285 }, 0.99), day("2026-10-05", {}, null)] }],
    incidents: [{ id: "i1", kind: "incident", title: "Runs stalled", impact: "major", status: "resolved", components: ["api"], startsAt: "2026-10-04T03:34:00Z", endsAt: null, resolvedAt: "2026-10-04T06:25:00Z", updates: [] }],
  };
  const s = await serve({ "/api/status/history": () => doc });
  const r = await cli(["status", "--platform", "--history", "--days", "3", "--url", s.url]);
  const bad = await cli(["status", "--platform", "--history", "--days", "91", "--url", s.url]);
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen[0].url, "/api/status/history");
  assert.equal(s.seen[0].query.get("days"), "3");
  assert.equal(s.seen[0].headers.authorization, undefined, "an open route");
  assert.match(r.out, /last 3 days/);
  assert.match(r.out, /Dashboard and API\s+99\.00%/);
  assert.match(r.out, /Runs stalled\s+major incident · 2026-10-04 03:34Z → 2026-10-04 06:25Z/);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /--days is a whole number from 1 to 90/);
  assert.equal(s.seen.length, 1, "a bad --days asks nothing");
});

test("team lists members, roles and scopes from GET /api/team — and refuses every write verb", async () => {
  const members = [
    { id: "u1", email: "owner@x.com", createdAt: "2026-01-02T00:00:00Z", owner: true, role: "owner", workspaces: null },
    { id: "u2", email: "ed@x.com", createdAt: "2026-03-04T00:00:00Z", owner: false, role: "editor", workspaces: ["blog-desk"] },
  ];
  const s = await serve({ "/api/team": () => ({ members }) });
  const r = await at(s.url, "team");
  const j = await at(s.url, "team", "--json");
  const invite = await at(s.url, "team", "invite", "a@b.com");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /owner@x\.com\s+owner\s+every workspace\s+joined 2026-01-02/);
  assert.match(r.out, /ed@x\.com\s+editor\s+blog-desk/);
  assert.match(r.out, /Settings → Team/);
  assert.deepEqual(json(j.out), members);
  assert.equal(invite.code, 1);
  assert.match(invite.out, /refuses them from a key/);
  assert.equal(s.seen.length, 2, "the refused verb sent nothing");
});

// ------------------------------------------------------------ runs, billing, windows

test("stop/rerun --until sends until with the filter to runs/bulk — a span or a date", async () => {
  const s = await serve({ "/api/workspaces": () => WORKSPACES, "POST /api/workspaces/blog-desk/runs/bulk": () => ({ ok: true, dryRun: true, matched: [] }) });
  const before = Date.now();
  const span = await at(s.url, "stop", "--status", "running", "--until", "2h", "--to", "blog-desk");
  const date = await at(s.url, "rerun", "--until", "2026-10-05T09:00:00Z", "--to", "blog-desk");
  const bad = await at(s.url, "rerun", "--until", "yesterday", "--to", "blog-desk");
  s.close();
  assert.equal(span.code, 0, span.out);
  assert.equal(date.code, 0, date.out);
  const [a, b] = writes(s);
  assert.equal(a.body.action, "stop");
  assert.deepEqual(a.body.status, ["running"]);
  const until = Date.parse(a.body.until);
  assert.ok(Math.abs(before - 2 * 36e5 - until) < 60_000, `until is two hours ago: ${a.body.until}`);
  assert.deepEqual(b.body, { action: "rerun", until: "2026-10-05T09:00:00.000Z", from: 1, dryRun: true });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /--until wants a span like 2h/);
  assert.equal(writes(s).length, 2, "a bad --until sends nothing");
});

test("billing credit <usd> posts { usd, note } to /api/billing; a live platform's refusal points at top-up", async () => {
  const s = await serve({ "POST /api/billing": () => ({ ok: true, entry: {}, balanceUsd: 25 }) });
  const r = await at(s.url, "billing", "credit", "20", "--note", "dev credit");
  const bad = await at(s.url, "billing", "credit", "-5");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /credited \$20\.00 · balance \$25\.00 · "dev credit"/);
  assert.equal(bad.code, 1);
  assert.deepEqual(writes(s), [{ method: "POST", url: "/api/billing", body: { usd: 20, note: "dev credit" } }]);

  const live = await serve({ "POST /api/billing": () => failing(403, { error: "top-ups go through checkout — POST /api/billing/checkout" }) });
  const refused = await at(live.url, "billing", "credit", "20");
  live.close();
  assert.equal(refused.code, 1);
  assert.match(refused.out, /billing is live on this platform.*foldrun billing top-up 20/);
});

test("observe and triggers send their window as days", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/observe": () => ({ workspace: "blog-desk", sinceDays: 7, runs: 0, failedRuns: 0, steps: 0, costUsd: 0, flows: [], agents: [], tools: [], failures: [] }),
    "/api/workspaces/blog-desk/triggers": () => ({ days: 3, flows: [], events: [] }),
  });
  const o = await at(s.url, "observe", "--to", "blog-desk", "--since", "7");
  const t = await at(s.url, "triggers", "--to", "blog-desk", "--since", "3");
  s.close();
  assert.equal(o.code, 0, o.out);
  assert.equal(t.code, 0, t.out);
  assert.equal(s.seen[0].query.get("days"), "7");
  assert.equal(s.seen[1].query.get("days"), "3");
  assert.equal(s.seen[0].query.get("since"), null);
});

test("--help for each new verb names it and calls nothing", async () => {
  const s = await serve({});
  for (const [args, want] of [
    [["team"], /foldrun team\s+who is in the account/],
    [["workspaces"], /workspaces show <name>[\s\S]*workspaces new <name> --platform/],
    [["agent"], /agent new <name> --platform[\s\S]*agent ls[\s\S]*agent import --list/],
    [["flow"], /flow new <name> --platform/],
    [["eval"], /eval new <name>/],
    [["source"], /source new <kind> <name>/],
    [["library"], /library new <kind>\/<name>/],
    [["backups"], /backups requests/],
    [["status"], /status --platform --history/],
    [["billing"], /billing credit <usd>.*without Stripe/],
    [["stop"], /--until/],
  ] as const) {
    const r = await at(s.url, ...args, "--help");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, want, args.join(" "));
  }
  s.close();
  assert.equal(s.seen.length, 0);
});
