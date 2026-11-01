// `foldrun connect` — the OAuth consent from the terminal, ending in the
// vault. Pinned offline through the real binary: a fake provider answers
// the token exchange, a fake platform receives the secret, and the test
// plays the browser by hitting the loopback callback with the state the CLI
// put in its authorize URL.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

/** A port nothing holds right now, from the OS — a fixed one sat inside
 *  Linux's ephemeral range and a CI runner's own connection took it
 *  (27 Oct 2026: "port 48132 is in use"). */
async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");

function serve(handler: http.RequestListener): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (d) => (s += d));
    req.on("end", () => resolve(s));
  });
}

async function runConnect(args: string[], env: Record<string, string | undefined>) {
  const child = spawn(process.execPath, [CLI, "connect", ...args], {
    cwd: ROOT,
    env: { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, NO_COLOR: "1", ...env },
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  // The CLI prints the authorize URL (--no-browser); the "browser" follows
  // the redirect it would have been sent to.
  const authorize = await new Promise<URL>((resolve, reject) => {
    const t = setInterval(() => {
      const m = out.match(/(https?:\/\/\S+authorize\S*)/);
      if (m) { clearInterval(t); resolve(new URL(m[1])); }
    }, 25);
    child.on("exit", () => { clearInterval(t); reject(new Error(`exited before printing the URL:\n${out}`)); });
  });
  const redirect = new URL(authorize.searchParams.get("redirect_uri")!);
  redirect.searchParams.set("code", "c0de");
  redirect.searchParams.set("state", authorize.searchParams.get("state")!);
  const page = await (await fetch(redirect)).text();
  const status = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? -1)));
  return { status, out, authorize, page };
}

test("connect: consent → exchange → refresh recipe stored on the platform, nothing secret printed", async () => {
  const port1 = await freePort();
  const exchanges: string[] = [];
  const stored: unknown[] = [];
  // Token endpoints must be https in the vault; the fake is loopback, which
  // setOAuth2Secret exempts and the CLI's own check must too.
  const provider = await serve(async (req, res) => {
    if (req.url === "/token") {
      exchanges.push(await readBody(req));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ access_token: "acc3ss", refresh_token: "r3fresh", expires_in: 3600, scope: "a b" }));
    } else { res.statusCode = 404; res.end(); }
  });
  const platform = await serve(async (req, res) => {
    // PUT, exactly as the real route and `secrets set` — a fake that took
    // POST let the first version of this command ship a 405.
    if (req.url === "/api/secrets" && req.method === "PUT") {
      stored.push({ auth: req.headers.authorization, body: JSON.parse(await readBody(req)) });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    } else { res.statusCode = 404; res.end("{}"); }
  });
  try {
    const r = await runConnect(
      ["LI_TOKEN", "--authorize-url", `${provider.url}/authorize`, "--token-url", `${provider.url}/token`,
       "--scopes", "a b", "--port", String(port1), "--client-id", "cid", "--client-secret", "csec",
       "--url", platform.url, "--token", "ptok", "--to", "desk", "--no-browser"],
      {},
    );
    assert.equal(r.status, 0, r.out);
    assert.equal(r.authorize.searchParams.get("scope"), "a b", "scopes are one space-separated string");
    assert.equal(r.authorize.searchParams.get("redirect_uri"), `http://localhost:${port1}/callback`);
    assert.match(r.page, /Connected/);
    assert.match(exchanges[0], /grant_type=authorization_code/);
    assert.match(exchanges[0], /code=c0de/);
    assert.equal(stored.length, 1);
    const s = stored[0] as { auth: string; body: { name: string; workspace: string; oauth2: { refresh_token: string; token_url: string } } };
    assert.equal(s.auth, "Bearer ptok");
    assert.equal(s.body.name, "LI_TOKEN");
    assert.equal(s.body.workspace, "desk");
    assert.equal(s.body.oauth2.refresh_token, "r3fresh");
    assert.doesNotMatch(r.out, /r3fresh|acc3ss|csec/, "nothing secret reaches the terminal");
    assert.match(r.out, /auto-refreshing/);
    assert.match(r.out, /Register this redirect URL/, "the redirect URL is announced before the browser opens");
  } finally {
    provider.close();
    platform.close();
  }
});

