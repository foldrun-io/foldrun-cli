// The platform under /v1 (23 Nov 2026): `foldrun login` at a platform whose
// /api/version says `paths.platform: "/v1"` at its own API address keeps that
// in the profile, and the profile's calls go as /v1/<route>, with its
// renames. Every other platform, and FOLDRUN_URL with no profile, keeps
// /api/<route> — and no command asks /api/version for it.
//
//   node --test tests/cli-api-paths.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, cli, type Fake } from "./fake-platform.ts";
import { spelledPath, pathPlanOf } from "../src/commands.mjs";

const me = { account: "acme", role: "admin", workspaces: null, actor: { kind: "key", id: "k1", prefix: "fr_api_x", label: "cli", origin: "cli-login" } };
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-paths-"));

test("spelledPath: /api/<route> → /v1/<route>, renames first, the query kept; nothing else moves", () => {
  const v1 = { v1: true, renames: { "/api/usage": "/v1/account/usage" } };
  assert.equal(spelledPath("/api/workspaces/acme/runs?limit=5&q=a?b", v1), "/v1/workspaces/acme/runs?limit=5&q=a?b");
  assert.equal(spelledPath("/api/usage", v1), "/v1/account/usage");
  assert.equal(spelledPath("/api/usage/budget?days=7", v1), "/v1/account/usage/budget?days=7");
  assert.equal(spelledPath("/api/usagex", v1), "/v1/usagex", "a rename takes its own path and what is under it, not a longer name");
  assert.equal(spelledPath("/v1/messages", v1), "/v1/messages");
  assert.equal(spelledPath("/a2a/x", v1), "/a2a/x");
  const old = { v1: false, renames: {} };
  assert.equal(spelledPath("/api/usage", old), "/api/usage");
  assert.equal(spelledPath("/api/workspaces", old), "/api/workspaces");
});

test("pathPlanOf: only platform /v1 is a plan; renames are /api → /v1 pairs only", () => {
  assert.equal(pathPlanOf({}), null);
  assert.equal(pathPlanOf({ paths: { platform: "/api", renames: {} } }), null);
  assert.deepEqual(pathPlanOf({ paths: { platform: "/v1", renames: { "/api/usage": "/v1/account/usage", "/x": "/v1/y", "/api/z": "https://evil.test/" } } }), { v1: true, renames: { "/api/usage": "/v1/account/usage" } });
});

