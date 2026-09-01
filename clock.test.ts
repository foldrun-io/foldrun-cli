// The date an agent is told it is, and the timezone it is told in.
//
// Containers run UTC. A Sydney desk publishing at 9am local was told it was
// still yesterday, and an article stamped with the real date was refused as
// "one day in the future". `timezone:` in AGENTS.md is how a workspace says
// which calendar it lives on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTimezone, localDate } from "../packages/core/src/runner.ts";

// 2026-08-31T23:30Z is already 1 September in Sydney (UTC+10).
const late = new Date("2026-08-31T23:30:00Z");

test("localDate is the calendar date in the zone, not UTC", () => {
  assert.equal(localDate("UTC", late), "2026-08-31");
  assert.equal(localDate("Australia/Sydney", late), "2026-09-01");
  assert.equal(localDate("America/Los_Angeles", late), "2026-08-31");
});

test("timezone: in AGENTS.md wins; unset is UTC; an unknown name falls back to UTC", () => {
  const prior = process.env.FOLDRUN_TIMEZONE;
  delete process.env.FOLDRUN_TIMEZONE;
  try {
    assert.equal(resolveTimezone({ timezone: "Australia/Sydney" }), "Australia/Sydney");
    assert.equal(resolveTimezone({ timezone: "  Europe/London " }), "Europe/London");
    assert.equal(resolveTimezone({}), "UTC");
    assert.equal(resolveTimezone({ timezone: 42 }), "UTC");
    assert.equal(resolveTimezone({ timezone: "Mars/Olympus_Mons" }), "UTC");
    process.env.FOLDRUN_TIMEZONE = "Asia/Tokyo";
    assert.equal(resolveTimezone({}), "Asia/Tokyo", "the platform default applies when the workspace says nothing");
    assert.equal(resolveTimezone({ timezone: "Australia/Perth" }), "Australia/Perth", "but a workspace's own choice still wins");
  } finally {
    if (prior === undefined) delete process.env.FOLDRUN_TIMEZONE;
    else process.env.FOLDRUN_TIMEZONE = prior;
  }
});
