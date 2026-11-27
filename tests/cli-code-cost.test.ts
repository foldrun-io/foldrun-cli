// /cost explain and `foldrun usage --session` (FOL-249): the rows a session
// keeps, what they come to, and the one biggest cause.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { localRow, cloudRow, meter, meteredRows, keepRow, keptRows, keptSessions, findSessions, rowsOf, ledgerKey, explainCost, explainLines, estimateUsd, cacheMiss, priceOf } from "../src/code-cost.mjs";

const RATES = { catalogue: { models: { prices: [{ provider: "anthropic", model: "m-1", inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3 }] } } };

test("a row from a turn on this computer counts the cache as part of what was read; a cloud row sums its steps, counts their recorded calls and reads who paid from them", () => {
  const l = localRow({ kind: "local", turn: 2, model: "m-1", calls: 3, usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 20 }, paidBy: "p" });
  assert.deepEqual([l.read, l.cacheRead, l.cacheWrite, l.output, l.calls, l.costUsd], [1050, 900, 50, 20, 3, undefined]);
  const c = cloudRow({ kind: "cloud", turn: 1, run: { id: "run-1", steps: [{ costUsd: 0.25, turns: 4, model: "m-1", tokens: { input: 1000, output: 10, cacheRead: 800 } }, { costUsd: 0.5, calls: [{}, {}], subagentOf: "x", tokens: { input: 200, output: 5 } }, { costUsd: null }] } });
  assert.deepEqual([c.read, c.cacheRead, c.cacheWrite, c.output, c.calls, c.costUsd, c.run, c.model, c.paidBy], [1200, 800, 0, 15, 6, 0.75, "run-1", "m-1", "the account's credits"]);
  // A step on the account's own model key is its provider's to bill; one metered at the gateway is said so; both are named.
  assert.equal(cloudRow({ kind: "cloud", turn: 1, run: { steps: [{ costUsd: 1, supply: "own" }] } }).paidBy, "your own model key");
  assert.equal(cloudRow({ kind: "cloud", turn: 1, run: { steps: [{ costUsd: 1, credential: "provider:anthropic" }] } }).paidBy, "your own model key");
  assert.equal(cloudRow({ kind: "cloud", turn: 1, run: { steps: [{ costUsd: 1, supply: "foldrun" }, { costUsd: 1, supply: "operator" }] } }).paidBy, "foldrun's models, metered at the gateway + the account's credits");
  // A retried step: each attempt by its own supply. The models: the ones its calls record.
  const retried = cloudRow({ kind: "cloud", turn: 1, run: { steps: [{ costUsd: 2, supply: "operator", model: "default", tries: [{ supply: "own" }, { supply: "operator" }], calls: [{ model: "served-a" }, { model: "served-b" }, { model: "served-a" }] }] } });
  assert.deepEqual([retried.paidBy, retried.model, retried.calls], ["your own model key + the account's credits", "served-a, served-b", 3]);
});

test("the meter counts every answered call and a compaction's summary request, keeps the model that served, and what a stopped turn had used", () => {
  const m = meter();
  m.note({ type: "system", subtype: "init", model: "foldrun/default" });
  m.note({ type: "assistant", message: { model: "served-1", usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 } } });
  m.note({ type: "system", subtype: "compact_boundary", model: "served-1", usage: { input_tokens: 500, output_tokens: 50 } });
  m.note({ type: "assistant", message: { model: "served-2", usage: { input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 7 } } });
  // A sub-agent's call seen through the parent is not the parent's; nor is an event with no usage.
  m.note({ type: "assistant", parent_tool_use_id: "t1", message: { usage: { input_tokens: 999 } } });
  m.note({ type: "result", usage: { input_tokens: 999 } });
  assert.deepEqual([m.calls, m.firstRead, m.lastCached], [3, 90, 30]);
  // Kept by the model that served: a cheaper last call does not reprice the first.
  const rows = meteredRows(m, { kind: "local", turn: 4, paidBy: "p", gapMs: 1000, before: 20_000 });
  assert.deepEqual(rows.map((r) => [r.model, r.calls, r.read, r.cacheRead, r.cacheWrite, r.output]), [["served-1", 2, 600, 90, 0, 55], ["served-2", 1, 50, 0, 30, 7]]);
  assert.deepEqual([rows[0].before, rows[0].firstRead, rows[0].gapMs, rows[1].before, rows[1].firstRead], [20_000, 90, 1000, undefined, undefined]);
  assert.deepEqual(meteredRows(meter(), { kind: "local", turn: 1, paidBy: "p" }), [], "a turn that reached no model has no row");
  // A call cut off mid-answer was still read: what its start reported is counted, once — and not on top of an answer that did come.
  const cut = meter();
  const start = (input: number) => ({ type: "stream_event", event: { type: "message_start", message: { model: "served-1", usage: { input_tokens: input, cache_read_input_tokens: 40, output_tokens: 1 } } } });
  cut.note(start(10));
  cut.note({ type: "assistant", message: { model: "served-1", usage: { input_tokens: 10, cache_read_input_tokens: 40, output_tokens: 9 } } });
  cut.note(start(70));
  cut.note({ type: "stream_event", event: { type: "message_delta", usage: { output_tokens: 6 } } });
  const cutRows = meteredRows(cut, { kind: "local", turn: 1, paidBy: "p" });
  assert.deepEqual(cutRows.map((r) => [r.calls, r.read, r.output, r.firstRead]), [[2, 160, 15, 40]]);
  assert.equal(meteredRows(cut, { kind: "local", turn: 1, paidBy: "p" })[0].calls, 2, "asked twice, counted once");
});

