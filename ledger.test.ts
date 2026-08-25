// The money ledger: append-only lines whose sum is the balance.
//
//   node --test tests/ledger.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readLedger,
  creditBalance,
  recordTopUp,
  recordRunCost,
  assertFunds,
  priceRun,
  ledgerSummary,
} from "../packages/core/src/ledger.ts";

function withAccount(body: () => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdagent-ledger-"));
  const prevData = process.env.MDAGENT_DATA;
  const prevBilling = process.env.MDAGENT_BILLING;
  const prevMargin = process.env.MDAGENT_MARGIN;
  const prevMinFee = process.env.MDAGENT_MIN_RUN_FEE;
  delete process.env.MDAGENT_MARGIN;
  delete process.env.MDAGENT_MIN_RUN_FEE;
  process.env.MDAGENT_DATA = root;
  try {
    fs.mkdirSync(path.join(root, "acme/workspaces"), { recursive: true });
    body();
  } finally {
    if (prevData === undefined) delete process.env.MDAGENT_DATA;
    else process.env.MDAGENT_DATA = prevData;
    if (prevBilling === undefined) delete process.env.MDAGENT_BILLING;
    else process.env.MDAGENT_BILLING = prevBilling;
    if (prevMargin === undefined) delete process.env.MDAGENT_MARGIN;
    else process.env.MDAGENT_MARGIN = prevMargin;
    if (prevMinFee === undefined) delete process.env.MDAGENT_MIN_RUN_FEE;
    else process.env.MDAGENT_MIN_RUN_FEE = prevMinFee;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("a balance is the sum of its lines", () => {
  withAccount(() => {
    assert.equal(creditBalance("acme"), 0);
    recordTopUp("acme", 10);
    recordRunCost("acme", "desk", "run-a", 0.25);
    recordRunCost("acme", "desk", "run-b", 0.5);
    assert.equal(creditBalance("acme"), 9.25);
    assert.equal(readLedger("acme").length, 3);
  });
});

test("a run is billed once, however many times it is settled", () => {
  withAccount(() => {
    recordTopUp("acme", 5);
    assert.ok(recordRunCost("acme", "desk", "run-a", 1));
    assert.equal(recordRunCost("acme", "desk", "run-a", 1), null);
    assert.equal(creditBalance("acme"), 4);
  });
});

test("a free run writes nothing", () => {
  withAccount(() => {
    assert.equal(recordRunCost("acme", "desk", "run-a", 0), null);
    assert.equal(readLedger("acme").length, 0);
  });
});

test("enforcement is opt-in, and refuses with a 402", () => {
  withAccount(() => {
    delete process.env.MDAGENT_BILLING;
    assertFunds("acme"); // never throws when the install doesn't enforce

    process.env.MDAGENT_BILLING = "1";
    let threw: unknown = null;
    try {
      assertFunds("acme");
    } catch (err) {
      threw = err;
    }
    assert.ok(threw instanceof Error, "an empty tank refuses");
    assert.equal((threw as Error & { status?: number }).status, 402);

    recordTopUp("acme", 1);
    assertFunds("acme"); // funded accounts pass
  });
});

test("a torn tail line loses one entry, never the file", () => {
  withAccount(() => {
    recordTopUp("acme", 10);
    const file = path.join(process.env.MDAGENT_DATA!, "acme/ledger.jsonl");
    fs.appendFileSync(file, '{"t":"2026-08-24T00:00:00.000Z","kind":"run","usd":-1'); // no close, no newline
    assert.equal(readLedger("acme").length, 1);
    assert.equal(creditBalance("acme"), 10);
  });
});

// ------------------------------------------------------------------ margin

test("no margin configured means charge equals cost — the self-hoster default", () => {
  assert.equal(priceRun(0.5), 0.5);
  assert.equal(priceRun(0), 0);
});

test("margin marks up, the floor catches the tail, and both round to micro-dollars", () => {
  process.env.MDAGENT_MARGIN = "1.25";
  process.env.MDAGENT_MIN_RUN_FEE = "0.01";
  try {
    assert.equal(priceRun(1), 1.25);
    assert.equal(priceRun(0.001), 0.01); // the floor, not 0.00125
    assert.equal(priceRun(0.1), 0.125);
    // a run that spent nothing is charged nothing — the floor never
    // invents a bill for a run our own gate refused
    assert.equal(priceRun(0), 0);
    assert.equal(priceRun(1 / 3), 0.416667); // micro-dollar rounding
  } finally {
    delete process.env.MDAGENT_MARGIN;
    delete process.env.MDAGENT_MIN_RUN_FEE;
  }
});

test("a charged run carries its provider cost, and the summary derives the margin", () => {
  withAccount(() => {
    process.env.MDAGENT_MARGIN = "1.5";
    recordTopUp("acme", 10);
    recordRunCost("acme", "desk", "run-a", 2); // charged 3, cost 2
    const [, run] = readLedger("acme");
    assert.equal(run.usd, -3);
    assert.equal(run.cost, 2);
    const s = ledgerSummary("acme");
    assert.equal(s.balanceUsd, 7);
    assert.equal(s.chargedUsd, 3);
    assert.equal(s.providerCostUsd, 2);
    assert.equal(s.marginUsd, 1);
  });
});

test("pre-margin entries count as charge == cost in the summary", () => {
  withAccount(() => {
    recordTopUp("acme", 10);
    // an old-format line, written by hand the way the old code wrote it
    const fs2 = fs;
    const file = path.join(process.env.MDAGENT_DATA!, "acme", "ledger.jsonl");
    fs2.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), kind: "run", usd: -1, workspace: "desk", runId: "run-old" }) + "\n");
    const s = ledgerSummary("acme");
    assert.equal(s.chargedUsd, 1);
    assert.equal(s.providerCostUsd, 1);
    assert.equal(s.marginUsd, 0);
  });
});
