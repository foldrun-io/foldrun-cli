// FOL-71: a `foldrun login` key lives 90 days and this CLI renews it itself.
//
// With under 14 days left, the next command rotates the key from itself
// (POST /api/keys/<own id>/rotate) and stores the new one. A key the person
// handed in (--token, FOLDRUN_TOKEN, `login --token`) is never touched, a
// key that does not renew is asked about at most daily, and a renewal that
// fails leaves the old key and the command alone.
//
//   node --test tests/cli-key-renew.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, cli, failing, WORKSPACES } from "./fake-platform.ts";

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

function home(url: string, profile: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-renew-"));
  fs.writeFileSync(
    path.join(dir, "credentials.json"),
    JSON.stringify({ current: "acme", profiles: { acme: { url, token: "mda_old", account: "acme", role: "editor", email: "a@acme.test", minted: true, ...profile } } }),
  );
  return dir;
}
const stored = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "credentials.json"), "utf8")).profiles.acme;
const me = (key: Record<string, unknown>) => ({ account: "acme", role: "editor", workspaces: null, actor: { kind: "key", id: "k1", label: "cli · mbp", prefix: "mda_old", ...key } });
const calls = (s: { seen: { method: string; url: string; headers: Record<string, unknown> }[] }, p: string) => s.seen.filter((x) => x.url.startsWith(p));

test("under 14 days left: the next command rotates the key from itself and stores the new one", async () => {
  const s = await serve({
    "/api/me": () => me({ origin: "cli-login", expiresAt: inDays(5) }),
    "POST /api/keys/k1/rotate": () => ({ ok: true, key: "mda_new", id: "k2", prefix: "mda_new", expiresAt: inDays(90), replaced: { id: "k1", endsAt: inDays(0) } }),
    "/api/workspaces": () => WORKSPACES,
  });
  const dir = home(s.url);
  const first = await cli(["workspaces"], { env: { FOLDRUN_HOME: dir } });
  const second = await cli(["workspaces"], { env: { FOLDRUN_HOME: dir } });
  s.close();
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /renewed this machine's sign-in as "acme" — it now lasts until \d{4}-\d{2}-\d{2}/);
  const rotate = calls(s, "/api/keys/k1/rotate");
  assert.equal(rotate.length, 1, "rotated once");
  assert.equal(rotate[0].headers.authorization, "Bearer mda_old", "with the key being renewed");
  const after = stored(dir);
  assert.equal(after.token, "mda_new");
  assert.equal(after.renews, true);
  assert.equal(after.minted, true, "still a login key, so logout still revokes it");
  const listed = s.seen.filter((x) => x.url.startsWith("/api/workspaces"));
  assert.equal(listed.at(-1)!.headers.authorization, "Bearer mda_new", "the command itself already uses the new key");
  assert.equal(calls(s, "/api/me").length, 1, "the second command knows the end and asks nothing");
  assert.doesNotMatch(second.out, /renewed/);
});

test("plenty of time left: nothing is rotated, and the end is remembered", async () => {
  const s = await serve({ "/api/me": () => me({ origin: "cli-login", expiresAt: inDays(80) }), "/api/workspaces": () => WORKSPACES });
  const dir = home(s.url);
  assert.equal((await cli(["workspaces"], { env: { FOLDRUN_HOME: dir } })).code, 0);
  assert.equal((await cli(["workspaces"], { env: { FOLDRUN_HOME: dir } })).code, 0);
  s.close();
  assert.equal(calls(s, "/api/keys").length, 0);
  assert.equal(calls(s, "/api/me").length, 1);
  assert.equal(stored(dir).token, "mda_old");
  assert.equal(stored(dir).renews, true);
});

test("a key that does not renew (an older platform, a person's key) is never rotated, and asked about at most daily", async () => {
  const s = await serve({ "/api/me": () => me({ expiresAt: inDays(3) }), "/api/workspaces": () => WORKSPACES });
  const dir = home(s.url);
  assert.equal((await cli(["workspaces"], { env: { FOLDRUN_HOME: dir } })).code, 0);
  assert.equal((await cli(["workspaces"], { env: { FOLDRUN_HOME: dir } })).code, 0);
  s.close();
  assert.equal(calls(s, "/api/keys").length, 0);
  assert.equal(calls(s, "/api/me").length, 1);
  assert.equal(stored(dir).renews, false);
});

test("--token, FOLDRUN_TOKEN and a key stored with `login --token` are never renewed", async () => {
  const s = await serve({ "/api/me": () => me({ origin: "cli-login", expiresAt: inDays(1) }), "/api/workspaces": () => WORKSPACES });
  const dir = home(s.url);
  const handed = home(s.url, { minted: false });
  assert.equal((await cli(["workspaces", "--token", "mda_ci"], { env: { FOLDRUN_HOME: dir } })).code, 0);
  assert.equal((await cli(["workspaces"], { env: { FOLDRUN_HOME: dir, FOLDRUN_TOKEN: "mda_ci", FOLDRUN_URL: s.url } })).code, 0);
  assert.equal((await cli(["workspaces"], { env: { FOLDRUN_HOME: handed } })).code, 0);
  s.close();
  assert.equal(calls(s, "/api/me").length, 0);
  assert.equal(calls(s, "/api/keys").length, 0);
  assert.equal(stored(dir).token, "mda_old");
});

test("a rotation the platform refuses leaves the old key and the command alone", async () => {
  const s = await serve({
    "/api/me": () => me({ origin: "cli-login", expiresAt: inDays(2) }),
    "POST /api/keys/k1/rotate": () => failing(403, { error: "this key may not do that" }),
    "/api/workspaces": () => WORKSPACES,
  });
  const dir = home(s.url);
  const r = await cli(["workspaces"], { env: { FOLDRUN_HOME: dir } });
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /blog-desk/);
  assert.equal(stored(dir).token, "mda_old");
});
