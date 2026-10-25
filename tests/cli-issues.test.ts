// FOL-54 step 3: `foldrun issues` lists the account's issues and acts on one
// through POST /api/issues/<id> — the dashboard's Issues page, same route.
//
//   node --test tests/cli-issues.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const issue = (over: object = {}) => ({
  id: "iss_abc123", kind: "failed", status: "open", workspace: "blog-desk", workspaces: ["blog-desk"], what: "daily", agent: "writer",
  reason: "writer: exit 1", action: "Read why it failed, fix the flow or agent, then rerun",
  firstSeen: "2026-10-18T00:00:00.000Z", lastSeen: "2026-10-19T00:00:00.000Z", count: 3,
  runs: [{ workspace: "blog-desk", id: "r1", at: "2026-10-19T00:00:00.000Z" }], recoveredAt: null,
  acknowledged: null, snoozedUntil: null, resolved: null, history: [], ...over,
});

test("issues lists them with count, reason and what to do; --to and --all reach the query", async () => {
  const s = await serve({ "/api/issues": (_b, q) => ({ issues: q.get("status") === "all" ? [issue(), issue({ id: "iss_def456", status: "resolved" })] : [issue()] }) });
  const r = await at(s.url, "issues", "--to", "blog-desk");
  const all = await at(s.url, "issues", "--all");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /iss_abc123/);
  assert.match(r.out, /3× · first/);
  assert.match(r.out, /→ Read why it failed/);
  assert.equal(s.seen[0].query.get("workspace"), "blog-desk");
  assert.equal(s.seen[0].query.get("status"), "active");
  assert.match(all.out, /\[resolved\]/);
});

test("issues ack / snooze / resolve post the action; a snooze needs --for; a bad verb or id is refused", async () => {
  const s = await serve({ "POST /api/issues/iss_abc123": (b) => ({ issue: issue({ status: JSON.parse(b).action === "resolve" ? "resolved" : "acknowledged" }) }) });
  const ack = await at(s.url, "issues", "ack", "iss_abc123");
  const snooze = await at(s.url, "issues", "snooze", "iss_abc123", "--for", "1d", "--note", "waiting on the vendor");
  const times = await at(s.url, "issues", "snooze", "iss_abc123", "--times", "5");
  const resolve = await at(s.url, "issues", "resolve", "iss_abc123");
  const noFor = await at(s.url, "issues", "snooze", "iss_abc123");
  const badVerb = await at(s.url, "issues", "close", "iss_abc123");
  const badId = await at(s.url, "issues", "ack", "abc");
  s.close();
  assert.equal(ack.code, 0, ack.out);
  assert.deepEqual(s.seen.map((x) => JSON.parse(x.body)), [
    { action: "acknowledge" },
    { action: "snooze", for: "1d", note: "waiting on the vendor" },
    { action: "snooze", times: 5 },
    { action: "resolve" },
  ]);
  assert.match(resolve.out, /is resolved/);
  assert.equal(snooze.code, 0);
  assert.equal(times.code, 0, times.out);
  for (const r of [noFor, badVerb, badId]) assert.equal(r.code, 1, r.out);
  assert.match(noFor.out, /--for/);
});

test("insights prints each problem with its cost, fix and evidence (FOL-72 step 8)", async () => {
  const s = await serve({
    "/api/insights": (_b, q) => ({ days: Number(q.get("days") ?? 7), insights: [{ id: "x", kind: "big-result", workspace: "blog-desk", agent: "writer", tool: "crm_export", title: "crm_export hands writer results up to 60k characters, sent again on every later call", why: "A tool result stays in the conversation.", fix: "Have crm_export return less.", credits: 1240, steps: 4, evidence: [{ workspace: "blog-desk", runId: "run-1", step: 2 }] }] }),
  });
  const r = await at(s.url, "insights", "--days", "14", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /crm_export hands writer results up to 60k/);
  assert.match(r.out, /4 steps · about 1,240 credits/);
  assert.match(r.out, /→ Have crm_export return less\./);
  assert.match(r.out, /run-1#2/);
  assert.equal(s.seen[0]!.query.get("days"), "14");
  assert.equal(s.seen[0]!.query.get("workspace"), "blog-desk");
});