const loginRoutes = {
  "POST /api/cli/login": () => ({ id: "p1", code: "ABCD-EFGH", verifyUrl: "http://x.test/cli/authorize", interval: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
  "/api/cli/login/p1": () => ({ status: "approved", token: "fr_api_paths", email: "a@acme.test", account: "acme", role: "admin" }),
};

/** One platform answering at /api and /v1 alike; `paths` is what its /api/version says. */
async function platform(paths: ((self: Fake) => unknown) | null, api: "self" | string = "self") {
  let self: Fake;
  const version = () => ({ version: "v1", api: "2026-11-22", urls: { api: api === "self" ? self.url : api, app: null }, ...(paths ? { paths: paths(self) } : {}) });
  const both = (route: string, answer: () => unknown) => ({ [`/api${route}`]: answer, [`/v1${route}`]: answer });
  self = await serve({
    ...loginRoutes,
    "/api/version": version,
    "/v1/version": version,
    ...both("/me", () => me),
    ...both("/workspaces", () => ({ workspaces: [{ name: "acme-desk" }] })),
  });
  return self;
}

async function signedIn(p: Fake, env: Record<string, string> = {}) {
  const h = home();
  const login = await cli(["login", "--url", p.url, "--no-browser"], { env: { FOLDRUN_HOME: h } });
  assert.equal(login.code, 0, login.out);
  const before = p.seen.length;
  const r = await cli(["workspaces"], { env: { FOLDRUN_HOME: h, ...env } });
  assert.equal(r.code, 0, r.out);
  const profile = Object.values(JSON.parse(fs.readFileSync(path.join(h, "credentials.json"), "utf8")).profiles)[0] as any;
  return { profile, urls: p.seen.slice(before).map((s) => s.url.split("?")[0]) };
}

const V1 = () => ({ platform: "/v1", models: "/v1", renames: { "/api/usage": "/v1/account/usage" } });

test("signed in where the API says /v1: the profile keeps it, calls go to /v1, no version probe per command", async () => {
  const p = await platform(V1);
  try {
    const { profile, urls } = await signedIn(p);
    assert.deepEqual(profile.paths, { v1: true, renames: { "/api/usage": "/v1/account/usage" } });
    assert.ok(urls.includes("/v1/workspaces"), `called ${urls.join(", ")}`);
    assert.ok(!urls.some((u) => u.startsWith("/api/")), `nothing under /api: ${urls.join(", ")}`);
    assert.ok(!urls.includes("/v1/version"), "no command asks the version for its paths");
  } finally {
    p.close();
  }
});

test("no paths, /api advertised, another address named as the API, or FOLDRUN_API_PATHS=api: /api", async () => {
  const cases: Array<[string, () => Promise<Fake>, Record<string, string>]> = [
    ["no paths", () => platform(null), {}],
    ["platform /api", () => platform(() => ({ platform: "/api", models: "/v1", renames: {} })), {}],
    ["another address is the API", () => platform(V1, "https://api.example.test"), {}],
    ["escape hatch", () => platform(V1), { FOLDRUN_API_PATHS: "api" }],
  ];
  for (const [name, make, env] of cases) {
    const p = await make();
    try {
      const { urls } = await signedIn(p, env);
      assert.ok(urls.includes("/api/workspaces"), `${name}: called ${urls.join(", ")}`);
      assert.ok(!urls.some((u) => u.startsWith("/v1/")), `${name}: nothing under /v1`);
    } finally {
      p.close();
    }
  }
});

/** A machine with two accounts at one address, only one of them on /v1. */
function twoProfiles(url: string) {
  const h = home();
  const at = new Date().toISOString();
  fs.writeFileSync(path.join(h, "credentials.json"), JSON.stringify({
    current: "acme",
    profiles: {
      acme: { url, token: "fr_api_acme", account: "acme", role: "admin", loggedInAt: at, paths: { v1: true, renames: {} } },
      beta: { url, token: "fr_api_beta", account: "beta", role: "admin", loggedInAt: new Date(Date.now() + 1000).toISOString() },
    },
    platforms: {},
  }), { mode: 0o600 });
  return h;
}

test("each profile uses its own plan, not the newest one's at the same address", async () => {
  const p = await platform(V1);
  try {
    const h = twoProfiles(p.url);
    for (const [args, want] of [[["workspaces"], "/v1/workspaces"], [["workspaces", "--profile", "beta"], "/api/workspaces"]] as const) {
      const before = p.seen.length;
      const r = await cli([...args], { env: { FOLDRUN_HOME: h } });
      assert.equal(r.code, 0, r.out);
      const urls = p.seen.slice(before).map((x) => x.url.split("?")[0]);
      assert.ok(urls.includes(want), `${args.join(" ")}: called ${urls.join(", ")}`);
    }
  } finally {
    p.close();
  }
});

test("a platform back on /api: signing in again works with a /v1 plan saved, and drops it", async () => {
  // Only /api answers here: a /v1 request would 404.
  let self: Fake;
  self = await serve({ ...loginRoutes, "/api/version": () => ({ version: "v1", api: "2026-11-22", urls: { api: self.url, app: null } }), "/api/me": () => me, "/api/workspaces": () => ({ workspaces: [] }) });
  try {
    const h = twoProfiles(self.url);
    const login = await cli(["login", "--url", self.url, "--no-browser"], { env: { FOLDRUN_HOME: h } });
    assert.equal(login.code, 0, login.out);
    assert.ok(!self.seen.some((x) => x.url.startsWith("/v1/")), `sign-in spelled everything /api: ${self.seen.map((x) => x.url).join(", ")}`);
    const acme = JSON.parse(fs.readFileSync(path.join(h, "credentials.json"), "utf8")).profiles.acme;
    assert.equal(acme.paths, undefined, "the stale plan is gone");
    const r = await cli(["workspaces"], { env: { FOLDRUN_HOME: h } });
    assert.equal(r.code, 0, r.out);
    // The same with --token and the key whose profile holds the /v1 plan.
    const h2 = twoProfiles(self.url);
    const before = self.seen.length;
    const again = await cli(["login", "--url", self.url, "--token", "fr_api_acme"], { env: { FOLDRUN_HOME: h2 } });
    assert.equal(again.code, 0, again.out);
    assert.ok(!self.seen.slice(before).some((x) => x.url.startsWith("/v1/")), "--token sign-in spelled everything /api");
  } finally {
    self.close();
  }
});

test("FOLDRUN_URL with no profile keeps /api and asks nothing first", async () => {
  const p = await platform(V1);
  try {
    const r = await cli(["workspaces"], { env: { FOLDRUN_HOME: home(), FOLDRUN_URL: p.url, FOLDRUN_TOKEN: "fr_api_test" } });
    assert.equal(r.code, 0, r.out);
    assert.equal(p.seen[0].url.split("?")[0], "/api/workspaces");
  } finally {
    p.close();
  }
});
