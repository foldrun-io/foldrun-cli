// The status line under the prompt (FOL-269): its fields, and rows broken between them.
import test from "node:test";
import assert from "node:assert/strict";
import { statusFields, wrapFields } from "../src/code-statusline.mjs";

const now = Date.parse("2026-11-24T10:00:00Z");
const s = { label: "fix login", context: "code-tk", model: "claude-sonnet-5-5", effort: "high", mode: "local", costUsd: 0.12, measure: { local: { tokens: 5_412, at: now - 10 * 60_000 } } };

test("statusFields: name, id, model, effort, size, cache, place, spend — in that order", () => {
  assert.deepEqual(statusFields(s, { now, ttlMs: 3_600_000, model: () => "Sonnet 5.5", cost: (u) => `$${u.toFixed(2)}` }), ["fix login", "code-tk", "Sonnet 5.5", "effort high", "5.4k tokens", "cache 50m left", "this computer", "$0.12"]);
  assert.deepEqual(statusFields({ context: "code-x", mode: "cloud", effort: "default" }, { now, ttlMs: 1 }), ["new conversation", "code-x", "cloud"], "before a turn: only what is known");
  assert.ok(statusFields({ ...s, measure: { local: { tokens: 9, at: now - 7_200_000 } } }, { now, ttlMs: 3_600_000 }).includes("cache expired"));
  assert.ok(statusFields({ ...s, mode: "cloud" }, { now, ttlMs: 3_600_000 }).every((f) => !/tokens|cache/.test(f)), "the other side's measure is not this side's");
  assert.ok(statusFields({ ...s, measure: { local: { ...s.measure.local, stale: true } } }, { now, ttlMs: 3_600_000 }).includes("cache reset"), "after a tool change: not the countdown");
  assert.ok(statusFields({ context: "c", mode: "local", measure: { local: { tokens: 9, at: now, model: "m-local" } } }, { now, ttlMs: 9 }).includes("m-local"), "the model that served this side");
  const after = statusFields({ ...s, modelChanged: true }, { now, ttlMs: 3_600_000, model: () => "Sonnet 5.5" });
  assert.ok(after.includes("new model next") && !after.some((f) => /Sonnet|cache/.test(f)), "after /model: not the old model or its cache");
  assert.equal(statusFields({ label: "a\u001b[31mb" }, { now, ttlMs: 1 })[0], "a[31mb", "no control characters reach the screen");
});

test("wrapFields: one row when it fits; else broken between fields, never inside one; at most three rows", () => {
  const f = ["fix login", "code-tk", "Sonnet 5.5", "effort high", "5.4k tokens", "cache 50m left", "this computer"];
  assert.deepEqual(wrapFields(f, 200), [f.join(" · ")]);
  const rows = wrapFields(f, 30);
  assert.ok(rows.length > 1 && rows.length <= 3);
  for (const r of rows) assert.ok(r.length <= 30, r);
  const back = rows.join(" · ").split(" · ");
  assert.deepEqual(back, f.slice(0, back.length), "whole fields, in order");
  assert.equal(wrapFields(f, 12).length, 3, "three rows at most");
  assert.ok(wrapFields(["a-very-long-conversation-name"], 10)[0].length <= 10);
});

test("/permissions bypass is the first field, never the one left off (FOL-308)", async () => {
  const { BYPASS_FIELD } = await import("../src/code-statusline.mjs");
  const f = statusFields({ bypass: true, label: "x", context: "code-1", mode: "local" }, { ttlMs: 3_600_000 });
  assert.equal(f[0], BYPASS_FIELD);
  assert.ok(!statusFields({ label: "x", mode: "local" }, { ttlMs: 3_600_000 }).includes(BYPASS_FIELD));
});
