// `foldrun webhooks deliveries | redeliver` and `foldrun notifications [set]`.
//
//   node --test tests/cli-webhooks-notifications.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, failing } from "./fake-platform.ts";

const delivery = (over: Record<string, unknown>) => ({
  id: "dlv_1",
  event: "failed",
  status: "delivered",
  destination: "${SLACK_URL}",
  attempts: 1,
  attemptLog: [],
  lastStatusCode: 200,
  lastError: null,
  nextAttemptAt: null,
  createdAt: "2026-10-01T01:00:00.000Z",
  ...over,
});

test("deliveries lists each one with its status and attempts; --failed narrows it", async () => {
  const s = await serve({
    "/api/workspaces/desk/notify/deliveries": (_b, q) => ({
      deliveries: q.get("status") === "failed"
        ? [delivery({ id: "dlv_2", status: "failed", attempts: 6, lastStatusCode: 503 })]
        : [delivery({}), delivery({ id: "dlv_3", status: "pending", attempts: 2, lastStatusCode: null, lastError: "timed out", nextAttemptAt: "2026-10-01T01:06:00.000Z" })],
      total: 2,
      limit: 30,
      offset: 0,
      endpoint: null,
    }),
  });
  const all = await at(s.url, "webhooks", "deliveries", "--to", "desk");
  const failed = await at(s.url, "webhooks", "deliveries", "--failed", "--to", "desk");
  s.close();
  assert.equal(all.code, 0, all.out);
  assert.match(all.out, /failed\s+delivered\s+1×\s+HTTP 200.*dlv_1/);
  assert.match(all.out, /retrying\s+2×\s+timed out.*next/);
  assert.equal(s.seen[0].query.get("status"), null);
  assert.equal(failed.code, 0, failed.out);
  assert.equal(s.seen[1].query.get("status"), "failed");
  assert.match(failed.out, /6×\s+HTTP 503.*dlv_2/);
});

test("a switched-off endpoint is said first, with the way back", async () => {
  const s = await serve({
    "/api/workspaces/desk/notify/deliveries": () => ({
      deliveries: [delivery({ status: "skipped", attempts: 0, lastStatusCode: null, lastError: "not attempted: the endpoint is switched off" })],
      total: 1, limit: 30, offset: 0,
      endpoint: { disabledAt: "2026-09-30T00:00:00.000Z", disabledReason: "every delivery failed for 3 days running", failingSince: "2026-09-27T00:00:00.000Z" },
    }),
  });
  const r = await at(s.url, "webhooks", "deliveries", "--to", "desk");
  s.close();
  assert.match(r.out, /switched off.*3 days running/);
  assert.match(r.out, /foldrun notify test --to desk/);
});

test("redeliver posts to the delivery and exits on whether it landed", async () => {
  const s = await serve({
    "POST /api/workspaces/desk/notify/deliveries/dlv_9/redeliver": () => ({
      ok: false,
      attempt: { n: 7, statusCode: 500, durationMs: 41, response: "boom", error: "HTTP 500", manual: true },
      delivery: delivery({ id: "dlv_9" }),
    }),
  });
  const r = await at(s.url, "webhooks", "redeliver", "dlv_9", "--to", "desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.equal(s.seen[0].method, "POST");
  assert.match(r.out, /✗ dlv_9.*attempt 7/);
  assert.match(r.out, /HTTP 500.*boom/);
});

const categories = [
  { category: "security", label: "Security", description: "Password resets.", required: true, why: "how you get back in", perWorkspace: false, enabled: true, workspaces: {} },
  { category: "run-alerts", label: "Run alerts", description: "A run failed.", required: false, perWorkspace: true, enabled: true, workspaces: { "seo-desk": false } },
  { category: "low-balance", label: "Low-balance warnings", description: "Credits low.", required: false, perWorkspace: false, enabled: false, workspaces: {} },
];

test("notifications lists every category: always, on, off, and the workspaces that differ", async () => {
  const s = await serve({ "/api/me/notifications": () => ({ email: "me@example.test", categories }) });
  const r = await at(s.url, "notifications");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /me@example\.test/);
  assert.match(r.out, /security\s+always/);
  assert.match(r.out, /run-alerts\s+on .*seo-desk off/);
  assert.match(r.out, /low-balance\s+off/);
});

test("notifications set sends the change — with --to as the workspace", async () => {
  const s = await serve({ "PATCH /api/me/notifications": () => ({ email: "me@example.test", categories }) });
  const r = await at(s.url, "notifications", "set", "run-alerts", "off", "--to", "seo-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { category: "run-alerts", enabled: false, workspace: "seo-desk" });
  assert.match(r.out, /Run alerts off for seo-desk/);
});

test("a required category's refusal is the platform's words", async () => {
  const s = await serve({ "PATCH /api/me/notifications": () => failing(409, { error: "Security mail cannot be turned off: how you get back in" }) });
  const r = await at(s.url, "notifications", "set", "security", "off");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /cannot be turned off/);
});

test("set needs on or off", async () => {
  const s = await serve({});
  const r = await at(s.url, "notifications", "set", "run-alerts", "maybe");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /on\|off/);
  assert.equal(s.seen.length, 0);
});
