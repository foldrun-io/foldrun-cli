// `foldrun mcp` (1 Nov 2026): an MCP server on stdio that forwards each
// JSON-RPC line to the platform's POST /api/mcp with this machine's sign-in.
// Against a fake platform: what is sent (path, key, revision header,
// read-only), what comes back on stdout (protocol only, one line each, the
// request's id on a refusal), and what is never forwarded.
//
//   node --test tests/cli-mcp.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { serve, failing, raw } from "./fake-platform.ts";

const CLI = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");

/** The binary as an AI app runs it: lines in on stdin, then stdin closed. */
function mcp(url: string, lines: string[], extra: string[] = []): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, "mcp", "--url", url, "--token", "k", ...extra], {
      env: { ...process.env, FOLDRUN_HOME: "/nonexistent/foldrun-home", FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    child.stdin.end(lines.map((l) => `${l}\n`).join(""));
  });
}
const out = (s: string) => s.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

/** A platform that answers like /api/mcp: the method echoed back as the result. */
function platform() {
  return serve({
    "POST /api/mcp": (body) => {
      const m = JSON.parse(body);
      if (m.id === undefined) return failing(202, {});
      if (m.method === "initialize") return { jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "foldrun", version: "test" } } };
      return { jsonrpc: "2.0", id: m.id, result: { echoed: m.method, params: m.params ?? null } };
    },
  });
}

test("each line goes to POST /api/mcp with the key, and each answer comes back as one line", async () => {
  const s = await platform();
  try {
    const r = await mcp(s.url, [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "inbox", arguments: {} } }),
    ]);
    assert.equal(r.code, 0, r.stderr);
    const answers = out(r.stdout);
    assert.equal(answers.length, 2, "the notification is answered with nothing");
    assert.deepEqual(answers.map((a) => a.id).sort(), [1, 2]);
    assert.equal(answers.find((a) => a.id === 2).result.echoed, "tools/call");
    assert.match(r.stderr, /acting with --token/, "notes go to stderr, never stdout");

    assert.equal(s.seen.length, 3);
    for (const seen of s.seen) {
      assert.equal(seen.url, "/api/mcp");
      assert.equal(seen.method, "POST");
      assert.equal(seen.headers.authorization, "Bearer k");
      assert.ok(seen.headers["foldrun-version"], "the API version this CLI was written against");
    }
    assert.equal(s.seen[0].headers["mcp-protocol-version"], undefined, "initialize goes before a revision is agreed");
    assert.equal(s.seen[2].headers["mcp-protocol-version"], "2025-06-18", "later calls carry the revision initialize agreed");
    assert.equal(s.seen[0].query.get("readonly"), null);
  } finally {
    s.close();
  }
});

test("--read-only asks the platform for the read tools only", async () => {
  const s = await platform();
  try {
    await mcp(s.url, [JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })], ["--read-only"]);
    assert.equal(s.seen[0].query.get("readonly"), "1");
  } finally {
    s.close();
  }
});

test("a line that is not JSON is answered -32700 and never sent", async () => {
  const s = await platform();
  try {
    const r = await mcp(s.url, ["{nope", JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" })]);
    const answers = out(r.stdout);
    assert.equal(answers.find((a) => a.id === null).error.code, -32700);
    assert.equal(answers.find((a) => a.id === 7).result.echoed, "ping");
    assert.equal(s.seen.length, 1);
  } finally {
    s.close();
  }
});

test("a refusal before the message was read comes back with the request's id", async () => {
  const s = await serve({ "POST /api/mcp": () => failing(401, { jsonrpc: "2.0", id: null, error: { code: -32603, message: "invalid API key" } }) });
  try {
    const r = await mcp(s.url, [JSON.stringify({ jsonrpc: "2.0", id: "a", method: "tools/list" })]);
    const [answer] = out(r.stdout);
    assert.equal(answer.id, "a");
    assert.match(answer.error.message, /^invalid API key — /, "with how to sign in again");
  } finally {
    s.close();
  }
});

test("a platform with no MCP endpoint, or a proxy's page, is a JSON-RPC error — never a stray line", async () => {
  const old = await serve({}); // every path: 404 { error: "run not found" }
  try {
    const r = await mcp(old.url, [JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })]);
    const [answer] = out(r.stdout);
    assert.equal(answer.id, 1);
    assert.match(answer.error.message, /has no MCP endpoint/);
  } finally {
    old.close();
  }
  const proxy = await serve({ "POST /api/mcp": () => raw("<html><title>Bad gateway</title></html>", "text/html", {}, 502) });
  try {
    const r = await mcp(proxy.url, [JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })]);
    const [answer] = out(r.stdout);
    assert.equal(answer.error.code, -32603);
    assert.match(r.stderr, /HTTP 502/);
  } finally {
    proxy.close();
  }
});

test("it takes no arguments", async () => {
  const s = await platform();
  try {
    const r = await mcp(s.url, [], ["extra"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /takes no arguments/);
    assert.equal(r.stdout, "");
  } finally {
    s.close();
  }
});

test("a sign-in renewed while the app keeps the server running is used from the next message on", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const s = await platform();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-mcp-home-"));
  const write = (token: string) =>
    fs.writeFileSync(path.join(home, "credentials.json"), JSON.stringify({ current: "acme", profiles: { acme: { url: s.url, token, account: "acme" } } }));
  write("old-key");
  try {
    const child = spawn(process.execPath, [CLI, "mcp"], { env: { ...process.env, FOLDRUN_HOME: home, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1" } });
    let stdout = "";
    const answered = (n: number) =>
      new Promise<void>((resolve) => {
        const check = () => (stdout.trim().split("\n").filter(Boolean).length >= n ? resolve() : setTimeout(check, 20));
        check();
      });
    child.stdout.on("data", (d) => (stdout += d));
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`);
    await answered(1);
    write("renewed-key"); // what another command's renewal leaves behind
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n`);
    await answered(2);
    child.stdin.end();
    await new Promise((r) => child.on("close", r));
    assert.deepEqual(s.seen.map((x) => x.headers.authorization), ["Bearer old-key", "Bearer renewed-key"]);
  } finally {
    s.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the account is pinned at start: switching profiles elsewhere does not move a running session", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const a = await platform();
  const b = await platform();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-mcp-pin-"));
  const write = (current: string) =>
    fs.writeFileSync(
      path.join(home, "credentials.json"),
      JSON.stringify({ current, profiles: { acme: { url: a.url, token: "acme-key", account: "acme" }, beta: { url: b.url, token: "beta-key", account: "beta" } } }),
    );
  write("acme");
  try {
    const child = spawn(process.execPath, [CLI, "mcp"], { env: { ...process.env, FOLDRUN_HOME: home, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1" } });
    let stdout = "";
    const answered = (n: number) =>
      new Promise<void>((resolve) => {
        const check = () => (stdout.trim().split("\n").filter(Boolean).length >= n ? resolve() : setTimeout(check, 20));
        check();
      });
    child.stdout.on("data", (d) => (stdout += d));
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`);
    await answered(1);
    write("beta"); // `foldrun use beta` in another terminal
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n`);
    await answered(2);
    child.stdin.end();
    await new Promise((r) => child.on("close", r));
    assert.deepEqual(a.seen.map((x) => x.headers.authorization), ["Bearer acme-key", "Bearer acme-key"]);
    assert.equal(b.seen.length, 0, "beta's platform never hears from it, and never gets acme's key");
  } finally {
    a.close();
    b.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
