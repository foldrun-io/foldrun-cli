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

test("keys --help names --gateway", async () => {
  const k = await cli(["keys", "--help"]);
  assert.match(k.out, /--gateway/);
});
