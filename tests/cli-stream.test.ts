// Following a run on a platform: the stream `invoke --watch` and `logs
// --follow` read. A stalled stream held the terminal for as long as the
// socket lived; now it is reconnected while the run is live and given up
// on, with a message, when it keeps going quiet. And a refused key says
// which account was sent.
//
//   node --test tests/cli-stream.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");

const runRecord = (status: string, n: number) => ({
  id: "r1",
  flow: "daily",
  status,
  steps: [{ agent: "writer", costUsd: 0.01, events: Array.from({ length: n }, (_, i) => ({ type: "text", text: `line ${i + 1}` })) }],
});

/**
 * A platform whose stream behaves as `streams` says, one entry per
 * connection: "stall" sends one run frame and then nothing; "finish"
 * sends a frame and `done`. The run itself is live until `liveFor`
 * polls have been answered.
 */
function fakePlatform(streams: ("stall" | "finish")[], { liveFor = Infinity, refuse = false } = {}) {
  let connections = 0;
  let polls = 0;
  const sockets = new Set<import("node:stream").Duplex>();
  return new Promise<{ url: string; connections: () => number; close: () => void }>((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url ?? "";
      if (refuse) {
        res.setHeader("content-type", "application/json");
        res.writeHead(403);
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
      if (req.method === "POST" && url.startsWith("/api/workspaces/ws/flows/daily/run")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ runId: "r1" }));
        return;
      }
      if (url === "/api/workspaces/ws/runs/r1/stream") {
        const mode = streams[connections++] ?? "stall";
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: run\ndata: ${JSON.stringify(runRecord(mode === "finish" ? "completed" : "running", connections))}\n\n`);
        if (mode === "finish") res.end("event: done\ndata: {}\n\n");
        return;
      }
      if (url === "/api/workspaces/ws/runs/r1") {
        polls++;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(runRecord(polls > liveFor ? "completed" : "running", connections)));
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
    server.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${port}`,
        connections: () => connections,
        close: () => {
          for (const s of sockets) s.destroy();
          server.close();
        },
      });
    });
  });
}

// Awaited, never spawnSync — the fake platform answers from this process.
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

// FOLDRUN_TIMEOUT=0.25 makes the stream's idle clock one second.
const QUICK = { FOLDRUN_TIMEOUT: "0.25" };

test("a stream that goes quiet is reconnected, and the lines already printed are not printed again", async () => {
  const p = await fakePlatform(["stall", "finish"]);
  try {
    const r = await run(["invoke", "daily", "--to", "ws", "--watch", "--url", p.url, "--token", "k"], QUICK);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /went quiet for 1s; reconnecting \(1\/3\)/);
    assert.equal(p.connections(), 2);
    assert.equal((r.out.match(/line 1$/gm) ?? []).length, 1, "the first line is printed once across both connections");
    assert.match(r.out, /✓.*completed/);
  } finally {
    p.close();
  }
});

test("a stream that keeps going quiet while the run is live is given up on, with where to look", async () => {
  const p = await fakePlatform(["stall", "stall", "stall"]);
  try {
    const started = Date.now();
    const r = await run(["invoke", "daily", "--to", "ws", "--watch", "--url", p.url, "--token", "k"], QUICK);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /went quiet for 1s three times while r1 is still running/);
    assert.match(r.out, /foldrun logs r1 --to ws --follow/);
    assert.equal(p.connections(), 3);
    assert.ok(Date.now() - started < 15_000, "it did not wait on the socket");
  } finally {
    p.close();
  }
});

test("a run that finished while the stream was quiet is reported from the record, not waited on", async () => {
  const p = await fakePlatform(["stall"], { liveFor: 0 });
  try {
    const r = await run(["invoke", "daily", "--to", "ws", "--watch", "--url", p.url, "--token", "k"], QUICK);
    assert.equal(r.code, 0, r.out);
    assert.equal(p.connections(), 1, "no reconnect for a run that is over");
    assert.match(r.out, /✓.*completed/);
  } finally {
    p.close();
  }
});

test("a refused key on logs --url and invoke --watch names the account that was sent", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const p = await fakePlatform([], { refuse: true });
  try {
    fs.writeFileSync(
      path.join(home, "credentials.json"),
      JSON.stringify({ current: "acme", profiles: { acme: { url: p.url, token: "k", account: "acme", role: "viewer", email: "a@acme.test" } } }),
    );
    const refused = await run(["logs", "--to", "ws", "--url", p.url], { FOLDRUN_HOME: home });
    assert.notEqual(refused.code, 0);
    assert.match(refused.out, /forbidden — acting as acme {2}acme · viewer · a@acme\.test/);
    assert.match(refused.out, /--profile <name> picks one/);
    const watched = await run(["invoke", "daily", "--to", "ws", "--watch", "--url", p.url], { FOLDRUN_HOME: home });
    assert.notEqual(watched.code, 0);
    assert.match(watched.out, /forbidden — acting as acme/);
  } finally {
    p.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
