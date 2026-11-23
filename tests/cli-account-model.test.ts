// `foldrun account model` — the account's own model key (/v1/account/model).
//
//   node --test tests/cli-account-model.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, cli } from "./fake-platform.ts";

const none = { set: false, provider: null, baseUrl: null, format: null, keyHint: null, runsOn: "none", platformKeyAllowed: false };
const mine = { set: true, provider: "openrouter", baseUrl: "https://openrouter.ai/api", format: "anthropic", keyHint: "…9876", runsOn: "account", platformKeyAllowed: false };

test("with no key, it says runs are refused and exits non-zero", async () => {
  const s = await serve({ "GET /v1/account/model": () => none });
  const r = await at(s.url, "account", "model");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no key — runs on this account are refused/);
});

test("set sends the provider and key once, with an idempotency key, and shows only the last four", async () => {
  const s = await serve({ "PUT /v1/account/model": () => mine });
  const r = await at(s.url, "account", "model", "set", "openrouter", "--key", "fake-9876");
  s.close();
  assert.equal(r.code, 0, r.out);
  const put = s.seen.find((x) => x.method === "PUT")!;
  assert.equal(put.url.split("?")[0], "/v1/account/model");
  assert.deepEqual(JSON.parse(put.body), { provider: "openrouter", apiKey: "fake-9876" });
  assert.ok(put.headers["idempotency-key"], "an Idempotency-Key on the write");
  assert.match(r.out, /your own key — openrouter/);
  assert.doesNotMatch(r.out, /fake-9876/);
});

test("a custom endpoint carries its base URL and format; remove DELETEs", async () => {
  const s = await serve({ "PUT /v1/account/model": () => ({ ...mine, provider: "custom" }), "DELETE /v1/account/model": () => none });
  await at(s.url, "account", "model", "set", "custom", "--key", "k-1", "--base-url", "https://llm.example.com/v1", "--format", "openai");
  const put = s.seen.find((x) => x.method === "PUT")!;
  assert.deepEqual(JSON.parse(put.body), { provider: "custom", apiKey: "k-1", baseUrl: "https://llm.example.com/v1", format: "openai" });
  const rm = await at(s.url, "account", "model", "remove");
  s.close();
  assert.equal(rm.code, 0, rm.out);
  assert.ok(s.seen.some((x) => x.method === "DELETE" && x.url.split("?")[0] === "/v1/account/model"));
});

test("set without a key is refused before anything is sent", async () => {
  const s = await serve({});
  const r = await at(s.url, "account", "model", "set", "anthropic");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--key/);
  assert.equal(s.seen.length, 0);
});

test("--key - reads a piped key (no prompt, no echo); a terminal is asked for it hidden instead of EAGAIN", async () => {
  const s = await serve({ "PUT /v1/account/model": () => mine });
  const r = await cli(["account", "model", "set", "openrouter", "--key", "-", "--url", s.url, "--token", "k"], { input: "piped-9876\n" });
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "PUT")!.body), { provider: "openrouter", apiKey: "piped-9876" });
  assert.doesNotMatch(r.out, /piped-9876|EAGAIN/);
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
  const s = await serve({ "PUT /v1/account/model": () => onFoldrun });
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
  const s = await serve({ "PUT /v1/account/model": () => ({ ...mine, source: "own", supply: null, choiceVersion: 2, foldrunModels: offered }) });
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
  const s = await serve({ "GET /v1/account/model": () => ({ ...onFoldrun, foldrunModels: { ...offered, refused: "foldrun's models are not available to this account — contact support" } }) });
  const r = await at(s.url, "account", "model");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /refused: foldrun's models are not available to this account/);
  assert.match(r.out, /use own/);
});

test("prices lists each provider's models as the account pays; --provider narrows", async () => {
  const s = await serve({ "GET /v1/account/model": () => ({ ...mine, source: "own", supply: null, choiceVersion: 0, foldrunModels: offered }) });
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
  const s = await serve({ "GET /v1/account/model": () => ({ ...mine, source: "own", supply: null, choiceVersion: 0, foldrunModels: offered }) });
  const r = await at(s.url, "account", "model");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /use foldrun --provider <p>/);
});

test("on a Claude Code plan (16 Nov 2026): the account runs on its Claude subscription, said so, exit 0", async () => {
  const s = await serve({ "GET /v1/account/model": () => ({ ...none, runsOn: "subscription" }) });
  const r = await at(s.url, "account", "model");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Claude subscription/);
  assert.match(r.out, /monthly and weekly limits/);
  assert.doesNotMatch(r.out, /refused|billed in credits/);
});

test("own keys off on the platform (models.byok): the view says so, offers no own key, and a set is refused by the platform with its reason", async () => {
  const s = await serve({
    "GET /v1/account/model": () => ({ set: true, provider: "anthropic", keyHint: "…1111", baseUrl: null, format: null, runsOn: "foldrun", platformKeyAllowed: false, source: "foldrun", supply: "anthropic", choiceVersion: 0, ownKeys: false, foldrunModels: { offered: true, refused: null, providers: [{ name: "anthropic", title: "Anthropic", available: true, reason: null, tiers: { default: "claude-sonnet-5-5" } }], prices: [], dailyCapUsd: null, spentTodayUsd: 0 } }),
    "PUT /v1/account/model": () => ({ __status: 403, body: { error: "own model keys are off on this platform: every model call goes through foldrun's models — a platform admin can turn own keys on (setting models.byok)" } }),
  });
  try {
    const view = await at(s.url, "account", "model");
    assert.match(view.out, /own model keys are off on this platform/);
    assert.match(view.out, /not used — `foldrun account model remove` deletes it/);
    assert.doesNotMatch(view.out, /use own|set <provider> --key/);
    const set = await at(s.url, "account", "model", "set", "anthropic", "--key", "sk-ant-api03-x");
    assert.notEqual(set.code, 0);
    assert.match(set.out, /own model keys are off on this platform/);
  } finally {
    s.close();
  }
});
