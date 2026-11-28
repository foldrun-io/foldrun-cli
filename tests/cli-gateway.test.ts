// `foldrun keys create --gateway` and `keys ls` for a gateway key (10 Nov
// 2026): a coding agent's key (Claude Code), against a fake platform.
//
//   node --test tests/cli-gateway.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, cli } from "./fake-platform.ts";

test("keys create --gateway posts { purpose: gateway, capUsd, dailyUsd } and prints the key once, with the Claude Code lines", async () => {
  const s = await serve({
    "POST /v1/keys": () => ({ ok: true, key: "mda_gwsecret", id: "g1", prefix: "mda_gwsecre", purpose: "gateway", capUsd: 20, dailyUsd: 5, expiresAt: "2027-02-08T00:00:00Z", gatewayUrl: "https://gateway.example.test" }),
  });
  const r = await at(s.url, "keys", "create", "laptop", "--gateway", "--cap", "20", "--daily", "5");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { label: "laptop", purpose: "gateway", capUsd: 20, dailyUsd: 5, expires: "90d" });
  assert.match(r.out, /✓ laptop\s+g1\s+gateway · Claude Code · \$0\.00 of \$20\.00 · \$0\.00 of \$5\.00 today/);
  assert.equal(r.out.split("mda_gwsecret").length - 1, 1, "the key is printed once");
  assert.match(r.out, /export ANTHROPIC_BASE_URL=https:\/\/gateway\.example\.test/);
  assert.match(r.out, /export ANTHROPIC_AUTH_TOKEN=<key>/, "the auth token: an API key makes Claude Code ask, with No preselected");
  assert.doesNotMatch(r.out, /ANTHROPIC_API_KEY/);
  assert.match(r.out, /"statusLine": \{ "type": "command", "command": "foldrun gateway status-line" \}/);
  assert.match(r.out, /opens the gateway only/);
});

