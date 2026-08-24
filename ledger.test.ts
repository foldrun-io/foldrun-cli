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
} from "../packages/core/src/ledger.ts";

function withAccount(body: () => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdagent-ledger-"));
  const prevData = process.env.MDAGENT_DATA;
  const prevBilling = process.env.MDAGENT_BILLING;
  process.env.MDAGENT_DATA = root;
  try {
    fs.mkdirSync(path.join(root, "acme/workspaces"), { recursive: true });
    body();
  } finally {
    if (prevData === undefined) delete process.env.MDAGENT_DATA;
    else process.env.MDAGENT_DATA = prevData;
    if (prevBilling === undefined) delete process.env.MDAGENT_BILLING;
    else process.env.MDAGENT_BILLING = prevBilling;
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