test("the estimate prices fresh input, cache writes, cache reads and output apart", () => {
  const row = localRow({ kind: "local", turn: 1, model: "m-1", calls: 1, usage: { input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, output_tokens: 1_000_000 }, paidBy: "p" });
  // 3 (fresh) + 3.75 (write: no price listed, a quarter more) + 0.3 (read, as listed) + 15 (out)
  assert.equal(Number(estimateUsd(row, priceOf(RATES, "m-1")!).toFixed(4)), 22.05);
  assert.equal(priceOf(RATES, "other"), null);
  assert.equal(priceOf(null, "m-1"), null);
});

test("the figures add up, cloud apart from this computer; a cache miss is measured against what the turn before left, and named as the cause with the pause before it", () => {
  const rows = [
    localRow({ kind: "local", turn: 1, model: "m-1", calls: 2, usage: { input_tokens: 500, cache_creation_input_tokens: 30_000, output_tokens: 100 }, paidBy: "p" }),
    localRow({ kind: "local", turn: 2, model: "m-1", calls: 2, usage: { input_tokens: 300, cache_read_input_tokens: 30_000, output_tokens: 100 }, paidBy: "p", before: 30_000, firstRead: 30_000 }),
    localRow({ kind: "local", turn: 3, model: "m-1", calls: 2, usage: { input_tokens: 400, cache_creation_input_tokens: 61_000, output_tokens: 100 }, paidBy: "p", gapMs: 45 * 60_000, before: 30_000, firstRead: 0 }),
    cloudRow({ kind: "cloud-agent", turn: 3, label: "#1", run: { steps: [{ costUsd: 0.01, turns: 1, tokens: { input: 900, output: 10 } }] } }),
  ];
  assert.equal(cacheMiss(rows[0]), false, "the first turn has nothing cached to read");
  assert.equal(cacheMiss(rows[1]), false);
  assert.equal(cacheMiss(rows[2]), true);
  // A large new input after a small turn reads all that was cached: low share, no miss.
  assert.equal(cacheMiss(localRow({ kind: "local", turn: 4, calls: 1, usage: { input_tokens: 90_000, cache_read_input_tokens: 12_000 }, paidBy: "p", before: 12_000, firstRead: 12_000 })), false);
  // The first call missed and a later call of the same turn read the rewritten cache back: still a miss.
  assert.equal(cacheMiss(localRow({ kind: "local", turn: 4, calls: 2, usage: { cache_creation_input_tokens: 40_000, cache_read_input_tokens: 40_000 }, paidBy: "p", before: 40_000, firstRead: 0 })), true);
  // Nothing was cached before (two uncached turns): not a miss.
  assert.equal(cacheMiss(localRow({ kind: "local", turn: 4, calls: 1, usage: { input_tokens: 20_000 }, paidBy: "p", firstRead: 0 })), false);
  // A cloud row does not say what was there to read: never called a miss.
  assert.equal(cacheMiss(cloudRow({ kind: "cloud", turn: 2, run: { steps: [{ tokens: { input: 90_000, output: 1 } }] } })), false);
  const x = explainCost(rows, RATES);
  assert.equal(x.allPriced, true);
  assert.deepEqual([x.rows[0].turn, x.rows[0].kind], [3, "local"]);
  assert.equal(x.totals.billedUsd, 0.01);
  const each = x.rows.filter((r) => r.estimated).reduce((n, r) => n + (r.usd ?? 0), 0);
  assert.equal(Number(x.totals.estimatedUsd.toFixed(9)), Number(each.toFixed(9)));
  assert.equal(x.totals.read, rows.reduce((n, r) => n + r.read, 0));
  assert.match(x.cause, /^Turn 3 · on this computer cost the most — \d+% of the session: the turn before left 30k tokens in the cache and its first call read back none \(61k written to it anew in the turn\) — a cache miss\. Likely the cache had expired: 45 minutes had passed since the turn before\.$/);
  const lines = explainLines(x);
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^turn 3 · on this computer\s+m-1\s+2 calls\s+61k read\s+0% cached\s+61k written\s+100 out\s+≈\$0\.\d+\s+p$/);
  assert.match(lines.at(-1)!, /cloud agent #1 · in turn 3.*\$0\.010\s+the account's credits$/);
});

