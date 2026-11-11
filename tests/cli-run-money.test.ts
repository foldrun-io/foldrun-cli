// `foldrun report <run-id>` shows what a run was charged once it settles, and
// its estimate until then (FOL-157).
//
//   node --test tests/cli-run-money.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const run = (over: Record<string, unknown>) => ({
  id: "run-m1", flow: "daily", status: "completed", startedAt: new Date(Date.now() - 60_000).toISOString(), finishedAt: new Date().toISOString(),
  steps: [{ agent: "writer", status: "completed", costUsd: 0.01, events: [], result: "ok" }], ...over,
});

for (const [label, over, expect] of [
  ["settled", { chargedUsd: 0.0512, estimatedUsd: 0.05, settled: true }, /charged \$0\.0512/],
  ["not settled", { chargedUsd: null, estimatedUsd: 0.05, settled: false }, /\$0\.0500 estimated, not settled yet/],
] as const) {
  test(`report shows the run's money — ${label}`, async () => {
    const s = await serve({ "/api/workspaces/desk/runs/run-m1": () => run(over), "/api/workspaces": () => ({ workspaces: [{ name: "desk" }] }), "/api/workspaces/desk/runs": () => ({ runs: [run(over)] }) });
    const r = await at(s.url, "report", "run-m1", "--to", "desk");
    s.close();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, expect);
  });
}
