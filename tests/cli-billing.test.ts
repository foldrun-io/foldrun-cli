// `foldrun billing` — the balance, and what the money went on.
//
// "The wallet is empty" was visible only in the dashboard, which means a run
// that stops paying for models reads from the terminal as a broken platform.
// So an empty wallet is said in words, and so is a waiver: a run charged $0
// because its models are being absorbed is the state people mistake for
// everything being fine.
//
//   node --test tests/cli-billing.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const entries = [
  { t: "2026-09-16T03:01:45.732Z", kind: "run", usd: 0, workspace: "lawyer-desk", flow: "hourly", runId: "run-aaa", waived: ["models", "compute"] },
  { t: "2026-09-16T02:33:56.938Z", kind: "adjustment", usd: -0.593345, note: "browser foldrun-browser-matt 4944s since 2026-09-16T01:11:33Z" },
  { t: "2026-09-15T09:00:00.000Z", kind: "topup", usd: 50, note: "manual top-up" },
];

test("billing leads with the balance and the ledger under it", async () => {
  const s = await serve({ "/api/billing": () => ({ enabled: true, balanceUsd: 42.5, entries: entries.slice(1) }) });
  const r = await at(s.url, "billing");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /balance \$42\.50/);
  assert.match(r.out, /billing on/);
  assert.match(r.out, /adjustment/);
  assert.match(r.out, /browser foldrun-browser-matt/);
  assert.match(r.out, /\+ .*topup.*\$50\.0000/);
  assert.doesNotMatch(r.out, /wallet is empty/);
});

test("a negative balance is said in words, not left to be read off a minus sign", async () => {
  const s = await serve({ "/api/billing": () => ({ enabled: true, balanceUsd: -376.886539, entries }) });
  const r = await at(s.url, "billing");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /balance \$-376\.89/);
  assert.match(r.out, /the wallet is empty/);
  assert.match(r.out, /in overdraft/);
});

test("what the platform is waiving is reported, because $0 runs look fine", async () => {
  const s = await serve({ "/api/billing": () => ({ enabled: true, balanceUsd: -1, entries }) });
  const r = await at(s.url, "billing");
  s.close();
  assert.match(r.out, /models, compute are being waived on recent runs/);
});

test("a run entry says which flow in which workspace it paid for", async () => {
  const s = await serve({ "/api/billing": () => ({ enabled: true, balanceUsd: 1, entries }) });
  const r = await at(s.url, "billing");
  s.close();
  assert.match(r.out, /lawyer-desk\/hourly/);
  assert.match(r.out, /run-aaa/);
});

test("billing off on a self-hosted install is said, not hidden", async () => {
  const s = await serve({ "/api/billing": () => ({ enabled: false, balanceUsd: 0, entries: [] }) });
  const r = await at(s.url, "billing");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /billing off — nothing is charged on this install/);
  assert.match(r.out, /no ledger entries yet/);
  assert.doesNotMatch(r.out, /wallet is empty/);
});

test("--limit caps the ledger, and the total is still named", async () => {
  const s = await serve({ "/api/billing": () => ({ enabled: true, balanceUsd: 1, entries }) });
  const r = await at(s.url, "billing", "--limit", "1");
  s.close();
  assert.match(r.out, /3 entries on the ledger/);
  assert.doesNotMatch(r.out, /manual top-up/);
});
