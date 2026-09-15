// `foldrun doctor` — one line per thing that can be wrong between this
// terminal and a platform. Pinned through the real binary against a fake
// one: the lines, the ✓/✗, the exit code, and that no key is ever printed.
//
//   node --test tests/cli-doctor.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");

function serve(handler: http.RequestListener) {
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

function run(args: string[], extraEnv: Record<string, string> = {}): Promise<{ out: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, FOLDRUN_HOME: "/nonexistent/foldrun-home", FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1", ...extraEnv },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ out, code: code ?? 1 }));
  });
}

test("doctor: every line ✓ against a healthy platform, and the key is shown as a prefix only", async () => {
  const p = await serve((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/healthz") {
      res.end(JSON.stringify({ ok: true, version: "0.9.1", role: "web" }));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  fs.writeFileSync(
    path.join(home, "credentials.json"),
    JSON.stringify({ current: "acme", profiles: { acme: { url: p.url, token: "fr_secretsecretsecret", account: "acme", role: "admin", email: "a@acme.test" } } }),
  );
  try {
    const r = await run(["doctor"], { FOLDRUN_HOME: home, FOLDRUN_TIMEOUT: "5" });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /✓ node\s+v\d+/);
    assert.match(r.out, /✓ cli\s+foldrun \d+\.\d+\.\d+/);
    assert.match(r.out, /✓ core\s+@foldrun\/core \d+\.\d+\.\d+/);
    assert.match(r.out, /✓ env\s+.*FOLDRUN_TIMEOUT set/);
    assert.match(r.out, /✓ account\s+acme\s+acme · admin · a@acme\.test · key fr_secre…/);
    assert.doesNotMatch(r.out, /secretsecret/, "the key itself is never printed");
    assert.match(r.out, /✓ dns\s+127\.0\.0\.1 is an address/);
    assert.match(r.out, /✓ healthz\s+GET \/api\/healthz 200 in \d+ ms · version 0\.9\.1 · role web/);
    assert.doesNotMatch(r.out, /✗/);
  } finally {
    p.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("doctor: a platform that is down is one ✗ line with the cause, and exit 1", async () => {
  const gone = await serve(() => {});
  gone.close();
  const r = await run(["doctor", "--url", gone.url, "--token", "k"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /✓ account\s+--token k…/);
  assert.match(r.out, /✗ healthz\s+could not reach .*ECONNREFUSED/);
});

test("doctor: not signed in and no platform named is said in the account line, and exit 1", async () => {
  const r = await run(["doctor"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /✗ account\s+not signed in/);
  assert.match(r.out, /✗ healthz\s+no platform/);
  assert.match((await run(["--help"])).out, /foldrun doctor/, "and it is in --help");
});
