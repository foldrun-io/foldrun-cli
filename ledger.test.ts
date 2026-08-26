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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-ledger-"));
  const prevData = process.env.FOLDRUN_DATA;
  const prevBilling = process.env.FOLDRUN_BILLING;
  const priceVars = [
    "FOLDRUN_MARGIN",
    "FOLDRUN_MIN_RUN_FEE",
    "FOLDRUN_RUN_FEE",
    "FOLDRUN_STEP_FEE",
    "FOLDRUN_COMPUTE_USD_PER_SEC",
    "FOLDRUN_MAX_RUN_EXPOSURE",
  ];
  const prevPrices = priceVars.map((k) => [k, process.env[k]] as const);
  for (const k of priceVars) delete process.env[k];
  process.env.FOLDRUN_DATA = root;
  try {
    fs.mkdirSync(path.join(root, "acme/workspaces"), { recursive: true });
    body();
  } finally {
    if (prevData === undefined) delete process.env.FOLDRUN_DATA;
    else process.env.FOLDRUN_DATA = prevData;
    if (prevBilling === undefined) delete process.env.FOLDRUN_BILLING;
    else process.env.FOLDRUN_BILLING = prevBilling;
    for (const [k, v] of prevPrices) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
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
    delete process.env.FOLDRUN_BILLING;
    assertFunds("acme"); // never throws when the install doesn't enforce

    process.env.FOLDRUN_BILLING = "1";
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
    const file = path.join(process.env.FOLDRUN_DATA!, "acme/ledger.jsonl");
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
  process.env.FOLDRUN_MARGIN = "1.25";
  process.env.FOLDRUN_MIN_RUN_FEE = "0.01";
  try {
    assert.equal(priceRun(1), 1.25);
    assert.equal(priceRun(0.001), 0.01); // the floor, not 0.00125
    assert.equal(priceRun(0.1), 0.125);
    // a run that spent nothing is charged nothing — the floor never
    // invents a bill for a run our own gate refused
    assert.equal(priceRun(0), 0);
    assert.equal(priceRun(1 / 3), 0.416667); // micro-dollar rounding
  } finally {
    delete process.env.FOLDRUN_MARGIN;
    delete process.env.FOLDRUN_MIN_RUN_FEE;
  }
});

test("a charged run carries its provider cost, and the summary derives the margin", () => {
  withAccount(() => {
    process.env.FOLDRUN_MARGIN = "1.5";
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
    const file = path.join(process.env.FOLDRUN_DATA!, "acme", "ledger.jsonl");
    fs2.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), kind: "run", usd: -1, workspace: "desk", runId: "run-old" }) + "\n");
    const s = ledgerSummary("acme");
    assert.equal(s.chargedUsd, 1);
    assert.equal(s.providerCostUsd, 1);
    assert.equal(s.marginUsd, 0);
  });
});

// ------------------------------------------------- runs, steps and compute

test("with nothing configured, a BYOK run is free — the self-hoster default", () => {
  // Their key bought the tokens, so tokenCostUsd is 0. Nothing is charged
  // until an operator decides what a run and a sandbox second are worth.
  assert.equal(priceRun({ tokenCostUsd: 0, steps: 4, computeSecs: 120 }), 0);
});

test("a BYOK run bills the run, its steps and its sandbox seconds — never tokens", () => {
  process.env.FOLDRUN_RUN_FEE = "0.02";
  process.env.FOLDRUN_STEP_FEE = "0.005";
  process.env.FOLDRUN_COMPUTE_USD_PER_SEC = "0.0001";
  process.env.FOLDRUN_MARGIN = "1.25";
  try {
    // 0.02 + 4×0.005 + 120×0.0001 = 0.052, and the margin never applies
    // because no tokens were bought on our account.
    assert.equal(priceRun({ tokenCostUsd: 0, steps: 4, computeSecs: 120 }), 0.052);
  } finally {
    for (const k of ["FOLDRUN_RUN_FEE", "FOLDRUN_STEP_FEE", "FOLDRUN_COMPUTE_USD_PER_SEC", "FOLDRUN_MARGIN"]) {
      delete process.env[k];
    }
  }
});

test("models-included stacks both: marked-up tokens on top of the same compute", () => {
  process.env.FOLDRUN_RUN_FEE = "0.02";
  process.env.FOLDRUN_STEP_FEE = "0.005";
  process.env.FOLDRUN_COMPUTE_USD_PER_SEC = "0.0001";
  process.env.FOLDRUN_MARGIN = "1.25";
  try {
    // 1×1.25 + 0.052
    assert.equal(priceRun({ tokenCostUsd: 1, steps: 4, computeSecs: 120 }), 1.302);
  } finally {
    for (const k of ["FOLDRUN_RUN_FEE", "FOLDRUN_STEP_FEE", "FOLDRUN_COMPUTE_USD_PER_SEC", "FOLDRUN_MARGIN"]) {
      delete process.env[k];
    }
  }
});

