// The HTTP client every remote command shares, pinned through the real
// binary: what a person sees when the platform is down, slow, behind a
// challenge page, or mid-deploy. "fetch failed" and "HTTP 403" were the
// whole message for each of those, and each sent the reader somewhere wrong.
//
//   node --test tests/cli-remote.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders }[];

/** A server that runs the handler, and remembers every request it saw. */
function serve(handler: (req: http.IncomingMessage, res: http.ServerResponse, n: number) => void) {
  const seen: Seen = [];
  return new Promise<{ url: string; seen: Seen; close: () => void }>((resolve) => {
    const server = http.createServer((req, res) => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers });
      handler(req, res, seen.length);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        close: () => {
          server.closeAllConnections();
          server.close();
        },
      });
    });
  });
}

const me = JSON.stringify({ account: "acme", role: "admin", workspaces: null, actor: { kind: "user", id: "u", email: "a@acme.test" } });

// Awaited, never spawnSync — the fake server answers from this process.
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

test("a refused connection says so, with the cause, not \"fetch failed\"", async () => {
  // A port that was listening a moment ago: nothing there now, and fetch
  // does not refuse it up front the way it does the well-known ones.
  const gone = await serve(() => {});
  gone.close();
  const r = await run(["whoami", "--url", gone.url, "--token", "k"]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, new RegExp(`could not reach ${gone.url.replace(/[.]/g, "\\.")}`));
  assert.match(r.out, /ECONNREFUSED/, "the cause chain is printed, not the top message alone");
});

test("a platform that accepts and never answers is given up on after FOLDRUN_TIMEOUT", async () => {
  const p = await serve(() => {
    /* never answers */
  });
  try {
    const started = Date.now();
    const r = await run(["whoami", "--url", p.url, "--token", "k"], { FOLDRUN_TIMEOUT: "1" });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /did not answer GET \/api\/me within 1s/);
    assert.match(r.out, /FOLDRUN_TIMEOUT/, "and says how to allow longer");
    assert.ok(Date.now() - started < 10_000, "it did not wait for the kernel");
  } finally {
    p.close();
  }
});

test("a GET that meets 503 is asked once more after Retry-After, and carries the CLI's User-Agent", async () => {
  const p = await serve((req, res, n) => {
    res.setHeader("content-type", "application/json");
    if (n === 1) {
      res.setHeader("retry-after", "0");
      res.writeHead(503);
      res.end(JSON.stringify({ error: "deploying" }));
      return;
    }
    res.end(me);
  });
  try {
    const r = await run(["whoami", "--url", p.url, "--token", "k"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /account\s+acme/);
    assert.equal(p.seen.length, 2, "one retry, no more");
    assert.match(String(p.seen[0].headers["user-agent"]), /^foldrun-cli\/\d+\.\d+\.\d+/);
  } finally {
    p.close();
  }
});

test("a POST is never retried — a second one could be a second run", async () => {
  const p = await serve((req, res) => {
    res.setHeader("content-type", "application/json");
    res.writeHead(503);
    res.end(JSON.stringify({ error: "deploying" }));
  });
  try {
    const r = await run(["keys", "create", "ci", "--url", p.url, "--token", "k"]);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /deploying/);
    assert.equal(p.seen.filter((s) => s.method === "POST").length, 1);
  } finally {
    p.close();
  }
});

test("a challenge page is reported as what it is: the status, the type and its first line", async () => {
  const p = await serve((req, res) => {
    res.setHeader("content-type", "text/html; charset=UTF-8");
    res.writeHead(403);
    res.end("<!DOCTYPE html>\n<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>");
  });
  try {
    const r = await run(["whoami", "--url", p.url, "--token", "k"]);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /HTTP 403 \(text\/html\): Just a moment\.\.\./);
    assert.doesNotMatch(r.out, /→ HTTP 403\n/, "not the bare status any more");
  } finally {
    p.close();
  }
});
