// `foldrun code -p "…"` with --output-format json / stream-json and
// --input-format stream-json (FOL-223): a script, a CI job or another agent
// runs a turn and reads JSON from stdout; what a person would read is on
// stderr.
//
//   node --test tests/cli-code-headless.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { serve, raw } from "./fake-platform.ts";
import { streamEvent } from "../src/commands.mjs";

const ID = "c".repeat(64);
const WS = "/v1/workspaces/desk";
const CLI = path.join(import.meta.dirname, "..", "bin", "foldrun.mjs");
const KODER = path.join(import.meta.dirname, "..", "bin", "koder.mjs");

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" });

function repo(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-headless-"));
  git(d, "init", "-q");
  fs.writeFileSync(path.join(d, "hello.txt"), "hello\n");
  git(d, "add", "-A");
  git(d, "commit", "-qm", "base");
  return d;
}

const record = (id: string, reply: string, status = "completed") => ({
  id,
  flow: "adhoc:coder",
  status,
  snapshot: { id: ID },
  startedAt: "2026-11-24T01:00:00.000Z",
  finishedAt: "2026-11-24T01:00:30.000Z",
  steps: [{
    agent: "coder", group: 1, status, attempts: 1, costUsd: 0.02,
    events: [
      { type: "info", text: "step started (model: claude-sonnet-5-5)" },
      { type: "tool", text: "Read", call: "c1", io: { input: { file_path: "hello.txt" } } },
      { type: "tool", text: "Read", call: "c1", ms: 4, io: { output: "hello" } },
      { type: "text", text: reply },
    ],
    result: reply,
  }],
});

async function platform() {
  const runs: string[] = [];
  const tasks: string[] = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`PUT ${WS}/source`]: () => ({ ok: true }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 6, compressedBytes: 100, expiresAt: "2026-12-01T00:00:00.000Z", reused: false }),
    [`POST ${WS}/agents/coder/run`]: (b) => {
      tasks.push(JSON.parse(String(b)).task);
      const id = `run-h-${runs.length + 1}`;
      runs.push(id);
      return { ok: true, runId: id, test: false, snapshot: ID };
    },
    [`GET ${WS}/runs/run-h-1`]: () => record("run-h-1", "First reply."),
    [`GET ${WS}/runs/run-h-2`]: () => record("run-h-2", "Second reply."),
    [`GET ${WS}/runs/run-h-1/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "unchanged", bytes: 0, modified: [], added: [], deleted: [] }), "application/json") : raw("", "text/x-diff")),
    [`GET ${WS}/runs/run-h-2/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "unchanged", bytes: 0, modified: [], added: [], deleted: [] }), "application/json") : raw("", "text/x-diff")),
  });
  return { s, tasks };
}

/** stdout and stderr apart: stdout must be JSON only. */
function run(url: string, args: string[], input = "", bin = CLI): Promise<{ out: string; err: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args, "--url", url, "--token", "k"], {
      env: { ...process.env, FOLDRUN_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-")), FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1", FOLDRUN_NO_AUTO_UPDATE: "1" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.stdin.end(input);
    child.on("close", (code) => resolve({ out, err, code: code ?? 1 }));
  });
}

const lines = (out: string) => out.trim().split("\n").map((l) => JSON.parse(l));

test("-p with --output-format json: one result object on stdout, the person's lines on stderr", async () => {
  const d = repo();
  const { s, tasks } = await platform();
  const r = await run(s.url, ["code", d, "--to", "desk", "-p", "read hello", "--output-format", "json"]);
  s.close();
  assert.equal(r.code, 0, r.err);
  const all = lines(r.out);
  assert.equal(all.length, 1, r.out);
  const res = all[0];
  assert.equal(res.type, "result");
  assert.equal(res.schema, 1);
  assert.equal(res.status, "completed");
  assert.equal(res.is_error, false);
  assert.equal(res.result, "First reply.");
  assert.match(res.session_id, /^code-[0-9a-f]{16}$/);
  assert.equal(res.run_id, "run-h-1");
  assert.equal(res.cost_usd, 0.02);
  assert.equal(res.applied, false);
  assert.deepEqual(tasks, ["read hello"], "-p is the task");
  assert.match(r.err, /foldrun code/, "the header went to stderr");
});