test("connect: a provider with no refresh token stores the access token and says when it expires", async () => {
  const provider = await serve(async (req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ access_token: "acc3ss", expires_in: 5184000 }));
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-connect-"));
  try {
    const r = await runConnect(
      ["GH_TOKEN", "--authorize-url", `${provider.url}/authorize`, "--token-url", `${provider.url}/token`,
       "--port", String(await freePort()), "--client-id", "cid", "--client-secret", "csec", "--local", "--no-browser"],
      { FOLDRUN_DATA: root },
    );
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /no refresh token/);
    assert.match(r.out, /60 days/);
    assert.ok(fs.existsSync(path.join(root, "default/secrets.json")), "stored in the local account vault");
    assert.doesNotMatch(r.out, /acc3ss/);
  } finally {
    provider.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("connect: a secret with a saved client reconnects through the platform — no client id prompt, no typing", async () => {
  const calls: string[] = [];
  let reconnected = false;
  const platform = await serve(async (req, res) => {
    res.setHeader("content-type", "application/json");
    calls.push(`${req.method} ${req.url}`);
    if (req.url === "/api/oauth/reconnect" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      assert.deepEqual({ secret: body.secret, workspace: body.workspace }, { secret: "LINKEDIN_OAUTH", workspace: "linkedin-desk" });
      reconnected = true;
      res.end(JSON.stringify({ ok: true, url: "https://www.linkedin.com/oauth/v2/authorization?state=abc", client: "linkedin", redirectUri: "https://dev.example/api/oauth/callback" }));
    } else if (req.url === "/api/oauth/connections") {
      // The callback lands on the platform; the CLI sees connectedAt move.
      res.end(JSON.stringify({ connections: [{ name: "LINKEDIN_OAUTH", workspace: "linkedin-desk", client: "linkedin", status: "ok", daysLeft: null, connectedAt: reconnected && calls.filter((c) => c.endsWith("/connections")).length > 1 ? "2026-09-14T01:00:00.000Z" : "2026-09-06T05:56:03.681Z" }] }));
    } else { res.statusCode = 404; res.end("{}"); }
  });
  try {
    const child = spawn(process.execPath, [CLI, "connect", "LINKEDIN_OAUTH", "--provider", "linkedin", "--workspace", "linkedin-desk", "--url", platform.url, "--token", "ptok", "--no-browser"], {
      cwd: ROOT,
      env: { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, OAUTH_CLIENT_ID: undefined, OAUTH_CLIENT_SECRET: undefined, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const status = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? -1)));
    assert.equal(status, 0, out);
    out = out.replace(/\x1b\[[0-9;]*m/g, "");
    assert.doesNotMatch(out, /client_id:/, "never asks for the client id");
    assert.match(out, /Reusing the saved linkedin client/);
    assert.match(out, /LINKEDIN_OAUTH reconnected/);
    assert.ok(calls.includes("POST /api/oauth/reconnect"));
    assert.ok(!calls.some((c) => c.startsWith("PUT /api/secrets")), "the platform callback stores it, not the CLI");
  } finally {
    platform.close();
  }
});

test("connect: PKCE by default — the challenge is S256 of the verifier sent with the code; a public app sends no secret", async () => {
  const port3 = await freePort();
  const exchanges: string[] = [];
  const provider = await serve(async (req, res) => {
    if (req.url === "/token") {
      exchanges.push(await readBody(req));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
    } else { res.statusCode = 404; res.end(); }
  });
  const platform = await serve(async (req, res) => {
    if (req.url === "/api/secrets" && req.method === "PUT") { await readBody(req); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true })); }
    else { res.statusCode = 404; res.end("{}"); }
  });
  try {
    const r = await runConnect(
      ["PUB_TOKEN", "--authorize-url", `${provider.url}/authorize`, "--token-url", `${provider.url}/token`,
       "--port", String(port3), "--client-id", "pub-id", "--client-secret", "", "--url", platform.url, "--token", "ptok", "--no-browser",
       "--authorize-param", "access_type=offline", "--authorize-param", "redirect_uri=https://evil.example"],
      {},
    );
    assert.equal(r.status, 0, r.out);
    assert.equal(r.authorize.searchParams.get("code_challenge_method"), "S256");
    const form = new URLSearchParams(exchanges[0]);
    const verifier = form.get("code_verifier")!;
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/, "32 random bytes, base64url");
    const crypto = await import("node:crypto");
    assert.equal(r.authorize.searchParams.get("code_challenge"), crypto.createHash("sha256").update(verifier).digest("base64url"));
    assert.equal(form.get("client_secret"), null, "a public app sends no secret");
    // What the provider documents beyond OAuth rides along; the flow's own
    // parameters cannot be overridden by one.
    assert.equal(r.authorize.searchParams.get("access_type"), "offline");
    assert.match(r.authorize.searchParams.get("redirect_uri") ?? "", new RegExp(`^http://localhost:${port3}/callback$`));
  } finally {
    provider.close();
    platform.close();
  }
});

