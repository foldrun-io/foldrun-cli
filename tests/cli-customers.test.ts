// `foldrun customers` and --customer (FOL-168): list the limits and blocks,
// block / unblock / change limits through the routes, name a customer on a
// run, and list one customer's runs.

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const VIEW = { limits: { startsPerMinute: 30, gatewayRpm: 20, gatewayConcurrency: 4 }, defaults: { startsPerMinute: 30, gatewayRpm: 60, gatewayConcurrency: 4 }, blocked: [{ customer: "c-bad", by: "ana@acme.test", reason: "spam", at: "2026-11-11T08:00:00.000Z" }] };

test("customers: ls shows limits (marking a changed one) and blocks; block, unblock and limits call their routes", async () => {
  const s = await serve({
    "GET /api/customers": () => VIEW,
    "PATCH /api/customers": (body) => ({ limits: { ...VIEW.limits, ...Object.fromEntries(Object.entries(JSON.parse(body)).map(([k, v]) => [k, v ?? (VIEW.defaults as Record<string, number>)[k]])) }, defaults: VIEW.defaults }),
    "PUT /api/customers/c-8812/block": () => ({ ok: true, customer: "c-8812", blocked: true }),
    "DELETE /api/customers/c-bad/block": () => ({ ok: true, customer: "c-bad", blocked: false }),
  });
  try {
    const ls = await at(s.url, "customers");
    assert.equal(ls.code, 0, ls.out);
    assert.match(ls.out, /20 gateway calls a minute \(default 60\)/);
    assert.match(ls.out, /c-bad\s+spam/);

    const b = await at(s.url, "customers", "block", "c-8812", "--reason", "abuse");
    assert.equal(b.code, 0, b.out);
    assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "PUT")!.body), { reason: "abuse" });

    const u = await at(s.url, "customers", "unblock", "c-bad", "--yes");
    assert.equal(u.code, 0, u.out);
    assert.ok(s.seen.some((x) => x.method === "DELETE" && x.url.includes("/c-bad/block")));

    const l = await at(s.url, "customers", "limits", "--gateway-rpm", "100", "--starts-per-minute", "default");
    assert.equal(l.code, 0, l.out);
    assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "PATCH")!.body), { startsPerMinute: null, gatewayRpm: 100 });
    assert.notEqual((await at(s.url, "customers", "limits", "--gateway-rpm", "lots")).code, 0);
    assert.notEqual((await at(s.url, "customers", "block")).code, 0);
  } finally {
    s.close();
  }
});

test("--customer names the run's customer on agent run and invoke; runs --customer lists only its runs", async () => {
  const s = await serve({
    "POST /api/workspaces/rank-desk/agents/tracker/run": () => ({ ok: true, runId: "run-1", test: false, customer: "c-1" }),
    "POST /api/workspaces/rank-desk/flows/weekly/run": () => ({ ok: true, runId: "run-2", steps: 1, test: false }),
    "GET /api/workspaces/rank-desk/runs": () => ({
      runs: [
        { id: "run-a", flow: "adhoc:tracker", status: "completed", startedAt: "2026-11-11T01:00:00.000Z", finishedAt: "2026-11-11T01:01:00.000Z", summary: "for c-1", customer: "c-1", steps: [] },
        { id: "run-b", flow: "adhoc:tracker", status: "completed", startedAt: "2026-11-11T00:00:00.000Z", finishedAt: "2026-11-11T00:01:00.000Z", summary: "for someone else", customer: "c-2", steps: [] },
      ],
      next: null,
    }),
  });
  try {
    assert.equal((await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "x", "--customer", "c-1")).code, 0);
    assert.equal(JSON.parse(s.seen.find((x) => x.url.includes("/agents/"))!.body).customer, "c-1");
    assert.equal((await at(s.url, "invoke", "weekly", "--to", "rank-desk", "--task", "x", "--customer", "c-1")).code, 0);
    assert.equal(JSON.parse(s.seen.find((x) => x.url.includes("/flows/"))!.body).customer, "c-1");
    const runs = await at(s.url, "runs", "--to", "rank-desk", "--customer", "c-1");
    assert.equal(runs.code, 0, runs.out);
    assert.match(runs.out, /for c-1/);
    assert.doesNotMatch(runs.out, /someone else/);
  } finally {
    s.close();
  }
});
