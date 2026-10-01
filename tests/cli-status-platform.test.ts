// `foldrun status --platform`: the platform's own status and any incident,
// from the open /api/status — no key sent — and what it says when the
// platform does not answer. Through the real binary against a fake platform.
//
//   node --test tests/cli-status-platform.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, cli } from "./fake-platform.ts";

const report = (over: Record<string, unknown> = {}) => ({
  status: "operational",
  description: "All systems operational",
  updatedAt: "2026-10-01T10:00:00.000Z",
  components: [
    { id: "web", name: "Dashboard and API", status: "operational", detail: "answering", checkedAt: "2026-10-01T10:00:00.000Z" },
    { id: "workers", name: "Run workers", status: "operational", detail: "0 waiting, 1 running", checkedAt: "2026-10-01T10:00:00.000Z" },
    { id: "scheduler", name: "Scheduler", status: "operational", detail: "ticking", checkedAt: "2026-10-01T10:00:00.000Z" },
    { id: "providers", name: "Model providers", status: "operational", detail: "api.anthropic.com reachable", checkedAt: "2026-10-01T09:58:00.000Z" },
    { id: "email", name: "Email", status: "operational", detail: "api.resend.com reachable", checkedAt: "2026-10-01T09:58:00.000Z" },
    { id: "storage", name: "Storage", status: "operational", detail: "database and volume answering", checkedAt: "2026-10-01T10:00:00.000Z" },
  ],
  incidents: [],
  maintenance: [],
  ...over,
});

test("status --platform: every component, the overall verdict, no key needed or sent", async () => {
  const s = await serve({ "/api/status": () => report() });
  const r = await cli(["status", "--platform", "--url", s.url]);
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /All systems operational/);
  for (const name of ["Dashboard and API", "Run workers", "Scheduler", "Model providers", "Email", "Storage"]) assert.match(r.out, new RegExp(`${name}\\s+operational`));
  assert.deepEqual(s.seen.map((x) => x.url), ["/api/status"]);
  assert.equal(s.seen[0].headers.authorization, undefined, "an open route: no key sent");
});

test("status --platform: a live incident and a maintenance window, with their latest update", async () => {
  const s = await serve({
    "/api/status": () =>
      report({
        status: "outage",
        description: "Major outage",
        incidents: [{ id: "inc-1", kind: "incident", title: "Runs slow to start", impact: "major", status: "identified", components: ["workers"], startsAt: "2026-10-01T09:00:00Z", endsAt: null, resolvedAt: null, updates: [{ at: "2026-10-01T09:00:00Z", status: "investigating", body: "Looking." }, { at: "2026-10-01T09:20:00Z", status: "identified", body: "A stuck node; replacing it." }] }],
        maintenance: [{ id: "inc-2", kind: "maintenance", title: "Database upgrade", impact: "maintenance", status: "scheduled", components: ["storage"], startsAt: "2099-01-01T01:00:00Z", endsAt: "2099-01-01T01:10:00Z", resolvedAt: null, updates: [{ at: "2026-10-01T08:00:00Z", status: "scheduled", body: "Ten minutes." }] }],
      }),
  });
  const r = await cli(["status", "--platform", "--url", s.url]);
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Major outage/);
  assert.match(r.out, /Runs slow to start\s+major incident · identified/);
  assert.match(r.out, /A stuck node; replacing it\./);
  assert.doesNotMatch(r.out, /Looking\./, "only the latest update");
  assert.match(r.out, /Database upgrade\s+maintenance 2099-01-01 01:00Z · scheduled/);
});

test("status --platform --json prints the answer as is", async () => {
  const s = await serve({ "/api/status": () => report() });
  const r = await cli(["status", "--platform", "--json", "--url", s.url]);
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(r.out).components.length, 6);
});

test("status --platform: a platform that does not answer is the signal — exit 1", async () => {
  const r = await cli(["status", "--platform", "--url", "http://127.0.0.1:9", "--timeout", "2"]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /status unavailable — .* the platform may be down/);
});

test("status --help names --platform", async () => {
  const r = await cli(["status", "--help"]);
  assert.match(r.out, /status --platform/);
});