test("connect --token-auth basic: the code goes to the token URL with HTTP Basic, the body has no secret, the recipe keeps it", async () => {
  const port = await freePort();
  const exchanges: { auth?: string; body: string }[] = [];
  const stored: { oauth2: Record<string, unknown> }[] = [];
  // Basic-only, like Notion: a body secret is invalid_client; the answer is
  // form-encoded with expires_in as a string, and carries a plain field.
  const provider = await serve(async (req, res) => {
    if (req.url === "/token") {
      const body = await readBody(req);
      exchanges.push({ auth: req.headers.authorization, body });
      if (req.headers.authorization !== `Basic ${Buffer.from("cid:c%3Asec").toString("base64")}` || new URLSearchParams(body).has("client_secret")) {
        res.statusCode = 401; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: "invalid_client" })); return;
      }
      res.setHeader("content-type", "application/x-www-form-urlencoded");
      res.end("access_token=acc3ss&refresh_token=r3fresh&expires_in=3600&workspace_name=Acme");
    } else { res.statusCode = 404; res.end(); }
  });
  const platform = await serve(async (req, res) => {
    if (req.url === "/api/secrets" && req.method === "PUT") { stored.push(JSON.parse(await readBody(req))); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true })); }
    else { res.statusCode = 404; res.end("{}"); }
  });
  try {
    const r = await runConnect(
      ["NOTION_TOKEN", "--authorize-url", `${provider.url}/authorize`, "--token-url", `${provider.url}/token`,
       "--port", String(port), "--client-id", "cid", "--client-secret", "c:sec", "--token-auth", "basic",
       "--url", platform.url, "--token", "ptok", "--no-browser"],
      {},
    );
    assert.equal(r.status, 0, r.out);
    const form = new URLSearchParams(exchanges[0].body);
    assert.equal(form.has("client_secret"), false);
    assert.equal(form.has("client_id"), false, "one authentication method per request");
    assert.equal(stored[0].oauth2.token_auth, "client_secret_basic", "refreshes sign in the same way");
    assert.equal(stored[0].oauth2.refresh_token, "r3fresh", "the form-encoded answer was read");
    assert.deepEqual(stored[0].oauth2.fields, { workspace_name: "Acme" });
    assert.doesNotMatch(r.out, /r3fresh|acc3ss|c:sec/);
  } finally {
    provider.close();
    platform.close();
  }
});

test("connect --token-auth: a bad value, or basic with no secret, is refused before any browser opens", async () => {
  for (const [args, msg] of [
    [["--token-auth", "mtls-later", "--client-secret", "s"], /--token-auth is basic/],
    [["--token-auth", "basic", "--client-secret", ""], /needs a client_secret/],
  ] as const) {
    const child = spawn(process.execPath, [CLI, "connect", "X_TOKEN", "--authorize-url", "https://p.example/authorize", "--token-url", "https://p.example/token",
      "--client-id", "cid", ...args, "--local", "--no-browser"], { cwd: ROOT, env: { ...process.env, FOLDRUN_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "fr-ta-")), NO_COLOR: "1" } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const code = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? -1)));
    assert.notEqual(code, 0, out);
    assert.match(out, msg);
    assert.doesNotMatch(out, /authorize\?/, "no consent was started");
  }
});

/** An authorization server that publishes RFC 8414 metadata at its issuer. */
async function discoverableProvider(opts: { issParameter?: boolean; par?: boolean } = {}) {
  const exchanges: { auth?: string; body: string }[] = [];
  const pushed: URLSearchParams[] = [];
  let base = "";
  const s = await serve(async (req, res) => {
    if (req.url === "/.well-known/oauth-authorization-server") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, revocation_endpoint: `${base}/revoke`,
        token_endpoint_auth_methods_supported: ["client_secret_basic"], code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: opts.issParameter === true,
        ...(opts.par ? { pushed_authorization_request_endpoint: `${base}/par` } : {}),
      }));
    } else if (req.url === "/par") {
      pushed.push(new URLSearchParams(await readBody(req)));
      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ request_uri: "urn:ietf:params:oauth:request_uri:xyz", expires_in: 60 }));
    } else if (req.url === "/token") {
      exchanges.push({ auth: req.headers.authorization, body: await readBody(req) });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
    } else { res.statusCode = 404; res.end(); }
  });
  base = s.url;
  return { ...s, exchanges, pushed };
}

