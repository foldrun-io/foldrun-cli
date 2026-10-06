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
