// `foldrun secrets workspaces NAME [workspace…] [--all]`: limit an account
// secret to selected workspaces on the platform (PATCH /api/secrets
// { name, workspaces }), open it to all again, or show the limit — against a
// fake platform, through the real binary (30 Oct 2026).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile, spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, FOLDRUN_WORKSPACE: undefined, NO_COLOR: "1" };
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-secret-ws-"));

const run = (...args: string[]) =>
  new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [CLI, ...args], { encoding: "utf8", cwd, env: ENV }, (err, stdout, stderr) =>
      resolve({ status: err && "code" in err ? Number(err.code) : 0, stdout, stderr }),
    );
  });

function fakePlatform() {
  const patches: unknown[] = [];
  let limit: string[] | null = null;
  return new Promise<{ url: string; patches: unknown[]; close: () => void }>((resolve) => {
    const server = http.createServer((req, res) => {
      const body: Buffer[] = [];
      req.on("data", (d) => body.push(d));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        const json = body.length ? JSON.parse(Buffer.concat(body).toString()) : {};
        if (req.url?.startsWith("/api/secrets") && req.method === "PUT") {
          patches.push({ put: json });
          return res.end(JSON.stringify({ ok: true, name: json.name, scope: json.workspace ? "workspace" : "account", ...(json.workspaces !== undefined ? { workspaces: json.workspaces } : {}) }));
        }
        if (req.url?.startsWith("/api/secrets") && req.method === "PATCH") {
          patches.push(json);
          limit = json.workspaces === null ? null : [...json.workspaces].sort();
          return res.end(JSON.stringify({ ok: true, name: json.name, scope: "account", workspaces: limit }));
        }
        if (req.url?.startsWith("/api/secrets")) {
          return res.end(JSON.stringify({ secrets: [{ name: "STRIPE_KEY", scope: "account", updatedAt: "2026-10-30", ...(limit ? { workspaces: limit } : {}) }] }));
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "nope" }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, patches, close: () => server.close() });
    });
  });
}

test("limits, shows and lifts an account secret's workspaces on the platform", async () => {
  const p = await fakePlatform();
  try {
    let r = await run("secrets", "workspaces", "STRIPE_KEY", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /STRIPE_KEY may be used in every workspace/);

    r = await run("secrets", "workspaces", "STRIPE_KEY", "sales", "ops,blog", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(p.patches.at(-1), { name: "STRIPE_KEY", workspaces: ["sales", "ops", "blog"] }, "no workspace scope is sent: it is an account secret");
    assert.match(r.stdout, /only in blog, ops, sales/);

    r = await run("secrets", "workspaces", "STRIPE_KEY", "--url", p.url, "--token", "k");
    assert.match(r.stdout, /only in blog, ops, sales — every other workspace finds it not set/);

    r = await run("secrets", "workspaces", "STRIPE_KEY", "--all", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(p.patches.at(-1), { name: "STRIPE_KEY", workspaces: null });
    assert.match(r.stdout, /every workspace/);

    r = await run("secrets", "workspaces", "STRIPE_KEY", "--none", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(p.patches.at(-1), { name: "STRIPE_KEY", workspaces: [] });
    assert.match(r.stdout, /may be used in no workspace/);

    r = await run("secrets", "workspaces", "STRIPE_KEY", "sales", "--all", "--url", p.url, "--token", "k");
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /one of/);
    r = await run("secrets", "workspaces", "--url", p.url, "--token", "k");
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /which secret/);
  } finally {
    p.close();
  }
});

test("secrets set --account --workspaces sends the limit with the value, in one PUT", async () => {
  const p = await fakePlatform();
  try {
    let r = await run("secrets", "set", "CRM_KEY", "--account", "--value", "v", "--workspaces", "sales,ops", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(p.patches.at(-1), { put: { name: "CRM_KEY", value: "v", workspaces: ["sales", "ops"] } });
    assert.match(r.stdout, /only for sales, ops/);
    r = await run("secrets", "set", "CRM_KEY", "--account", "--value", "v", "--none", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(p.patches.at(-1), { put: { name: "CRM_KEY", value: "v", workspaces: [] } });
    // A workspace's own secret has no list: refused before anything is sent.
    const before = p.patches.length;
    r = await run("secrets", "set", "CRM_KEY", "--value", "v", "--workspaces", "sales", "--to", "sales", "--url", p.url, "--token", "k");
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /add --account/);
    assert.equal(p.patches.length, before);
  } finally {
    p.close();
  }
});

test("--help shows the verb and its flag", () => {
  const r = spawnSync(process.execPath, [CLI, "secrets", "--help"], { encoding: "utf8", cwd, env: ENV });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /foldrun secrets workspaces NAME \[workspace…\]/);
  assert.match(r.stdout, /--all\s+secrets workspaces/);
  assert.match(r.stdout, /--none\s+secrets workspaces, secrets set/);
  assert.match(r.stdout, /--workspaces <a,b>\s+secrets set/);
});
