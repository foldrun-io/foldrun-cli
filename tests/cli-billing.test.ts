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
import { serve, at, failing } from "./fake-platform.ts";

const entries = [
  { t: "2026-09-16T03:01:45.732Z", kind: "run", usd: 0, workspace: "intake-desk", flow: "hourly", runId: "run-aaa", waived: ["models", "compute"] },
  { t: "2026-09-16T02:33:56.938Z", kind: "adjustment", usd: -0.593345, note: "browser foldrun-browser-acme 4944s since 2026-09-16T01:11:33Z" },
  { t: "2026-09-15T09:00:00.000Z", kind: "topup", usd: 50, note: "manual top-up" },
];

test("billing leads with the balance and the ledger under it", async () => {
  const s = await serve({ "/v1/billing": () => ({ enabled: true, balanceUsd: 42.5, entries: entries.slice(1) }) });
  const r = await at(s.url, "billing");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /balance \$42\.50/);
  assert.match(r.out, /billing on/);
  assert.match(r.out, /adjustment/);
  assert.match(r.out, /browser foldrun-browser-acme/);
  assert.match(r.out, /\+ .*topup.*\$50\.0000/);
  assert.doesNotMatch(r.out, /wallet is empty/);
});

test("what the platform says the account should hear is printed, in its words", async () => {
  const notices = ["the wallet is empty — new runs are refused until it is topped up", "models, compute are waived for this account — those parts of each charge are $0"];
  const s = await serve({ "/v1/billing": () => ({ enabled: true, balanceUsd: -376.886539, entries, notices }) });
  const r = await at(s.url, "billing");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /balance \$-376\.89/);
  assert.match(r.out, /the wallet is empty — new runs are refused until it is topped up/);
  assert.match(r.out, /models, compute are waived for this account/);
});

test("the CLI draws no billing conclusion of its own: no notice, nothing said", async () => {
  // A negative balance inside an overdraft, or a fully waived account, is
  // not refused: only the platform knows, so without its notice the CLI
  // says nothing beyond the numbers.
  const s = await serve({ "/v1/billing": () => ({ enabled: true, balanceUsd: -1, entries, notices: [] }) });
  const r = await at(s.url, "billing");
  s.close();
  assert.doesNotMatch(r.out, /wallet is empty/);
  assert.doesNotMatch(r.out, /waived/);
});

test("a run entry says which flow in which workspace it paid for", async () => {
  const s = await serve({ "/v1/billing": () => ({ enabled: true, balanceUsd: 1, entries }) });
  const r = await at(s.url, "billing");
  s.close();
  assert.match(r.out, /intake-desk\/hourly/);
  assert.match(r.out, /run-aaa/);
});

test("billing off on a self-hosted install is said, not hidden", async () => {
  const s = await serve({ "/v1/billing": () => ({ enabled: false, balanceUsd: 0, entries: [] }) });
  const r = await at(s.url, "billing");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /billing off — nothing is charged on this install/);
  assert.match(r.out, /no ledger entries yet/);
  assert.doesNotMatch(r.out, /wallet is empty/);
});

test("--limit caps the ledger, and the total is still named", async () => {
  const s = await serve({ "/v1/billing": () => ({ enabled: true, balanceUsd: 1, entries }) });
  const r = await at(s.url, "billing", "--limit", "1");
  s.close();
  assert.match(r.out, /3 entries on the ledger/);
  assert.doesNotMatch(r.out, /manual top-up/);
});


test("every billing verb on a platform without billing says so, not a bare 404", async () => {
  const s = await serve({
    "GET /v1/billing": () => failing(404, { error: "not found" }),
    "GET /v1/billing/statement": () => failing(404, { error: "not found" }),
  });
  const plain = await at(s.url, "billing");
  const statement = await at(s.url, "billing", "statement");
  s.close();
  assert.notEqual(plain.code, 0);
  assert.match(plain.out, /has no billing/);
  assert.match(statement.out, /has no billing/);
});

