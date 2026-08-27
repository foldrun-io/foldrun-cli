// The wallet: burn, runway, and the settings the guard acts on.
//
//   node --test tests/wallet.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordTopUp } from "../packages/core/src/ledger.ts";
import {
  walletSummary,
  walletConfig,
  saveWalletConfig,
  warnThresholdUsd,
} from "../packages/core/src/wallet.ts";

function withAccount(body: () => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-wallet-"));
  const prevData = process.env.FOLDRUN_DATA;
  const prevLow = process.env.FOLDRUN_LOW_BALANCE_USD;
  process.env.FOLDRUN_DATA = root;
  delete process.env.FOLDRUN_LOW_BALANCE_USD;
  try {
    fs.mkdirSync(path.join(root, "acme/workspaces"), { recursive: true });
    body();
  } finally {
    if (prevData === undefined) delete process.env.FOLDRUN_DATA;
    else process.env.FOLDRUN_DATA = prevData;
    if (prevLow === undefined) delete process.env.FOLDRUN_LOW_BALANCE_USD;
    else process.env.FOLDRUN_LOW_BALANCE_USD = prevLow;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Append a raw ledger line with a chosen timestamp — burn math needs aged
 *  entries, and recordRunCost stamps "now". */
function spend(tenant: string, usd: number, daysAgo: number) {
  const file = path.join(process.env.FOLDRUN_DATA!, tenant, "ledger.jsonl");
  const t = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  fs.appendFileSync(file, JSON.stringify({ t, kind: "run", usd: -usd }) + "\n");
}

test("burn divides by the days that have data, not by a flattering 30", () =>
  withAccount(() => {
    recordTopUp("acme", 100);
    spend("acme", 5, 0.5);
    spend("acme", 5, 1.5);
    const s = walletSummary("acme");
    // $10 over ~1.5 days ≈ $6.7/day — dividing by 30 would claim $0.33/day
    // and a runway of 9 months for a wallet that dies in a fortnight.
    assert.ok(s.burnPerDayUsd > 5, `burn ${s.burnPerDayUsd} should reflect the short window`);
    assert.ok(s.daysLeft !== null && s.daysLeft < 20, `runway ${s.daysLeft} should be days, not months`);
    assert.equal(s.spend7dUsd, 10);
  }));

test("no spend means no runway claim", () =>
  withAccount(() => {
    recordTopUp("acme", 50);
    const s = walletSummary("acme");
    assert.equal(s.burnPerDayUsd, 0);
    assert.equal(s.daysLeft, null);
    assert.equal(s.emptyOn, null);
  }));

test("top-ups are not burn", () =>
  withAccount(() => {
    recordTopUp("acme", 100);
    spend("acme", 2, 1);
    recordTopUp("acme", 100);
    const s = walletSummary("acme");
    assert.equal(s.spend30dUsd, 2, "the second top-up must not count as spend");
  }));

test("the warn threshold prefers the auto top-up's own line", () =>
  withAccount(() => {
    assert.equal(warnThresholdUsd("acme", 0), 5, "floor with no history");
    assert.equal(warnThresholdUsd("acme", 4), 12, "3 days of burn beats the floor");
    saveWalletConfig("acme", { autoTopUp: { enabled: true, thresholdUsd: 25, amountUsd: 50 } });
    assert.equal(warnThresholdUsd("acme", 4), 25, "an enabled refill rule sets the line");
  }));

test("wallet config round-trips and starts empty", () =>
  withAccount(() => {
    assert.deepEqual(walletConfig("acme"), {});
    saveWalletConfig("acme", { stripeCustomerId: "cus_1", warnedAt: "2026-08-27T00:00:00Z" });
    assert.equal(walletConfig("acme").stripeCustomerId, "cus_1");
    saveWalletConfig("acme", { ...walletConfig("acme"), warnedAt: undefined });
    assert.equal(walletConfig("acme").warnedAt, undefined, "clearing a marker sticks");
  }));
