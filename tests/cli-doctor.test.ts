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
    if (req.url === "/v1/healthz") {
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
    assert.match(r.out, /✓ healthz\s+GET \/v1\/healthz 200 in \d+ ms · version 0\.9\.1 · role web/);
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

// FOL-402: the road test — a small and a big download and a big upload of
// /v1/network/bytes on the profile's address and on each front its
// /v1/version names; "consistent with Iran's filter" only when the small one
// passes and a big one stalls on one address while another completes.
function bytesServer(opts: { freezeBig?: boolean; fronts?: string[]; notice?: unknown }) {
  return serve(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/v1/healthz") return void res.end(JSON.stringify({ ok: true }));
    if (u.pathname === "/v1/version") {
      res.setHeader("content-type", "application/json");
      return void res.end(JSON.stringify({ urls: { api: null, ...(opts.fronts ? { fronts: opts.fronts } : {}) }, ...(opts.notice ? { notice: opts.notice } : {}) }));
    }
    if (u.pathname === "/v1/network/bytes" && req.method === "GET") {
      const size = Number(u.searchParams.get("size") ?? 65536);
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(size) });
      if (opts.freezeBig && size > 20000) return void res.write(Buffer.alloc(16384)); // then nothing: frozen
      return void res.end(Buffer.alloc(size, 7));
    }
    if (u.pathname === "/v1/network/bytes" && req.method === "POST") {
      let n = 0;
      for await (const c of req) {
        n += (c as Buffer).length;
        if (opts.freezeBig && n > 20000) return; // swallowed: frozen
      }
      res.setHeader("content-type", "application/json");
      return void res.end(JSON.stringify({ received: n }));
    }
    res.writeHead(404);
    res.end("{}");
  });
}

test("doctor: the road test passes on a whole road, and a platform without the route is said, not failed", async () => {
  const p = await bytesServer({ notice: { id: "abc", message: "Iran's filter blocked our old address", action: "run_doctor", command: "foldrun doctor" } });
  try {
    const r = await run(["doctor", "--url", p.url, "--token", "k"], { FOLDRUN_TIMEOUT: "5" });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /✓ road\s+127\.0\.0\.1:\d+ · 1 KiB down \d+ ms · 64 KiB down \d+ ms · 64 KiB up \d+ ms/);
    assert.match(r.out, /! notice\s+Iran's filter blocked our old address — run `foldrun doctor`/);
    assert.doesNotMatch(r.out, /Iran's filter:/);
  } finally {
    p.close();
  }
  const old = await serve((req, res) => {
    if (req.url === "/v1/healthz") return void res.end("{}");
    res.writeHead(404);
    res.end("{}");
  });
  try {
    const r = await run(["doctor", "--url", old.url, "--token", "k"], { FOLDRUN_TIMEOUT: "5" });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /· road\s+.* has no road test/);
  } finally {
    old.close();
  }
});

test("doctor: big calls freezing on the main address while the named front completes reads as Iran's filter", async () => {
  const front = await bytesServer({});
  const main = await bytesServer({ freezeBig: true, fronts: [front.url] });
  try {
    const r = await run(["doctor", "--url", main.url, "--token", "k"], { FOLDRUN_TIMEOUT: "5", FOLDRUN_PROBE_IDLE_SECONDS: "1" });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /✗ road\s+127\.0\.0\.1:\d+ · 1 KiB down \d+ ms · 64 KiB down stalled at body, 16384 bytes/);
    assert.match(r.out, /✓ road\s+127\.0\.0\.1:\d+ · 1 KiB down/);
    assert.match(r.out, /consistent with Iran's filter: small calls pass but big ones stall at 127\.0\.0\.1:\d+, while 127\.0\.0\.1:\d+ completes/);
  } finally {
    main.close();
    front.close();
  }
});
