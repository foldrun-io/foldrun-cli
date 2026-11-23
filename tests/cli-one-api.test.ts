// The one API (21 Nov 2026): a platform with an API address of its own
// (GET /v1/version `urls: { api, app }`) gets this machine's calls there
// after `foldrun login`; its dashboard is kept for the pages the CLI opens
// and the person's own routes the API host leaves to it.
//
//   node --test tests/cli-one-api.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, cli, failing, raw, type Fake } from "./fake-platform.ts";

const me = { account: "acme", role: "admin", workspaces: null, actor: { kind: "key", id: "k1", prefix: "mda_x", label: "cli", origin: "cli-login" } };
const loginRoutes = (token = "mda_oneapi") => ({
  "POST /v1/cli/login": () => ({ id: "p1", code: "ABCD-EFGH", verifyUrl: "http://x.test/cli/authorize", interval: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
  "/v1/cli/login/p1": () => ({ status: "approved", token, email: "a@acme.test", account: "acme", role: "admin" }),
});

/** A dashboard and an API, two addresses of one platform. */
async function pair(opts: { apiMe?: () => unknown; appMe?: () => unknown; apiVersion?: () => unknown } = {}) {
  let api: Fake;
  let app: Fake;
  const urls = () => ({ version: "v1", api: "2026-10-26", urls: { api: api.url, app: app.url } });
  app = await serve({ ...loginRoutes(), "/v1/version": urls, "/v1/me": opts.appMe ?? (() => me), "POST /v1/auth/name": () => ({ ok: true }) });
  api = await serve({ ...loginRoutes(), "/v1/version": opts.apiVersion ?? urls, "/v1/me": opts.apiMe ?? (() => me), "/v1/workspaces": () => ({ workspaces: [] }) });
  return { api, app, close: () => (api.close(), app.close()) };
}

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-oneapi-"));
const profiles = (h: string) => JSON.parse(fs.readFileSync(path.join(h, "credentials.json"), "utf8")).profiles;

test("signed in at the dashboard: calls move to the API, pages and a person's own routes stay on the dashboard", async () => {
  const h = home();
  const p = await pair();
  try {
    const env = { FOLDRUN_HOME: h };
    const login = await cli(["login", "--url", p.app.url, "--no-browser"], { env });
    assert.equal(login.code, 0, login.out);
    assert.match(login.out, new RegExp(`the API is ${p.api.url.replace(/[.]/g, "\\.")}; pages open at`));
    const saved = Object.values(profiles(h)) as any[];
    assert.equal(saved.length, 1);
    assert.equal(saved[0].url, p.api.url);
    assert.equal(saved[0].app, p.app.url);

    const before = p.api.seen.length;
    const who = await cli(["whoami"], { env });
    assert.equal(who.code, 0, who.out);
    assert.ok(p.api.seen.slice(before).some((s) => s.url === "/v1/me"), "whoami asks the API");
    assert.match(who.out, /dashboard\s+http:\/\/127\.0\.0\.1/);

    const name = await cli(["me", "name", "Ana"], { env });
    assert.equal(name.code, 0, name.out);
    assert.ok(p.app.seen.some((s) => s.method === "POST" && s.url === "/v1/auth/name"), "a person's name is the dashboard's route");
    assert.ok(!p.api.seen.some((s) => s.url === "/v1/auth/name"), "never sent to the API host, which refuses it");

    const open = await cli(["open", "runs", "--print", "--to", "blog-desk"], { env });
    assert.equal(open.out.trim().split("\n").at(-1), `${p.app.url}/dashboard/blog-desk/runs`);

    const seen = p.api.seen.length;
    const byDashboard = await cli(["whoami", "--url", p.app.url], { env });
    assert.equal(byDashboard.code, 0, `--url <dashboard> still finds the profile kept at the API: ${byDashboard.out}`);
    assert.ok(p.api.seen.slice(seen).some((s) => s.url === "/v1/me"), "and its calls go to the API, not the dashboard named");
    const viaEnv = p.api.seen.length;
    const envWho = await cli(["whoami"], { env: { ...env, FOLDRUN_URL: p.app.url } });
    assert.equal(envWho.code, 0, envWho.out);
    assert.ok(p.api.seen.slice(viaEnv).some((s) => s.url === "/v1/me"), "FOLDRUN_URL=<dashboard> too");
  } finally {
    p.close();
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test("an API address the new key does not answer at (or answers as someone else) changes nothing", async () => {
  for (const apiMe of [() => failing(401, { error: "invalid API key" }), () => ({ ...me, account: "someone-else" })]) {
    const h = home();
    const p = await pair({ apiMe });
    try {
      const login = await cli(["login", "--url", p.app.url, "--no-browser"], { env: { FOLDRUN_HOME: h } });
      assert.equal(login.code, 0, login.out);
      const [saved] = Object.values(profiles(h)) as any[];
      assert.equal(saved.url, p.app.url, "kept where it signed in");
      assert.equal(saved.app, undefined);
    } finally {
      p.close();
      fs.rmSync(h, { recursive: true, force: true });
    }
  }
});

test("an address that does not name the same pair back never sees the key", async () => {
  const h = home();
  const p = await pair({ apiVersion: () => ({ version: "v1", api: "2026-10-26", urls: { api: "https://elsewhere.example", app: "https://elsewhere.example" } }) });
  try {
    const login = await cli(["login", "--url", p.app.url, "--no-browser"], { env: { FOLDRUN_HOME: h } });
    assert.equal(login.code, 0, login.out);
    const [saved] = Object.values(profiles(h)) as any[];
    assert.equal(saved.url, p.app.url, "kept where it signed in");
    assert.ok(!p.api.seen.some((s) => s.headers.authorization), "no request with a key reached the address that would not vouch for the pair");
  } finally {
    p.close();
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test("signed in at the API with a profile still at the dashboard: that profile moves, no second one", async () => {
  const h = home();
  const p = await pair();
  try {
    fs.writeFileSync(
      path.join(h, "credentials.json"),
      JSON.stringify({ current: "acme", profiles: { acme: { token: "mda_old", email: "a@acme.test", account: "acme", role: "admin", url: p.app.url, workspace: "blog-desk" } } }),
    );
    const login = await cli(["login", "--url", p.api.url, "--no-browser"], { env: { FOLDRUN_HOME: h } });
    assert.equal(login.code, 0, login.out);
    const all = profiles(h);
    assert.deepEqual(Object.keys(all), ["acme"]);
    assert.equal(all.acme.url, p.api.url);
    assert.equal(all.acme.app, p.app.url);
    assert.equal(all.acme.workspace, "blog-desk");
  } finally {
    p.close();
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test("a second sign-in at the dashboard moves the account's profile to the API — one profile, its default project kept", async () => {
  const h = home();
  const p = await pair();
  try {
    fs.writeFileSync(
      path.join(h, "credentials.json"),
      JSON.stringify({ current: "acme", profiles: { acme: { token: "mda_old", email: "a@acme.test", account: "acme", role: "admin", url: p.app.url, workspace: "blog-desk" } } }),
    );
    const login = await cli(["login", "--url", p.app.url, "--no-browser"], { env: { FOLDRUN_HOME: h } });
    assert.equal(login.code, 0, login.out);
    const all = profiles(h);
    assert.deepEqual(Object.keys(all), ["acme"]);
    assert.equal(all.acme.url, p.api.url);
    assert.equal(all.acme.app, p.app.url);
    assert.equal(all.acme.workspace, "blog-desk");
    assert.equal(all.acme.token, "mda_oneapi");
  } finally {
    p.close();
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test("signed in at the API itself: the dashboard it names is kept once the key answers there", async () => {
  const h = home();
  const p = await pair();
  try {
    const login = await cli(["login", "--url", p.api.url, "--no-browser"], { env: { FOLDRUN_HOME: h } });
    assert.equal(login.code, 0, login.out);
    const [saved] = Object.values(profiles(h)) as any[];
    assert.equal(saved.url, p.api.url);
    assert.equal(saved.app, p.app.url);
  } finally {
    p.close();
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test("a platform with one address (no urls, or an older one): nothing moves", async () => {
  const h = home();
  const s = await serve({ ...loginRoutes(), "/v1/me": () => me });
  try {
    const login = await cli(["login", "--url", s.url, "--no-browser"], { env: { FOLDRUN_HOME: h } });
    assert.equal(login.code, 0, login.out);
    const [saved] = Object.values(profiles(h)) as any[];
    assert.equal(saved.url, s.url);
    assert.equal(saved.app, undefined);
    assert.doesNotMatch(login.out, /the API is/);
  } finally {
    s.close();
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test("a key given with FOLDRUN_TOKEN goes where FOLDRUN_URL says, whatever profiles this machine has", async () => {
  const h = home();
  const p = await pair();
  try {
    const env = { FOLDRUN_HOME: h };
    assert.equal((await cli(["login", "--url", p.app.url, "--no-browser"], { env })).code, 0);
    const before = p.api.seen.length;
    const who = await cli(["whoami"], { env: { ...env, FOLDRUN_URL: p.app.url, FOLDRUN_TOKEN: "mda_ci" } });
    assert.equal(who.code, 0, who.out);
    assert.ok(!p.api.seen.slice(before).some((s) => s.headers.authorization === "Bearer mda_ci"), "the CI key never went to the saved API");
    assert.ok(p.app.seen.some((s) => s.headers.authorization === "Bearer mda_ci"), "it went to the address it was given");
  } finally {
    p.close();
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test("a redirect is no answer: an address that only redirects never vouches for the pair", async () => {
  const h = home();
  let api: Fake;
  const app = await serve({
    ...loginRoutes(),
    "/v1/version": () => ({ version: "v1", api: "2026-10-26", urls: { api: api.url, app: app.url } }),
    "/v1/me": () => me,
  });
  api = await serve({ "/v1/version": () => raw("", "text/plain", { location: `${app.url}/v1/version` }, 302), "/v1/me": () => me });
  try {
    const login = await cli(["login", "--url", app.url, "--no-browser"], { env: { FOLDRUN_HOME: h } });
    assert.equal(login.code, 0, login.out);
    const [saved] = Object.values(profiles(h)) as any[];
    assert.equal(saved.url, app.url);
    assert.ok(!api.seen.some((s) => s.headers.authorization), "no key went to the redirecting address");
  } finally {
    api.close();
    app.close();
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test("a sign-in that cannot reach the API this time keeps the moved profile, not a second one", async () => {
  const h = home();
  const s = await serve({ ...loginRoutes(), "/v1/me": () => me });
  try {
    fs.writeFileSync(
      path.join(h, "credentials.json"),
      JSON.stringify({ current: "acme", profiles: { acme: { token: "mda_old", email: "a@acme.test", account: "acme", role: "admin", url: "https://api.example.test", app: s.url, workspace: "blog-desk" } } }),
    );
    const login = await cli(["login", "--url", s.url, "--no-browser"], { env: { FOLDRUN_HOME: h } });
    assert.equal(login.code, 0, login.out);
    const all = profiles(h);
    assert.deepEqual(Object.keys(all), ["acme"]);
    assert.equal(all.acme.url, s.url, "kept where this sign-in could check it");
    assert.equal(all.acme.workspace, "blog-desk");
  } finally {
    s.close();
    fs.rmSync(h, { recursive: true, force: true });
  }
});


test("a key given with --token keeps a person's own routes on the address given, not a saved dashboard", async () => {
  const h = home();
  const p = await pair();
  try {
    const env = { FOLDRUN_HOME: h };
    assert.equal((await cli(["login", "--url", p.app.url, "--no-browser"], { env })).code, 0);
    await cli(["me", "name", "Bo", "--url", p.api.url, "--token", "mda_given"], { env });
    assert.ok(!p.app.seen.some((s) => s.headers.authorization === "Bearer mda_given"), "the given key never went to the saved dashboard");
    assert.ok(p.api.seen.some((s) => s.url === "/v1/auth/name" && s.headers.authorization === "Bearer mda_given"), "it went where it was told");
  } finally {
    p.close();
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test("an install that names only its API: the login moves there and the dashboard is where it started", async () => {
  const h = home();
  let api: Fake;
  const only = () => ({ version: "v1", api: "2026-10-26", urls: { api: api.url, app: null } });
  const app = await serve({ ...loginRoutes(), "/v1/version": only, "/v1/me": () => me });
  api = await serve({ "/v1/version": only, "/v1/me": () => me });
  try {
    const login = await cli(["login", "--url", app.url, "--no-browser"], { env: { FOLDRUN_HOME: h } });
    assert.equal(login.code, 0, login.out);
    const [saved] = Object.values(profiles(h)) as any[];
    assert.equal(saved.url, api.url);
    assert.equal(saved.app, app.url);
  } finally {
    api.close();
    app.close();
    fs.rmSync(h, { recursive: true, force: true });
  }
});
