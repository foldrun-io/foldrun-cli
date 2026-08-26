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
  noteRunDeleted,
  accrueDaily,
} from "../packages/core/src/ledger.ts";
import { accountUsage } from "../packages/core/src/usage.ts";

function withAccount(body: () => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-ledger-"));
  const prevData = process.env.FOLDRUN_DATA;
  const prevBilling = process.env.FOLDRUN_BILLING;
  const priceVars = [
    "FOLDRUN_MARGIN",
    "FOLDRUN_MIN_RUN_FEE",
    "FOLDRUN_RUN_FEE",
    "FOLDRUN_NET_USD_PER_GB",
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

test("a BYOK run bills compute and network — never tokens, never steps", () => {
  process.env.FOLDRUN_RUN_FEE = "0.02";
  process.env.FOLDRUN_COMPUTE_USD_PER_SEC = "0.0001";
  process.env.FOLDRUN_NET_USD_PER_GB = "0.10";
  process.env.FOLDRUN_MARGIN = "1.25";
  try {
    // 0.02 + 120×0.0001 + 0.5GB×0.10 = 0.082. No step fee by design — a
    // step is not a unit the platform pays for, and charging one would
    // punish well-factored flows. No margin: their key bought the tokens.
    assert.equal(
      priceRun({ tokenCostUsd: 0, steps: 4, computeSecs: 120, netBytes: 0.5 * 1024 ** 3 }),
      0.082,
    );
  } finally {
    for (const k of ["FOLDRUN_RUN_FEE", "FOLDRUN_NET_USD_PER_GB", "FOLDRUN_COMPUTE_USD_PER_SEC", "FOLDRUN_MARGIN"]) {
      delete process.env[k];
    }
  }
});

test("models-included stacks the margin on top of the same meters", () => {
  process.env.FOLDRUN_RUN_FEE = "0.02";
  process.env.FOLDRUN_COMPUTE_USD_PER_SEC = "0.0001";
  process.env.FOLDRUN_MARGIN = "1.25";
  try {
    // 1×1.25 + 0.02 + 120×0.0001
    assert.equal(priceRun({ tokenCostUsd: 1, steps: 4, computeSecs: 120 }), 1.282);
  } finally {
    for (const k of ["FOLDRUN_RUN_FEE", "FOLDRUN_COMPUTE_USD_PER_SEC", "FOLDRUN_MARGIN"]) {
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
    process.env.FOLDRUN_COMPUTE_USD_PER_SEC = "0.001";
    try {
      recordTopUp("acme", 10);
      recordRunCost("acme", "desk", "run-a", { tokenCostUsd: 0, steps: 3, computeSecs: 30 });
      const [, run] = readLedger("acme");
      assert.equal(run.usd, -0.03);
      assert.equal(run.cost, 0);
      assert.deepEqual(run.meter, { steps: 3, computeSecs: 30 });

      const s = ledgerSummary("acme");
      assert.equal(s.chargedUsd, 0.03);
      assert.equal(s.providerCostUsd, 0); // we bought no tokens
      assert.equal(s.marginUsd, 0.03); // so all of it is margin
    } finally {
      delete process.env.FOLDRUN_COMPUTE_USD_PER_SEC;
    }
  });
});

test("a day accrues the base fee and storage once, however often it is swept", () => {
  withAccount(() => {
    process.env.FOLDRUN_BILLING = "1";
    process.env.FOLDRUN_BASE_FEE_MONTHLY = "30";
    process.env.FOLDRUN_STORAGE_USD_PER_GB_MONTH = "0.15";
    try {
      const day = new Date("2026-09-15T08:00:00.000Z"); // September: 30 days
      const first = accrueDaily("acme", 2 * 1024 ** 3, day);
      assert.equal(first.length, 2);
      assert.equal(first[0].usd, -1); // 30 / 30 days
      assert.equal(first[1].usd, -0.01); // 2GB × 0.15 / 30
      // Swept again the same day: nothing doubles.
      assert.equal(accrueDaily("acme", 2 * 1024 ** 3, day).length, 0);
      // A new day accrues again.
      assert.equal(accrueDaily("acme", 2 * 1024 ** 3, new Date("2026-09-16T08:00:00.000Z")).length, 2);
    } finally {
      delete process.env.FOLDRUN_BASE_FEE_MONTHLY;
      delete process.env.FOLDRUN_STORAGE_USD_PER_GB_MONTH;
    }
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

// ------------------------------------------------------ deletion and money

test("deleting a charged run explains itself in the ledger and moves nothing", () => {
  withAccount(() => {
    recordTopUp("acme", 10);
    recordRunCost("acme", "desk", "run-a", 2);
    const before = creditBalance("acme");

    noteRunDeleted("acme", "desk", "run-a");
    const entries = readLedger("acme");
    const note = entries[entries.length - 1];
    assert.equal(note.kind, "adjustment");
    assert.equal(note.usd, 0);
    assert.equal(note.runId, "run-a");
    assert.match(note.note!, /charge stands/);
    // The story is completed; the money is untouched.
    assert.equal(creditBalance("acme"), before);
  });
});

test("deleting an unbilled run leaves no ledger residue", () => {
  withAccount(() => {
    recordTopUp("acme", 10);
    noteRunDeleted("acme", "desk", "run-never-billed");
    assert.equal(readLedger("acme").length, 1); // just the top-up
  });
});

// ------------------------------------------------------------- usage report

test("the usage report cuts one set of facts three ways that agree", () => {
  withAccount(() => {
    process.env.FOLDRUN_RUNNER_CPUS = "2";
    process.env.FOLDRUN_RUNNER_MEMORY = "4Gi";
    try {
      const ws = path.join(process.env.FOLDRUN_DATA!, "acme/workspaces/desk");
      fs.mkdirSync(path.join(ws, "runs"), { recursive: true });
      fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
      fs.writeFileSync(
        path.join(ws, "runs/run-a.json"),
        JSON.stringify({
          id: "run-a", flow: "publish", status: "completed",
          startedAt: "2026-08-26T00:00:00.000Z", finishedAt: "2026-08-26T00:05:00.000Z",
          steps: [
            { agent: "writer", instruction: "", group: 1, optional: false, status: "completed",
              events: [], result: "x", costUsd: 0.5, computeSecs: 30,
              tokens: { input: 1000, output: 400 } },
            { agent: "editor", instruction: "", group: 2, optional: false, status: "completed",
              events: [], result: "y", costUsd: 0.25, computeSecs: 10,
              tokens: { input: 500, output: 100 } },
            // A carried step ran — and was counted — in another run.
            { agent: "writer", instruction: "", group: 3, optional: false, status: "completed",
              events: [], result: "z", costUsd: null, computeSecs: null, carriedFrom: "run-0" },
          ],
        }),
      );

      const u = accountUsage("acme");
      assert.equal(u.totals.runs, 1);
      assert.equal(u.totals.steps, 2, "the carried step is not consumption");
      assert.equal(u.totals.tokenCostUsd, 0.75);
      assert.equal(u.totals.inputTokens, 1500);
      assert.equal(u.totals.computeSecs, 40);
      // Reservations: computeSecs × the limits in force.
      assert.equal(u.totals.cpuSecs, 80);
      assert.equal(u.totals.gibSecs, 160);

      const desk = u.workspaces.find((w) => w.workspace === "desk")!;
      // The flow cut and the agent cut are the same facts sliced twice.
      assert.equal(desk.byFlow.publish.tokenCostUsd, 0.75);
      assert.equal(desk.byAgent.writer.tokenCostUsd, 0.5);
      assert.equal(desk.byAgent.editor.tokenCostUsd, 0.25);
      assert.equal(
        Object.values(desk.byAgent).reduce((s, b) => s + b.computeSecs, 0),
        desk.computeSecs,
      );
      // Storage sees the files just written.
      assert.ok(desk.storage.runsBytes > 0);
      assert.ok(desk.storage.sourceBytes > 0);
    } finally {
      delete process.env.FOLDRUN_RUNNER_CPUS;
      delete process.env.FOLDRUN_RUNNER_MEMORY;
    }
  });
});