test("a run that did nothing is free however the fees are set", () => {
  process.env.FOLDRUN_RUN_FEE = "0.02";
  process.env.FOLDRUN_MIN_RUN_FEE = "0.01";
  try {
    // No tokens, no steps, no seconds: our own gate refused it before it
    // started, and the per-run fee must not invent a bill for that.
    assert.equal(priceRun({ tokenCostUsd: 0, steps: 0, computeSecs: 0 }), 0);
  } finally {
    delete process.env.FOLDRUN_RUN_FEE;
    delete process.env.FOLDRUN_MIN_RUN_FEE;
  }
});

test("a BYOK line records zero provider cost, so the margin is the whole charge", () => {
  withAccount(() => {
    process.env.FOLDRUN_STEP_FEE = "0.01";
    recordTopUp("acme", 10);
    recordRunCost("acme", "desk", "run-a", { tokenCostUsd: 0, steps: 3, computeSecs: 42.5 });
    const [, run] = readLedger("acme");
    assert.equal(run.usd, -0.03);
    assert.equal(run.cost, 0);
    assert.deepEqual(run.meter, { steps: 3, computeSecs: 42.5 });

    const s = ledgerSummary("acme");
    assert.equal(s.chargedUsd, 0.03);
    assert.equal(s.providerCostUsd, 0); // we bought no tokens
    assert.equal(s.marginUsd, 0.03); // so all of it is margin
  });
});

test("a run priced at zero writes no line, however many steps it ran", () => {
  withAccount(() => {
    // Self-host, no pricing configured, BYOK: nothing to charge and nothing
    // to observe, so the ledger stays empty rather than filling with $0.
    assert.equal(recordRunCost("acme", "desk", "run-a", { tokenCostUsd: 0, steps: 9, computeSecs: 300 }), null);
    assert.equal(readLedger("acme").length, 0);
  });
});

// --------------------------------------------------- the two billing races

test("two racing settles cannot bill a run twice, even with the ledger scan blinded", () => {
  withAccount(() => {
    recordTopUp("acme", 10);
    // The scan-then-append window: both drivers read a ledger with no line
    // for this run. The marker claim is what must hold — simulate the loser
    // arriving after the winner's marker but as if its scan saw nothing, by
    // simply calling again (the marker, not the scan, is the guarantee).
    assert.ok(recordRunCost("acme", "desk", "run-a", 1));
    // Delete the ledger line, keep the marker: the scan now says "not
    // billed", and only the marker stands between this and a double charge.
    const file = path.join(process.env.FOLDRUN_DATA!, "acme/ledger.jsonl");
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    fs.writeFileSync(file, lines.filter((l) => !l.includes("run-a")).join("\n") + "\n");
    assert.equal(recordRunCost("acme", "desk", "run-a", 1), null);
  });
});

test("runs billed before markers existed are not re-billed after the upgrade", () => {
  withAccount(() => {
    recordTopUp("acme", 10);
    // A pre-marker line: written directly, no marker file beside it.
    const file = path.join(process.env.FOLDRUN_DATA!, "acme/ledger.jsonl");
    fs.appendFileSync(
      file,
      JSON.stringify({ t: "2026-01-01T00:00:00.000Z", kind: "run", usd: -1, workspace: "desk", runId: "run-old" }) + "\n",
    );
    assert.equal(recordRunCost("acme", "desk", "run-old", 1), null);
    assert.equal(creditBalance("acme"), 9);
  });
});

test("exposure holds the balance for every unsettled run", () => {
  withAccount(() => {
    process.env.FOLDRUN_BILLING = "1";
    process.env.FOLDRUN_MAX_RUN_EXPOSURE = "2";
    recordTopUp("acme", 5);

    assertFunds("acme", 0); // $5 covers one $2 hold
    assertFunds("acme", 1); // and two
    let threw: unknown = null;
    try {
      assertFunds("acme", 2); // a third would need $6 held against $5
    } catch (err) {
      threw = err;
    }
    assert.ok(threw instanceof Error, "the burst is refused, not admitted");
    assert.equal((threw as Error & { status?: number }).status, 402);
    assert.match((threw as Error).message, /held/);
  });
});

test("without an exposure ceiling the gate keeps its old shape: positive admits", () => {
  withAccount(() => {
    process.env.FOLDRUN_BILLING = "1";
    recordTopUp("acme", 0.01);
    assertFunds("acme", 50); // in-flight count is ignored when no ceiling is set
  });
});