test("billing names the subscription the account works under (23 Nov 2026): the plan and its use, a legacy plan as honoured, or none", async () => {
  const sub = (body: object) => ({ prices: { pro: 20, max: 100 }, available: { pro: true, max: true }, balanceUsd: 10, ...body });
  const pro = await serve({
    "/v1/billing": () => ({ enabled: true, balanceUsd: 10, entries: [] }),
    "/v1/billing/coding-plan": () => sub({ plan: { plan: "pro", status: "active", renew: true, periodEnd: "2026-12-20T00:00:00Z" }, allowance: { windows: [{ name: "month", usedPct: 12 }, { name: "week", usedPct: 40 }] }, extraUsage: { on: true }, entitlement: { kind: "active", source: "subscription", plan: "pro" } }),
  });
  const a = await at(pro.url, "billing");
  pro.close();
  assert.match(a.out, /foldrun Pro\s+renews 2026-12-20/);
  assert.match(a.out, /this month 12% of the allowance used/);
  assert.match(a.out, /this week 40% of the allowance used/);
  assert.match(a.out, /extra usage on/);
  const legacy = await serve({
    "/v1/billing": () => ({ enabled: true, balanceUsd: 10, entries: [] }),
    "/v1/billing/coding-plan": () => sub({ plan: null, allowance: null, extraUsage: null, entitlement: { kind: "active", source: "legacy", plan: "scale", paidThrough: "2026-12-01T00:00:00Z" } }),
  });
  const b = await at(legacy.url, "billing");
  legacy.close();
  assert.match(b.out, /scale platform plan — honoured to 2026-12-01, no longer sold/);
  const none = await serve({
    "/v1/billing": () => ({ enabled: true, balanceUsd: 50, entries: [] }),
    "/v1/billing/coding-plan": () => sub({ plan: null, allowance: null, extraUsage: null, entitlement: { kind: "none" } }),
  });
  const n = await at(none.url, "billing");
  none.close();
  assert.match(n.out, /no active subscription — new work is refused until one starts: foldrun billing plan pro/);
  // A platform that sells none: nothing about a subscription.
  const off = await serve({ "/v1/billing": () => ({ enabled: true, balanceUsd: 1, entries: [] }) });
  const o = await at(off.url, "billing");
  off.close();
  assert.equal(o.code, 0, o.out);
  assert.doesNotMatch(o.out, /subscription|foldrun Pro/);
});

const plan = { plan: "pro", status: "active", periodStart: "2026-11-01T00:00:00Z", periodEnd: "2026-12-01T00:00:00Z", priceUsd: 20, renew: true };

test("billing shows the plan, allowance, reset, extra usage, cap, spend and balance (FOL-235)", async () => {
  const s = await serve({
    "/v1/billing": () => ({ enabled: true, balanceUsd: 12.5, entries: [] }),
    "/v1/billing/coding-plan": () => ({
      plan,
      entitlement: { kind: "active", plan: "pro", source: "subscription", paidThrough: "2026-12-01T00:00:00Z", renews: true },
      allowance: { windows: [{ name: "week", usedPct: 40, resetsAt: "2026-11-27T00:00:00Z" }] },
      extraUsage: { on: true, capUsd: 30, spentUsd: 4.25, heldUsd: 0 },
    }),
  });
  const r = await at(s.url, "billing");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /balance \$12\.50/);
  assert.match(r.out, /foldrun Pro\s+renews 2026-12-01/);
  assert.match(r.out, /this week 40% of the allowance used.*resets 2026-11-27/);
  assert.match(r.out, /extra usage on · cap \$30\.00 a period · \$4\.25 spent/);
});

test("billing extra-usage on --limit sends the switch and the cap", async () => {
  const s = await serve({
    "GET /v1/billing/coding-plan": () => ({ plan, entitlement: { kind: "active", plan: "pro", source: "subscription", renews: true }, extraUsage: { on: false, capUsd: null } }),
    "PATCH /v1/billing/coding-plan": () => ({ plan: { ...plan, extraUsage: true, extraUsageCapUsd: 30 }, extraUsage: { on: true, capUsd: 30, spentUsd: 0, heldUsd: 0 } }),
  });
  const r = await at(s.url, "billing", "extra-usage", "on", "--limit", "30", "--yes");
  const seen = s.seen.find((x) => x.method === "PATCH");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(seen!.body), { extraUsage: true, extraUsageCapUsd: 30 });
  assert.match(r.out, /on, up to \$30\.00 a period/);
});

