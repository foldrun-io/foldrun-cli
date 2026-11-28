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

/** The message as the person typed it: a session's first cloud turn is told where its folder is on the computer first (FOL-462). */
const typed = (task: string) => task.replace(/^You are working in the cloud[\s\S]*?reaches it\.\n\n/, "");


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
      tasks.push(typed(JSON.parse(String(b)).task));
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
  assert.match(r.err, /koder from foldrun\.io/, "the header went to stderr");
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

// Codex round 1 on FOL-223: what a script reading JSON must be able to count on.
async function platformWith(reply: string, status = "completed") {
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`PUT ${WS}/source`]: () => ({ ok: true }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 6, compressedBytes: 100, expiresAt: "2026-12-01T00:00:00.000Z", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => ({ ok: true, runId: "run-x-1", test: false, snapshot: ID }),
    [`GET ${WS}/runs/run-x-1`]: () => record("run-x-1", reply, status),
    [`GET ${WS}/runs/run-x-1/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "unchanged", bytes: 0, modified: [], added: [], deleted: [] }), "application/json") : raw("", "application/octet-stream")),
  });
  return s;
}

test("a big result reaches a pipe whole before the process exits (Codex: cut at 64 KiB)", async () => {
  const d = repo();
  const big = "x".repeat(1024 * 1024);
  const s = await platformWith(big);
  const r = await run(s.url, ["code", d, "--to", "desk", "-p", "go", "--output-format", "json"]);
  s.close();
  assert.equal(r.code, 0, r.err);
  const res = lines(r.out)[0];
  assert.equal(res.result.length, big.length);
});

test("a run that ends failed is a result with is_error and an error, and exits 1 (Codex)", async () => {
  const d = repo();
  const s = await platformWith("could not", "failed");
  const r = await run(s.url, ["code", d, "--to", "desk", "-p", "go", "--output-format", "json"]);
  s.close();
  assert.equal(r.code, 1);
  const res = lines(r.out)[0];
  assert.equal(res.is_error, true);
  assert.match(res.error, /ended failed/);
});

test("a failure before any turn is JSON on stdout too, and stdout holds nothing else (Codex)", async () => {
  const d = repo();
  // The project cannot be read: setup fails before a turn.
  const s = await serve({ [`GET ${WS}`]: () => raw(JSON.stringify({ error: "no such project" }), "application/json", {}, 404) });
  const r = await run(s.url, ["code", d, "--to", "desk", "-p", "go", "--output-format", "json"]);
  s.close();
  assert.equal(r.code, 1, r.out + r.err);
  const all = lines(r.out);
  assert.equal(all.length, 1, r.out);
  assert.equal(all[0].type, "result");
  assert.equal(all[0].is_error, true);
  assert.ok(all[0].error, "says why");
});

test("--input-format stream-json takes each message as it comes: a client may wait for a result before sending the next (Codex)", async () => {
  const d = repo();
  const { s, tasks } = await platform();
  const child = spawn(process.execPath, [CLI, "code", d, "--to", "desk", "--input-format", "stream-json", "--output-format", "json", "--url", s.url, "--token", "k"], {
    env: { ...process.env, FOLDRUN_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-")), FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1", FOLDRUN_NO_AUTO_UPDATE: "1" },
  });
  let out = "";
  let err = "";
  child.stderr.on("data", (x) => (err += x));
  child.stdout.on("data", (x) => (out += x));
  const got = async (n: number) => {
    const until = Date.now() + 20_000;
    while (out.trim().split("\n").filter(Boolean).length < n) {
      if (Date.now() > until) throw new Error(`no result ${n} in 20 s: ${out} ${err}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  child.stdin.write(`${JSON.stringify({ type: "user", text: "first" })}\n`);
  await got(1);
  assert.equal(lines(out)[0].result, "First reply.");
  child.stdin.write(`${JSON.stringify({ type: "user", text: "second" })}\n`);
  await got(2);
  child.stdin.end();
  const code = await new Promise<number>((resolve) => child.on("close", (c) => resolve(c ?? 1)));
  s.close();
  assert.equal(code, 0, err);
  assert.deepEqual(lines(out).map((e) => e.result), ["First reply.", "Second reply."]);
  assert.equal(tasks.length, 2);
});

