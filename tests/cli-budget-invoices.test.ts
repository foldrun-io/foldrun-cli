// Two dashboard pages the CLI could not reach (5 Nov 2026): Spend limits —
// `foldrun usage budget`, each cap and what is spent in its window, from
// GET /api/usage/budget — and the Invoices tab — `foldrun billing invoices`,
// the plan's tax invoices and every credit purchase with its receipt, from
// GET /api/billing/invoices.
//
//   node --test tests/cli-budget-invoices.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, failing } from "./fake-platform.ts";

const json = (out: string) => JSON.parse(out.slice(out.search(/[[{]/)));

const BUDGET = {
  account: { budget: { usd: 500, period: "month" }, label: "$500/month", spentUsd: 410, window: "this month" },
  workspaces: [
    { workspace: "desk", budget: { usd: 60, period: "day" }, label: "$60/day", spentUsd: 61.2, window: "today" },
    { workspace: "blog", budget: { usd: 100, period: "week" }, label: "$100/week", spentUsd: 20, window: "this week" },
    { workspace: "quiet", budget: null, label: null, spentUsd: 1.5, window: "this month" },
  ],
};

test("usage budget: the account's cap and each workspace's, spent in its window, how close, and the one at its cap", async () => {
  const s = await serve({ "/api/usage/budget": () => BUDGET });
  const r = await at(s.url, "usage", "budget");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen[0].method, "GET");
  assert.match(r.out, /account +! \$410\.00 of \$500\/month this month · 82% · past the 80% warning/);
  assert.match(r.out, /desk +✗ \$61\.20 of \$60\/day today · 102% · at the cap, new runs are refused until tomorrow/);
  assert.match(r.out, /blog +✓ \$20\.00 of \$100\/week this week · 20%/);
  assert.match(r.out, /quiet +\$1\.50 spent this month · no cap/);
});

test("usage budget --to <ws>: that workspace alone; one the key cannot open is said so", async () => {
  const s = await serve({ "/api/usage/budget": () => BUDGET });
  const one = await at(s.url, "usage", "budget", "--to", "blog");
  const asJson = await at(s.url, "usage", "budget", "--to", "blog", "--json");
  const none = await at(s.url, "usage", "budget", "--to", "nope");
  s.close();
  assert.equal(one.code, 0, one.out);
  assert.match(one.out, /blog +✓ \$20\.00 of \$100\/week/);
  assert.doesNotMatch(one.out, /\$500|\$61/, "not the account, not another workspace");
  assert.deepEqual(json(asJson.out), { workspaces: [BUDGET.workspaces[1]] });
  assert.notEqual(none.code, 0);
  assert.match(none.out, /no workspace "nope" among the ones this credential may open/);
});

test("usage budget for a scoped key: the account's figure is hidden, and why", async () => {
  const s = await serve({ "/api/usage/budget": () => ({ account: null, accountHidden: true, workspaces: [BUDGET.workspaces[1]] }) });
  const r = await at(s.url, "usage", "budget");
  const j = await at(s.url, "usage", "budget", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /account +shown only to a member or key with every workspace/);
  assert.equal(json(j.out).accountHidden, true);
});

const INVOICES = {
  stripe: true,
  invoices: [
    { id: "in_2", number: "FR-0002", description: "Monthly fee", createdAt: "2026-10-28T04:00:00.000Z", amount: 99, currency: "aud", status: "open", url: "https://invoice.stripe.com/i/2", pdfUrl: null },
    { id: "in_1", number: "FR-0001", description: "First month", createdAt: "2026-09-28T04:00:00.000Z", amount: 29, currency: "aud", status: "paid", url: "https://invoice.stripe.com/i/1", pdfUrl: null },
  ],
  receipts: [
    { t: "2026-10-20T03:00:00.000Z", usd: 20, label: "Credit", receiptUrl: null },
    { t: "2026-10-02T03:00:00.000Z", usd: 50, label: "Top-up", receiptUrl: "https://pay.stripe.com/receipts/paid" },
  ],
};

test("billing invoices: number, date, amount, status and link for each invoice; each purchase with its receipt", async () => {
  const s = await serve({ "/api/billing/invoices": () => INVOICES });
  const r = await at(s.url, "billing", "invoices");
  const j = await at(s.url, "billing", "invoices", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen[0].method, "GET");
  assert.match(r.out, /FR-0002 +2026-10-28 +99\.00 AUD +open +Monthly fee/);
  assert.match(r.out, /FR-0001 +2026-09-28 +29\.00 AUD +paid +First month/);
  assert.match(r.out, /https:\/\/invoice\.stripe\.com\/i\/2/);
  assert.match(r.out, /2026-10-02 +\+\$50\.00 +Top-up\n +https:\/\/pay\.stripe\.com\/receipts\/paid/);
  assert.match(r.out, /2026-10-20 +\+\$20\.00 +Credit\n +no receipt — not paid by card/);
  assert.ok(r.out.indexOf("FR-0002") < r.out.indexOf("FR-0001"), "newest first, as sent");
  assert.deepEqual(json(j.out), INVOICES);
});

test("billing invoices without Stripe: says so rather than an empty table", async () => {
  const s = await serve({ "/api/billing/invoices": () => ({ stripe: false, invoices: [], receipts: [] }) });
  const r = await at(s.url, "billing", "invoices");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /none — Stripe is not set up for this account/);
  assert.match(r.out, /no payments yet/);
});

test("billing invoices on an install with no billing (404): says so", async () => {
  const s = await serve({});
  const r = await at(s.url, "billing", "invoices");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /has no billing — invoices are the hosted platform's/);
});

test("billing invoices with a scoped key (403): needs every workspace", async () => {
  const s = await serve({ "/api/billing/invoices": () => failing(403, { error: "invoices and receipts are the whole account's — a member or key scoped to some workspaces cannot read them" }) });
  const r = await at(s.url, "billing", "invoices");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /invoices need a member or key with every workspace — invoices and receipts are the whole account's/);
});
