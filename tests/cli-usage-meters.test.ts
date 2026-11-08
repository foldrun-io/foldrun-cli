// `foldrun usage meters` and `foldrun usage rates` (7 Nov 2026, FOL-125): the
// Usage page's Compute, Tokens and Rates tabs at the terminal.
//
//   node --test tests/cli-usage-meters.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, failing } from "./fake-platform.ts";

const PLAN = { id: "starter", name: "Starter", feeUsd: 29, creditsPerMonth: 3000, rollover: true, rolloverCapCredits: 6000, storageGb: 10, computeAtOnce: { vcpu: 4, memGiB: 8 }, lane: "normal", paysForTokens: false };
const USAGE = {
  tenant: "acme",
  period: { from: "2026-11-01", to: "2026-11-07", basis: "consumption" },
  credits: { unit: "credit", usdPerCredit: 0.01, pots: { planUsd: 12, boughtUsd: 5 }, plan: { ...PLAN, status: "active", resetsAt: "2026-12-01T00:00:00.000Z" }, boughtOldestExpiresAt: null },
  tokens: {
    totals: { calls: 12, billedCredits: 42.5, byokTokens: 9000 },
    byModel: [
      { supply: "foldrun", provider: "anthropic", model: "claude-sonnet-5-5", calls: 10, inputTokens: 5000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 800, billedCredits: 42.5 },
      { supply: "own", provider: "openai", model: "gpt-5", calls: 2, inputTokens: 8000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1000, billedCredits: 0, billedNote: "your own key; the provider bills you" },
    ],
  },
  compute: {
    meters: [
      { meter: "vcpu", quantity: 3.5, unit: "vCPU-hour", rateCreditsPerUnit: 6, credits: 21 },
      { meter: "ram", quantity: 7, unit: "GiB-hour", rateCreditsPerUnit: 2, credits: 14 },
      { meter: "disk", quantity: 20, unit: "GiB-hour", rateCreditsPerUnit: 0.02, credits: 0.4 },
      { meter: "storage", quantity: 12, unit: "GB", rateCreditsPerUnit: 10, credits: 20, includedGb: 10, overGb: 2, basis: "filesystem" },
      { meter: "network", quantity: 1.5, unit: "GB", rateCreditsPerUnit: 20, credits: 30 },
      { meter: "search", quantity: 24, unit: "pod-hour", rateCreditsPerUnit: null, credits: 1.6, sessions: 3, networkGb: 0.2 },
      { meter: "browser", quantity: 2.5, unit: "pod-hour", rateCreditsPerUnit: null, credits: 4.2, sessions: 1, networkGb: 1.25 },
      { meter: "warm", quantity: 0.05, unit: "pod-hour", rateCreditsPerUnit: null, credits: 0.3, sessions: 2, networkGb: 0.4 },
    ],
    planFee: { usd: 29, credits: 2900, label: "Starter plan, monthly fee", includedCredits: 3000 },
    bySize: [{ size: "small", steps: 40, hours: 2.5, vcpu: 1, memGiB: 1, diskGiB: 2, creditsPerHour: 8 }],
  },
  billed: { totalCredits: 88.4, waived: [] },
};

test("usage meters: pots, each meter with quantity, rate and credits, the plan fee, sizes and tokens by model", async () => {
  const s = await serve({ "/api/usage": () => USAGE });
  const r = await at(s.url, "usage", "meters");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen[0].method, "GET");
  assert.match(r.out, /2026-11-01 to 2026-11-07/);
  assert.match(r.out, /plan credits 1,200 +bought credits 500/);
  assert.match(r.out, /vCPU +3\.5 vCPU-hour +at 6 credits per vCPU-hour +21 credits/);
  assert.match(r.out, /storage +12 GB +at 10 credits per GB-month +20 credits \(10 GB included, 2 over\)/);
  assert.match(r.out, /search pods +24 pod-hour +1\.6 credits \(3 sessions, 0\.2 GB moved\)/, "the search pods are their own meter");
  assert.match(r.out, /browser pods +2\.5 pod-hour +4\.2 credits \(1 session, 1\.25 GB moved\)/, "and so is the browser, with its network");
  assert.match(r.out, /warm builds +0\.05 pod-hour +0\.3 credits \(2 sessions, 0\.4 GB moved\)/, "and the warm builds");
  assert.match(r.out, /plan fee +Starter plan, monthly fee +\$29\.00 for 3,000 credits/);
  assert.match(r.out, /small +40 steps +2\.5 h +1 vCPU · 1 GiB · 2 GiB disk +8 credits an hour/);
  assert.match(r.out, /anthropic +claude-sonnet-5-5 +10 calls +5,000 in \/ 800 out +42\.5 credits/);
  assert.match(r.out, /openai +gpt-5 +2 calls +8,000 in \/ 1,000 out +your key · 0 credits/, "your own key is listed at 0 billed");
  assert.match(r.out, /the ledger charged 88\.4 credits/);
});