test("keys create --gateway refuses, before any request, a bad limit or a role; no limit is the plan's key", async () => {
  const s = await serve({ "POST /v1/keys": () => ({ ok: true }) });
  const bad = await at(s.url, "keys", "create", "x", "--gateway", "--cap", "-3");
  const role = await at(s.url, "keys", "create", "x", "--gateway", "--cap", "5", "--role", "admin");
  const both = await at(s.url, "keys", "create", "x", "--gateway", "--a2a", "--cap", "5");
  const bare = await at(s.url, "keys", "create", "x", "--gateway", "--daily", "5", "--expires");
  s.close();
  for (const r of [bad, role, both, bare]) assert.equal(r.code, 1, r.out);
  assert.match(bare.out, /--expires needs a span/, "a bare --expires is not read as 90 days (Codex review)");
  assert.match(bad.out, /--cap takes a number of dollars/);
  assert.equal(s.seen.length, 0, "refused before any request");
  // No limit (28 Nov 2026): a plan-first key, no amounts sent — the platform's billing decides.
  const p = await serve({ "POST /v1/keys": () => ({ ok: true, key: "fr_gw_plan", id: "g1", purpose: "gateway", credential: "account", walletUsd: null, capUsd: null, dailyUsd: null, gatewayUrl: "https://gw.example.test" }) });
  const plain = await at(p.url, "keys", "create", "x", "--gateway");
  p.close();
  assert.equal(plain.code, 0, plain.out);
  assert.deepEqual(JSON.parse(p.seen[0].body), { label: "x", purpose: "gateway", credential: "account", expires: "90d" });
  assert.match(plain.out, /your plan, then your account's terms/);
  assert.match(role.out, /not --role/);
  assert.match(both.out, /--a2a or --gateway, not both/);
  assert.equal(s.seen.length, 0);
});

test("keys ls shows a gateway key's limits and what it has spent", async () => {
  const s = await serve({
    "/v1/keys": () => ({
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
  const s = await serve({ "POST /v1/keys": () => ({ ok: true, key: "mda_x", id: "g2", purpose: "gateway", capUsd: 5, dailyUsd: null, gatewayUrl: null }) });
  const r = await at(s.url, "keys", "create", "--gateway", "laptop", "--cap", "5");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(s.seen[0].body).label, "laptop");
  assert.match(r.out, /not set on this platform yet/, "no gateway URL yet: said so");
});

test("keys create --gateway --login posts credential: login, takes no limit, and keys ls says it is not metered", async () => {
  const s = await serve({
    "POST /v1/keys": () => ({ ok: true, key: "mda_login", id: "g3", purpose: "gateway", credential: "login", capUsd: null, dailyUsd: null, gatewayUrl: "https://gateway.example.test" }),
    "/v1/keys": () => ({ keys: [{ id: "g3", prefix: "mda_login123", label: "mine", role: "viewer", workspaces: null, purpose: "gateway", gateway: { capUsd: null, dailyUsd: null, credential: "login" }, createdAt: "2026-11-10T00:00:00Z", revokedAt: null, expiresAt: null, lastUsedAt: null }], gatewayUrl: null }),
  });
  const r = await at(s.url, "keys", "create", "mine", "--gateway", "--login");
  const withCap = await at(s.url, "keys", "create", "mine", "--gateway", "--login", "--cap", "5");
  const ls = await at(s.url, "keys", "ls");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { label: "mine", purpose: "gateway", credential: "login", expires: "90d" });
  assert.match(r.out, /pro plan · not billed per call/);
  assert.doesNotMatch(r.out, /shows what it has spent/, "a login key has no spend to show");
  assert.match(r.out, /the plan's usage limits apply/);
  assert.equal(withCap.code, 1);
  assert.match(withCap.out, /--login takes no --cap or --daily/);
  assert.match(ls.out, /gateway · Claude Code · pro plan · not billed per call/);
});

test("keys create --gateway --login --plan max posts the plan; --plan is pro or max and goes with --login", async () => {
  const s = await serve({
    "POST /v1/keys": () => ({ ok: true, key: "mda_max", id: "g4", purpose: "gateway", credential: "login", plan: "max", capUsd: null, dailyUsd: null, gatewayUrl: "https://gateway.example.test" }),
  });
  const r = await at(s.url, "keys", "create", "big", "--gateway", "--login", "--plan", "max");
  const odd = await at(s.url, "keys", "create", "big", "--gateway", "--login", "--plan", "ultra");
  const noLogin = await at(s.url, "keys", "create", "big", "--gateway", "--cap", "5", "--plan", "max");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { label: "big", purpose: "gateway", credential: "login", plan: "max", expires: "90d" });
  assert.match(r.out, /max plan · not billed per call/);
  assert.equal(odd.code, 1);
  assert.match(odd.out, /--plan is pro or max/);
  assert.equal(noLogin.code, 1);
  assert.match(noLogin.out, /--plan goes with --login/);
  assert.equal(s.seen.length, 1, "nothing else was sent");
});

test("keys set changes the tiers named, keeps the rest, and clears with - or --clear", async () => {
  const s = await serve({
    "/v1/keys": () => ({ keys: [{ id: "g5", prefix: "mda_g5", label: "laptop", role: "viewer", workspaces: null, purpose: "gateway", gateway: { capUsd: 5, dailyUsd: null, models: { haiku: "deepseek/deepseek-v4" } }, createdAt: "2026-11-10T00:00:00Z", revokedAt: null }], gatewayUrl: null }),
    "PATCH /v1/keys/g5": (body: string) => ({ ok: true, id: "g5", models: JSON.parse(body).models }),
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

const gw = () => ({ "POST /v1/keys": () => ({ ok: true, key: "fr_gw_cc_secret", id: "g9", purpose: "gateway", capUsd: 20, dailyUsd: null, gatewayUrl: "https://gateway.example.test" }) });
const inDir = (url: string, dir: string, ...args: string[]) => cli([...args, "--url", url, "--token", "k"], { env: { CLAUDE_CONFIG_DIR: dir } });

test("keys create --gateway --claude-code writes the URL and key into a new Claude Code settings file, readable only by you", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-"));
  const s = await serve(gw());
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cc-home-"));
  const r = await cli(["keys", "create", "laptop", "--gateway", "--cap", "20", "--claude-code", "--url", s.url, "--token", "k"], { env: { CLAUDE_CONFIG_DIR: dir, FOLDRUN_HOME: home } });
  s.close();
  assert.equal(r.code, 0, r.out);
  const file = path.join(dir, "settings.json");
  // FOL-402: what was written is recorded, so a later move of the address knows it is ours — never the key itself.
  const record = JSON.parse(fs.readFileSync(path.join(home, "claude-code.json"), "utf8"));
  assert.equal(record.settings, path.resolve(file));
  assert.equal(record.baseUrl, "https://gateway.example.test");
  assert.doesNotMatch(JSON.stringify(record), /fr_gw_cc_secret/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { env: { ANTHROPIC_BASE_URL: "https://gateway.example.test", ANTHROPIC_AUTH_TOKEN: "fr_gw_cc_secret" }, statusLine: { type: "command", command: "foldrun gateway status-line", refreshInterval: 60 } });
  assert.match(r.out, /statusLine: foldrun gateway status-line/);
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
    statusLine: { type: "command", command: "foldrun gateway status-line", refreshInterval: 60 },
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
  const s = await serve({ "POST /v1/keys": () => ({ ok: true, key: "fr_gw_x", id: "g8", purpose: "gateway", capUsd: 5, dailyUsd: null, gatewayUrl: null }) });
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
  const s = await serve({ "POST /v1/keys": () => {
    fs.writeFileSync(file, JSON.stringify({ model: "sonnet", theme: "dark" }));
    return { ok: true, key: "fr_gw_cc_secret", id: "g9", purpose: "gateway", capUsd: 20, dailyUsd: null, gatewayUrl: "https://gateway.example.test" };
  } });
  const r = await inDir(s.url, dir, "keys", "create", "laptop", "--gateway", "--cap", "20", "--claude-code");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { model: "sonnet", theme: "dark", env: { ANTHROPIC_BASE_URL: "https://gateway.example.test", ANTHROPIC_AUTH_TOKEN: "fr_gw_cc_secret" }, statusLine: { type: "command", command: "foldrun gateway status-line", refreshInterval: 60 } });
});

test("--claude-code: a file broken after the key is made is left alone, and the lines to copy are printed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-"));
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, "{}");
  const s = await serve({ "POST /v1/keys": () => {
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

test("--claude-code keeps a status line of the person's own and says how to add the spend", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-"));
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, JSON.stringify({ statusLine: { type: "command", command: "~/bin/my-line" } }));
  const s = await serve(gw());
  const r = await inDir(s.url, dir, "keys", "create", "laptop", "--gateway", "--cap", "20", "--claude-code");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).statusLine, { type: "command", command: "~/bin/my-line" });
  assert.match(r.out, /your own statusLine was kept/);
});

// `foldrun gateway status-line` (11 Nov 2026): Claude Code's status line,
// from the gateway's GET /v1/usage, with the key in the env Claude Code gives.
import http from "node:http";

function fakeGateway(reply: (req: http.IncomingMessage) => [number, string]) {
  const seen: http.IncomingMessage[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req);
    const [status, body] = reply(req);
    res.writeHead(status, { "content-type": "text/plain" });
    res.end(body);
  });
  return new Promise<{ url: string; seen: http.IncomingMessage[]; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, seen, close: () => server.close() })),
  );
}
const line = (env: Record<string, string>, ...args: string[]) => cli(["gateway", "status-line", ...args], { env: { ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_BASE_URL: "", ...env }, input: '{"session_id":"s1"}' });

