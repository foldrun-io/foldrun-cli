// `foldrun report <run>` says how much of each step's input the prompt cache
// served, the way the run page does — and says nothing for a step recorded
// before cache reads were counted apart (18 Oct 2026), rather than "0%".
//
//   node --test tests/cli-report-cache.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, WORKSPACES } from "./fake-platform.ts";

const run = {
  id: "run-cache",
  flow: "digest",
  status: "completed",
  startedAt: "2026-10-18T01:00:00.000Z",
  finishedAt: "2026-10-18T01:05:00.000Z",
  steps: [
    { agent: "reader", group: 1, status: "completed", attempts: 1, costUsd: 0.02, events: [], result: "ok",
      tokens: { input: 10000, output: 500, cacheRead: 9000, cacheWrite: 0 } },
    { agent: "older", group: 2, status: "completed", attempts: 1, costUsd: 0.05, events: [], result: "ok",
      tokens: { input: 10000, output: 500 } },
    // The reader again, with a memory file written in between: most of its
    // input is written, and the record's layers say which one moved.
    { agent: "reader", group: 3, status: "completed", attempts: 1, costUsd: 0.04, events: [], result: "ok",
      tokens: { input: 10000, output: 500, cacheRead: 2000, cacheWrite: 7500 },
      promptLayers: [{ name: "persona", chars: 10, hash: "aaaaaaaaaaaa" }, { name: "memory", chars: 40, hash: "cccccccccccc", stable: false }] },
  ],
};
run.steps[0].promptLayers = [{ name: "persona", chars: 10, hash: "aaaaaaaaaaaa" }, { name: "memory", chars: 20, hash: "bbbbbbbbbbbb", stable: false }];

test("report prints the cache share per step and for the run", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-cache": () => run,
  });
  const r = await at(s.url, "report", "run-cache", "--to", "blog-desk");
  s.close();
  // 30,000 input tokens in all; the share is over the steps that measured it
  // (11,000 of 20,000), not diluted by the older record that cannot say.
  assert.match(r.out, /30,000 in \/ 1,500 out tokens · 55% cached/);
  assert.match(r.out, /reader .*90% cached/);
  assert.doesNotMatch(r.out, /older .*cached/, "an old record cannot say, so it says nothing");
  // The third step wrote three quarters of its input: the note names the
  // layer that changed since the reader's first step. The first step wrote
  // nothing much (its record has no cacheWrite worth a note) and says nothing.
  assert.match(r.out, /prompt cache: 75% of input written to the cache — memory changed since step 1/);
  assert.equal((r.out.match(/prompt cache:/g) ?? []).length, 1);
});
