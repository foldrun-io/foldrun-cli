// Dashboard → CLI parity for the runs pages and the inbox (audit 4 Nov 2026):
// saved views written, a selection of runs stopped, rerun or deleted, a
// `wait: event` step rejected, the inbox's "Mark all read", and the
// assistant's page context. These pin what the CLI sends.
//
//   node --test tests/cli-parity-runs.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, WORKSPACES } from "./fake-platform.ts";

const VIEWS = { theme: "system", runViews: [{ name: "broken web", query: "tool=web&tool_error=1" }, { name: "old", query: "status=failed" }] };
const patches = (s: { seen: { method: string; body: string }[] }) => s.seen.filter((x) => x.method === "PATCH").map((x) => JSON.parse(x.body));

// ------------------------------------------------------------ saved views

test("runs views save writes the whole list back with the filters given, replacing a view of that name", async () => {
  const s = await serve({ "GET /api/me/preferences": () => VIEWS, "PATCH /api/me/preferences": (body) => ({ theme: "system", ...JSON.parse(body) }) });
  const r = await at(s.url, "runs", "views", "save", "old", "--status", "failed", "--to", "blog-desk", "--since", "24h", "--tool-error", "--q", "sydney batch", "--min-tokens", "50k");
  s.close();
  assert.equal(r.code, 0, r.out);
  const [body] = patches(s);
  assert.equal(body.runViews.length, 2);
  assert.deepEqual(body.runViews[0], VIEWS.runViews[0], "the others are kept as they were");
  assert.equal(body.runViews[1].name, "old");
  const q = new URLSearchParams(body.runViews[1].query);
  assert.deepEqual(Object.fromEntries(q), { status: "failed", workspace: "blog-desk", since: "today", q: "sydney batch", min_tokens: "50k", tool_error: "1" });
  assert.match(r.out, /replaced the view old/);
});

test("runs views save refuses what a view cannot keep, or no filter at all, before writing", async () => {
  const s = await serve({ "GET /api/me/preferences": () => VIEWS, "PATCH /api/me/preferences": () => ({}) });
  const verdict = await at(s.url, "runs", "views", "save", "x", "--verdict", "blocked");
  const none = await at(s.url, "runs", "views", "save", "x");
  const nameless = await at(s.url, "runs", "views", "save");
  s.close();
  assert.notEqual(verdict.code, 0);
  assert.match(verdict.out, /not --verdict/);
  assert.notEqual(none.code, 0);
  assert.match(none.out, /at least one filter/);
  assert.notEqual(nameless.code, 0);
  assert.equal(patches(s).length, 0);
});

test("runs views rm asks (--yes with no terminal) and writes the list without it", async () => {
  const s = await serve({ "GET /api/me/preferences": () => VIEWS, "PATCH /api/me/preferences": (body) => JSON.parse(body) });
  const asked = await at(s.url, "runs", "views", "rm", "old");
  assert.notEqual(asked.code, 0);
  assert.match(asked.out, /--yes/);
  assert.equal(patches(s).length, 0);
  const missing = await at(s.url, "runs", "views", "rm", "nope", "--yes");
  assert.notEqual(missing.code, 0);
  assert.match(missing.out, /no saved view called nope/);
  const r = await at(s.url, "runs", "views", "rm", "old", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(patches(s), [{ runViews: [VIEWS.runViews[0]] }]);
});

// ----------------------------------------------------- a selection of runs

const RUN = (id: string, status = "running") => ({ id, flow: "daily", status, startedAt: "2026-11-04T09:00:00Z", steps: [] });

test("stop <id> <id> finds each run's workspace, asks, then stops them through runs/bulk, one call per workspace", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/r1": () => RUN("r1"),
    "/api/workspaces/rank-desk/runs/r2": () => RUN("r2"),
    "/api/workspaces/blog-desk/runs/r3": () => RUN("r3"),
    "POST /api/workspaces/blog-desk/runs/bulk": (body) => ({ ok: true, runs: JSON.parse(body).runIds.map((runId: string) => ({ runId, ok: true })) }),
    "POST /api/workspaces/rank-desk/runs/bulk": () => ({ ok: true, runs: [{ runId: "r2", ok: false, error: "already finished" }] }),
  });
  const asked = await at(s.url, "stop", "r1", "r2", "r3");
  assert.notEqual(asked.code, 0);
  assert.match(asked.out, /--yes/);
  assert.equal(s.seen.filter((x) => x.url.endsWith("/runs/bulk")).length, 0, "nothing stopped without a yes");
  const r = await at(s.url, "stop", "r1", "r2", "r3", "--yes");
  s.close();
  assert.equal(r.code, 1, "one refused → exit 1");
  const bulk = s.seen.filter((x) => x.url.endsWith("/runs/bulk"));
  assert.deepEqual(bulk.map((x) => [x.url, JSON.parse(x.body)]), [
    ["/api/workspaces/blog-desk/runs/bulk", { action: "stop", runIds: ["r1", "r3"] }],
    ["/api/workspaces/rank-desk/runs/bulk", { action: "stop", runIds: ["r2"] }],
  ]);
  assert.match(r.out, /2 of 3 stopped · 1 refused/);
});