test("usage meters --since/--until become the API's from and to", async () => {
  const s = await serve({ "/api/usage": () => USAGE });
  const r = await at(s.url, "usage", "meters", "--since", "2026-10-01", "--until", "2026-10-31");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen[0].url, "/api/usage");
  assert.equal(s.seen[0].query.get("from"), "2026-10-01");
  assert.equal(s.seen[0].query.get("to"), "2026-10-31");
});

test("usage meters refuses a day that is not YYYY-MM-DD before any request", async () => {
  const s = await serve({ "/api/usage": () => USAGE });
  const r = await at(s.url, "usage", "meters", "--since", "last week");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--since is a UTC day, YYYY-MM-DD/);
  assert.equal(s.seen.length, 0);
});

test("usage meters --json is the period, credits, tokens, compute and billed", async () => {
  const s = await serve({ "/api/usage": () => ({ ...USAGE, totals: { runs: 1 }, workspaces: [] }) });
  const r = await at(s.url, "usage", "meters", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  const doc = JSON.parse(r.out.slice(r.out.indexOf("{")));
  assert.deepEqual(Object.keys(doc).sort(), ["billed", "compute", "credits", "period", "tokens"]);
});

test("usage meters for a scoped key: no pots, no plan fee, no ledger total — and no error", async () => {
  const s = await serve({ "/api/usage": () => ({ ...USAGE, credits: null, billed: null, compute: { ...USAGE.compute, planFee: null } }) });
  const r = await at(s.url, "usage", "meters");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /plan credits|plan fee|the ledger charged/);
});

test("usage meters with no model calls says so", async () => {
  const s = await serve({ "/api/usage": () => ({ ...USAGE, tokens: { totals: { calls: 0, billedCredits: 0, byokTokens: 0 }, byModel: [] } }) });
  const r = await at(s.url, "usage", "meters");
  s.close();
  assert.match(r.out, /no model calls in this period/);
});

const RATES = { creditUsd: 0.01, vcpuUsdPerHour: 0.06, ramUsdPerGibHour: 0.02, diskUsdPerGibMonth: 0.16, storageUsdPerGbMonth: 0.1, networkUsdPerGb: 0.2, margin: 1.2 };
const CATALOGUE = {
  version: 3, creditUsd: 0.01,
  plans: [{ ...PLAN, id: "free", name: "Free", feeUsd: 0, creditsPerMonth: 300, rollover: false, rolloverCapCredits: 0, storageGb: 2, computeAtOnce: { vcpu: 2, memGiB: 4 } }, PLAN],
  contact: { label: "Contact us" }, meters: [],
  example: { name: "default step", vcpu: 2, memGiB: 2, creditsPerHour: 16 },
  models: { margin: 1.2, providers: ["anthropic"], soon: ["zai"], prices: [{ provider: "anthropic", model: "claude-sonnet-5-5", inputPerMTok: 3.6, outputPerMTok: 18, cacheReadPerMTok: 0.36, cacheWritePerMTok: 4.5 }] },
};

test("usage rates: each meter in dollars and credits, the plan, the plans, the example and the model prices", async () => {
  const s = await serve({ "/api/usage/rates": () => ({ rates: RATES, plan: { ...PLAN, status: "active", resetsAt: null }, catalogue: CATALOGUE }) });
  const r = await at(s.url, "usage", "rates");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /vCPU +\$0\.06 per vCPU-hour +6 credits/);
  assert.match(r.out, /network +\$0\.2 per GB, in and out +20 credits/);
  assert.match(r.out, /your plan +Starter \(active\) · 3,000 credits a month · 10 GB stored · 4 vCPU · 8 GiB at once · unused credits roll over up to 6,000/);
  assert.match(r.out, /● Starter +\$29\/mo +3,000 credits/);
  assert.match(r.out, /○ Free +free +300 credits/);
  assert.doesNotMatch(r.out, /runs at once/);
  assert.match(r.out, /a default step \(2 vCPU, 2 GiB\) costs about 16 credits an hour/);
  assert.match(r.out, /claude-sonnet-5-5 +in \$3\.6 +out \$18 +cache read \$0\.36/);
  assert.match(r.out, /coming: zai/);
});

test("usage rates --json is the API's answer whole; nothing billed is said, not failed", async () => {
  const doc = { rates: RATES, plan: null, catalogue: CATALOGUE };
  let s = await serve({ "/api/usage/rates": () => doc });
  let r = await at(s.url, "usage", "rates", "--json");
  s.close();
  assert.deepEqual(JSON.parse(r.out.slice(r.out.indexOf("{"))), doc);
  s = await serve({ "/api/usage/rates": () => ({ rates: null, plan: null, catalogue: null }) });
  r = await at(s.url, "usage", "rates");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /nothing is billed on this platform/);
});

test("usage rates: a refusal is the platform's sentence and a non-zero exit", async () => {
  const s = await serve({ "/api/usage/rates": () => failing(401, { error: "that key is not valid" }) });
  const r = await at(s.url, "usage", "rates");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /that key is not valid/);
});

test("--help names both verbs", async () => {
  const r = await at("http://127.0.0.1:1", "usage", "--help");
  assert.match(r.out, /foldrun usage meters/);
  assert.match(r.out, /foldrun usage rates/);
});
