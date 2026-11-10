// `foldrun keys create --gateway` and `keys ls` for a gateway key (10 Nov
// 2026): a coding agent's key (Claude Code), against a fake platform.
//
//   node --test tests/cli-gateway.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, cli } from "./fake-platform.ts";

test("keys create --gateway posts { purpose: gateway, capUsd, dailyUsd } and prints the key once, with the Claude Code lines", async () => {
  const s = await serve({
    "POST /api/keys": () => ({ ok: true, key: "mda_gwsecret", id: "g1", prefix: "mda_gwsecre", purpose: "gateway", capUsd: 20, dailyUsd: 5, expiresAt: "2027-02-08T00:00:00Z", gatewayUrl: "https://gateway.example.test" }),
  });
  const r = await at(s.url, "keys", "create", "laptop", "--gateway", "--cap", "20", "--daily", "5");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { label: "laptop", purpose: "gateway", capUsd: 20, dailyUsd: 5, expires: "90d" });
  assert.match(r.out, /✓ laptop\s+g1\s+gateway · Claude Code · \$0\.00 of \$20\.00 · \$0\.00 of \$5\.00 today/);
  assert.equal(r.out.split("mda_gwsecret").length - 1, 1, "the key is printed once");
  assert.match(r.out, /export ANTHROPIC_BASE_URL=https:\/\/gateway\.example\.test/);
  assert.match(r.out, /export ANTHROPIC_API_KEY=<key>/);
  assert.match(r.out, /opens the gateway only/);
});

test("keys create --gateway refuses, before any request, with no limit, a bad limit, or a role", async () => {
  const s = await serve({ "POST /api/keys": () => ({ ok: true }) });
  const none = await at(s.url, "keys", "create", "x", "--gateway");
  const bad = await at(s.url, "keys", "create", "x", "--gateway", "--cap", "-3");
  const role = await at(s.url, "keys", "create", "x", "--gateway", "--cap", "5", "--role", "admin");
  const both = await at(s.url, "keys", "create", "x", "--gateway", "--a2a", "--cap", "5");
  const bare = await at(s.url, "keys", "create", "x", "--gateway", "--daily", "5", "--expires");
  s.close();
  for (const r of [none, bad, role, both, bare]) assert.equal(r.code, 1, r.out);
  assert.match(bare.out, /--expires needs a span/, "a bare --expires is not read as 90 days (Codex review)");
  assert.match(none.out, /needs a limit of its own/);
  assert.match(bad.out, /--cap takes a number of dollars/);
  assert.match(role.out, /not --role/);
  assert.match(both.out, /--a2a or --gateway, not both/);
  assert.equal(s.seen.length, 0);
});

test("keys ls shows a gateway key's limits and what it has spent", async () => {
  const s = await serve({
    "/api/keys": () => ({
      keys: [{ id: "g1", prefix: "mda_gw123456", label: "laptop", role: "viewer", workspaces: null, purpose: "gateway", gateway: { capUsd: 20, dailyUsd: 5, spentUsd: 3.42, todayUsd: 1.27 }, createdAt: "2026-11-10T00:00:00Z", revokedAt: null, expiresAt: null, lastUsedAt: null }],
      gatewayUrl: "https://gateway.example.test",
    }),
  });
  const r = await at(s.url, "keys", "ls");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /gateway · Claude Code · \$3\.42 of \$20\.00 · \$1\.27 of \$5\.00 today/);
  assert.doesNotMatch(r.out, /all workspaces/, "not shown as a workspace key");
});

test("--gateway is a switch: a word after it is not swallowed as its value", async () => {
  const s = await serve({ "POST /api/keys": () => ({ ok: true, key: "mda_x", id: "g2", purpose: "gateway", capUsd: 5, dailyUsd: null, gatewayUrl: null }) });
  const r = await at(s.url, "keys", "create", "--gateway", "laptop", "--cap", "5");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(s.seen[0].body).label, "laptop");
  assert.match(r.out, /not set on this platform yet/, "no gateway URL yet: said so");
});

test("keys create --gateway --login posts credential: login, takes no limit, and keys ls says it is not metered", async () => {
  const s = await serve({
    "POST /api/keys": () => ({ ok: true, key: "mda_login", id: "g3", purpose: "gateway", credential: "login", capUsd: null, dailyUsd: null, gatewayUrl: "https://gateway.example.test" }),
    "/api/keys": () => ({ keys: [{ id: "g3", prefix: "mda_login123", label: "mine", role: "viewer", workspaces: null, purpose: "gateway", gateway: { capUsd: null, dailyUsd: null, credential: "login" }, createdAt: "2026-11-10T00:00:00Z", revokedAt: null, expiresAt: null, lastUsedAt: null }], gatewayUrl: null }),
  });
  const r = await at(s.url, "keys", "create", "mine", "--gateway", "--login");
  const withCap = await at(s.url, "keys", "create", "mine", "--gateway", "--login", "--cap", "5");
  const ls = await at(s.url, "keys", "ls");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { label: "mine", purpose: "gateway", credential: "login", expires: "90d" });
  assert.match(r.out, /the operator's Claude login · not metered/);
  assert.doesNotMatch(r.out, /shows what it has spent/, "a login key has no spend to show");
  assert.match(r.out, /shares that subscription's weekly cap/);
  assert.equal(withCap.code, 1);
  assert.match(withCap.out, /--login takes no --cap or --daily/);
  assert.match(ls.out, /gateway · Claude Code · the operator's Claude login · not metered/);
});

test("keys set changes the tiers named, keeps the rest, and clears with - or --clear", async () => {
  const s = await serve({
    "/api/keys": () => ({ keys: [{ id: "g5", prefix: "mda_g5", label: "laptop", role: "viewer", workspaces: null, purpose: "gateway", gateway: { capUsd: 5, dailyUsd: null, models: { haiku: "deepseek/deepseek-v4" } }, createdAt: "2026-11-10T00:00:00Z", revokedAt: null }], gatewayUrl: null }),
    "PATCH /api/keys/g5": (body: string) => ({ ok: true, id: "g5", models: JSON.parse(body).models }),
  });
  const set = await at(s.url, "keys", "set", "g5", "--sonnet", "openai/gpt-6");
  const drop = await at(s.url, "keys", "set", "g5", "--haiku", "-");
  const clear = await at(s.url, "keys", "set", "g5", "--clear");
  const none = await at(s.url, "keys", "set", "g5");
  s.close();
  assert.equal(set.code, 0, set.out);
  assert.equal(drop.code, 0, drop.out);
  assert.equal(clear.code, 0, clear.out);
  const patches = s.seen.filter((x) => x.method === "PATCH").map((x) => JSON.parse(x.body).models);
  assert.deepEqual(patches[0], { haiku: "deepseek/deepseek-v4", sonnet: "openai/gpt-6" }, "the tier named changes, the rest stay");
  assert.match(set.out, /Sonnet → openai\/gpt-6 · Haiku → deepseek\/deepseek-v4/);
  assert.deepEqual(patches[1], null, "the only tier cleared: no map left");
  assert.deepEqual(patches[2], null);
  assert.equal(none.code, 1);
  assert.match(none.out, /which tier/);
});

test("keys --help names --gateway", async () => {
  const k = await cli(["keys", "--help"]);
  assert.match(k.out, /--gateway/);
});