test("connect --issuer: the metadata fills the URLs, picks Basic, and the recipe keeps the revocation URL", async () => {
  const port = await freePort();
  const p = await discoverableProvider();
  const stored: { oauth2: Record<string, unknown> }[] = [];
  const platform = await serve(async (req, res) => {
    if (req.url === "/api/secrets" && req.method === "PUT") { stored.push(JSON.parse(await readBody(req))); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true })); }
    else { res.statusCode = 404; res.end("{}"); }
  });
  try {
    const r = await runConnect(["KC_TOKEN", "--issuer", p.url, "--port", String(port), "--client-id", "cid", "--client-secret", "shh", "--url", platform.url, "--token", "ptok", "--no-browser"], {});
    assert.equal(r.status, 0, r.out);
    assert.equal(r.authorize.origin + r.authorize.pathname, `${p.url}/authorize`);
    assert.match(r.out, /read .*\.well-known\/oauth-authorization-server/);
    assert.equal(p.exchanges[0].auth, `Basic ${Buffer.from("cid:shh").toString("base64")}`, "the server listed Basic only");
    assert.equal(stored[0].oauth2.token_url, `${p.url}/token`);
    assert.equal(stored[0].oauth2.token_auth, "client_secret_basic");
    assert.equal(stored[0].oauth2.revocation_url, `${p.url}/revoke`);
  } finally {
    p.close();
    platform.close();
  }
});

test("connect --issuer: a callback whose iss is another server is refused and nothing is exchanged (RFC 9207)", async () => {
  const port = await freePort();
  const p = await discoverableProvider({ issParameter: true });
  const child = spawn(process.execPath, [CLI, "connect", "KC_TOKEN", "--issuer", p.url, "--port", String(port), "--client-id", "cid", "--client-secret", "shh", "--local", "--no-browser"],
    { cwd: ROOT, env: { ...process.env, FOLDRUN_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "fr-iss-")), NO_COLOR: "1" } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  try {
    const authorize = await new Promise<URL>((resolve, reject) => {
      const t = setInterval(() => { const m = out.match(/(https?:\/\/\S+authorize\S*)/); if (m) { clearInterval(t); resolve(new URL(m[1])); } }, 25);
      child.on("exit", () => { clearInterval(t); reject(new Error(out)); });
    });
    const back = new URL(authorize.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", "c0de");
    back.searchParams.set("state", authorize.searchParams.get("state")!);
    back.searchParams.set("iss", "https://evil.example");
    const page = await fetch(back);
    assert.equal(page.status, 400);
    const code = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? -1)));
    assert.notEqual(code, 0);
    assert.match(out, /answered as https:\/\/evil\.example — expected/);
    assert.equal(p.exchanges.length, 0, "the code was never traded");
  } finally {
    p.close();
  }
});

test("secrets rm says what revoking the grant at the provider came to, and a failure is not hidden", async () => {
  for (const [revoked, expect] of [
    [{ revoked: ["refresh_token"] }, /grant revoked at the provider \(refresh_token\)/],
    [{ revoked: [], error: "the provider refused to revoke the refresh token (503)" }, /! the provider refused to revoke the refresh token \(503\) — revoke the app's access in the provider's own settings/],
    [{ skipped: "shared-grant", revoked: [] }, /grant kept: another secret uses the same app, which the provider may revoke together/],
  ] as const) {
    const platform = await serve(async (req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/secrets" && req.method === "DELETE") { await readBody(req); res.end(JSON.stringify({ ok: true, revoked })); }
      else { res.statusCode = 404; res.end("{}"); }
    });
    const child = spawn(process.execPath, [CLI, "secrets", "rm", "CRM", "--account", "--yes", "--url", platform.url, "--token", "ptok"], { cwd: ROOT, env: { ...process.env, FOLDRUN_DATA: undefined, NO_COLOR: "1" } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const code = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? -1)));
    platform.close();
    assert.equal(code, 0, out);
    assert.match(out, /CRM removed/);
    assert.match(out, expect);
  }
});

