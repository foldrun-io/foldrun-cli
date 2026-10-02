// `foldrun report <run>` says which runner image each step ran on, and what
// happened to the account's browser pod under a slim step — the run page's
// chip and note, in the terminal, worded the way core words them.
//
//   node --test tests/cli-report-image.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, WORKSPACES } from "./fake-platform.ts";
import { imageLabel, podNote, podTries } from "../src/commands.mjs";
import { browserPodLine, podTriesLine } from "@foldrun/core/browser-pod";

const run = {
  id: "run-pod",
  flow: "watch",
  status: "failed",
  startedAt: "2026-10-01T01:00:00.000Z",
  finishedAt: "2026-10-01T01:05:00.000Z",
  steps: [
    {
      agent: "reader", group: 1, status: "completed", attempts: 1, costUsd: 0.03, events: [], result: "read it",
      image: { variant: "full", why: "re-run after the browser pod was lost" },
      browserPod: { reconnects: 3, reconnected: 0, lost: { cause: "lost", detail: "ECONNREFUSED" }, writes: [], fallback: "browser pod lost; re-ran on full" },
      tries: [
        { n: 1, status: "lost", costUsd: 0.01, tokens: null, computeSecs: 3, startedAt: "2026-10-01T01:00:00.000Z", finishedAt: "2026-10-01T01:01:00.000Z", image: "slim", browserPod: "3 reconnects; pod lost: ECONNREFUSED" },
        { n: 2, attempt: 1, status: "completed", costUsd: 0.02, tokens: null, computeSecs: 5, startedAt: "2026-10-01T01:01:00.000Z", finishedAt: "2026-10-01T01:02:00.000Z", image: "full", browserPod: "3 reconnects; browser pod lost; re-ran on full (ECONNREFUSED)" },
      ],
    },
    {
      agent: "filler", group: 2, status: "failed", attempts: 1, costUsd: 0.01, events: [], result: null,
      image: { variant: "slim", why: "browses through the account's browser pod", pod: true },
      browserPod: { reconnects: 3, reconnected: 0, lost: { cause: "lost", detail: "gone" }, writes: ["state/x.csv (Write)"], failure: "browser pod died after the step had written state/x.csv (Write) — not re-run" },
    },
    { agent: "plain", group: 3, status: "skipped", attempts: 0, costUsd: null, events: [], result: null, image: { variant: "slim" } },
  ],
};

test("report shows the image and the pod's story per step", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs/run-pod": () => run,
  });
  const r = await at(s.url, "report", "run-pod", "--to", "blog-desk");
  s.close();
  assert.match(r.out, /reader .*completed · full/);
  assert.match(r.out, /browser pod: 3 reconnects; browser pod lost; re-ran on full \(ECONNREFUSED\)/);
  assert.doesNotMatch(r.out, /got through/, "a lost pod never let a reconnect through");
  assert.match(r.out, /tries: #1 slim · lost · \$0\.0100 → #2 full · completed · \$0\.0200/, "the lost slim go and the full re-run, apart and numbered");
  assert.match(r.out, /filler .*failed · slim · browser pod/);
  assert.match(r.out, /browser pod: 3 reconnects; browser pod died after the step had written state\/x\.csv \(Write\)/);
  assert.match(r.out, /plain .*skipped · slim/);
});

test("the CLI's wording is core's", () => {
  for (const step of run.steps) {
    if (!step.browserPod) continue;
    assert.equal(podNote(step)!.line, browserPodLine(step.browserPod as never));
  }
  assert.equal(podNote({ browserPod: { reconnects: 1, reconnected: 1 } })!.line, browserPodLine({ reconnects: 1, reconnected: 1 }));
  for (const p of [
    { reconnects: 1, reconnected: 0, closedAgain: 1, lost: { cause: "lost", detail: "browser has been closed" } },
    { reconnects: 2, reconnected: 0, closedAgain: 1, lost: { cause: "lost", detail: "gone" }, fallback: "browser pod lost; re-ran on full" },
    { reconnects: 4, reconnected: 1, lost: { cause: "lost", detail: "ECONNREFUSED" } },
    { reconnects: 0, reconnected: 0, lost: { cause: "lost", detail: "gone" } },
  ] as const) assert.equal(podNote({ browserPod: p })!.line, browserPodLine(p as never), JSON.stringify(p));
  assert.equal(podNote({ browserPod: { reconnects: 0, reconnected: 0 } }), null);
  assert.equal(imageLabel({}), null);
  for (const step of run.steps) assert.equal(podTries(step), podTriesLine((step as { tries?: never }).tries));
  const many = [{ n: 1, status: "failed", image: "full", costUsd: null }, { n: 2, status: "lost", image: "slim", costUsd: 0.01 }, { n: 3, attempt: 2, status: "completed", image: "full", costUsd: 0.02 }] as const;
  assert.equal(podTries({ tries: many }), podTriesLine(many as never));
});