test("gateway status-line prints the gateway's line, asked with the key as a Bearer, and keeps it a few seconds", async () => {
  const g = await fakeGateway(() => [200, "foldrun · $3.12 of $20.00 · today $1.10 of $5.00\n"]);
  const key = `fr_gw_${Date.now()}`;
  const first = await line({ ANTHROPIC_BASE_URL: `${g.url}/`, ANTHROPIC_AUTH_TOKEN: key });
  const again = await line({ ANTHROPIC_BASE_URL: g.url, ANTHROPIC_AUTH_TOKEN: key });
  g.close();
  assert.equal(first.code, 0, first.out);
  assert.equal(first.out.trim(), "foldrun · $3.12 of $20.00 · today $1.10 of $5.00");
  assert.equal(again.out.trim(), first.out.trim());
  assert.equal(g.seen.length, 1, "the second draw was answered from the cache");
  assert.equal(g.seen[0].url, "/v1/usage?format=line");
  assert.equal(g.seen[0].headers.authorization, `Bearer ${key}`);
});

test("gateway status-line: an API key works too; with --cache 0 it asks every time", async () => {
  const g = await fakeGateway(() => [200, "foldrun · included in your plan\n"]);
  const key = `fr_gw_api_${Date.now()}`;
  await line({ ANTHROPIC_BASE_URL: g.url, ANTHROPIC_API_KEY: key }, "--cache", "0");
  const r = await line({ ANTHROPIC_BASE_URL: g.url, ANTHROPIC_API_KEY: key }, "--cache", "0");
  g.close();
  assert.equal(r.out.trim(), "foldrun · included in your plan");
  assert.equal(g.seen.length, 2);
});

