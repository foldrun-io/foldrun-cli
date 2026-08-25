// The board's two newest rewrites: pattern templates at creation, and one
// step's options edited surgically.
//
//   node --test tests/flow-edit.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  flowPatternTemplate,
  updateFlowStep,
  parseFlow,
  FLOW_PATTERNS,
} from "../packages/core/src/store.ts";

// ---------------------------------------------------------------- templates

test("every pattern template parses into the shape it advertises", () => {
  for (const pattern of FLOW_PATTERNS) {
    const raw = flowPatternTemplate(pattern, "demo", ["writer", "editor", "extra", "judge"]);
    const flow = parseFlow("demo.md", raw);
    assert.equal(flow.name, "demo", pattern);
    assert.ok(flow.steps.length >= 1, pattern);
  }

  const loop = parseFlow("x.md", flowPatternTemplate("review-loop", "x", ["writer", "editor"]));
  assert.equal(loop.steps[1].loop, 3);
  assert.equal(loop.steps[1].until, "APPROVED");
  assert.equal(loop.steps[1].agent, "editor");

  const fan = parseFlow("x.md", flowPatternTemplate("fan-out", "x", ["a", "b", "c"]));
  assert.equal(fan.steps[1].each, "lines");
  assert.equal(fan.steps[1].max, 10);

  const debate = parseFlow("x.md", flowPatternTemplate("debate", "x", []));
  const groups = debate.steps.map((s) => s.group);
  assert.deepEqual(groups, [1, 2, 2, 3], "two takes in parallel, then the judge");
});

test("templates use the workspace's real agents where they exist", () => {
  const raw = flowPatternTemplate("review-loop", "x", ["notetaker"]);
  assert.match(raw, /\[\[notetaker\]\]/);
  assert.ok(!raw.includes("[[writer]]"), "no placeholder when a real agent exists");
});

// ---------------------------------------------------------------- step edit

const FLOW = `---
name: digest
# a comment that must survive
---

1. [[researcher]] — gather the week
2. [[writer]] — write it up
   retry: 1
   verify: test -s outputs/post.md
`;

test("editing one step touches only that step's managed options", () => {
  const out = updateFlowStep(FLOW, 1, { model: "fast", loop: 2, until: "SHIP IT", retry: null });
  const flow = parseFlow("digest.md", out);
  assert.equal(flow.steps[1].model, "fast");
  assert.equal(flow.steps[1].loop, 2);
  assert.equal(flow.steps[1].until, "SHIP IT");
  assert.equal(flow.steps[1].retry, undefined, "null cleared it");
  assert.equal(flow.steps[1].verify, "test -s outputs/post.md", "unmanaged option survives");
  assert.equal(flow.steps[0].model, undefined, "the other step is untouched");
  assert.match(out, /# a comment that must survive/);
});

test("fan-out options write and clear as a pair", () => {
  const on = updateFlowStep(FLOW, 0, { each: "lines", max: 99 });
  assert.equal(parseFlow("f.md", on).steps[0].each, "lines");
  assert.equal(parseFlow("f.md", on).steps[0].max, 20, "clamped on the way in");

  const off = updateFlowStep(on, 0, { each: null, max: null });
  assert.equal(parseFlow("f.md", off).steps[0].each, undefined);
  assert.equal(parseFlow("f.md", off).steps[0].max, undefined);
});

test("an index off the end refuses rather than writing garbage", () => {
  assert.throws(() => updateFlowStep(FLOW, 9, { model: "fast" }), /no step 9/);
});