test("connect --issuer with a PAR endpoint: the parameters are pushed and the browser carries only client_id and request_uri", async () => {
  const port = await freePort();
  const p = await discoverableProvider({ par: true });
  const child = spawn(process.execPath, [CLI, "connect", "PAR_TOKEN", "--issuer", p.url, "--port", String(port), "--client-id", "cid", "--client-secret", "shh", "--local", "--no-browser"],
    { cwd: ROOT, env: { ...process.env, FOLDRUN_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "fr-par-")), NO_COLOR: "1" } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  try {
    const authorize = await new Promise<URL>((resolve, reject) => {
      const t = setInterval(() => { const m = out.match(/(https?:\/\/\S+authorize\S*)/); if (m) { clearInterval(t); resolve(new URL(m[1])); } }, 25);
      child.on("exit", () => { clearInterval(t); reject(new Error(out)); });
    });
    assert.deepEqual([...authorize.searchParams.keys()].sort(), ["client_id", "request_uri"]);
    assert.equal(authorize.searchParams.get("request_uri"), "urn:ietf:params:oauth:request_uri:xyz");
    const f = p.pushed[0];
    assert.equal(f.get("client_id"), "cid", "PAR carries client_id even with Basic (RFC 9126 §2.1)");
    assert.equal(f.get("code_challenge_method"), "S256");
    assert.ok(f.get("state"));
    child.kill();
  } finally {
    p.close();
  }
});

test("connect --token-auth jwt --key-file: the exchange is a signed assertion, no secret is asked or sent, the recipe keeps the key", async () => {
  const { generateClientKey, verifyClientAssertion } = await import("@foldrun/core");
  const { privateKey, publicJwk } = generateClientKey("ES256");
  const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fr-key-")), "key.pem");
  fs.writeFileSync(keyFile, privateKey);
  const port = await freePort();
  const forms: URLSearchParams[] = [];
  const stored: { oauth2: Record<string, unknown> }[] = [];
  let tokenUrl = "";
  const provider = await serve(async (req, res) => {
    if (req.url === "/token") {
      const form = new URLSearchParams(await readBody(req));
      forms.push(form);
      res.setHeader("content-type", "application/json");
      try {
        verifyClientAssertion(form.get("client_assertion") ?? "", { clientId: "cid", audiences: [tokenUrl], keys: [publicJwk] });
        res.end(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
      } catch (err) { res.statusCode = 401; res.end(JSON.stringify({ error: "invalid_client", error_description: (err as Error).message })); }
    } else { res.statusCode = 404; res.end(); }
  });
  tokenUrl = `${provider.url}/token`;
  const platform = await serve(async (req, res) => {
    if (req.url === "/api/secrets" && req.method === "PUT") { stored.push(JSON.parse(await readBody(req))); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true })); }
    else { res.statusCode = 404; res.end("{}"); }
  });
  try {
    const r = await runConnect(["SIGNED", "--authorize-url", `${provider.url}/authorize`, "--token-url", tokenUrl, "--port", String(port), "--client-id", "cid",
      "--token-auth", "jwt", "--key-file", keyFile, "--url", platform.url, "--token", "ptok", "--no-browser"], {});
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /client_secret/, "no secret is asked for");
    assert.equal(forms[0].has("client_secret"), false);
    assert.equal(stored[0].oauth2.token_auth, "private_key_jwt");
    assert.match(String(stored[0].oauth2.client_assertion_key), /BEGIN PRIVATE KEY/);
    assert.doesNotMatch(r.out, /PRIVATE KEY/, "the key never reaches the terminal");
  } finally {
    provider.close();
    platform.close();
  }
});

