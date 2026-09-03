// The timeline's reading of a run record. These are the rules the picture
// is drawn from, so they are pinned here rather than in a browser: a tool
// call and its completion pair into one span, a step's clock comes from its
// own stamps before its events, and a record from before either existed
// still reads — as ticks and event bounds, never as a guess.

import test from "node:test";
import assert from "node:assert/strict";
import {
  toolSpans,
  traceEvents,
  stepSpan,
  fmtDur,
  fmtTick,
  tickEvery,
} from "../web/components/run-timeline-model.ts";
import type { StepRecord } from "../packages/core/src/store.ts";

const T = (offsetMs: number) => new Date(1_700_000_000_000 + offsetMs).toISOString();

const step = (over: Partial<StepRecord>): StepRecord => ({
  agent: "writer",
  instruction: "",
  group: 1,
  optional: false,
  status: "completed",
  events: [],
  result: null,
  costUsd: null,
  ...over,
});

test("a tool call and its completion pair into one span by the provider's id", () => {
  const s = step({
    events: [
      { t: T(0), type: "tool", text: "websearch", call: "a" },
      { t: T(100), type: "tool", text: "read", call: "b" },
      { t: T(1300), type: "tool", text: "read", call: "b", ms: 1200 },
      { t: T(2500), type: "tool", text: "websearch", call: "a", ms: 2500, err: true },
    ],
  });
  const spans = toolSpans(s);
  assert.equal(spans.length, 2);
  assert.deepEqual(spans[0], { name: "websearch", start: new Date(T(0)).getTime(), end: new Date(T(2500)).getTime(), err: true });
  assert.equal(spans[1].end! - spans[1].start, 1200);
  assert.equal(spans[1].err, false);
});

test("legacy tool events with no id stay ticks, and a completion whose call was lost is still a span", () => {
  const s = step({
    events: [
      { t: T(0), type: "tool", text: "read" },
      { t: T(900), type: "tool", text: "fetch", call: "z", ms: 400 },
    ],
  });
  const spans = toolSpans(s);
  assert.equal(spans[0].end, null);
  assert.equal(spans[1].end! - spans[1].start, 400);
  assert.equal(spans[1].start, new Date(T(500)).getTime());
});

test("the trace shows one line per tool call, carrying its duration once it returns", () => {
  const s = step({
    events: [
      { t: T(0), type: "info", text: "isolation: k8s" },
      { t: T(10), type: "tool", text: "read", call: "b" },
      { t: T(50), type: "text", text: "Reading…" },
      { t: T(1210), type: "tool", text: "read", call: "b", ms: 1200, err: true },
      { t: T(1300), type: "tool", text: "bash" },
    ],
  });
  const lines = traceEvents(s);
  assert.deepEqual(
    lines.map((l) => [l.type, l.text, l.durationMs ?? null, Boolean(l.err)]),
    [
      ["info", "isolation: k8s", null, false],
      ["tool", "read", 1200, true],
      ["text", "Reading…", null, false],
      ["tool", "bash", null, false],
    ],
  );
  // Pure: the record is not rewritten by being read.
  assert.equal(s.events.length, 5);
  assert.equal("durationMs" in s.events[1], false);
});

test("a step's clock is its own stamps, then its events; a live step runs to now", () => {
  const now = new Date(T(60_000)).getTime();
  // Stamped: exact, even though the first event came later and the last earlier.
  const stamped = step({
    startedAt: T(1000),
    finishedAt: T(9000),
    events: [
      { t: T(3000), type: "tool", text: "read" },
      { t: T(5000), type: "text", text: "done" },
    ],
  });
  assert.deepEqual(stepSpan(stamped, now), { start: new Date(T(1000)).getTime(), end: new Date(T(9000)).getTime(), live: false });
  // Unstamped and settled: first and last event.
  const legacy = step({ events: stamped.events });
  assert.deepEqual(stepSpan(legacy, now), { start: new Date(T(3000)).getTime(), end: new Date(T(5000)).getTime(), live: false });
  // Running: the bar grows to the clock.
  const live = step({ status: "running", startedAt: T(2000), events: [{ t: T(2000), type: "tool", text: "read" }] });
  assert.deepEqual(stepSpan(live, now), { start: new Date(T(2000)).getTime(), end: now, live: true });
  // Waiting at a gate is live too: the hatched bar grows while a person decides.
  const gated = step({ status: "awaiting-approval", events: [{ t: T(4000), type: "info", text: "waiting for approval before running" }] });
  assert.equal(stepSpan(gated, now)!.live, true);
  // Not begun: nothing to draw.
  assert.equal(stepSpan(step({ status: "pending" }), now), null);
});

test("durations and axis ticks read the way a person says them", () => {
  assert.equal(fmtDur(400), "0.4s");
  assert.equal(fmtDur(12_300), "12s");
  assert.equal(fmtDur(3_400), "3.4s");
  assert.equal(fmtDur(126_000), "2m 06s");
  assert.equal(fmtDur(659_600), "11m 00s");
  assert.equal(fmtDur(4_320_000), "1h 12m");
  assert.equal(fmtTick(120_000), "2m");
  assert.equal(fmtTick(90_000), "1m 30s");
  assert.equal(fmtTick(7_200_000), "2h");
  // At most eight ticks, on round numbers, however long the run.
  assert.equal(tickEvery(11 * 60_000), 120_000);
  assert.equal(tickEvery(30_000), 5_000);
  assert.ok(tickEvery(10 * 3600_000) >= 3600_000);
});