test("rerun <id> <id> --from 2 reruns them from that step; --agent is for one run; --dry-run touches nothing", async () => {
  const s = await serve({
    "POST /api/workspaces/blog-desk/runs/bulk": (body) => ({ ok: true, runs: JSON.parse(body).runIds.map((runId: string) => ({ runId, ok: true, newRunId: `${runId}-again` })) }),
  });
  const agent = await at(s.url, "rerun", "r1", "r2", "--to", "blog-desk", "--agent", "writer", "--yes");
  assert.notEqual(agent.code, 0);
  assert.match(agent.out, /--agent reruns one run/);
  const mixed = await at(s.url, "rerun", "r1", "r2", "--to", "blog-desk", "--status", "failed", "--yes");
  assert.notEqual(mixed.code, 0);
  const dry = await at(s.url, "rerun", "r1", "r2", "--to", "blog-desk", "--dry-run");
  assert.equal(dry.code, 0, dry.out);
  assert.equal(s.seen.length, 0, "refused and dry runs send nothing");
  const r = await at(s.url, "rerun", "r1", "r2", "--to", "blog-desk", "--from", "2", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { action: "rerun", runIds: ["r1", "r2"], from: 2 });
  assert.match(r.out, /r1 → r1-again/);
});

test("runs rm <id> <id> lists, asks once, then deletes each — one refusal does not stop the rest", async () => {
  const s = await serve({
    "GET /api/workspaces/blog-desk/runs/r1": () => RUN("r1", "completed"),
    "GET /api/workspaces/blog-desk/runs/r2": () => RUN("r2", "failed"),
    "DELETE /api/workspaces/blog-desk/runs/r1": () => ({ __status: 403, body: { error: "needs workspace:manage" } }),
    "DELETE /api/workspaces/blog-desk/runs/r2": () => ({ ok: true }),
  });
  const asked = await at(s.url, "runs", "rm", "r1", "r2", "--to", "blog-desk");
  assert.notEqual(asked.code, 0);
  assert.equal(s.seen.filter((x) => x.method === "DELETE").length, 0);
  const r = await at(s.url, "runs", "rm", "r1", "r2", "--to", "blog-desk", "--yes");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(s.seen.filter((x) => x.method === "DELETE").map((x) => x.url), ["/api/workspaces/blog-desk/runs/r1", "/api/workspaces/blog-desk/runs/r2"]);
  assert.match(r.out, /1 of 2 deleted · 1 refused/);
});

// --------------------------------------------------- a `wait: event` step

const PARKED = {
  id: "r9",
  flow: "invoice",
  status: "awaiting-approval",
  steps: [
    { agent: "billing", status: "completed", instruction: "Send it." },
    { agent: "chaser", status: "awaiting-approval", waitFor: "event", instruction: "Chase when paid." },
  ],
};

test("reject --event-wait refuses the step parked on wait: event, naming it, with the dashboard's reason", async () => {
  const s = await serve({ "GET /api/workspaces/blog-desk/runs/r9": () => PARKED, "POST /api/workspaces/blog-desk/runs/r9/approve": () => ({ ok: true, decision: "reject", steps: [1] }) });
  const plain = await at(s.url, "reject", "r9", "--to", "blog-desk");
  assert.notEqual(plain.code, 0);
  assert.match(plain.out, /--event-wait rejects that one/);
  const approve = await at(s.url, "approve", "r9", "--to", "blog-desk", "--event-wait", "--yes");
  assert.notEqual(approve.code, 0, "--event-wait is a reject");
  assert.equal(s.seen.filter((x) => x.method === "POST").length, 0);
  const r = await at(s.url, "reject", "r9", "--to", "blog-desk", "--event-wait");
  s.close();
  assert.equal(r.code, 0, r.out);
  const posts = s.seen.filter((x) => x.method === "POST");
  assert.deepEqual(posts.map((x) => JSON.parse(x.body)), [{ decision: "reject", step: 1, reason: "rejected while waiting for its event" }]);
  assert.match(r.out, /rejected 1 step of r9/);
});

// ------------------------------------------------------------------- inbox

test("inbox read --all marks every unread item read, in calls of 200; a tab flag narrows the view asked", async () => {
  const items = Array.from({ length: 250 }, (_, i) => ({ id: `i${i}`, read: i % 50 === 0, kind: "run", bucket: "mine" }));
  const s = await serve({ "GET /api/me/inbox": () => ({ person: "me@acme.test", items, counts: {} }), "POST /api/me/inbox": () => ({ ok: true }) });
  const r = await at(s.url, "inbox", "read", "--all");
  const team = await at(s.url, "inbox", "read", "--all", "--team", "--workspace", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(team.code, 0, team.out);
  const gets = s.seen.filter((x) => x.method === "GET");
  assert.equal(gets[0].query.get("bucket"), "all");
  assert.deepEqual(Object.fromEntries(gets[1].query), { bucket: "team", workspace: "blog-desk" });
  const posts = s.seen.filter((x) => x.method === "POST").slice(0, 2).map((x) => JSON.parse(x.body));
  assert.equal(posts[0].ids.length, 200);
  assert.equal(posts[1].ids.length, 45);
  assert.ok(posts.every((p) => p.action === "read"));
  assert.ok(!posts.flatMap((p) => p.ids).includes("i0"), "a read item is not sent");
  assert.match(r.out, /marked read 245 items/);
});

// --------------------------------------------------------------- assistant

test("assistant --page sends the page context the dashboard sends", async () => {
  const s = await serve({ "/api/workspaces/desk/assistant": () => ({ ok: true, reply: "That flow runs daily.", files: [], issues: [] }) });
  const r = await at(s.url, "assistant", "what does this do?", "--to", "desk", "--page", "flows — daily.md");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(s.seen[0].body).page, "flows — daily.md");
});