test("--output-format stream-json: init, the agent's calls and words as they happen, then the result — every stdout line is JSON", async () => {
  const d = repo();
  const { s } = await platform();
  const r = await run(s.url, ["code", d, "--to", "desk", "--task", "read hello", "--output-format", "stream-json"]);
  s.close();
  assert.equal(r.code, 0, r.err);
  const all = lines(r.out);
  assert.deepEqual(all.map((e) => e.type), ["system", "tool_call", "tool_result", "message", "result"], r.out);
  assert.equal(all[0].subtype, "init");
  assert.equal(all[0].session_id, all.at(-1).session_id);
  assert.deepEqual(all[1].input, { file_path: "hello.txt" });
  assert.equal(all[2].ms, 4);
  assert.equal(all[3].text, "First reply.");
  assert.ok(!all.some((e) => /step started/.test(JSON.stringify(e))), "the platform's notes stay out");
});

test("--input-format stream-json: each line on stdin is a turn of one session", async () => {
  const d = repo();
  const { s, tasks } = await platform();
  const input = `${JSON.stringify({ type: "user", text: "first" })}\n${JSON.stringify({ type: "user", message: { content: "second" } })}\n`;
  const r = await run(s.url, ["code", d, "--to", "desk", "--input-format", "stream-json", "--output-format", "json"], input);
  s.close();
  assert.equal(r.code, 0, r.err);
  const all = lines(r.out);
  assert.deepEqual(all.map((e) => e.result), ["First reply.", "Second reply."]);
  assert.equal(all[0].session_id, all[1].session_id, "one session");
  assert.equal(tasks[0], "first");
  assert.match(tasks[1]!, /second$/, "the second turn carries the message");
});

test("koder -p works the same", async () => {
  const d = repo();
  const { s } = await platform();
  const r = await run(s.url, [d, "--to", "desk", "-p", "read hello", "--output-format", "json"], "", KODER);
  s.close();
  assert.equal(r.code, 0, r.err);
  assert.equal(lines(r.out)[0].result, "First reply.");
});

test("refusals: a bad format, stdin without stream-json, a bad stdin line — the last as JSON", async () => {
  const d = repo();
  const { s } = await platform();
  const bad = await run(s.url, ["code", d, "--to", "desk", "-p", "x", "--output-format", "yaml"]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err + bad.out, /--output-format is text, json or stream-json/);
  const noTask = await run(s.url, ["code", d, "--to", "desk", "--output-format", "json"]);
  assert.notEqual(noTask.code, 0);
  assert.match(noTask.err + noTask.out, /give it with -p/);
  const both = await run(s.url, ["code", d, "--to", "desk", "-p", "x", "--input-format", "stream-json"]);
  assert.match(both.err + both.out, /leave out --task/);
  const junk = await run(s.url, ["code", d, "--to", "desk", "--input-format", "stream-json", "--output-format", "json"], "not json\n");
  s.close();
  assert.equal(junk.code, 1);
  const res = lines(junk.out)[0];
  assert.equal(res.is_error, true);
  assert.match(res.error, /stdin line 1 is not JSON/);
});

test("streamEvent: one shape per event, nothing for a platform note", () => {
  assert.equal(streamEvent({ type: "info", text: "clock" }, { agent: "coder" }), null);
  assert.deepEqual(streamEvent({ type: "text", text: "hi" }, { agent: "coder" }), { type: "message", agent: "coder", text: "hi" });
  assert.deepEqual(streamEvent({ type: "tool", text: "Bash", call: 1, ms: 3, error: true }, { agent: "w", subagentOf: 0 }), { type: "tool_result", agent: "w", subagent: true, call: "1", tool: "Bash", ms: 3, error: true });
});
