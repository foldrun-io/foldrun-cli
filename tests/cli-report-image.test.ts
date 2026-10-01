// `foldrun report <run>` says which runner image each step ran on, and what
// happened to the account's browser pod under a slim step — the run page's
// chip and note, in the terminal, worded the way core words them.
//
//   node --test tests/cli-report-image.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, WORKSPACES } from "./fake-platform.ts";
import { imageLabel, podNote } from "../src/commands.mjs";
import { browserPodLine } from "../../foldrun-core/src/browser-pod.ts";

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
  assert.match(r.out, /browser pod: 3 reconnects \(0 got through\); browser pod lost; re-ran on full \(ECONNREFUSED\)/);
  assert.match(r.out, /filler .*failed · slim · browser pod/);
  assert.match(r.out, /browser pod: 3 reconnects \(0 got through\); browser pod died after the step had written state\/x\.csv \(Write\)/);
  assert.match(r.out, /plain .*skipped · slim/);
});

test("the CLI's wording is core's", () => {
  for (const step of run.steps) {
    if (!step.browserPod) continue;
    assert.equal(podNote(step)!.line, browserPodLine(step.browserPod as never));
  }
  assert.equal(podNote({ browserPod: { reconnects: 1, reconnected: 1 } })!.line, browserPodLine({ reconnects: 1, reconnected: 1 }));
  assert.equal(podNote({ browserPod: { reconnects: 0, reconnected: 0 } }), null);
  assert.equal(imageLabel({}), null);
});