test("each billing refusal code says what to do next (FOL-235)", async () => {
  const cases: Record<string, RegExp> = {
    subscription_required: /foldrun billing plan pro/,
    allowance_used: /foldrun billing extra-usage on --limit/,
    extra_usage_cap: /--no-limit/,
    extra_usage_unfunded: /foldrun billing top-up/,
    pay_as_you_go_off: /foldrun billing pay-as-you-go on/,
    model_not_in_plan: /extra-usage on/,
    billing_unreadable: /nothing was charged/,
  };
  for (const [code, want] of Object.entries(cases)) {
    const s = await serve({ "/v1/billing": () => failing(code === "billing_unreadable" ? 503 : 402, { error: `refused: ${code}`, code }) });
    const r = await at(s.url, "billing");
    s.close();
    assert.notEqual(r.code, 0);
    assert.match(r.out, want, code);
  }
});

test("Starter is the third size (27 Nov 2026): listed with its price, bought, and Pro → Starter is a move down at the renewal", async () => {
  const entitlement = { kind: "active", plan: "pro", source: "subscription", renews: true };
  const base = { prices: { starter: 10, pro: 25, max: 120 }, available: { starter: true, pro: true, max: true }, balanceUsd: 40, extraUsage: { on: false, capUsd: null } };
  const s = await serve({
    "GET /v1/billing/coding-plan": () => ({ ...base, plan: null, entitlement: { kind: "none" } }),
    "POST /v1/billing/coding-plan": () => ({ plan: { ...plan, plan: "starter", priceUsd: 10 } }),
  });
  const l = await at(s.url, "billing", "plans");
  assert.equal(l.code, 0, l.out);
  assert.match(l.out, /Starter\s+\$10\/30 days\s+0\.4 of Pro's allowance/);
  assert.match(l.out, /Pro\s+\$25\/30 days/);
  assert.match(l.out, /Max\s+\$120\/30 days/);
  const b = await at(s.url, "billing", "plan", "starter", "--yes");
  const post = s.seen.find((x) => x.method === "POST");
  s.close();
  assert.equal(b.code, 0, b.out);
  assert.deepEqual(JSON.parse(post!.body), { plan: "starter", maxUsd: 10 });
  // On Pro, Starter is a move down at the renewal, bound to the period shown.
  const d = await serve({
    "GET /v1/billing/coding-plan": () => ({ ...base, plan, entitlement }),
    "POST /v1/billing/coding-plan": () => ({ plan: { ...plan, nextPlan: "starter" } }),
  });
  const r = await at(d.url, "billing", "plan", "starter", "--yes");
  const down = d.seen.find((x) => x.method === "POST");
  d.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(down!.body), { plan: "starter", maxUsd: 10, period: plan.periodEnd });
  assert.match(r.out, /Pro until 2026-12-01, then Starter/);
  // A platform from before Starter reports no price for it: not listed.
  const old = await serve({ "GET /v1/billing/coding-plan": () => ({ prices: { pro: 20, max: 100 }, available: { pro: true, max: true }, balanceUsd: 1, plan: null, entitlement: { kind: "none" } }) });
  const o = await at(old.url, "billing", "plans");
  old.close();
  assert.doesNotMatch(o.out, /Starter/);
});

test("the storage a plan includes is a line in `billing` and `billing plans` (27 Nov 2026); an older platform that does not say prints none", async () => {
  const live = { plan: "starter", status: "active", renew: true, periodEnd: "2026-12-20T00:00:00Z" };
  const body = (allowance: object) => ({ prices: { starter: 10, pro: 25, max: 120 }, available: { starter: true, pro: true, max: true }, balanceUsd: 5, plan: live, allowance, extraUsage: { on: false, capUsd: null }, entitlement: { kind: "active", source: "subscription", plan: "starter" } });
  const s = await serve({
    "/v1/billing": () => ({ enabled: true, balanceUsd: 5, entries: [] }),
    "/v1/billing/coding-plan": () => body({ windows: [{ name: "week", usedPct: 5, resetsAt: "2026-12-01T00:00:00Z" }], storageGb: 2 }),
  });
  const a = await at(s.url, "billing");
  const p = await at(s.url, "billing", "plans");
  s.close();
  assert.equal(a.code, 0, a.out);
  assert.match(a.out, /foldrun Starter/);
  assert.match(a.out, /storage 2 GB included/);
  assert.match(p.out, /storage\s+2 GB included/);
  const old = await serve({
    "/v1/billing": () => ({ enabled: true, balanceUsd: 5, entries: [] }),
    "/v1/billing/coding-plan": () => body({ windows: [] }),
  });
  const o = await at(old.url, "billing", "plans");
  old.close();
  assert.doesNotMatch(o.out, /GB included/);
});

