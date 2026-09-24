// `foldrun triggers` — why nothing ran.
//
//   node --test tests/cli-triggers.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const report = {
  days: 7,
  flows: [
    { flow: "publish", trigger: "schedule", fired: 7, started: 7, dropped: [], lastFiredAt: "2026-09-24T01:00:00.000Z", lastStartedAt: "2026-09-24T01:00:00.000Z" },
    { flow: "on-lead", trigger: "webhook", fired: 40, started: 2, dropped: [{ outcome: "throttled", count: 36, detail: "throttle: 900s — the last run of this flow started 120s ago" }, { outcome: "duplicate", count: 2, detail: "already handled this x-github-delivery — no run started" }], lastFiredAt: "2026-09-24T02:00:00.000Z", lastStartedAt: "2026-09-23T02:00:00.000Z" },
    { flow: "nightly", trigger: "schedule", fired: 3, started: 0, dropped: [{ outcome: "quarantined", count: 3, detail: "disable_after: 3 — the last 3 runs of this flow failed; it will not fire again until one succeeds" }], lastFiredAt: "2026-09-24T03:00:00.000Z", lastStartedAt: null },
  ],
  events: [],
  deliveries: [],
};

test("one row per flow: fired vs started, each reason with its count, and a quarantine is loud", async () => {
  const s = await serve({ "/api/workspaces/rank-desk/triggers": () => report });
  const r = await at(s.url, "triggers", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 1, "a flow switched off is worth a non-zero exit");
  assert.match(r.out, /publish.*7\/7 started/);
  assert.match(r.out, /on-lead.*2\/40 started/);
  assert.match(r.out, /36× throttled/);
  assert.match(r.out, /2× duplicate/);
  assert.match(r.out, /nightly.*0\/3 started.*never became a run/);
  assert.match(r.out, /3× quarantined/);
  assert.match(r.out, /1 switched off by disable_after/);
  assert.equal(s.seen[0].query.get("since"), "7");
});

test("--since widens the window, and a quiet workspace says so", async () => {
  const s = await serve({ "/api/workspaces/rank-desk/triggers": () => ({ days: 30, flows: [], events: [], deliveries: [] }) });
  const r = await at(s.url, "triggers", "--since", "30", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen[0].query.get("since"), "30");
  assert.match(r.out, /no trigger fired in rank-desk in the last 30 days/);
});
