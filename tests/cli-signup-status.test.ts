// `foldrun signup status`: the open /api/signup — free, paid and the plans —
// with no key sent, and an exit 1 for a platform that does not answer or
// answers another shape. Through the real binary against a fake platform.
//
//   node --test tests/cli-signup-status.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, cli } from "./fake-platform.ts";

test("signup status: both doors, no key sent", async () => {
  const s = await serve({ "/api/signup": () => ({ free: true, paid: false, plans: [] }) });
  const r = await cli(["signup", "status", "--url", s.url]);
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /free\s+open/);
  assert.match(r.out, /paid\s+closed/);
  assert.deepEqual(s.seen.map((x) => x.url), ["/api/signup"]);
  assert.equal(s.seen[0].headers.authorization, undefined, "an open route: no key sent");
});

test("signup status: closed says so; plain `signup` is status", async () => {
  const s = await serve({ "/api/signup": () => ({ free: false, paid: false, plans: [] }) });
  const r = await cli(["signup", "--url", s.url]);
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /registration is closed/);
});

test("signup status: the plans, while paid is open", async () => {
  const plans = [{ id: "pro", name: "Pro", price: { amount: 9900, currency: "usd", interval: "month" }, credits: 9900, storageGb: null, vcpu: 8, memoryGiB: 16, priority: true }];
  const s = await serve({ "/api/signup": () => ({ free: false, paid: true, plans }) });
  const r = await cli(["signup", "status", "--url", s.url]);
  const j = await cli(["signup", "status", "--json", "--url", s.url]);
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Pro\s+99 USD\/month/);
  assert.match(r.out, /high-priority lane/);
  assert.deepEqual(JSON.parse(j.out), { free: false, paid: true, plans });
});

test("signup status: another shape, or no answer, is exit 1", async () => {
  const s = await serve({ "/api/signup": () => ({ open: true }) });
  const bad = await cli(["signup", "status", "--url", s.url]);
  s.close();
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /not \{ free, paid, plans \}/);
  const gone = await cli(["signup", "status", "--url", "http://127.0.0.1:9", "--timeout", "2"]);
  assert.equal(gone.code, 1, gone.out);
});

test("signup --help names status", async () => {
  const r = await cli(["signup", "--help"]);
  assert.match(r.out, /signup status/);
});
