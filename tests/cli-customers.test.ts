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

test("customers usage lists spend per customer; limits takes --max-open-runs and --daily-model-usd (none takes it away)", async () => {
  const s = await serve({
    "GET /api/customers/usage": (_b, q) => ({ days: Number(q.get("days")), customers: [{ customer: "c-big", chargedUsd: 4.2, todayUsd: 0.5, calls: 120 }] }),
    "PATCH /api/customers": (body) => ({ limits: { startsPerMinute: 30, gatewayRpm: 60, gatewayConcurrency: 4, maxOpenRuns: 3, dailyModelUsd: JSON.parse(body).dailyModelUsd ?? null }, defaults: { startsPerMinute: 30, gatewayRpm: 60, gatewayConcurrency: 4, maxOpenRuns: 10, dailyModelUsd: null } }),
  });
  try {
    const u = await at(s.url, "customers", "usage", "--days", "30");
    assert.equal(u.code, 0, u.out);
    assert.match(u.out, /\$4\.20\s+today \$0\.500 · 120 calls\s+c-big/);
    assert.equal(s.seen.find((x) => x.url.includes("/usage"))!.query.get("days"), "30");
    const l = await at(s.url, "customers", "limits", "--max-open-runs", "3", "--daily-model-usd", "2.50");
    assert.equal(l.code, 0, l.out);
    assert.deepEqual(JSON.parse(s.seen.filter((x) => x.method === "PATCH").at(-1)!.body), { maxOpenRuns: 3, dailyModelUsd: 2.5 });
    assert.match(l.out, /\$2\.5 a day/);
    await at(s.url, "customers", "limits", "--daily-model-usd", "none");
    assert.deepEqual(JSON.parse(s.seen.filter((x) => x.method === "PATCH").at(-1)!.body), { dailyModelUsd: null });
    assert.notEqual((await at(s.url, "customers", "limits", "--daily-model-usd", "-1")).code, 0);
    assert.notEqual((await at(s.url, "customers", "usage", "--days", "400")).code, 0);
  } finally {
    s.close();
  }
});

test("keys create --require-customer sends it; keys set <id> --customer required|optional toggles it; ls marks it", async () => {
  const s = await serve({
    "POST /api/keys": () => ({ ok: true, key: "fr_api_x", id: "k9", prefix: "fr_api_x", expiresAt: null }),
    "PATCH /api/keys/k9": (body) => ({ ok: true, id: "k9", requireCustomer: JSON.parse(body).requireCustomer }),
    "GET /api/keys": () => ({ keys: [{ id: "k9", prefix: "fr_api_x", label: "partner", role: "editor", workspaces: null, createdAt: "2026-11-11T00:00:00.000Z", revokedAt: null, requireCustomer: true }] }),
  });
  try {
    assert.equal((await at(s.url, "keys", "create", "partner", "--require-customer")).code, 0);
    assert.equal(JSON.parse(s.seen.find((x) => x.method === "POST")!.body).requireCustomer, true);
    const on = await at(s.url, "keys", "set", "k9", "--customer", "required");
    assert.equal(on.code, 0, on.out);
    assert.match(on.out, /required on every run and gateway call/);
    await at(s.url, "keys", "set", "k9", "--customer", "optional");
    assert.deepEqual(JSON.parse(s.seen.filter((x) => x.method === "PATCH").at(-1)!.body), { requireCustomer: false });
    assert.notEqual((await at(s.url, "keys", "set", "k9", "--customer", "maybe")).code, 0);
    const ls = await at(s.url, "keys", "ls");
    assert.match(ls.out, /\[customer required\]/);
  } finally {
    s.close();
  }
});

test("--require-customer with --a2a and keys set --customer with model flags are refused, never half-applied (Codex review)", async () => {
  const s = await serve({});
  try {
    const a = await at(s.url, "keys", "create", "x", "--a2a", "--to", "ws", "--flows", "f", "--require-customer");
    assert.notEqual(a.code, 0);
    assert.match(a.out, /not --a2a/);
    const b = await at(s.url, "keys", "set", "k9", "--customer", "required", "--sonnet", "openai/gpt-6");
    assert.notEqual(b.code, 0);
    assert.match(b.out, /two commands/);
    assert.equal(s.seen.filter((x) => x.method !== "GET").length, 0, "nothing was sent");
  } finally {
    s.close();
  }
});