// -p on this computer (FOL-223): no questions — a change only with --yes, a missing model key said, not asked.
function modelStream(content: Array<{ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown }>) {
  const ev = (e: Record<string, unknown>) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
  let out = ev({ type: "message_start", message: { id: "m", model: "claude-sonnet-test", usage: { input_tokens: 100, output_tokens: 1 } } });
  content.forEach((b, index) => {
    if (b.type === "text") {
      out += ev({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      out += ev({ type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } });
    } else {
      out += ev({ type: "content_block_start", index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      out += ev({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    out += ev({ type: "content_block_stop", index });
  });
  out += ev({ type: "message_delta", delta: { stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn" }, usage: { output_tokens: 5 } });
  out += ev({ type: "message_stop" });
  return raw(out, "text/event-stream");
}

async function localPlatform(d: string) {
  const said: string[] = [];
  let calls = 0;
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: default\n---\nYou code.\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/messages": (b) => {
      calls++;
      // The first call edits hello.txt; the second reads what the tool answered and replies with it.
      if (calls % 2 === 1) return modelStream([{ type: "tool_use", id: `t${calls}`, name: "Write", input: { file_path: path.join(d, "new.txt"), content: "changed\n" } }]);
      const body = JSON.parse(String(b));
      const last = JSON.stringify(body.messages.at(-1));
      said.push(last);
      return modelStream([{ type: "text", text: /no one to ask/.test(last) ? "Not changed: no --yes." : "Changed it." }]);
    },
  });
  return { s, said };
}

const seedKey = (home: string, url: string) =>
  fs.writeFileSync(path.join(home, "code-local-keys.json"), JSON.stringify({ [`${url}#acme`]: { id: "key-1", key: "fr_gw_test", gatewayUrl: url, kind: "account" } }), { mode: 0o600 });

function runIn(home: string, url: string, args: string[]): Promise<{ out: string; err: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args, "--url", url, "--token", "k"], {
      env: { ...process.env, FOLDRUN_HOME: home, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1", FOLDRUN_NO_AUTO_UPDATE: "1" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (x) => (out += x));
    child.stderr.on("data", (x) => (err += x));
    child.stdin.end();
    child.on("close", (code) => resolve({ out, err, code: code ?? 1 }));
  });
}

test("-p on this computer: a file change only with --yes; without it the agent is told why and nothing changes", { timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const { s, said } = await localPlatform(d);
  seedKey(home, s.url);
  try {
    const no = await runIn(home, s.url, ["code", d, "--local", "--no-sandbox", "--to", "desk", "-p", "change hello", "--output-format", "json"]);
    assert.equal(no.code, 0, no.err);
    const r1 = lines(no.out)[0];
    assert.equal(r1.where, "local");
    assert.equal(r1.applied, false);
    assert.equal(r1.result, "Not changed: no --yes.");
    assert.equal(fs.existsSync(path.join(d, "new.txt")), false, "nothing written");
    assert.match(said[0]!, /not started with --yes/);
    const yes = await runIn(home, s.url, ["code", d, "--local", "--no-sandbox", "--to", "desk", "-p", "change hello", "--yes", "--output-format", "json"]);
    assert.equal(yes.code, 0, yes.err);
    const r2 = lines(yes.out)[0];
    assert.equal(r2.applied, true);
    assert.equal(r2.result, "Changed it.");
    assert.equal(fs.readFileSync(path.join(d, "new.txt"), "utf8"), "changed\n", yes.err);
  } finally {
    s.close();
  }
});

test("-p on this computer with no model key says so and asks nothing (the next stdin line is not taken as an answer)", { timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const { s } = await localPlatform(d);
  try {
    const r = await runIn(home, s.url, ["code", d, "--local", "--no-sandbox", "--to", "desk", "-p", "hi", "--output-format", "json"]);
    assert.equal(r.code, 1, r.out + r.err);
    assert.equal(lines(r.out)[0].is_error, true);
    assert.match(r.err, /no model key on this computer yet/);
    assert.doesNotMatch(r.err, /make it\?/);
  } finally {
    s.close();
  }
});

test("-p asks nothing at setup either: a missing project is refused, not asked about (Codex)", async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({ [`GET ${WS}`]: () => raw("{}", "application/json", {}, 404) });
  try {
    const r = await runIn(home, s.url, ["code", d, "--local", "--to", "desk", "-p", "hi", "--output-format", "json"]);
    assert.equal(r.code, 1);
    assert.match(lines(r.out)[0].error, /-p asks nothing — create desk\?: pass --yes to mean it/);
  } finally {
    s.close();
  }
});

test("a script's turn in a folder that works on this computer must say where it runs", async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  fs.writeFileSync(path.join(home, "code-sessions.json"), JSON.stringify({ [path.resolve(d)]: { context: "code-0000000000000000", ws: "desk", agent: "coder", url: "x", mode: "local" } }));
  const { s } = await localPlatform(d);
  try {
    const r = await runIn(home, s.url, ["code", d, "--to", "desk", "-p", "hi"]);
    assert.notEqual(r.code, 0);
    assert.match(r.err + r.out, /--local -p \(here; file changes only with --yes\) or --cloud -p/);
  } finally {
    s.close();
  }
});

test("streamEvent: one shape per event, nothing for a platform note", () => {
  assert.equal(streamEvent({ type: "info", text: "clock" }, { agent: "coder" }), null);
  assert.deepEqual(streamEvent({ type: "text", text: "hi" }, { agent: "coder" }), { type: "message", agent: "coder", text: "hi" });
  assert.deepEqual(streamEvent({ type: "tool", text: "Bash", call: 1, ms: 3, error: true }, { agent: "w", subagentOf: 0 }), { type: "tool_result", agent: "w", subagent: true, call: "1", tool: "Bash", ms: 3, error: true });
});

test("-p on this computer: ask_person is refused with nobody to ask, and the agent is told to decide or say what it needs (FOL-314)", { timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const said: string[] = [];
  let calls = 0;
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: default\n---\nYou code.\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/messages": (b) => {
      calls++;
      if (calls === 1) return modelStream([{ type: "tool_use", id: "q1", name: "ask_person", input: { question: "Red or green?", options: ["red", "green"], answer: "green" } }]);
      said.push(JSON.stringify(JSON.parse(String(b)).messages.at(-1)));
      return modelStream([{ type: "text", text: "Decided myself." }]);
    },
  });
  seedKey(home, s.url);
  try {
    const r = await runIn(home, s.url, ["code", d, "--local", "--no-sandbox", "--to", "desk", "-p", "pick a colour", "--output-format", "json"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(lines(r.out)[0].result, "Decided myself.");
    assert.match(said[0]!, /runs from a script with no one to ask/);
    assert.doesNotMatch(said[0]!, /The person answered/, "the model's own answer is never passed off as the person's");
  } finally {
    s.close();
  }
});
