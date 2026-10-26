// `foldrun usage compute` — the account's pool, what its running steps hold,
// and (27 Oct 2026) the steps waiting for room, oldest first.
//
//   node --test tests/cli-usage-compute.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

test("usage compute lists the steps waiting for room, with how long and why", async () => {
  const s = await serve({
    "/api/usage/compute": () => ({
      compute: { vcpu: 8, memGiB: 16, stepVcpu: 4, stepMemGiB: 8, source: "plan" },
      inUse: { vcpu: 8, memGiB: 12, steps: 3 },
      waiting: [
        { workspace: "desk", runId: "run-old", flow: "daily", step: 1, agent: "writer", since: ago(75), why: "8 of this account's 8 vCPU is held by its running steps and this one needs 2", cpus: 2, memGiB: 4 },
        { workspace: "desk", runId: "run-new", flow: "hourly", step: 0, agent: "reader", since: ago(3), why: "an older step of this account has waited 75 minutes for room and starts first", cpus: 1, memGiB: 1 },
      ],
    }),
  });
  const r = await at(s.url, "usage", "compute");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /8 of 8 vCPU · 12 of 16 GiB/);
  assert.match(r.out, /2 waiting for room/);
  assert.match(r.out, /75 min +desk\/daily writer +2 vCPU · 4 GiB/);
  assert.match(r.out, /an older step of this account/);
  assert.ok(r.out.indexOf("run-old") < r.out.indexOf("run-new"), "oldest first, as the platform sent them");
});

test("with nothing waiting, no waiting section", async () => {
  const s = await serve({ "/api/usage/compute": () => ({ compute: { vcpu: null, memGiB: null, stepVcpu: null, stepMemGiB: null, source: null }, inUse: { vcpu: 0, memGiB: 0, steps: 0 }, waiting: [] }) });
  const r = await at(s.url, "usage", "compute");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /waiting for room/);
});
