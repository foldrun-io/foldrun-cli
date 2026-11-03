// `foldrun account model` — the account's own model key (/api/account/model).
//
//   node --test tests/cli-account-model.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const none = { set: false, provider: null, baseUrl: null, format: null, keyHint: null, runsOn: "none", platformKeyAllowed: false };
const mine = { set: true, provider: "openrouter", baseUrl: "https://openrouter.ai/api", format: "anthropic", keyHint: "…9876", runsOn: "account", platformKeyAllowed: false };

test("with no key, it says runs are refused and exits non-zero", async () => {
  const s = await serve({ "GET /api/account/model": () => none });
  const r = await at(s.url, "account", "model");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no key — runs on this account are refused/);
});

test("set sends the provider and key once, with an idempotency key, and shows only the last four", async () => {
  const s = await serve({ "PUT /api/account/model": () => mine });
  const r = await at(s.url, "account", "model", "set", "openrouter", "--key", "fake-9876");
  s.close();
  assert.equal(r.code, 0, r.out);
  const put = s.seen.find((x) => x.method === "PUT")!;
  assert.equal(put.url.split("?")[0], "/api/account/model");
  assert.deepEqual(JSON.parse(put.body), { provider: "openrouter", apiKey: "fake-9876" });
  assert.ok(put.headers["idempotency-key"], "an Idempotency-Key on the write");
  assert.match(r.out, /your own key — openrouter/);
  assert.doesNotMatch(r.out, /fake-9876/);
});

test("a custom endpoint carries its base URL and format; remove DELETEs", async () => {
  const s = await serve({ "PUT /api/account/model": () => ({ ...mine, provider: "custom" }), "DELETE /api/account/model": () => none });
  await at(s.url, "account", "model", "set", "custom", "--key", "k-1", "--base-url", "https://llm.example.com/v1", "--format", "openai");
  const put = s.seen.find((x) => x.method === "PUT")!;
  assert.deepEqual(JSON.parse(put.body), { provider: "custom", apiKey: "k-1", baseUrl: "https://llm.example.com/v1", format: "openai" });
  const rm = await at(s.url, "account", "model", "remove");
  s.close();
  assert.equal(rm.code, 0, rm.out);
  assert.ok(s.seen.some((x) => x.method === "DELETE" && x.url.split("?")[0] === "/api/account/model"));
});

test("set without a key is refused before anything is sent", async () => {
  const s = await serve({});
  const r = await at(s.url, "account", "model", "set", "anthropic");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--key/);
  assert.equal(s.seen.length, 0);
});

// ---- foldrun's models

const offered = {
  offered: true,
  refused: null,
  providers: [
    { name: "anthropic", title: "Anthropic", available: true, reason: null, tiers: {} },
    { name: "openai", title: "OpenAI", available: true, reason: null, tiers: { fast: "gpt-5-mini", default: "gpt-5" } },
    { name: "gemini", title: "Google Gemini", available: false, reason: "gemini is not available on this platform right now", tiers: {} },
  ],
  prices: [
    { provider: "openai", model: "gpt-5", inputPerMTok: 1.5, outputPerMTok: 12, cacheReadPerMTok: 0.15, cacheWritePerMTok: null },
    { provider: "anthropic", model: "claude-sonnet-4-5", inputPerMTok: 3.6, outputPerMTok: 18, cacheReadPerMTok: 0.36, cacheWritePerMTok: 4.5 },
  ],
  dailyCapUsd: 60,
  spentTodayUsd: 1.25,
};
const onFoldrun = { ...mine, runsOn: "foldrun", source: "foldrun", supply: "openai", choiceVersion: 1, foldrunModels: offered };

test("use foldrun --provider sends the choice once and says what it costs today", async () => {
  const s = await serve({ "PUT /api/account/model": () => onFoldrun });
  const r = await at(s.url, "account", "model", "use", "foldrun", "--provider", "openai");
  s.close();
  assert.equal(r.code, 0, r.out);
  const put = s.seen.find((x) => x.method === "PUT")!;
  assert.deepEqual(JSON.parse(put.body), { source: "foldrun", supply: "openai" });
  assert.ok(put.headers["idempotency-key"]);
  assert.match(r.out, /foldrun's models — OpenAI/);
  assert.match(r.out, /fast → gpt-5-mini/);
  assert.match(r.out, /spent today \$1\.25 of a \$60\.00 daily cap/);
  assert.match(r.out, /your own key openrouter …9876 is kept/);
});

test("use foldrun without a provider is refused before anything is sent; use own goes back", async () => {
  const s = await serve({ "PUT /api/account/model": () => ({ ...mine, source: "own", supply: null, choiceVersion: 2, foldrunModels: offered }) });
  const bad = await at(s.url, "account", "model", "use", "foldrun");
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /which provider/);
  assert.equal(s.seen.length, 0);
  const own = await at(s.url, "account", "model", "use", "own");
  s.close();
  assert.equal(own.code, 0, own.out);
  assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "PUT")!.body), { source: "own" });
  assert.match(own.out, /your own key — openrouter/);
});

test("refused for the account: shown with why, and a non-zero exit", async () => {
  const s = await serve({ "GET /api/account/model": () => ({ ...onFoldrun, foldrunModels: { ...offered, refused: "foldrun's models are not available to this account — contact support" } }) });
  const r = await at(s.url, "account", "model");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /refused: foldrun's models are not available to this account/);
  assert.match(r.out, /use own/);
});

test("prices lists each provider's models as the account pays; --provider narrows", async () => {
  const s = await serve({ "GET /api/account/model": () => ({ ...mine, source: "own", supply: null, choiceVersion: 0, foldrunModels: offered }) });
  const all = await at(s.url, "account", "model", "prices");
  assert.equal(all.code, 0, all.out);
  assert.match(all.out, /gpt-5 +\$1\.50 +\$12\.00 +\$0\.15 +—/);
  assert.match(all.out, /claude-sonnet-4-5/);
  assert.match(all.out, /Google Gemini.*not available/);
  const one = await at(s.url, "account", "model", "prices", "--provider", "openai");
  s.close();
  assert.doesNotMatch(one.out, /claude-sonnet/);
});

test("on your own key where foldrun's models are offered, the hint says how to choose them", async () => {
  const s = await serve({ "GET /api/account/model": () => ({ ...mine, source: "own", supply: null, choiceVersion: 0, foldrunModels: offered }) });
  const r = await at(s.url, "account", "model");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /use foldrun --provider <p>/);
});