test("with no price list the rows are ranked by tokens and say so; nothing is invented, and no row is said to have cost the most", () => {
  const rows = [localRow({ kind: "local", turn: 1, model: "m-1", calls: 12, usage: { input_tokens: 9000, output_tokens: 10 }, paidBy: "p" }), localRow({ kind: "sub-agent", turn: 1, label: "scout", calls: 1, usage: { input_tokens: 100, output_tokens: 10 }, paidBy: "p" })];
  const x = explainCost(rows, null);
  assert.equal(x.allPriced, false);
  assert.deepEqual([x.totals.billedUsd, x.totals.estimatedUsd, x.totals.unpriced], [0, 0, 2]);
  assert.match(x.cause, /^Turn 1 · on this computer used the most \(by tokens: not every row has a price\): it made 12 model calls/);
  assert.doesNotMatch(x.cause, /% of the session|cost the most/);
  assert.match(explainLines(x)[0], /no price/);
});

test("rows are kept per conversation — the platform, project, agent, folder and id together — in a private file, read back clean; any id is a safe file name", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cost-"));
  const was = process.env.FOLDRUN_HOME;
  process.env.FOLDRUN_HOME = home;
  try {
    const a = { url: "https://p", account: "acme", ws: "desk", agent: "coder", dir: home, context: "main" };
    const b = { ...a, ws: "other" };
    const odd = { ...a, context: "../issue.42 é" };
    assert.equal(keptRows(a), null);
    const row = (turn: number) => localRow({ kind: "local", turn, calls: 1, usage: { input_tokens: 5 }, paidBy: "p" });
    keepRow(a, row(1));
    keepRow(a, row(2));
    keepRow(b, row(1));
    keepRow(odd, row(1));
    assert.notEqual(ledgerKey(a), ledgerKey(b));
    assert.notEqual(ledgerKey(a), ledgerKey({ ...a, account: "other" }), "another account's conversation is its own");
    const file = path.join(home, "code-cost", `${ledgerKey(a)}.jsonl`);
    fs.appendFileSync(file, '{"kind":"local","turn":3,"calls":"x","read":-4,"paidBy":7,"costUsd":"1"}\n{"kind":"nope"}\n{broken');
    const rows = keptRows(a)!;
    assert.equal(rows.length, 3, "every row is read: nothing is dropped at a cap");
    assert.deepEqual([rows[2].calls, rows[2].read, rows[2].paidBy, rows[2].costUsd], [0, 0, "", undefined]);
    assert.equal(fs.statSync(file).mode & 0o077, 0);
    assert.equal(keptRows(b)!.length, 1, "another project's conversation of the same id is its own");
    assert.deepEqual(fs.readdirSync(path.join(home, "code-cost")).filter((f) => !/^[0-9a-f]{32}\.jsonl$/.test(f)), []);
    // By id: both `main`s; by the start of a key: one.
    assert.deepEqual(findSessions("main").map((x) => x.ws).sort(), ["desk", "other"]);
    assert.deepEqual(findSessions(ledgerKey(b).slice(0, 8)).map((x) => x.ws), ["other"]);
    assert.equal(findSessions("../issue.42 é").length, 1);
    assert.equal(findSessions("nope").length, 0);
    assert.equal(rowsOf(ledgerKey(a)).length, 3);
    assert.deepEqual(rowsOf("../../etc/passwd"), []);
    assert.equal(keptSessions().length, 3);
  } finally {
    if (was === undefined) delete process.env.FOLDRUN_HOME;
    else process.env.FOLDRUN_HOME = was;
  }
});

test("a call's start marks the turn read even when it reports no input count (a translated provider — Codex round 11)", () => {
  const m = meter();
  assert.equal(m.started, false);
  m.note({ type: "stream_event", parent_tool_use_id: "toolu_1", event: { type: "message_start", message: { usage: { input_tokens: 5 } } } });
  assert.equal(m.started, false, "a sub-agent's call is not the turn's");
  m.note({ type: "stream_event", event: { type: "message_start", message: { model: "gpt-x", usage: { input_tokens: 0 } } } });
  assert.equal(m.started, true);
  assert.equal(m.lastInput, 0);
});

test("a second opinion in an answer (FOL-418): the second model's tokens counted under that model, beside the call's", () => {
  const m = meter();
  m.note({ type: "assistant", message: { model: "claude-x", usage: { input_tokens: 100, output_tokens: 10 }, content: [
    { type: "server_tool_use", id: "s1", name: "foldrun_review", input: { diff: "x" } },
    { type: "foldrun_review_tool_result", tool_use_id: "s1", content: { type: "foldrun_review_result", model: "openai/gpt-x", text: "ok", usage: { input_tokens: 400, output_tokens: 40 } } },
    { type: "foldrun_debate_tool_result", tool_use_id: "s2", content: { type: "foldrun_debate_tool_result_error", error_code: "unavailable" } },
  ] } });
  const rows = meteredRows(m, { kind: "local", turn: 1, paidBy: "p" });
  assert.deepEqual(rows.map((r) => [r.model, r.calls, r.read, r.output]), [["claude-x", 1, 100, 10], ["openai/gpt-x", 1, 400, 40]]);
});