test("secrets clients add --token-auth jwt --generate-key: the platform makes the key and the CLI prints its public JWK", async () => {
  let sent: Record<string, unknown> = {};
  const jwk = { kty: "EC", crv: "P-256", x: "x", y: "y", kid: "k1", alg: "ES256", use: "sig" };
  const platform = await serve(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/oauth/clients" && req.method === "POST") { sent = JSON.parse(await readBody(req)); res.end(JSON.stringify({ ok: true, name: "okta", public_jwk: jwk })); }
    else { res.statusCode = 404; res.end("{}"); }
  });
  const child = spawn(process.execPath, [CLI, "secrets", "clients", "add", "okta", "--authorize-url", "https://okta.example/authorize", "--token-url", "https://okta.example/token",
    "--client-id", "cid", "--token-auth", "jwt", "--generate-key", "--url", platform.url, "--token", "ptok"], { cwd: ROOT, env: { ...process.env, FOLDRUN_DATA: undefined, NO_COLOR: "1" } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const code = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? -1)));
  platform.close();
  assert.equal(code, 0, out);
  const config = (sent as { config: Record<string, unknown> }).config;
  assert.equal(config.token_auth, "private_key_jwt");
  assert.equal(config.generate_key, true);
  assert.equal(config.client_secret, "");
  assert.match(out, /Register this public key/);
  assert.match(out, /"kid": "k1"/);
});

test("connect --device (RFC 8628): shows the code, polls through pending, stores the grant — no browser, no loopback port", async () => {
  let polls = 0;
  const stored: { oauth2: Record<string, unknown> }[] = [];
  const provider = await serve(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/device") { await readBody(req); res.end(JSON.stringify({ device_code: "dc", user_code: "WXYZ-1234", verification_uri: "https://p.example/device", expires_in: 600, interval: 1 })); return; }
    if (req.url === "/token") {
      const form = new URLSearchParams(await readBody(req));
      polls++;
      if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:device_code" || form.get("device_code") !== "dc") { res.statusCode = 400; res.end(JSON.stringify({ error: "invalid_grant" })); return; }
      if (polls < 2) { res.statusCode = 400; res.end(JSON.stringify({ error: "authorization_pending" })); return; }
      res.end(JSON.stringify({ access_token: "a", refresh_token: "r-device", expires_in: 3600 }));
      return;
    }
    res.statusCode = 404; res.end("{}");
  });
  const platform = await serve(async (req, res) => {
    if (req.url === "/api/secrets" && req.method === "PUT") { stored.push(JSON.parse(await readBody(req))); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true })); }
    else { res.statusCode = 404; res.end("{}"); }
  });
  try {
    const child = spawn(process.execPath, [CLI, "connect", "TV_TOKEN", "--device", "--device-url", `${provider.url}/device`, "--token-url", `${provider.url}/token`,
      "--client-id", "cid", "--client-secret", "", "--url", platform.url, "--token", "ptok"], { cwd: ROOT, env: { ...process.env, FOLDRUN_DATA: undefined, NO_COLOR: "1" } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const code = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? -1)));
    assert.equal(code, 0, out);
    assert.match(out, /enter the code WXYZ-1234/);
    assert.doesNotMatch(out, /Register this redirect URL/, "no loopback redirect for a device flow");
    assert.equal(polls, 2);
    assert.equal(stored[0].oauth2.refresh_token, "r-device");
  } finally {
    provider.close();
    platform.close();
  }
});

test("connect --client <saved> --device: the platform starts it and stores the grant; the CLI shows the code and polls", async () => {
  const calls: string[] = [];
  let polls = 0;
  const platform = await serve(async (req, res) => {
    res.setHeader("content-type", "application/json");
    calls.push(`${req.method} ${req.url}`);
    if (req.url === "/api/oauth/device" && req.method === "POST") { await readBody(req); res.end(JSON.stringify({ id: "a".repeat(48), user_code: "QWER-TY12", verification_uri: "https://p.example/device", expires_in: 600, interval: 5 })); return; }
    if (req.url === `/api/oauth/device/${"a".repeat(48)}`) { polls++; res.end(JSON.stringify(polls < 2 ? { status: "pending" } : { status: "connected", name: "TV", stored: "oauth2" })); return; }
    if (req.url === "/api/oauth/connections") { res.end(JSON.stringify({ connections: [] })); return; }
    res.statusCode = 404; res.end("{}");
  });
  const child = spawn(process.execPath, [CLI, "connect", "TV", "--client", "kc", "--device", "--scopes", "openid", "--url", platform.url, "--token", "ptok"], { cwd: ROOT, env: { ...process.env, FOLDRUN_DATA: undefined, NO_COLOR: "1", FOLDRUN_DEVICE_POLL_S: "0.05" } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const code = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? -1)));
  platform.close();
  assert.equal(code, 0, out);
  assert.match(out, /QWER-TY12/);
  assert.match(out, /TV connected/);
  assert.ok(!calls.includes("POST /api/oauth/start"), "no browser consent was started");
});
