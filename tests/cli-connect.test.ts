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
    if (req.url === "/api/secrets" && req.method === "POST") {
      stored.push({ auth: req.headers.authorization, body: JSON.parse(await readBody(req)) });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    } else { res.statusCode = 404; res.end("{}"); }
  });
  try {
    const r = await runConnect(
      ["LI_TOKEN", "--authorize-url", `${provider.url}/authorize`, "--token-url", `${provider.url}/token`,
       "--scopes", "a b", "--port", "48131", "--client-id", "cid", "--client-secret", "csec",
       "--url", platform.url, "--token", "ptok", "--to", "desk", "--no-browser"],
      {},
    );
    assert.equal(r.status, 0, r.out);
    assert.equal(r.authorize.searchParams.get("scope"), "a b", "scopes are one space-separated string");
    assert.equal(r.authorize.searchParams.get("redirect_uri"), "http://localhost:48131/callback");
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
       "--port", "48132", "--client-id", "cid", "--client-secret", "csec", "--local", "--no-browser"],
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
