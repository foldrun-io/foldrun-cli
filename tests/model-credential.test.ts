// Which credential `foldrun run` really calls the model with. The CLI used
// to insist on ANTHROPIC_API_KEY and then never hand it to the step: the
// host allowlist dropped it, and Claude Code ran on the machine's own
// claude.ai login. Here the model is a local fake of the Messages API that
// records the auth header each call carried — no network, no cost.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const CLI = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
// Needs a core that resolves the credential (model-credential.ts). The
// release job tests against the published @foldrun/core, which may predate it.
const core = await import("@foldrun/core").catch(() => null);
const skip = typeof (core as { resolveModelCredential?: unknown } | null)?.resolveModelCredential === "function"
  ? false
  : "the installed @foldrun/core predates model credentials — needs the core release after 0.5.0";

function fakeMessagesApi() {
  const seen: { apiKey: string | null; bearer: string | null }[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (!req.url?.startsWith("/v1/messages")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end("{}");
      }
      if (req.url.includes("count_tokens")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ input_tokens: 1 }));
      }
      const auth = String(req.headers.authorization ?? "");
      seen.push({ apiKey: (req.headers["x-api-key"] as string) ?? null, bearer: auth.startsWith("Bearer ") ? auth.slice(7) : null });
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "done" } });
      ev("content_block_stop", { index: 0 });
      ev("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } });
      ev("message_stop", {});
      res.end();
    });
  });
  return new Promise<{ url: string; seen: typeof seen; close: () => void }>((ok) =>
    server.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, seen, close: () => server.close() })),
  );
}

function workspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cred-"));
  fs.mkdirSync(path.join(ws, "agents/a"), { recursive: true });
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
  fs.writeFileSync(path.join(ws, "agents/a/agent.md"), "---\nname: a\ndescription: says done\nmodel: fast\n---\n\nSay done.\n");
  return ws;
}

function run(ws: string, env: Record<string, string>): Promise<{ status: number | null; out: string }> {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL"].includes(k)));
  return new Promise((ok) => {
    const child = spawn(process.execPath, [CLI, "run", "a", "--workspace", ws], {
      env: { ...base, FOLDRUN_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cred-data-")), FOLDRUN_EXECUTOR: "sandbox", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (status) => ok({ status, out }));
  });
}

const recordOf = (ws: string) => {
  const runs = path.join(ws, "runs");
  const file = fs.readdirSync(runs).find((f) => f.endsWith(".json"))!;
  return JSON.parse(fs.readFileSync(path.join(runs, file), "utf8"));
};

for (const [name, env, expect] of [
  ["an API key", { ANTHROPIC_API_KEY: "sk-ant-api-TEST" }, { apiKey: "sk-ant-api-TEST", bearer: null, label: "API key (ANTHROPIC_API_KEY)" }],
  ["a Claude login token", { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-TEST" }, { apiKey: null, bearer: "sk-ant-oat-TEST", label: "Claude login token (CLAUDE_CODE_OAUTH_TOKEN)" }],
] as const) {
  test(`foldrun run calls the model with ${name}, and the run says so`, { timeout: 180_000, skip }, async () => {
    const api = await fakeMessagesApi();
    const ws = workspace();
    try {
      const r = await run(ws, { ...env, ANTHROPIC_BASE_URL: api.url });
      assert.equal(r.status, 0, r.out);
      assert.ok(api.seen.length > 0, `the model was never called:\n${r.out}`);
      for (const call of api.seen) {
        assert.equal(call.apiKey, expect.apiKey, "x-api-key on the model call");
        assert.equal(call.bearer, expect.bearer, "bearer on the model call");
      }
      assert.match(r.out, new RegExp(`model credential: ${expect.label.replace(/[()]/g, "\\$&")}`));
      assert.equal(recordOf(ws).steps[0].credential, expect.label);
    } finally {
      api.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
}
