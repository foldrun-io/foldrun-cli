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

// `--claude-code` (11 Nov 2026): the key goes straight into Claude Code's
// user settings, so nothing is copied by hand. CLAUDE_CONFIG_DIR points the
// CLI at a temporary folder here.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const gw = () => ({ "POST /api/keys": () => ({ ok: true, key: "fr_gw_cc_secret", id: "g9", purpose: "gateway", capUsd: 20, dailyUsd: null, gatewayUrl: "https://gateway.example.test" }) });
const inDir = (url: string, dir: string, ...args: string[]) => cli([...args, "--url", url, "--token", "k"], { env: { CLAUDE_CONFIG_DIR: dir } });

test("keys create --gateway --claude-code writes the URL and key into a new Claude Code settings file, readable only by you", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-"));
  const s = await serve(gw());
  const r = await inDir(s.url, dir, "keys", "create", "laptop", "--gateway", "--cap", "20", "--claude-code");
  s.close();
  assert.equal(r.code, 0, r.out);
  const file = path.join(dir, "settings.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { env: { ANTHROPIC_BASE_URL: "https://gateway.example.test", ANTHROPIC_AUTH_TOKEN: "fr_gw_cc_secret" } });
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.match(r.out, /Claude Code now runs on it/);
  assert.doesNotMatch(r.out, /export ANTHROPIC_API_KEY/, "no lines to copy when the file was written");
  assert.equal(fs.existsSync(`${file}.before-foldrun`), false, "no backup of a file that was not there");
});

test("--claude-code keeps every other setting, drops a competing ANTHROPIC_API_KEY, and keeps the old file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-"));
  const file = path.join(dir, "settings.json");
  const before = JSON.stringify({ model: "opus", permissions: { allow: ["Bash(ls)"] }, env: { FOO: "1", ANTHROPIC_API_KEY: "sk-old", ANTHROPIC_BASE_URL: "https://old.example" } }, null, 2);
  fs.writeFileSync(file, before);
  const s = await serve(gw());
  const r = await inDir(s.url, dir, "keys", "create", "laptop", "--gateway", "--cap", "20", "--claude-code");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
    model: "opus",
    permissions: { allow: ["Bash(ls)"] },
    env: { FOO: "1", ANTHROPIC_BASE_URL: "https://gateway.example.test", ANTHROPIC_AUTH_TOKEN: "fr_gw_cc_secret" },
  });
  assert.equal(fs.readFileSync(`${file}.before-foldrun`, "utf8"), before);
  assert.match(r.out, /removed from that env block: ANTHROPIC_API_KEY/);
});

test("--claude-code refuses a settings file it cannot safely rewrite, before any key is made", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-"));
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, "{ not json");
  const s = await serve(gw());
  const broken = await inDir(s.url, dir, "keys", "create", "laptop", "--gateway", "--cap", "20", "--claude-code");
  fs.writeFileSync(file, JSON.stringify({ env: ["x"] }));
  const badEnv = await inDir(s.url, dir, "keys", "create", "laptop", "--gateway", "--cap", "20", "--claude-code");
  const noGateway = await inDir(s.url, dir, "keys", "create", "laptop", "--claude-code");
  const a2a = await inDir(s.url, dir, "keys", "create", "bot", "--a2a", "--to", "ws", "--flows", "f", "--claude-code");
  s.close();
  for (const r of [broken, badEnv, noGateway, a2a]) assert.equal(r.code, 1, r.out);
  assert.match(a2a.out, /--claude-code goes with --gateway/, "an A2A key is not made with it (Codex review)");
  assert.match(broken.out, /not valid JSON.*no key was made/);
  assert.match(badEnv.out, /"env" that is not an object/);
  assert.match(noGateway.out, /--claude-code goes with --gateway/);
  assert.equal(s.seen.length, 0, "nothing was minted");
  assert.equal(fs.readFileSync(file, "utf8"), JSON.stringify({ env: ["x"] }), "the file is untouched");
});

test("--claude-code on a platform with no gateway URL writes nothing and says so", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-"));
  const s = await serve({ "POST /api/keys": () => ({ ok: true, key: "fr_gw_x", id: "g8", purpose: "gateway", capUsd: 5, dailyUsd: null, gatewayUrl: null }) });
  const r = await inDir(s.url, dir, "keys", "create", "laptop", "--gateway", "--cap", "5", "--claude-code");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.existsSync(path.join(dir, "settings.json")), false);
  assert.match(r.out, /no gateway URL yet, so Claude Code's settings were not written/);
});

test("--claude-code refuses a settings folder it cannot write, before any key is made (Codex review)", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-"));
  fs.writeFileSync(path.join(dir, "settings.json"), "{}");
  fs.chmodSync(dir, 0o500);
  const s = await serve(gw());
  const r = await inDir(s.url, dir, "keys", "create", "laptop", "--gateway", "--cap", "20", "--claude-code");
  s.close();
  fs.chmodSync(dir, 0o700);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no key was made/);
  assert.equal(s.seen.length, 0, "nothing was minted");
});

test("--claude-code writes from the file as it is after the key is made, so a change made meanwhile is kept (Codex review)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-"));
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, JSON.stringify({ model: "opus" }));
  const s = await serve({ "POST /api/keys": () => {
    fs.writeFileSync(file, JSON.stringify({ model: "sonnet", theme: "dark" }));
    return { ok: true, key: "fr_gw_cc_secret", id: "g9", purpose: "gateway", capUsd: 20, dailyUsd: null, gatewayUrl: "https://gateway.example.test" };
  } });
  const r = await inDir(s.url, dir, "keys", "create", "laptop", "--gateway", "--cap", "20", "--claude-code");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { model: "sonnet", theme: "dark", env: { ANTHROPIC_BASE_URL: "https://gateway.example.test", ANTHROPIC_AUTH_TOKEN: "fr_gw_cc_secret" } });
});

test("--claude-code: a file broken after the key is made is left alone, and the lines to copy are printed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-"));
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, "{}");
  const s = await serve({ "POST /api/keys": () => {
    fs.writeFileSync(file, "{ broken");
    return { ok: true, key: "fr_gw_cc_secret", id: "g9", purpose: "gateway", capUsd: 20, dailyUsd: null, gatewayUrl: "https://gateway.example.test" };
  } });
  const r = await inDir(s.url, dir, "keys", "create", "laptop", "--gateway", "--cap", "20", "--claude-code");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /The key was made, but Claude Code's settings were not written/);
  assert.match(r.out, /export ANTHROPIC_BASE_URL=https:\/\/gateway\.example\.test/);
  assert.equal(fs.readFileSync(file, "utf8"), "{ broken");
});