test("gateway status-line always prints one line and exits 0: no gateway, no key, not foldrun, unreachable", async () => {
  const notOurs = await fakeGateway(() => [404, '{"type":"error","error":{"type":"not_found_error"}}']);
  const proxy = await fakeGateway(() => [502, "<html>Bad gateway\u001b[31m</html>"]);
  const t = Date.now();
  const none = await line({});
  const noKey = await line({ ANTHROPIC_BASE_URL: notOurs.url });
  const other = await line({ ANTHROPIC_BASE_URL: notOurs.url, ANTHROPIC_AUTH_TOKEN: `k1${t}` });
  const bad = await line({ ANTHROPIC_BASE_URL: proxy.url, ANTHROPIC_AUTH_TOKEN: `k2${t}` });
  notOurs.close();
  proxy.close();
  const gone = await line({ ANTHROPIC_BASE_URL: "http://127.0.0.1:9", ANTHROPIC_AUTH_TOKEN: `k3${t}` });
  for (const r of [none, noKey, other, bad, gone]) {
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out.trim().split("\n").length, 1, r.out);
  }
  assert.match(none.out, /no gateway set/);
  assert.match(noKey.out, /no key set/);
  assert.match(other.out, /not a foldrun gateway/);
  assert.equal(bad.out.trim(), "foldrun · usage not available (502)", "a proxy's page is not printed");
  assert.match(gone.out, /gateway not reachable/);
});

