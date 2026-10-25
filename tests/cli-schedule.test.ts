// `foldrun schedule` — every flow in the account that fires on a clock.
//
// The reason this prints the next firing times rather than only the cron
// line: `0 5 1-7 * 5` reads as "the first Friday" and fires eight times in
// twenty-eight days, because day-of-month and day-of-week are OR'd. The
// times are the only honest answer.
//
//   node --test tests/cli-schedule.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const soon = new Date(Date.now() + 3 * 3600_000).toISOString();
const later = new Date(Date.now() + 27 * 3600_000).toISOString();

const scheduled = [
  { workspace: "rank-desk", flow: "rankings", schedule: "0 5 * * 1", timezone: "Australia/Sydney", steps: 9, valid: true, upcoming: [later] },
  { workspace: "blog-desk", flow: "daily", schedule: "0 8 * * *", timezone: "Australia/Sydney", steps: 7, valid: true, upcoming: [soon, later] },
  { workspace: "blog-desk", flow: "broken", schedule: "every tuesday", timezone: "UTC", steps: 2, valid: false, upcoming: [] },
];

test("schedule lists every clocked flow, soonest first, with the next times", async () => {
  const s = await serve({ "/api/schedule": () => ({ scheduled }) });
  const r = await at(s.url, "schedule");
  s.close();
  assert.equal(r.code, 1, "an unparseable cron line is a failure to report");
  const lines = r.out.split("\n").filter((l) => /rankings|daily|broken/.test(l));
  assert.match(lines[0], /daily/, "the one firing in three hours comes first");
  assert.match(r.out, /0 8 \* \* \*/);
  assert.match(r.out, /Australia\/Sydney · 7 steps/);
  assert.match(r.out, /next /);
  assert.match(r.out, /then /, "the times after the next one are printed too");
  assert.match(r.out, /3 scheduled flows/);
});

test("a cron line the scheduler cannot parse is marked, and is the exit code", async () => {
  const s = await serve({ "/api/schedule": () => ({ scheduled }) });
  const r = await at(s.url, "schedule");
  s.close();
  assert.equal(r.code, 1);
  assert.match(r.out, /cannot parse this — it will never fire/);
});

test("--to narrows to one workspace", async () => {
  const s = await serve({ "/api/schedule": () => ({ scheduled }) });
  const r = await at(s.url, "schedule", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /rankings/);
  assert.doesNotMatch(r.out, /daily/);
  assert.match(r.out, /1 scheduled flow\b/);
});

test("nothing scheduled says how a flow gets a clock", async () => {
  const s = await serve({ "/api/schedule": () => ({ scheduled: [] }) });
  const r = await at(s.url, "schedule");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /trigger: schedule/);
});