test("a wallet-only account (FOL-385): billing and billing plans say it pays as it goes, and pay-as-you-go speaks of a month", async () => {
  const wallet = { kind: "active", plan: "wallet", source: "wallet", paidThrough: null, renews: false };
  const base = { prices: { starter: 10, pro: 25, max: 120 }, available: { starter: true, pro: true, max: true }, balanceUsd: 20, plan: null, allowance: null, entitlement: wallet };
  const s = await serve({
    "/v1/billing": () => ({ enabled: true, balanceUsd: 20, entries: [] }),
    "GET /v1/billing/coding-plan": () => ({ ...base, extraUsage: { on: true, capUsd: 50, spentUsd: 3.5, heldUsd: 0, wallet: true } }),
    "PATCH /v1/billing/coding-plan": () => ({ plan: null, allowance: null, extraUsage: { on: false, capUsd: 50, spentUsd: 3.5, heldUsd: 0, wallet: true } }),
  });
  const b = await at(s.url, "billing");
  assert.equal(b.code, 0, b.out);
  assert.match(b.out, /pay as you go — no plan, your wallet pays/);
  assert.match(b.out, /on · cap \$50\.00 a month · \$3\.50 spent this month/);
  const l = await at(s.url, "billing", "plans");
  assert.match(l.out, /pay as you go\s+on · up to \$50\.00 a month/);
  const off = await at(s.url, "billing", "pay-as-you-go", "off");
  s.close();
  assert.equal(off.code, 0, off.out);
  assert.match(off.out, /pay as you go off \(its limit, \$50\.00 a month, kept\) — nothing new runs until you turn it on/);
});

test("plan renewal (FOL-452): billing plans says who pays it, the grace is said, and the card backup is a wallet setting", async () => {
  const sub = { kind: "active", source: "subscription", plan: "pro" };
  const live = { plan: "pro", status: "active", renew: true, periodEnd: "2026-12-20T00:00:00Z", periodStart: "2026-11-20T00:00:00Z", priceUsd: 25 };
  const base = { prices: { starter: 10, pro: 25, max: 120 }, available: { starter: true, pro: true, max: true }, balanceUsd: 5, allowance: { windows: [] }, extraUsage: { on: false, capUsd: null } };
  const renewal = (over: object) => ({ plan: "pro", priceUsd: 25, at: live.periodEnd, walletCovers: false, cardBackup: true, state: null, graceUntil: null, attempts: 0, ...over });
  let view: object = { ...base, plan: live, entitlement: sub, renewal: renewal({}) };
  const s = await serve({
    "GET /v1/billing/coding-plan": () => view,
    "GET /v1/billing/wallet": () => ({ enabled: true, summary: { balanceUsd: 5 }, cardSaved: true, autoTopUp: null, renewFromCard: true }),
    "PUT /v1/billing/wallet": () => ({ ok: true }),
    "DELETE /v1/billing/coding-plan": () => ({ plan: null }),
  });
  const card = await at(s.url, "billing", "plans");
  assert.match(card.out, /renewal\s+\$25\.00: your wallet holds \$5\.00, your saved card pays the rest/);
  view = { ...base, plan: live, entitlement: sub, renewal: renewal({ cardBackup: false }) };
  assert.match((await at(s.url, "billing", "plans")).out, /no card pays the rest — `foldrun billing top-up <usd>` before then/);
  view = { ...base, plan: { ...live, status: "ended", renew: false }, entitlement: { kind: "none" }, renewal: renewal({ state: "failed", graceUntil: "2026-12-23T00:00:00Z" }) };
  assert.match((await at(s.url, "billing", "plans")).out, /your Pro plan could not renew: your wallet is short of \$25\.00\. Top up by 2026-12-23 00:00 UTC/);
  const stop = await at(s.url, "billing", "plan", "cancel", "--yes");
  assert.equal(stop.code, 0, stop.out);
  assert.match(stop.out, /Pro will not renew — it ends within the hour/);
  assert.ok(s.seen.some((x) => x.method === "DELETE"), "the renewal is stopped in the grace");
  const w = await at(s.url, "billing", "wallet");
  assert.match(w.out, /renewals\s+the saved card pays what the wallet lacks/);
  const off = await at(s.url, "billing", "wallet", "set", "renew-from-card", "off");
  const put = s.seen.find((x) => x.method === "PUT");
  s.close();
  assert.equal(off.code, 0, off.out);
  assert.deepEqual(JSON.parse(put!.body), { renewFromCard: false });
  assert.match(off.out, /plan renewals from the wallet only/);
});
