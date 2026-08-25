// The credential types beyond a static value and user-consent OAuth:
// machine-to-machine OAuth, signed service accounts, and file secrets.
//
//   node --test tests/secret-types.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import {
  setSecret,
  setServiceAccountSecret,
  setFileSecret,
  resolveSecrets,
  materializeSecrets,
  listSecrets,
  isFileValue,
  fileContent,
} from "../packages/core/src/secrets.ts";
import { setOAuth2Secret } from "../packages/core/src/secrets.ts";
import { materializeFileSecrets, cleanupFileSecrets } from "../packages/core/src/secret-files.ts";

function withVault(body: () => void | Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdagent-types-"));
  const prev = process.env.MDAGENT_DATA;
  process.env.MDAGENT_DATA = root;
  const done = () => {
    if (prev === undefined) delete process.env.MDAGENT_DATA;
    else process.env.MDAGENT_DATA = prev;
    fs.rmSync(root, { recursive: true, force: true });
  };
  try {
    fs.mkdirSync(path.join(root, "acme/workspaces/desk"), { recursive: true });
    const out = body();
    if (out && typeof (out as Promise<void>).then === "function") return (out as Promise<void>).finally(done);
    done();
  } catch (e) {
    done();
    throw e;
  }
}

test("machine-to-machine OAuth: no refresh token, client_credentials exchange", () =>
  withVault(async () => {
    let grant = "";
    const server = http.createServer((req, res) => {
      let b = ""; req.on("data", (c) => (b += c));
      req.on("end", () => {
        grant = new URLSearchParams(b).get("grant_type") ?? "";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "m2m-token", expires_in: 3600 }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      setOAuth2Secret("acme", "API", {
        token_url: `http://127.0.0.1:${port}/token`,
        client_id: "cid", client_secret: "shh",
        grant_type: "client_credentials",
      });
      const { env } = resolveSecrets("acme", ["API"]);
      const live = await materializeSecrets(env);
      assert.equal(live.API, "m2m-token");
      assert.equal(grant, "client_credentials");
    } finally { server.close(); }
  }));

test("service account: a signed JWT is exchanged for a token", () =>
  withVault(async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    let sawAssertion = false;
    const server = http.createServer((req, res) => {
      let b = ""; req.on("data", (c) => (b += c));
      req.on("end", () => {
        const form = new URLSearchParams(b);
        sawAssertion = form.get("grant_type") === "urn:ietf:params:oauth:grant-type:jwt-bearer" && !!form.get("assertion");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "sa-token", expires_in: 3600 }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      setServiceAccountSecret("acme", "GCP", {
        token_url: `http://127.0.0.1:${port}/token`,
        issuer: "svc@project.iam.gserviceaccount.com",
        private_key: pem,
        scope: "https://www.googleapis.com/auth/cloud-platform",
      });
      assert.equal(listSecrets("acme").find((s) => s.name === "GCP")?.kind, "service-account");
      const { env } = resolveSecrets("acme", ["GCP"]);
      const live = await materializeSecrets(env);
      assert.equal(live.GCP, "sa-token");
      assert.ok(sawAssertion, "the JWT assertion reached the token endpoint");
    } finally { server.close(); }
  }));

test("service account: a non-PEM key is refused on save", () =>
  withVault(() => {
    assert.throws(
      () => setServiceAccountSecret("acme", "GCP", { token_url: "https://x/t", issuer: "a@b", private_key: "not a key", scope: "s" }),
      /PEM/,
    );
  }));

test("file secret: content stored, materialised to a 0600 path, blocked from env", () =>
  withVault(() => {
    setFileSecret("acme", "SSH_KEY", "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n");
    assert.equal(listSecrets("acme").find((s) => s.name === "SSH_KEY")?.kind, "file");
    const { env } = resolveSecrets("acme", ["SSH_KEY"]);
    assert.ok(isFileValue(env.SSH_KEY), "still a @file marker before materialisation");
    assert.match(fileContent(env.SSH_KEY), /BEGIN OPENSSH/);

    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-"));
    try {
      const { env: mat, dir } = materializeFileSecrets(agentDir, env);
      assert.ok(fs.existsSync(mat.SSH_KEY), "the env var now points at a real file");
      assert.match(fs.readFileSync(mat.SSH_KEY, "utf8"), /BEGIN OPENSSH/);
      assert.equal(fs.statSync(mat.SSH_KEY).mode & 0o777, 0o600, "0600, or ssh refuses it");
      cleanupFileSecrets(dir);
      assert.ok(!fs.existsSync(mat.SSH_KEY), "gone after cleanup");
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  }));

test("materialising files leaves non-file secrets untouched", () =>
  withVault(() => {
    setSecret("acme", "PLAIN", "value");
    setFileSecret("acme", "CERT", "cert-bytes");
    const { env } = resolveSecrets("acme", ["PLAIN", "CERT"]);
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-"));
    try {
      const { env: mat } = materializeFileSecrets(agentDir, env);
      assert.equal(mat.PLAIN, "value");
      assert.match(mat.CERT, new RegExp(agentDir.replace(/[.\\]/g, "\\$&")));
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  }));