test("gateway with no subcommand says what it does", async () => {
  const r = await cli(["gateway"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /gateway status-line/);
});

test("keys create --gateway --account posts credential account with its wallet budget (none sent when not given: the account's terms) and says plan first", async () => {
  const s = await serve({
    "POST /v1/keys": (body: string) => {
      const b = JSON.parse(body);
      return { ok: true, key: "fr_gw_acct", id: "a1", purpose: "gateway", credential: "account", walletUsd: b.walletUsd, capUsd: null, dailyUsd: 50, gatewayUrl: "https://gateway.example.test" };
    },
  });
  const withWallet = await at(s.url, "keys", "create", "laptop", "--gateway", "--account", "--daily", "50", "--wallet", "15");
  const planOnly = await at(s.url, "keys", "create", "desk", "--gateway", "--account", "--daily", "50");
  s.close();
  assert.equal(withWallet.code, 0, withWallet.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { label: "laptop", purpose: "gateway", credential: "account", walletUsd: 15, dailyUsd: 50, expires: "90d" });
  assert.match(withWallet.out, /plan first · credits \$0\.00 of \$15\.00/);
  assert.equal(JSON.parse(s.seen[1].body).walletUsd, undefined, "no --wallet: no amount sent — the platform's billing decides (28 Nov 2026)");
  assert.match(planOnly.out, /your plan, then your account's terms/);
});

test("--wallet goes with --account; --account and --login are refused together; a bad --wallet is refused — all before any request", async () => {
  const s = await serve({ "POST /v1/keys": () => ({ ok: true }) });
  const lone = await at(s.url, "keys", "create", "x", "--gateway", "--daily", "5", "--wallet", "3");
  const both = await at(s.url, "keys", "create", "x", "--gateway", "--account", "--login");
  const bad = await at(s.url, "keys", "create", "x", "--gateway", "--account", "--daily", "5", "--wallet", "-1");
  s.close();
  for (const r of [lone, both, bad]) assert.equal(r.code, 1, r.out);
  assert.match(lone.out, /--wallet goes with --account/);
  assert.match(both.out, /--account or --login, not both/);
  assert.match(bad.out, /--wallet is a number of dollars from 0/);
  assert.equal(s.seen.length, 0);
});

test("keys set <id> --wallet <usd> sends walletUsd alone; keys ls shows an account key's credits against its budget", async () => {
  const s = await serve({
    "PATCH /v1/keys/a1": (body: string) => ({ ok: true, id: "a1", walletUsd: JSON.parse(body).walletUsd }),
    "/v1/keys": () => ({
      keys: [{ id: "a1", prefix: "fr_gw_acct", label: "laptop", role: "viewer", workspaces: null, purpose: "gateway", gateway: { capUsd: null, dailyUsd: 50, spentUsd: 9, todayUsd: 2, credential: "account", walletUsd: 20, walletSpentUsd: 4.5 }, createdAt: "2026-11-20T00:00:00Z", revokedAt: null, expiresAt: null, lastUsedAt: null }],
      gatewayUrl: "https://gateway.example.test",
    }),
  });
  const set = await at(s.url, "keys", "set", "a1", "--wallet", "30");
  const ls = await at(s.url, "keys", "ls");
  s.close();
  assert.equal(set.code, 0, set.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { walletUsd: 30 });
  assert.match(set.out, /bought credits may pay up to \$30\.00/);
  assert.match(ls.out, /plan first · credits \$4\.50 of \$20\.00/);
});

test("--account or --wallet without --gateway, and keys set --wallet with another change, are refused before any request", async () => {
  const s = await serve({ "POST /v1/keys": () => ({ ok: true }), "PATCH /v1/keys/a1": () => ({ ok: true }) });
  const noGw = await at(s.url, "keys", "create", "x", "--account");
  const walletOnly = await at(s.url, "keys", "create", "x", "--wallet", "3");
  const both = await at(s.url, "keys", "set", "a1", "--customer", "required", "--wallet", "0");
  s.close();
  for (const r of [noGw, walletOnly, both]) assert.equal(r.code, 1, r.out);
  assert.match(noGw.out, /add --gateway/);
  assert.match(both.out, /set the wallet budget on its own/);
  assert.equal(s.seen.length, 0);
});

test("keys create --gateway --account on a platform that ignores the kind: the key it made is revoked and never shown", async () => {
  const s = await serve({
    "POST /v1/keys": () => ({ ok: true, key: "fr_gw_plain", id: "p1", purpose: "gateway", capUsd: null, dailyUsd: 50, gatewayUrl: "https://gateway.example.test" }),
    "DELETE /v1/keys": () => ({ ok: true }),
  });
  const r = await at(s.url, "keys", "create", "x", "--gateway", "--account", "--daily", "50", "--wallet", "5");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.doesNotMatch(r.out, /fr_gw_plain/, "the key is never printed");
  assert.match(r.out, /does not make plan-first keys at those limits/);
  const del = s.seen.find((x) => x.method === "DELETE");
  assert.deepEqual(JSON.parse(del!.body), { id: "p1" });
});

test("keys set --wallet succeeds only when the platform confirms the budget (an explicit 0 included)", async () => {
  const s = await serve({
    "PATCH /v1/keys/a1": () => ({ ok: true, id: "a1" }),
    "PATCH /v1/keys/a2": () => ({ ok: true, id: "a2", walletUsd: 0 }),
  });
  const ignored = await at(s.url, "keys", "set", "a1", "--wallet", "0");
  const zero = await at(s.url, "keys", "set", "a2", "--wallet", "0");
  s.close();
  assert.equal(ignored.code, 1, ignored.out);
  assert.match(ignored.out, /did not confirm the wallet budget/);
  assert.equal(zero.code, 0, zero.out);
  assert.match(zero.out, /the plan alone pays/);
});

// One key (22 Nov 2026): an API key that may also call foldrun's models.
test("keys create --model-access posts modelAccess on an API key, prints its limits, and revokes a key a platform made without it", async () => {
  const s = await serve({
    "POST /v1/keys": () => ({ ok: true, key: "fr_api_onekey", id: "a1", prefix: "fr_api_onek", role: "editor", workspaces: null, expiresAt: null, modelAccess: { capUsd: null, dailyUsd: 50, walletUsd: 5 }, gatewayUrl: "https://api.example.test" }),
  });
  const r = await at(s.url, "keys", "create", "ci", "--model-access", "--daily", "50", "--wallet", "5");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { label: "ci", expires: "90d", modelAccess: { dailyUsd: 50, walletUsd: 5 } });
  assert.match(r.out, /models: plan first, then up to \$5\.00 of credits · \$50\.00 a day/);
  assert.equal(r.out.split("fr_api_onekey").length - 1, 1, "the key is printed once");

  const old = await serve({ "POST /v1/keys": () => ({ ok: true, key: "fr_api_plain", id: "a2", prefix: "fr_api_plai", role: "editor", workspaces: null }), "DELETE /v1/keys": () => ({ ok: true }) });
  const refused = await at(old.url, "keys", "create", "ci", "--model-access", "--daily", "5");
  old.close();
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /without model access — it was revoked/);
  assert.doesNotMatch(refused.out, /fr_api_plain/, "the key it made instead is never shown");
  assert.deepEqual(JSON.parse(old.seen[1].body), { id: "a2" });

  const z = await serve({ "POST /v1/keys": () => ({ ok: true }) });
  const stray = await at(z.url, "keys", "create", "x", "--daily", "5");
  const mixed = await at(z.url, "keys", "create", "x", "--model-access", "--gateway", "--daily", "5");
  z.close();
  for (const x of [stray, mixed]) assert.equal(x.code, 1, x.out);
  assert.match(stray.out, /add --model-access/);
  assert.match(mixed.out, /goes on an API key/);
  assert.equal(z.seen.length, 0, "refused before any request");
});

test("keys ls shows an API key's model access beside its role", async () => {
  const s = await serve({
    "GET /v1/keys": () => ({ keys: [{ id: "a1", prefix: "fr_api_onek", label: "ci", role: "editor", workspaces: null, createdAt: "2026-11-22T00:00:00Z", revokedAt: null, gateway: { capUsd: null, dailyUsd: 50, credential: "account", walletUsd: 5, spentUsd: 1, todayUsd: 1, walletSpentUsd: 0 } }] }),
  });
  const r = await at(s.url, "keys", "ls");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /editor · all projects · models: plan first · credits \$0\.00 of \$5\.00 · \$1\.00 spent · \$1\.00 of \$50\.00 today/);
});
