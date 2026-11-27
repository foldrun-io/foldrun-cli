// foldrun code as a person uses it (19 Nov 2026): a real terminal (a pty,
// through python3's pty module), typing /help, !command, a pasted
// two-line message, d at the apply prompt, /undo, /quit — and --continue
// picking the conversation up again. Plus the helpers in code-session.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync, spawn, spawnSync} from "node:child_process";
import {serve, raw} from "./fake-platform.ts";
import {codeCompleter, joinMessage, shellNote, withNotes, colorPatch, helpText, readHistory, appendHistory, lastSession, rememberSession, friendlyTool, friendlyError, folderRelative, formatSecs, formatBytes, formatCost, shortModel, homeTilde} from "../src/code-session.mjs";
import {folderChoice, localPrompt, projectNameFor, localModelOf, localCallSummary, insideFolder} from "../src/code-session.mjs";

const WS = "/v1/workspaces/desk";
const ID = "c".repeat(64);
const RUN = "run-sess-1";
const PATCH = "diff --git a/a.txt b/a.txt\nindex 7898192..422c2b7 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n a\n+b\n";
const hasPty = spawnSync("python3", ["-c", "import pty"]).status === 0 && process.platform !== "win32";

function repo(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-code-sess-"));
  const git = (...a: string[]) => execFileSync("git", ["-C", d, "-c", "user.email=t@t", "-c", "user.name=t", ...a]);
  git("init", "-q");
  fs.writeFileSync(path.join(d, "a.txt"), "a\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  return d;
}

function platform() {
  return serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => ({ ok: true, runId: RUN, snapshot: ID, context: "code-me" }),
    [`GET ${WS}/runs/${RUN}`]: () => ({
      id: RUN, flow: "adhoc:coder", status: "completed", snapshot: { id: ID }, startedAt: "2026-11-19T01:00:00.000Z", finishedAt: "2026-11-19T01:00:05.000Z",
      steps: [{ agent: "coder", group: 1, status: "completed", attempts: 1, costUsd: 0.02, events: [{ t: "2026-11-19T01:00:01.000Z", type: "text", text: "Added b." }], result: "Added b." }],
    }),
    [`GET ${WS}/runs/${RUN}/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "changed" }), "application/json") : raw(PATCH, "text/x-diff")),
    [`GET ${WS}/sessions/code-me/messages`]: () => ({ messages: [] }),
  });
}

/** The CLI on a pty: send() types, until() waits for output to match. */
/** The test's environment without what makes bash run a file before every
 *  command (CI sets BASH_ENV to its own setup script, which failed inside
 *  the agent's commands — dev-deploy 44642683485). */
function outerEnv() {
  const env = { ...process.env };
  delete env.BASH_ENV;
  delete env.ENV;
  return env;
}

/** A command typed alone opens its list (FOL-259); Enter at once does what it did before. */
async function alone(t: { send: (x: string) => unknown, until: (re: RegExp, from?: number, ms?: number) => Promise<number> }, cmd: string, at: number) {
  t.send(`${cmd}\r`);
  const next = await t.until(/↑↓ to move · Enter to choose · Esc to cancel/, at);
  await new Promise((r) => setTimeout(r, 100));
  t.send("\r");
  return next;
}

function onTerminal(args: string[], home: string, extraEnv: Record<string, string> = {}) {
  const cli = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
  const child = spawn("python3", ["-c", "import pty,sys; sys.exit(pty.spawn(sys.argv[1:]) >> 8)", process.execPath, cli, ...args], {
    env: { ...outerEnv(), FOLDRUN_CODE_SANDBOX: "off", FOLDRUN_CODE_RESOURCES: process.env.FOLDRUN_TEST_RESOURCES ?? "off", FOLDRUN_HOME: home, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1", SHELL: "/bin/sh", TERM: "dumb", ...extraEnv },
  });
  let out = "";
  child.stdout.on("data", (x) => (out += x));
  child.stderr.on("data", (x) => (out += x));
  const done = new Promise<number>((r) => child.on("close", (code) => r(code ?? 1)));
  const until = async (re: RegExp, from = 0, ms = 15_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const m = re.exec(out.slice(from));
      if (m) return from + m.index + m[0].length;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`waited for ${re} — the screen:\n${out}`);
  };
  // The CLI's end, bounded: one that does not end is killed and fails with the screen,
  // rather than holding the test file open until CI's job limit (FOL-298 hung there twice, 25 Nov 2026).
  const ended = async (ms = 15_000) => {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, no) => (timer = setTimeout(() => { child.kill("SIGKILL"); no(new Error(`the CLI did not end within ${ms} ms — the screen:\n${out}`)); }, ms)));
    try { return await Promise.race([done, late]); } finally { clearTimeout(timer); }
  };
  return { send: (t: string) => child.stdin.write(t), until, done, ended, out: () => out, child };
}

const CATALOG = {
  runsOn: "foldrun",
  supply: "deepseek",
  foldrunModels: {
    offered: true,
    providers: [{ name: "deepseek", title: "DeepSeek", available: true, reason: null, tiers: { fast: "deepseek-chat" } }],
    catalog: [
      { id: "anthropic/claude-opus-5-5", provider: "anthropic", providerTitle: "Anthropic", model: "claude-opus-5-5", inputPerMTok: 15, outputPerMTok: 75, available: true, covered: true },
      { id: "deepseek/deepseek-chat", provider: "deepseek", providerTitle: "DeepSeek", model: "deepseek-chat", inputPerMTok: 0.28, outputPerMTok: 0.42, available: true, covered: true },
      { id: "openai/gpt-x", provider: "openai", providerTitle: "OpenAI", model: "gpt-x", inputPerMTok: 2, outputPerMTok: 8, available: false, covered: true },
    ],
    codeTiers: { fast: { id: "anthropic/claude-haiku-5-5", provider: "anthropic", model: "claude-haiku-5-5" } },
  },
};

function sse(content: Array<{ type: "text"; text: string } | { type: "thinking"; thinking: string } | { type: "tool_use"; id: string; name: string; input: unknown }>, stop?: string, usage: Record<string, number> = {}) {
  const ev = (e: Record<string, unknown>) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
  let out = ev({ type: "message_start", message: { id: "m", model: "claude-sonnet-test", usage: { input_tokens: 100, output_tokens: 1, ...usage } } });
  content.forEach((b, index) => {
    if (b.type === "text") {
      out += ev({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      out += ev({ type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } });
    } else if (b.type === "thinking") {
      out += ev({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
      if (b.thinking) out += ev({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: b.thinking } });
      out += ev({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: "sig" } });
    } else {
      out += ev({ type: "content_block_start", index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      out += ev({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    out += ev({ type: "content_block_stop", index });
  });
  out += ev({ type: "message_delta", delta: { stop_reason: stop ?? (content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn") }, usage: { output_tokens: 5 } });
  out += ev({ type: "message_stop" });
  return raw(out, "text/event-stream");
}

// The CLI runs the published @foldrun/core: this turns on by itself once
// the CLI's range reaches the core release that has endOf (FOL-211).
const coreEndsHonestly = typeof ((await import("@foldrun/core/engine-loop")) as Record<string, unknown>).endOf === "function";

test("a session on a terminal: /help, !command sent with the next message, a pasted message is one turn, d shows the diff, /undo, /quit, then --continue", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home);
  try {
    let at = await t.until(/\w ❯ /);
    assert.match(t.out(), /session code-me/);

    // /help is a list (FOL-263): the commands by group; Esc changes nothing.
    t.send("/help\r");
    at = await t.until(/\/undo\s+Changes · take back[\s\S]*Esc to cancel/, at);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\x1b");
    at = await t.until(/nothing changed/, at);
    at = await t.until(/\w ❯ /, at);

    t.send("!echo hello-from-shell\r");
    at = await t.until(/goes with your next message/, at);
    assert.match(t.out(), /hello-from-shell/);
    at = await t.until(/\w ❯ /, at);

    // Two lines in one write: a paste — one message, one turn, sent by Enter (FOL-423).
    t.send("add b\rand keep it short\r");
    await t.until(/ … /);
    t.send("\r");
    at = await t.until(/send it\? \[y\]es/, at);
    t.send("y\r"); // the upload preview (FOL-212): nothing leaves before this yes
    at = await t.until(/apply it to/, at);
    const posts = s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run"));
    assert.equal(posts.length, 1, "one turn for the pasted lines");
    const task = JSON.parse(posts[0]!.body).task as string;
    assert.match(task, /The person ran `echo hello-from-shell` in the folder \(exit 0\)/);
    assert.match(task, /hello-from-shell/);
    assert.match(task, /add b\nand keep it short$/);
    assert.match(t.out(), /✓ done/);

    t.send("d\r");
    at = await t.until(/\+b/, at);
    at = await t.until(/apply it to/, at);
    t.send("y\r");
    at = await t.until(/\/undo takes it back/, at);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "a\nb\n");
    at = await t.until(/\w ❯ /, at);

    // /undo alone lists what can be taken back (FOL-263); Enter takes the patch.
    at = await alone(t, "/undo", at);
    at = await t.until(/take back the last change/, at);
    t.send("y\r");
    at = await t.until(/taken back/, at);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "a\n");
    at = await t.until(/\w ❯ /, at);

    t.send("/nope\r");
    at = await t.until(/is not a command — \/help lists them/, at);
    at = await t.until(/\w ❯ /, at);

    t.send("/quit\r");
    await t.until(/foldrun code --continue/, at);
    assert.equal(await t.done, 0);
    if (process.env.SHOW_SCREEN) console.log(t.out());
  } finally {
    t.child.kill();
  }
  assert.match(fs.readFileSync(path.join(home, "code-history"), "utf8"), /add b and keep it short/, "history keeps the message, on one line");

  // --continue: the folder's last conversation.
  const again = onTerminal(["code", d, "--to", "desk", "--continue", "--url", s.url, "--token", "k"], home);
  try {
    await again.until(/session code-me · continuing/);
    again.send("/quit\r");
    await again.done;
  } finally {
    again.child.kill();
    s.close();
  }
});

test("the status line under the prompt (FOL-269): the conversation, its id and where it runs, broken between fields on a narrow screen; /status line off hides it, for the person", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home, { TERM: "xterm-256color", FOLDRUN_NO_TICKER: "1", COLUMNS: "200", NO_COLOR: "1" });
  try {
    let at = await t.until(/\w ❯ /);
    at = await t.until(/new conversation · code-me · cloud/, at);
    t.send("/rename fix login\r");
    at = await t.until(/fix login · code-me · cloud/, at);
    t.send("/status line off\r");
    at = await t.until(/status line off/, at);
    await new Promise((r) => setTimeout(r, 300));
    assert.doesNotMatch(t.out().slice(at), /fix login · code-me/, `off is off: ${JSON.stringify(t.out().slice(at - 300))}`);
    t.send("/status line on\r");
    at = await t.until(/fix login · code-me · cloud/, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "code-prefs.json"), "utf8")).statusLine, undefined, "on again: nothing kept");
});

test("/status jobs off hides the background jobs' rows under the working line, for the person; on again keeps nothing (FOL-343)", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-jb", "--url", s.url, "--token", "k"], home, { TERM: "xterm-256color", FOLDRUN_NO_TICKER: "1", NO_COLOR: "1", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/status jobs\r");
    at = await t.until(/background jobs under the working line are shown · \/status jobs off/, at);
    t.send("/status jobs off\r");
    at = await t.until(/background jobs hidden/, at);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, "code-prefs.json"), "utf8")).jobs, false, "kept for the person");
    t.send("/status jobs on\r");
    at = await t.until(/background jobs shown/, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "code-prefs.json"), "utf8")).jobs, undefined, "on again: nothing kept");
});

test("/permissions cloud ask|bypass (FOL-382): starting cloud jobs is unasked until the person asks to be asked; kept for the person, a job's changes always asked", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-cj", "--url", s.url, "--token", "k"], home, { TERM: "xterm-256color", FOLDRUN_NO_TICKER: "1", NO_COLOR: "1", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/permissions cloud\r");
    at = await t.until(/cloud jobs start without a question — \/permissions cloud ask · bypass \(a job's changes are asked/, at);
    t.send("/permissions cloud ask\r");
    at = await t.until(/cloud jobs are asked about before they start: one question for each call · kept for you, every session/, at);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, "code-prefs.json"), "utf8")).cloudAsk, true, "kept for the person");
    // The list has the choice, the other way round now; its first row shows what is allowed.
    t.send("/permissions\r");
    at = await t.until(/Cloud jobs without asking\s+they start unasked[\s\S]*Esc to cancel/, at);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\r");
    at = await t.until(/cloud jobs are asked about before they start — \/permissions cloud bypass/, at);
    t.send("/permissions cloud bypass\r");
    at = await t.until(/cloud jobs start without a question \(what is sent is still shown, and a job's changes are asked/, at);
    t.send("/permissions cloud\r");
    at = await t.until(/cloud jobs start without a question — \/permissions cloud ask/, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "code-prefs.json"), "utf8")).cloudAsk, undefined, "bypass again: nothing kept (the default)");
});

test("/permissions steps (owner, 27 Nov 2026): no limit by default; a number is kept for the person, off takes it away", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-st", "--url", s.url, "--token", "k"], home, { TERM: "xterm-256color", FOLDRUN_NO_TICKER: "1", NO_COLOR: "1", COLUMNS: "200" });
  const prefs = () => { try { return JSON.parse(fs.readFileSync(path.join(home, "code-prefs.json"), "utf8")); } catch { return {}; } };
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/permissions steps\r");
    at = await t.until(/no limit: a turn goes on until the model is done/, at);
    t.send("/permissions steps 3\r");
    at = await t.until(/at least 5 steps/, at);
    assert.equal(prefs().turnSteps, undefined, "a refused number is not kept");
    t.send("/permissions steps 200\r");
    at = await t.until(/a turn stops after 200 model steps and asks to go on · kept for you, every session/, at);
    assert.equal(prefs().turnSteps, 200);
    t.send("/permissions steps off\r");
    at = await t.until(/no limit: a turn goes on until the model is done .* · kept for you/, at);
    assert.equal(prefs().turnSteps, undefined, "off is the default: nothing kept");
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a bracketed paste is one message however slowly it arrives; Enter after it sends it; the terminal's paste mode stays on for the session and is off again when it ends (FOL-434)", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home, { TERM: "xterm-256color", FOLDRUN_NO_TICKER: "1" });
  try {
    let at = await t.until(/\w ❯ /);
    assert.match(t.out(), /\x1b\[\?2004h/, "paste mode on while the prompt waits");
    t.send("\x1b[200~add b\r");
    await new Promise((r) => setTimeout(r, 200)); // far past the 30 ms grouping
    t.send("and keep it short\x1b[201~");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run")).length, 0, "nothing sent before Enter");
    t.send("\r");
    at = await t.until(/send it\? \[y\]es/, at);
    t.send("y\r"); // the upload preview (FOL-212): nothing leaves before this yes
    at = await t.until(/apply it to/, at);
    const posts = s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run"));
    assert.equal(posts.length, 1);
    assert.match(JSON.parse(posts[0]!.body).task as string, /add b\nand keep it short$/);
    // One reader for the whole session (FOL-434): paste marks stay on through the turn and its questions.
    assert.doesNotMatch(t.out(), /\x1b\[\?2004l/, "paste mode never turned off during the session");
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    await t.done;
    assert.match(t.out().slice(at), /\x1b\[\?2004l/, "paste mode off when the session ends");
  } finally {
    t.child.kill();
    s.close();
  }
});

for (const [how, env, paste] of [
  ["with the terminal's paste marks", { TERM: "xterm-256color" }, "\x1b[200~fix the bug\rin src/a.ts\r\x1b[201~"],
  ["without them (lines arriving together)", { TERM: "dumb" }, "fix the bug\rin src/a.ts\r"],
] as const) {
  test(`a paste never sends, ${how}: it waits on the line and Enter sends it (owner, 27 Nov 2026)`, { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
    const d = repo();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
    const s = await platform();
    const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-pz", "--url", s.url, "--token", "k"], home, { ...env, FOLDRUN_NO_TICKER: "1", NO_COLOR: "1" });
    try {
      let at = await t.until(/\w ❯ /);
      t.send(paste);
      at = await t.until(/ … /, at);
      await new Promise((r) => setTimeout(r, 400)); // far past the 30 ms grouping
      assert.equal(s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run")).length, 0, "a paste ending on a line break is not sent");
      t.send("\r");
      at = await t.until(/send it\? \[y\]es/, at);
      t.send("y\r");
      at = await t.until(/apply it to/, at);
      const posts = s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run"));
      assert.equal(posts.length, 1);
      assert.match(JSON.parse(posts[0]!.body).task as string, /^fix the bug\nin src\/a\.ts$/);
      t.send("n\r");
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      await t.done;
    } finally {
      t.child.kill();
      s.close();
    }
  });
}

test("completion: /commands at the start, @paths anywhere, a folder at a time", () => {
  const complete = codeCompleter(() => ["src/a.ts", "src/b/c.ts", "README.md"]);
  assert.deepEqual(complete("/un"), [["/undo"], "/un"]);
  assert.deepEqual(complete("look at @src/")[0].sort(), ["@src/a.ts", "@src/b/"]);
  assert.deepEqual(complete("look at @R"), [["@README.md"], "@R"]);
  assert.deepEqual(complete("plain words"), [[], "plain words"]);
});

test("a message: a trailing \\ goes on; lines that came together stay one message", () => {
  assert.equal(joinMessage(["first \\"]), null);
  assert.equal(joinMessage(["first \\", "second"]), "first \nsecond");
  assert.equal(joinMessage(["a", "b"]), "a\nb");
});

test("!command notes: the output goes first, cut from the front when long", () => {
  const note = shellNote("npm test", { output: `${"x".repeat(7000)}END`, code: 1, error: null });
  assert.match(note, /^The person ran `npm test` in the folder \(exit 1\)/);
  assert.match(note, /characters cut/);
  assert.match(note, /END\n```$/);
  assert.equal(withNotes([], "go"), "go");
  assert.equal(withNotes(["n1"], "go"), "n1\n\ngo");
});

test("history: one entry per message, newest first, no repeats, private", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-hist-")), "h");
  appendHistory(f, "one");
  appendHistory(f, "two\nlines");
  appendHistory(f, "one");
  assert.deepEqual(readHistory(f), ["one", "two lines"]);
  fs.appendFileSync(f, "evil \x1b]52;c;eA==\x07\n");
  assert.deepEqual(readHistory(f), ["one", "two lines"], "a line with a control character is never handed to readline");
  if (process.platform !== "win32") assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  if (process.platform !== "win32") {
    const old = path.join(path.dirname(f), "old");
    fs.writeFileSync(old, "x\n", { mode: 0o644 });
    appendHistory(old, "y");
    assert.equal(fs.statSync(old).mode & 0o777, 0o600, "an older, readable file is made private on the next write");
  }
});

test("sessions: the last conversation of a folder, only for the same project", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-sess-")), "s.json");
  rememberSession(f, "/x/y", { context: "code-1", ws: "desk", agent: "coder" });
  assert.equal(lastSession(f, "/x/y", "desk")?.context, "code-1");
  assert.equal(lastSession(f, "/x/y", "other"), null);
  assert.equal(lastSession(f, "/x/z", "desk"), null);
});

test("appearance: verbs, folder paths, times, sizes, money, models", () => {
  assert.equal(friendlyTool("Bash"), "Run");
  assert.equal(friendlyTool("Grep"), "Search");
  assert.equal(friendlyTool("mcp__github__create_issue"), "Create issue");
  assert.equal(friendlyTool("mcp__foldrun_install__install"), "Install");
  assert.equal(friendlyError("Bash: Exit code 1 calc.py def add(a, b): return a - b\nhead: cannot open"), "Run failed · exit 1");
  assert.equal(friendlyError("the sandbox stopped\nmore detail"), "the sandbox stopped");
  assert.equal(shortModel("sonnet"), "Sonnet");
  assert.equal(friendlyTool("Thing"), "Thing");
  assert.equal(folderRelative("/work/agents/coder/snapshot/src/a.ts"), "src/a.ts");
  assert.equal(folderRelative("cd /work/agents/coder/snapshot && npm test"), "npm test");
  assert.equal(folderRelative("cd snapshot && ls /work/agents/coder/snapshot"), "ls .");
  assert.equal(formatSecs(0.42), "0.4s");
  assert.equal(formatSecs(12.3), "12s");
  assert.equal(formatSecs(65), "1m 05s");
  assert.equal(formatSecs(3700), "1h 01m");
  assert.equal(formatBytes(20480), "20 KB");
  assert.equal(formatCost(0.0421), "$0.042");
  assert.equal(formatCost(2.5), "$2.50");
  assert.equal(formatCost(0.0002), "<$0.001");
  assert.equal(shortModel("claude-sonnet-5-5"), "Sonnet 5.5");
  assert.equal(shortModel("claude-opus-5"), "Opus 5");
  assert.equal(shortModel("gpt-5.1"), "gpt-5.1");
  assert.equal(homeTilde("/home/ana/code", "/home/ana"), "~/code");
  assert.equal(homeTilde("/srv/code", "/home/ana"), "/srv/code");
});

test("help and diff colors", () => {
  assert.match(helpText(), /\/diff/);
  assert.match(helpText(), /!<command>/);
  const id = (x: string) => x;
  const marked = colorPatch(PATCH, { green: (x) => `G${x}`, red: (x) => `R${x}`, bold: (x) => `B${x}`, dim: id });
  assert.match(marked, /^Bdiff --git/m);
  assert.match(marked, /^G\+b$/m);
  assert.doesNotMatch(marked, /^G\+\+\+/m, "the file head is a head, not an added line");
  const bin = "diff --git a/x.pyc b/x.pyc\nnew file mode 100644\nindex 0..5\nGIT binary patch\nliteral 350\nzcma)0Jx\n\nliteral 0\nHcmV\n\n" + PATCH;
  const shown = colorPatch(bin, { green: id, red: id, bold: id, dim: id });
  assert.match(shown, /a binary file — not shown/);
  assert.doesNotMatch(shown, /zcma|literal/);
  assert.match(shown, /^\+b$/m, "the next file is shown as usual");
});

test("the CLI's own controls pass the terminal guard; nothing else does through writeControl", async () => {
  const { writeControl, unguardedWhile, guardStream } = await import("../src/terminal.mjs");
  let got = "";
  const stream = { write: (x: string) => ((got += x), true) } as unknown as NodeJS.WriteStream;
  guardStream(stream);
  stream.write("\r\x1b[2Kx");
  assert.equal(got, "x", "the guard strips controls");
  got = "";
  writeControl("\r\x1b[2K", stream);
  writeControl("\x1b[?2004h", stream);
  assert.equal(got, "\r\x1b[2K\x1b[?2004h");
  assert.throws(() => writeControl("\x1b]52;c;eA==\x07", stream), /not one of the CLI's own controls/);
  got = "";
  const again = unguardedWhile(stream);
  stream.write("\x1b[1G");
  again();
  stream.write("\x1b[1G");
  assert.equal(got, "\x1b[1G", "unguarded only until put back");
});

test("a working frame is one write: its text made safe as the guard makes it, only the CLI's own controls between the rows (owner, 26 Nov 2026)", async () => {
  const { writeFrame, guardStream } = await import("../src/terminal.mjs");
  const writes: string[] = [];
  const stream = { write: (x: string) => (writes.push(x), true) } as unknown as NodeJS.WriteStream;
  guardStream(stream);
  writeFrame([{ control: "\x1b[?2026h\r\x1b[3A" }, "  working\x1b]52;c;eA==\x07", { control: "\x1b[K" }, "\n", "  desk\u00a0❯ typed\x1b[1G", { control: "\x1b[K\x1b[J\x1b[?2026l" }], stream);
  assert.equal(writes.length, 1, "one write, never a half-drawn frame");
  assert.equal(writes[0], "\x1b[?2026h\r\x1b[3A  working\x1b[K\n  desk\u00a0❯ typed\x1b[K\x1b[J\x1b[?2026l", "what the agent or the person typed loses its controls");
  assert.throws(() => writeFrame([{ control: "\x1b[1G" }], stream), /not one of the CLI's own controls/);
});

test("/model: shows the agent's model; /model max changes its file's model: line, with the version it read", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let file = '---\nname: coder\n"model": default # cheap\neffort: medium\n---\n\nYou code.\n';
  const puts: Array<{ content: string; ifMatch: unknown }> = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: file, sha256: `sha-${puts.length}` }),
    [`PUT ${WS}/source`]: (b) => {
      const body = JSON.parse(String(b));
      puts.push(body);
      file = body.content;
      return { ok: true };
    },
    [`GET ${WS}/sessions/code-me/messages`]: () => ({ messages: [] }),
  });
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home);
  try {
    let at = await t.until(/\w ❯ /);
    // The picker: the file's model ticked, Esc keeps it, nothing written.
    at = await alone(t, "/model", at); // /model's list (FOL-263): Model… opens the picker
    at = await t.until(/Choose a model[\s\S]*1\. Default[^\n]*✔[\s\S]*Esc to cancel/, at);
    t.send("\x1b");
    at = await t.until(/kept Default \(Sonnet\)/, at);
    assert.equal(puts.length, 0);
    at = await t.until(/\w ❯ /, at);
    t.send("/model max\r");
    at = await t.until(/Max \(Opus\) from your next message/, at);
    assert.equal(puts.length, 1);
    assert.equal(puts[0]!.ifMatch, "sha-0", "written over exactly what was read");
    assert.match(puts[0]!.content, /^model: max # cheap$/m, "a quoted key is the same key: replaced, not added beside");
    assert.equal((puts[0]!.content.match(/model/g) ?? []).length, 1);
    assert.match(puts[0]!.content, /^effort: medium$/m, "the rest of the file as it was");
    at = await t.until(/\w ❯ /, at);
    t.send("/model max\r");
    at = await t.until(/already max/, at);
    // ↓ then Enter in the picker: Max is ticked now, the next one is Fast.
    at = await alone(t, "/model", at); // /model's list (FOL-263): Model… opens the picker
    at = await t.until(/2\. Max[^\n]*✔[\s\S]*Esc to cancel/, at);
    await new Promise((r) => setTimeout(r, 100));
    // An arrow cut across two reads, the rest with Enter in one: keys, not reads.
    t.send("\x1b");
    await new Promise((r) => setTimeout(r, 5));
    t.send("[B\r");
    at = await t.until(/Fast \(Haiku\) from your next message/, at);
    assert.match(puts.at(-1)!.content, /^model: fast # cheap$/m);
    t.send("/model bad name!\r");
    at = await t.until(/is not a model/, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("the start box and /status name the same session, and /status says where its spent figure comes from (FOL-272)", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--url", s.url, "--token", "k"], home);
  try {
    let at = await t.until(/\w ❯ /);
    const id = /session (code-[0-9a-f]{16})/.exec(t.out())?.[1];
    assert.ok(id, `the start box names the session:\n${t.out()}`);
    const before = at;
    at = await alone(t, "/status", at);
    at = await t.until(/spent\s+\$0\.0+ in the cloud this session/, at);
    const shown = /session\s+(code-[0-9a-f]{16})/.exec(t.out().slice(before))?.[1];
    assert.equal(shown, id, "the same id in both");
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("/model second (FOL-418): another provider's model for tools: [debate, review], written as second_model: and the tools in one save; none takes all three away", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let file = "---\nname: coder\nmodel: anthropic/claude-x\ntools: [read, write]\n---\n\nYou code.\n";
  const puts: Array<{ content: string; ifMatch: unknown; message: string }> = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: file, sha256: `sha-${puts.length}` }),
    [`PUT ${WS}/source`]: (b) => {
      const body = JSON.parse(String(b));
      puts.push(body);
      file = body.content;
      return { ok: true };
    },
    [`GET ${WS}/sessions/code-sm/messages`]: () => ({ messages: [] }),
  });
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-sm", "--url", s.url, "--token", "k"], home);
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/model second anthropic/claude-y\r");
    at = await t.until(/same provider as this agent's model/, at);
    assert.equal(puts.length, 0);
    t.send("/model second gpt-x\r");
    at = await t.until(/not a model written provider\/model/, at);
    t.send("/model second openai/gpt-x\r");
    at = await t.until(/second opinion: openai\/gpt-x — debate and review/, at);
    assert.equal(puts.length, 1);
    assert.equal(puts[0]!.ifMatch, "sha-0", "written over exactly what was read");
    assert.match(puts[0]!.content, /^second_model: openai\/gpt-x$/m);
    assert.match(puts[0]!.content, /^tools: \[read, write, debate, review\]$/m);
    assert.match(puts[0]!.content, /^model: anthropic\/claude-x$/m, "the rest of the file as it was");
    t.send("/model second none\r");
    at = await t.until(/no second opinion: debate and review are taken away/, at);
    assert.doesNotMatch(puts[1]!.content, /second_model/);
    assert.match(puts[1]!.content, /^tools: \[read, write\]$/m);
    // A prose line that starts the same way is not the field.
    file = `${file}\nsecond_model: an example in the prose\n`;
    t.send("/model second none\r");
    at = await t.until(/no second model was set/, at);
    assert.equal(puts.length, 2);
    // [[review]] is the author's own tool: left for the person to edit.
    file = "---\nname: coder\nmodel: anthropic/claude-x\ntools: [read, [[review]]]\n---\n\nYou code.\n";
    t.send("/model second openai/gpt-x\r");
    at = await t.until(/lists its own tool \[\[review\]\], not the built-in/, at);
    assert.equal(puts.length, 2);
    // Both spellings in one list: the link is still the author's.
    file = "---\nname: coder\nmodel: anthropic/claude-x\ntools: [read, review, [[review]]]\nsecond_model: openai/gpt-x\n---\n\nYou code.\n";
    t.send("/model second none\r");
    at = await t.until(/lists its own tool \[\[review\]\]/, at);
    // A quoted comma string: the list editor would make it one item, so it is left alone.
    file = "---\nname: coder\nmodel: anthropic/claude-x\ntools: \"read, write\"\n---\n\nYou code.\n";
    t.send("/model second openai/gpt-x\r");
    at = await t.until(/writes tools: in a form this command does not edit/, at);
    // A byte-order mark before the opening: not edited.
    file = "\uFEFF---\nname: coder\ntools: [read]\n---\n\nYou code.\n";
    t.send("/model second openai/gpt-x\r");
    at = await t.until(/opens its frontmatter with something beside ---/, at);
    // A ---yaml opening: not edited.
    file = "---yaml\nname: coder\ntools: [read]\n---\n\nYou code.\n";
    t.send("/model second openai/gpt-x\r");
    at = await t.until(/opens its frontmatter with something beside ---/, at);
    assert.equal(puts.length, 2);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("/model effort (FOL-256, FOL-263): the effort: line of the agent's file — a picker, from /model's list too, a level straight away, default takes the line out; /status names it", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let file = "---\nname: coder\nmodel: default\n---\n\nYou code.\n";
  const puts: Array<{ content: string; ifMatch: unknown; message: string }> = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: file, sha256: `sha-${puts.length}` }),
    [`PUT ${WS}/source`]: (b) => {
      const body = JSON.parse(String(b));
      puts.push(body);
      file = body.content;
      return { ok: true };
    },
    [`GET ${WS}/sessions/code-ef/messages`]: () => ({ messages: [] }),
  });
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-ef", "--url", s.url, "--token", "k"], home);
  try {
    let at = await t.until(/\w ❯ /);
    // The picker: the model's default ticked (no effort: line), Esc keeps it, nothing written.
    t.send("/model effort\r");
    at = await t.until(/How hard the model thinks[\s\S]*1\. Model's default[^\n]*✔[\s\S]*6\. Max[\s\S]*Esc to cancel/, at);
    t.send("\x1b");
    at = await t.until(/kept the model's default/, at);
    assert.equal(puts.length, 0);
    at = await t.until(/\w ❯ /, at);
    t.send("/model effort high\r");
    at = await t.until(/effort high from your next message[^\n]*kept for desk, here and in the cloud/, at);
    assert.equal(puts.length, 1);
    assert.equal(puts[0]!.ifMatch, "sha-0", "written over exactly what was read");
    assert.match(puts[0]!.content, /^effort: high$/m);
    assert.match(puts[0]!.content, /^model: default$/m, "the rest of the file as it was");
    assert.match(puts[0]!.message, /effort high/);
    at = await t.until(/\w ❯ /, at);
    t.send("/model effort HIGH\r");
    at = await t.until(/already effort high/, at);
    at = await alone(t, "/status", at);
    at = await t.until(/effort\s+high \(\/model effort changes it\)/, at);
    t.send("/model effort max\r");
    at = await t.until(/effort max from your next message/, at);
    assert.match(puts.at(-1)!.content, /^effort: max$/m);
    assert.equal((puts.at(-1)!.content.match(/effort/g) ?? []).length, 1, "replaced, not added beside");
    // From /model's list (FOL-263): How hard it thinks… opens the picker; ↑ from Max is Extra high.
    t.send("/model\r");
    at = await t.until(/The model[\s\S]*How hard it thinks…[\s\S]*Esc to cancel/, at);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\x1b[B");
    await new Promise((r) => setTimeout(r, 100));
    t.send("\r");
    at = await t.until(/6\. Max[^\n]*✔[\s\S]*Esc to cancel/, at);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\x1b[A\r");
    at = await t.until(/effort extra high from your next message/, at);
    assert.match(puts.at(-1)!.content, /^effort: xhigh$/m);
    // The cloud runner's reading: an alias is its level; /status reads the file as it is now.
    file = "---\nname: coder\nmodel: default\neffort: extra-high # deep\n---\n\nYou code.\n";
    at = await alone(t, "/status", at);
    at = await t.until(/effort\s+xhigh \(\/model effort changes it\)/, at);
    // A block scalar with a blank line in it goes whole.
    file = "---\nname: coder\neffort: |-\n\n  high\nmodel: default\n---\n\nYou code.\n";
    t.send("/model effort default\r");
    at = await t.until(/the model's default from your next message/, at);
    assert.equal(puts.at(-1)!.content, "---\nname: coder\nmodel: default\n---\n\nYou code.\n");
    file = "---\nname: coder\nmodel: default\neffort: xhigh\n---\n\nYou code.\n";
    // default: the line goes, the model decides.
    t.send("/model effort default\r");
    at = await t.until(/the model's default from your next message/, at);
    assert.doesNotMatch(puts.at(-1)!.content, /effort/);
    assert.equal(puts.at(-1)!.content, "---\nname: coder\nmodel: default\n---\n\nYou code.\n");
    t.send("/model effort extreme\r");
    at = await t.until(/"extreme" is not an effort — low, medium, high, xhigh, max, or default/, at);
    // /model thinking on|off is the summary, and points at /model effort.
    t.send("/model thinking maybe\r");
    at = await t.until(/how hard it thinks is \/model effort \(low to max\)/, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("token hints (FOL-262): a new model, a break past the cache's life — each once, with the size and its cost; none while the cache is warm; /status tips off stops them; /status explain lists them", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let file = "---\nname: coder\nmodel: default\n---\nYou code.\n";
  const big = { cache_read_input_tokens: 40_000 };
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: file, sha256: "x" }),
    [`PUT ${WS}/source`]: (b) => {
      file = JSON.parse(String(b)).content;
      return { ok: true };
    },
    [`GET ${WS}/sessions/code-tk/messages`]: () => ({ messages: [] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "GET /v1/account/usage/rates": () => ({ catalogue: { models: { prices: [{ model: "claude-sonnet-test", inputPerMTok: 3, outputPerMTok: 15 }] } } }),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": () => sse([{ type: "text", text: "Done." }], undefined, big),
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-tk", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "250", FOLDRUN_CODE_CACHE_TTL_MS: "2500" });
  const count = (re: RegExp) => (t.out().match(new RegExp(re.source, "g")) ?? []).length;
  try {
    let at = await t.until(/\w ❯ /);
    t.send("one\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/Done\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    // Warm: the next message says nothing.
    t.send("two\r");
    at = await t.until(/Done\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    assert.equal(count(/the cache has expired/), 0, "no hint while the cache is warm");
    // A break past the cache's life: said before the message goes, priced by the model that served the last call.
    await new Promise((r) => setTimeout(r, 3000));
    t.send("three\r");
    at = await t.until(/back after 0 min: the cache has expired, so this message reads the conversation again at full price — about 40\.1k tokens \(~\$0\.12\)[\s\S]*Done\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    // Another model: once, with the size (its own price is not known before it answers).
    t.send("/model fast\r");
    at = await t.until(/another model has no cache of this conversation: your next message reads it all at full price — about 40\.1k tokens\. /, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/model default\r");
    at = await t.until(/\w ❯ /, at);
    // Off: no more, for you.
    t.send("/status tips off\r");
    at = await t.until(/token hints off/, at);
    t.send("/model effort high\r");
    at = await t.until(/effort high from your next message/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/status explain\r");
    at = await t.until(/hints given[\s\S]*back after[\s\S]*another model/, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
  assert.equal(count(/another model has no cache/), 2, "once on screen, once in /cost explain");
  assert.equal(count(/changes what the model is sent/), 0, `off is off:\n${t.out().split("\n").filter((l) => /changes what the model is sent|❯/.test(l)).join("\n")}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "code-prefs.json"), "utf8")).tips, false);
});

test("/model effort on this computer (FOL-256): the next turn's model call carries the agent's effort as output_config.effort; default sends none", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const engine: any = await import("@foldrun/core/engine-loop");
  assert.equal(engine.ENGINE_FEATURES?.effort, true, "the core this CLI depends on sends an effort");
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let file = "---\nname: coder\nmodel: default\neffort: low\n---\nYou code.\n";
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "text", text: "First." }]),
    () => sse([{ type: "text", text: "Second." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: file, sha256: "x" }),
    [`PUT ${WS}/source`]: (b) => {
      file = JSON.parse(String(b)).content;
      return { ok: true };
    },
    [`GET ${WS}/sessions/code-el/messages`]: () => ({ messages: [] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return (turns[asked.length - 1] ?? (() => sse([{ type: "text", text: "(no more)" }])))();
    },
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-el", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("say one\r");
    at = await t.until(/\[y\/N\]|First\./, at);
    if (!/First\./.test(t.out().slice(at - 400))) {
      t.send("y\r");
      at = await t.until(/First\./, at);
    }
    at = await t.until(/\w ❯ /, at);
    assert.deepEqual(asked[0].output_config, { effort: "low" }, "the file's effort, as the cloud runs it");
    t.send("/model effort max\r");
    at = await t.until(/effort max from your next message/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("say two\r");
    at = await t.until(/Second\./, at);
    assert.deepEqual(asked[1].output_config, { effort: "max" });
    at = await t.until(/\w ❯ /, at);
    t.send("/model effort default\r");
    at = await t.until(/the model's default from your next message/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("say three\r");
    at = await t.until(/\(no more\)/, at);
    assert.equal("output_config" in asked[2], false, "no effort: line, no effort sent — the model decides");
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("/model with the platform's list (23 Nov 2026): tiers say what they run, every model behind the proxy is offered, a provider's own id finds its catalogue id, an unknown one is refused with the nearest", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let file = "---\nname: coder\nmodel: default\n---\n\nYou code.\n";
  const puts: Array<{ content: string }> = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: file, sha256: `sha-${puts.length}` }),
    [`PUT ${WS}/source`]: (b) => {
      const body = JSON.parse(String(b));
      puts.push(body);
      file = body.content;
      return { ok: true };
    },
    ["GET /v1/account/model"]: () => CATALOG,
    [`GET ${WS}/sessions/code-me/messages`]: () => ({ messages: [] }),
  });
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home);
  try {
    let at = await t.until(/\w ❯ /);
    at = await alone(t, "/model", at); // /model's list (FOL-263): Model… opens the picker
    at = await t.until(/3\. Fast\s+deepseek-chat[\s\S]*deepseek\/deepseek-chat\s+DeepSeek · \$0\.28\/\$0\.42 per M · in plan[\s\S]*Esc to cancel/, at);
    assert.doesNotMatch(t.out().slice(-2000), /openai\/gpt-x/, "a model that cannot be had now is not offered");
    t.send("\x1b");
    at = await t.until(/kept Default/, at);
    t.send("/model deepseek-chat\r");
    at = await t.until(/deepseek\/deepseek-chat from your next message/, at);
    assert.match(puts.at(-1)!.content, /^model: deepseek\/deepseek-chat$/m);
    t.send("/model openai/gpt-x\r");
    at = await t.until(/not available on this platform right now/, at);
    t.send("/model claude-opus-9\r");
    at = await t.until(/not a model behind foldrun's proxy — did you mean anthropic\/claude-opus-5-5/, at);
    assert.equal(puts.length, 1, "nothing written for a refused name");
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("/model on the account's own key in the cloud: names go to its endpoint as written — no list, nothing refused", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let file = "---\nname: coder\nmodel: default\n---\n\nYou code.\n";
  const puts: Array<{ content: string }> = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: file, sha256: `sha-${puts.length}` }),
    [`PUT ${WS}/source`]: (b) => {
      const body = JSON.parse(String(b));
      puts.push(body);
      file = body.content;
      return { ok: true };
    },
    ["GET /v1/account/model"]: () => ({ ...CATALOG, runsOn: "account", supply: null }),
    [`GET ${WS}/sessions/code-me/messages`]: () => ({ messages: [] }),
  });
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home);
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/model my-private-deployment\r");
    at = await t.until(/my-private-deployment from your next message/, at);
    assert.match(puts.at(-1)!.content, /^model: my-private-deployment$/m);
    t.send("/model cheap\r");
    at = await t.until(/from your next message/, at);
    assert.match(puts.at(-1)!.content, /^model: cheap$/m, "a tier synonym the runner reads passes as written");
    t.send("/model foldrun/fast\r");
    at = await t.until(/Fast \(Haiku\) from your next message/, at);
    assert.match(puts.at(-1)!.content, /^model: fast$/m, "the gateway's spelling is kept as the tier word");
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("/model in the cloud under a provider: block the project's AGENTS.md sets: names go as written, as the runner sends them there", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let file = "---\nname: coder\nmodel: default\n---\n\nYou code.\n";
  const puts: Array<{ content: string }> = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: (_b, q) => (q.get("path") === "AGENTS.md" ? { path: "AGENTS.md", content: "---\n  name: desk\n  provider:\n    name: openai\n    token: ${OPENAI}\n---\n" } : { path: "agents/coder/agent.md", content: file, sha256: `sha-${puts.length}` }),
    [`PUT ${WS}/source`]: (b) => {
      const body = JSON.parse(String(b));
      puts.push(body);
      file = body.content;
      return { ok: true };
    },
    ["GET /v1/account/model"]: () => CATALOG,
    [`GET ${WS}/sessions/code-me/messages`]: () => ({ messages: [] }),
  });
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home);
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/model gpt-5-mini\r");
    at = await t.until(/gpt-5-mini from your next message/, at);
    assert.match(puts.at(-1)!.content, /^model: gpt-5-mini$/m);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("/model in the cloud on a key that cannot read the account's AGENTS.md: cannot tell, so the name is kept as written", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let file = "---\nname: coder\nmodel: default\n---\n\nYou code.\n";
  const puts: Array<{ content: string }> = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: (_b, q) => (q.get("path") === "AGENTS.md" ? { __status: 404, body: { error: "not found" } } : { path: "agents/coder/agent.md", content: file, sha256: `sha-${puts.length}` }),
    [`PUT ${WS}/source`]: (b) => {
      const body = JSON.parse(String(b));
      puts.push(body);
      file = body.content;
      return { ok: true };
    },
    ["GET /v1/account/model"]: () => CATALOG,
    ["GET /v1/account/agents-md"]: () => ({ __status: 403, body: { error: "this key is scoped to projects" } }),
    [`GET ${WS}/sessions/code-me/messages`]: () => ({ messages: [] }),
  });
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home);
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/model my-private-deployment\r");
    at = await t.until(/my-private-deployment from your next message/, at);
    assert.match(puts.at(-1)!.content, /^model: my-private-deployment$/m);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("catalogModel: tier words pass, ids and a provider's own id resolve, no list leaves the name to the gateway", async () => {
  const { catalogModel } = await import("../src/commands.mjs");
  const cat = { catalog: CATALOG.foldrunModels.catalog, tiers: {} };
  assert.equal(catalogModel("max", cat), "max");
  assert.equal(catalogModel("DeepSeek/deepseek-chat", cat), "deepseek/deepseek-chat");
  assert.equal(catalogModel("claude-opus-5-5", cat), "anthropic/claude-opus-5-5");
  assert.throws(() => catalogModel("mistral/large", cat), /not a model behind foldrun's proxy/);
  assert.throws(() => catalogModel("openai/deepseek-chat", cat), /did you mean deepseek\/deepseek-chat/, "a provider written out is never another's");
  assert.equal(catalogModel("Claude/claude-opus-5-5", cat), "anthropic/claude-opus-5-5", "the provider's other names");
  assert.equal(catalogModel("mistral/large", null), "mistral/large");
  assert.equal(catalogModel("anything", { catalog: [], tiers: {} }), "anything");
});

test("Ctrl-R: search what was typed before, Ctrl-R again for older, Enter puts it on the line, Esc leaves the line as it was", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  fs.writeFileSync(path.join(home, "code-history"), "fix the login test\nadd b\nfix the signup test\n", { mode: 0o600 });
  const s = await platform();
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home, { TERM: "xterm-256color", FOLDRUN_NO_TICKER: "1" });
  const pause = () => new Promise((r) => setTimeout(r, 150));
  try {
    let at = await t.until(/\w ❯ /);
    t.send("draft");
    await pause();
    t.send("\x12");
    await pause();
    t.send("zzz");
    at = await t.until(/no match/, at);
    t.send("\x1b");
    await pause();
    // Typed fast: the keys come in one piece, and each is still the search's.
    t.send("\x12fix\x12");
    at = await t.until(/fix the login test/, at);
    t.send("\r");
    await pause();
    assert.equal(s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run")).length, 0, "Enter in the search only puts the match on the line");
    t.send(" now\r");
    at = await t.until(/send it\? \[y\]es/, at);
    t.send("y\r"); // the upload preview (FOL-212): nothing leaves before this yes
    at = await t.until(/apply it to/, at);
    const posts = s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run"));
    assert.equal(posts.length, 1);
    assert.match(JSON.parse(posts[0]!.body).task as string, /^fix the login test now$/m, "the older match, edited, then sent — the Esc'd search left 'draft' and Ctrl-R replaced it");
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    // Typed, Ctrl-R, a query and Enter in one piece: the typed text reaches
    // the line first, and the match replaces it — never "match + abc" (Codex).
    t.send("abc\x12login\r");
    await pause();
    t.send(" again\r");
    at = await t.until(/apply it to/, at);
    const second = s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run"));
    assert.equal(second.length, 2);
    assert.match(JSON.parse(second[1]!.body).task as string, /^fix the login test now again$/m);
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("typing during a turn: kept for the next message, never answers 'apply it?', Ctrl-C still stops", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const http = await import("node:http");
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const posts: string[] = [];
  let done = false;
  let runs = 0;
  const record = () => ({
    id: `run-ta-${runs}`, flow: "adhoc:coder", status: done ? "completed" : "running", snapshot: { id: ID }, startedAt: "2026-11-19T01:00:00.000Z", ...(done ? { finishedAt: "2026-11-19T01:00:05.000Z" } : {}),
    steps: [{ agent: "coder", group: 1, status: done ? "completed" : "running", attempts: 1, costUsd: 0.01, events: [], ...(done ? { result: "Done." } : {}) }],
  });
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (x) => (body += x));
    req.on("end", () => {
      const [u, q] = (req.url ?? "").split("?");
      const json = (v: unknown) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(v));
      };
      if (u === WS) return json({ name: "desk" });
      if (u === `${WS}/agents`) return json({ agents: [{ name: "coder" }] });
      if (u === `${WS}/snapshots`) return json({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: false });
      if (u === `${WS}/sessions/code-me/messages`) return json({ messages: [] });
      if (u === `${WS}/agents/coder/run`) {
        posts.push(JSON.parse(body).task);
        runs++;
        done = false;
        return json({ ok: true, runId: `run-ta-${runs}`, snapshot: ID, context: "code-me" });
      }
      if (u === `${WS}/runs/run-ta-${runs}`) return json(record());
      if (u === `${WS}/runs/run-ta-${runs}/stream`) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: run\ndata: ${JSON.stringify(record())}\n\n`);
        setTimeout(() => {
          done = true;
          res.write(`event: run\ndata: ${JSON.stringify(record())}\n\nevent: done\ndata: {}\n\n`);
          res.end();
        }, 1500);
        return;
      }
      if (u === `${WS}/runs/run-ta-${runs}/archive`) {
        const meta = new URLSearchParams(q).get("path") === "snapshot.json";
        res.writeHead(200, { "content-type": meta ? "application/json" : "text/x-diff" });
        return res.end(meta ? JSON.stringify({ status: "changed" }) : PATCH);
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", url, "--token", "k"], home, { TERM: "xterm-256color" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("add b\r");
    at = await t.until(/send it\? \[y\]es/, at);
    t.send("y\r"); // the upload preview (FOL-212): nothing leaves before this yes
    at = await t.until(/the agent is on it/, at);
    await new Promise((r) => setTimeout(r, 300));
    // Mid-turn: a "y" and Enter (which once answered the apply prompt), more
    // words, a Backspace, an arrow — all for the next message.
    t.send("y\rthen add cx\x7f\x1b[A");
    at = await t.until(/❯ y then add c/, at);
    at = await t.until(/apply it to/, at);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "a\n", "nothing applied by what was typed during the turn");
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    t.send("\r");
    at = await t.until(/apply it to/, at);
    assert.deepEqual(posts, ["add b", "y then add c"], "the typed text was on the line, and Enter sent it");
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    // FOL-325: the input line is there from the start of a cloud turn, its
    // hint saying what Enter does; Enter pressed alone queues the line for
    // after the turn (it once only added a space), and it is sent then.
    t.send("third\r");
    at = await t.until(/the agent is on it/, at);
    at = await t.until(/❯ Enter or Tab: queue it for after the turn \(\/queue\)/, at, 5_000);
    t.send("fourth");
    await new Promise((r) => setTimeout(r, 200));
    t.send("\r");
    at = await t.until(/1 queued/, at, 5_000);
    at = await t.until(/apply it to/, at);
    // Its patch declined: the queued line is not sent, it is put back on the
    // line (the cloud's rule before FOL-325), and Enter sends it.
    t.send("n\r");
    at = await t.until(/the queued message was not sent — it is on your line/, at, 5_000);
    at = await t.until(/\w ❯ (?:\x1b\[\d+G)?fourth/, at);
    t.send("\r");
    at = await t.until(/apply it to/, at, 15_000);
    assert.deepEqual(posts.slice(-2), ["third", "fourth"], "the queued line was kept, and sent with Enter");
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    // Ctrl-C mid-turn, with the keyboard in raw mode: still the turn's stop.
    t.send("go\r");
    at = await t.until(/the agent is on it/, at);
    await new Promise((r) => setTimeout(r, 200));
    t.send("\x03");
    at = await t.until(/stopping/, at);
    at = await t.until(/before you stopped it[\s\S]*apply it to/, at); // what it had changed is offered
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    server.closeAllConnections();
    server.close();
  }
});

test("typing during a turn: ←/→, Home/End, Ctrl-A/Ctrl-E, Backspace and Delete edit the line, and the cursor is shown where the next key goes (FOL-348)", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const http = await import("node:http");
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const posts: string[] = [];
  let done = false;
  let runs = 0;
  const record = () => ({
    id: `run-ed-${runs}`, flow: "adhoc:coder", status: done ? "completed" : "running", snapshot: { id: ID }, startedAt: "2026-11-19T01:00:00.000Z", ...(done ? { finishedAt: "2026-11-19T01:00:05.000Z" } : {}),
    steps: [{ agent: "coder", group: 1, status: done ? "completed" : "running", attempts: 1, costUsd: 0.01, events: [], ...(done ? { result: "Done." } : {}) }],
  });
  // The first turn ends when the test says so: the keys are all typed while it runs.
  let finish = () => {};
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (x) => (body += x));
    req.on("end", () => {
      const [u, q] = (req.url ?? "").split("?");
      const json = (v: unknown) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(v));
      };
      if (u === WS) return json({ name: "desk" });
      if (u === `${WS}/agents`) return json({ agents: [{ name: "coder" }] });
      if (u === `${WS}/snapshots`) return json({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: false });
      if (u === `${WS}/sessions/code-me/messages`) return json({ messages: [] });
      if (u === `${WS}/agents/coder/run`) {
        posts.push(JSON.parse(body).task);
        runs++;
        done = false;
        return json({ ok: true, runId: `run-ed-${runs}`, snapshot: ID, context: "code-me" });
      }
      if (u === `${WS}/runs/run-ed-${runs}`) return json(record());
      if (u === `${WS}/runs/run-ed-${runs}/stream`) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: run\ndata: ${JSON.stringify(record())}\n\n`);
        const end = () => {
          done = true;
          res.write(`event: run\ndata: ${JSON.stringify(record())}\n\nevent: done\ndata: {}\n\n`);
          res.end();
        };
        if (runs === 1) finish = end;
        else setTimeout(end, 300);
        return;
      }
      if (u === `${WS}/runs/run-ed-${runs}/archive`) {
        const meta = new URLSearchParams(q).get("path") === "snapshot.json";
        res.writeHead(200, { "content-type": meta ? "application/json" : "text/x-diff" });
        return res.end(meta ? JSON.stringify({ status: "changed" }) : PATCH);
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", url, "--token", "k"], home, { TERM: "xterm-256color" });
  const pause = (ms = 150) => new Promise((r) => setTimeout(r, ms));
  /** The last whole frame drawn so far whose input line shows `typed`. */
  const frameWith = (typed: string) => t.out().split("\x1b[?2026h").filter((f) => f.includes(`❯ ${typed}`) && f.includes("\x1b[?2026l")).at(-1) ?? "";
  /** The column (1-based) the cursor belongs at on the frame's last row: `before` cells into what is typed. */
  const columnFor = (frame: string, typed: string, before: number) => {
    const row = (frame.slice(0, frame.lastIndexOf("\x1b[?2026l")).split("\n").at(-1) ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
    return row.indexOf(`❯ ${typed}`) + 2 + before + 1;
  };
  try {
    let at = await t.until(/\w ❯ /);
    t.send("add b\r");
    at = await t.until(/send it\? \[y\]es/, at);
    t.send("y\r");
    at = await t.until(/the agent is on it/, at);
    await pause(300);
    // 'helo', ← twice, 'l': the l goes in the middle.
    t.send("helo");
    await pause();
    t.send("\x1b[D");
    await pause();
    t.send("\x1b[D");
    await pause();
    t.send("l");
    at = await t.until(/❯ hello/, at);
    await pause(200);
    const frame = frameWith("hello");
    // Shown while the turn runs — in the frame itself, not only when the turn ends — after "hel", where the l went in.
    assert.ok(frame.endsWith(`\r\x1b[${columnFor(frame, "hello", 3) - 1}C\x1b[?25h\x1b[?2026l`), `the cursor after "hel": ${JSON.stringify(frame)}`);
    assert.ok(frame.startsWith("\x1b[?25l"), "hidden only while the frame is drawn, in the same write");
    // End, then a Backspace in the middle; Home and Delete; Ctrl-E, Ctrl-A and →.
    t.send("\x1b[F wXorld");
    await pause();
    t.send("\x1b[D\x1b[D\x1b[D\x1b[D\x7f");
    at = await t.until(/❯ hello world/, at);
    await pause();
    t.send("\x1b[H\x1b[3~H");
    at = await t.until(/❯ Hello world/, at);
    await pause();
    t.send("\x05!\x01\x1b[C");
    at = await t.until(/❯ Hello world!/, at);
    await pause(200);
    const last = frameWith("Hello world!");
    assert.ok(last.endsWith(`\r\x1b[${columnFor(last, "Hello world!", 1) - 1}C\x1b[?25h\x1b[?2026l`), `the cursor after "H": ${JSON.stringify(last)}`);
    // A paste is text, never keys: its Delete sequence and Ctrl-A do nothing, and it goes in at the end (Codex).
    t.send("\x05\x1b[200~ x\x1b[3~\x01\x7f\x03y\x1b[201~");
    at = await t.until(/❯ Hello world! xy/, at);
    // A flag pasted before a flag stays two flags: the cursor snaps once the read is in, not per character (Codex).
    await pause();
    t.send("\x1b[200~🇳🇿\x1b[201~");
    await pause();
    t.send("\x1b[D");
    await pause();
    // In two reads, cut between the flag's halves.
    t.send("\x1b[200~🇦");
    await pause();
    t.send("🇺\x1b[201~!");
    at = await t.until(/❯ Hello world! xy🇦🇺!🇳🇿/, at);
    finish();
    at = await t.until(/apply it to/, at);
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    t.send("\r");
    at = await t.until(/apply it to/, at);
    assert.deepEqual(posts, ["add b", "Hello world! xy🇦🇺!🇳🇿"], "the line as edited is the next message");
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    await t.done;
    assert.ok(t.out().lastIndexOf("\x1b[?25h") > t.out().lastIndexOf("\x1b[?25l"), "the cursor shown again at the end");
    const { inputView } = await import("../src/commands.mjs");
    // By display cell: a wide character is two, the end kept in view while the cursor is there.
    assert.deepEqual(inputView("日本語ab", 2, 20), { shown: "日本語ab", col: 4 });
    assert.deepEqual(inputView("abcdefghijklmnopqrstuvwxyz", 26, 10), { shown: "…rstuvwxyz", col: 10 });
    assert.deepEqual(inputView("abcdefghijklmnopqrstuvwxyz", 2, 10), { shown: "abcdefghi…", col: 2 });
    // A grapheme of several characters is as wide as its widest: 👍🏽 and 👩‍💻 are two cells, not four (Codex).
    assert.deepEqual(inputView("👍🏽x", 4, 20), { shown: "👍🏽x", col: 2 });
    assert.deepEqual(inputView("👩‍💻ab", "👩‍💻".length, 20), { shown: "👩‍💻ab", col: 2 });
    const { displayWidth } = await import("../src/code-session.mjs");
    assert.equal(displayWidth("👍🏽👩‍💻e\u0301日"), 2 + 2 + 1 + 2);
    assert.equal(displayWidth("🇦🇺❤️"), 4, "a flag and an emoji-presentation heart are two each");
    const { clipCells, clipCellsEnd } = await import("../src/code-session.mjs");
    assert.equal(clipCells("👍🏽ab", 3), "👍🏽…");
    assert.equal(clipCellsEnd("ab👍🏽", 3), "…👍🏽");
    const { marginLines, cutRows } = await import("../src/code-session.mjs");
    for (const r of marginLines("👍🏽👍🏽ab" + "c".repeat(14), 10)) assert.ok(displayWidth(r) <= 10, `wrapped by grapheme: ${r}`);
    assert.deepEqual(cutRows("abकि", 2), ["ab", "कि"], "a vowel sign stays with its letter");
    // A long table cell with one non-ASCII letter wraps in linear time: the rest is not measured again each row (Codex).
    const { drawTable } = await import("../src/code-session.mjs");
    const head = Array.from({ length: 20 }, (_, i) => `h${i}`);
    const id = (s: string) => s;
    const t0 = Date.now();
    drawTable([`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, `| ${head.map(() => "x".repeat(20000) + "é").join(" | ")} |`], 120, { bold: id, dim: id, cyan: id });
    // 123 ms on a laptop, 1262 ms on a CI runner; measured again each row it is minutes (~3,300 rows × 20,000 × 20 cells).
    assert.ok(Date.now() - t0 < 5000, `table took ${Date.now() - t0} ms`);
    for (const r of cutRows("👍🏽".repeat(9), 6)) assert.ok(displayWidth(r) <= 6 && !/^\u{1f3fd}/u.test(r), `cut whole: ${r}`);
  } finally {
    t.child.kill();
    server.closeAllConnections();
    server.close();
  }
});

test("the reply: markdown drawn, wrapped to the screen, words already shown left out, the sandbox's folder name gone", async () => {
  const { formatReply, withoutSaid, replyPaths } = await import("../src/code-session.mjs");
  const c = { bold: (x: string) => `<b>${x}</b>`, cyan: (x: string) => `<c>${x}</c>`, dim: (x: string) => `<d>${x}</d>` };
  const out = formatReply("- **`calc.py`:** `add` now returns `a + b` instead of `a - b`, which is what the test checks for.\n## Next\n```\nx = 1\n```\nlone * star", 40, c);
  const lines = out.split("\n");
  assert.equal(lines[0], "  • <c><b>calc.py</b></c><b>:</b> <c>add</c> now returns <c>a + b</c>");
  assert.match(lines[1]!, /^ {4}instead of/, "a list item's next line sits under its text");
  for (const l of lines) assert.ok(l.replace(/<\/?[bcd]>/g, "").length <= 38, `within the screen: ${l}`);
  assert.ok(lines.includes("  <b>Next</b>"), "a heading is bold, its # gone");
  assert.ok(lines.includes("  <d>│</d> <d>x = 1</d>") && !out.includes("```"), "fenced code kept in the coding's gutter, its fences gone");
  assert.ok(lines.includes("  lone * star"), "a lone mark is shown as written");
  const said = "The folder holds one file with an obvious bug. I'll fix it.";
  assert.equal(withoutSaid(`${said}\nI fixed the bug.`, [said]), "I fixed the bug.");
  assert.equal(replyPaths("built in `snapshot/site/`; open snapshot/site/index.html"), "built in `site/`; open site/index.html");
  assert.equal(replyPaths("what to change in `snapshot/`. The snapshot holds one file"), "what to change in your folder. The snapshot holds one file");
  assert.equal(replyPaths("wrote /work/agents/coder/snapshot/test.py"), "wrote test.py");
  assert.equal(replyPaths("see https://example.com/snapshot/report"), "see https://example.com/snapshot/report", "a web address is left alone");
  assert.equal(replyPaths("```\ncd snapshot/site\n```"), "```\ncd snapshot/site\n```", "fenced code is left as written");
});

test("the transcript's three kinds have their own marks, with colour and without, and keep them when wrapped at 80 columns (FOL-356)", async () => {
  const { sentBlock, formatAnswer, gutterPatch, gutterRows, cutRows, displayWidth, MARKS } = await import("../src/code-session.mjs");
  const plain = (x: string) => x;
  const none = { bold: plain, cyan: plain, dim: plain, green: plain, red: plain, head: plain, mark: plain, answer: plain, text: plain };
  const tag = (t: string) => (x: string) => `<${t}>${x}</${t}>`;
  const hued = { bold: tag("b"), cyan: tag("c"), dim: tag("d"), green: tag("g"), red: tag("r"), head: tag("h"), mark: tag("v"), answer: tag("a"), text: tag("b") };
  const strip = (x: string) => x.replace(/<\/?[a-z]>/g, "");
  const long = "please look at the failing test in calc.py and tell me why add returns the wrong number when both are negative, then fix it";
  const reply = "The test fails because `add` subtracts. I changed it to return `a + b`, and the test passes now; nothing else in the folder needed a change.\n```\nreturn a + b  # " + "x".repeat(100) + "\n```";
  const patch = `diff --git a/calc.py b/calc.py\n--- a/calc.py\n+++ b/calc.py\n@@ -1 +1 @@\n-    return a - b\n+    return a + b  # ${"y".repeat(100)}\n`;
  for (const c of [none, hued]) {
    const sent = sentBlock(long, 80, c).map(strip);
    const answer = formatAnswer(reply, 80, c).split("\n").map(strip);
    const coding = gutterPatch(patch, 80, c).split("\n").map(strip);
    assert.ok(sent.length >= 2, "the message wraps at 80 columns");
    assert.match(sent[0]!, /^ {2}❯ please look/, "the message starts with ❯");
    for (const l of sent.slice(1)) assert.match(l, /^ {2}┃ \S/, `a wrapped row of the message keeps its bar: ${l}`);
    assert.match(answer[0]!, /^◆ The test fails/, "the answer starts with ◆");
    for (const l of answer.slice(1).filter((x) => x.trim() && !x.includes(MARKS.gutter))) assert.match(l, /^ {2}\S/, `the answer's next rows sit in its margin: ${l}`);
    const code = answer.filter((l) => l.includes(MARKS.gutter));
    assert.ok(code.length >= 2 && code.every((l) => l.startsWith("  │ ")), "code in the answer is in the gutter, a long line cut with the gutter kept");
    assert.ok(coding.length > patch.trimEnd().split("\n").length, "a long diff line is cut into rows");
    for (const l of coding) assert.match(l, /^ {2}│( |$)/, `every diff row is in the gutter: ${l}`);
    for (const l of [...sent, ...answer, ...coding]) assert.ok(displayWidth(l) < 80, `inside 80 columns: ${l}`);
    // Each kind's first mark is its own: none of them stands for another.
    assert.equal(new Set([sent[0]!.trim()[0], answer[0]![0], coding[0]!.trim()[0]]).size, 3);
  }
  // With colour, the marks are painted and a cut diff row keeps its line's colour.
  assert.match(sentBlock("hi", 80, hued)[0]!, /^ {2}<v>❯<\/v> <b>hi<\/b>$/);
  assert.match(formatAnswer("Done.", 80, hued), /^<a>◆<\/a> Done\.$/);
  const added = gutterPatch(patch, 80, hued).split("\n").filter((l) => l.includes("<g>"));
  assert.ok(added.length >= 2 && added.every((l) => l.startsWith("  <d>│</d> <g>")), "the rows of a cut + line are all green, in the gutter");
  // No colour at all: nothing but the marks and the text.
  for (const l of [...sentBlock(long, 80, none), ...formatAnswer(reply, 80, none).split("\n"), ...gutterPatch(patch, 80, none).split("\n")]) assert.doesNotMatch(l, /\x1b|</);
  // Wide characters count as two cells: cut, never past the edge.
  for (const r of cutRows("漢".repeat(50), 20)) assert.ok(displayWidth(r) <= 20);
  assert.deepEqual(gutterRows([{ text: "" }], 80, plain), ["  │"], "an empty row is the gutter alone");
  // A whitespace-only change is seen: trailing spaces and tabs on a changed line as · and → (Codex).
  const ws = gutterPatch("@@ -1 +1 @@\n-x\n+x \n+\ty\t\n same \n", 80, none).split("\n");
  assert.ok(ws.includes("  │ -x") && ws.includes("  │ +x·") && ws.includes("  │ +  y→") && ws.includes("  │  same"), JSON.stringify(ws));
  // A body row that itself starts ++ (an edit to ++i) is marked too; the file header is not touched.
  const pp = gutterPatch("+++ b/a.c\n@@ -1 +1 @@\n-++i;\n+++i; \n", 80, none).split("\n");
  assert.ok(pp.includes("  │ +++ b/a.c") && pp.includes("  │ +++i;·"), JSON.stringify(pp));
  // For a script (--print): marks: false is the answer as before FOL-356 — no ◆, code indented, no gutter.
  const scripted = formatAnswer("Done.\n\n```\nx = 1\n```", 80, { ...none, marks: false });
  assert.ok(!scripted.includes(MARKS.answer) && !scripted.includes(MARKS.gutter) && scripted.includes("    x = 1"), scripted);
});

test("a session on a terminal leaves what was sent as a ❯ block, the answer under ◆ and the diff in the │ gutter, with NO_COLOR (FOL-356)", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  // A terminal that moves its cursor: readline's echo of the message is taken off and drawn again as the block.
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home, { TERM: "xterm-256color", COLUMNS: "80" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("add b\r");
    at = await t.until(/send it\? \[y\]es/, at);
    assert.match(t.out(), /\x1b\[1A\r?\x1b\[J\r?\n {2}❯ add b\r?\n/, "the echo taken off, the message drawn as its own block after a blank line");
    t.send("y\r");
    at = await t.until(/apply it to/, at);
    assert.match(t.out(), /\n◆ Added b\./, "the answer under its own mark");
    assert.doesNotMatch(t.out(), /\x1b\[[0-9;]*m/, "NO_COLOR: marks only, no colour");
    t.send("d\r");
    at = await t.until(/ {2}│ \+b/, at);
    assert.match(t.out(), / {2}│ @@ -1 \+1,2 @@/, "the diff in the gutter");
    at = await t.until(/apply it to/, at);
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a markdown table is drawn as columns, wrapped to the screen; too narrow, one block per row (FOL-310)", async () => {
  const { formatReply, drawTable } = await import("../src/code-session.mjs");
  const c = { bold: (x: string) => `<b>${x}</b>`, cyan: (x: string) => `<c>${x}</c>`, dim: (x: string) => `<d>${x}</d>` };
  const plainOf = (x: string) => x.replace(/<\/?[bcd]>/g, "");
  const table = "Before.\n\n| Source | What it says |\n|---|:---:|\n| **AWS**: aws.amazon.com/what-is/observability/ | Describes observability as built on telemetry, chiefly logs, metrics and traces. |\n| `otel` \\| spec | Lists traces. |\n\nAfter.";
  const wide = formatReply(table, 120, c).split("\n");
  assert.ok(!wide.some((l) => /^\s*\||\*\*|---/.test(plainOf(l))), `no markdown marks left: ${wide.join("\n")}`);
  const head = wide.find((l) => plainOf(l).includes("Source"))!;
  assert.match(head, /<b>Source<\/b>.*<d> │ <\/d><b>What<\/b>/, "the header is bold, columns split by │");
  assert.ok(wide.some((l) => /^  <d>─+─┼─+<\/d>$/.test(l)), "a rule under the header");
  const awsRow = wide.find((l) => plainOf(l).includes("AWS"))!;
  const col = plainOf(head).indexOf("│");
  assert.equal(plainOf(awsRow).indexOf("│"), col, "columns line up");
  assert.ok(wide.some((l) => plainOf(l).includes("otel | spec")), "an escaped bar stays in its cell, code drawn");
  assert.ok(wide.includes("  Before.") && wide.includes("  After."));
  // 60 columns: every line within the screen, a long cell wrapped in its column.
  const mid = formatReply(table, 60, c).split("\n");
  for (const l of mid) assert.ok(plainOf(l).length <= 58, `within the screen: ${l}`);
  assert.ok(mid.filter((l) => plainOf(l).includes("│")).length > 4, "wrapped rows keep their columns");
  assert.ok(mid.some((l) => plainOf(l).includes("╌┼╌")), "rows that wrap are kept apart");
  // 30 columns: one block per row, the header naming each value.
  const narrow = formatReply(table, 30, c).split("\n");
  for (const l of narrow) assert.ok(plainOf(l).length <= 28, `within the screen: ${l}`);
  assert.ok(narrow.some((l) => l.startsWith("  <b>Source: </b>")), narrow.join("\n"));
  // Odd input never crashes, hangs or runs past the screen (Codex).
  const { displayWidth } = await import("../src/code-session.mjs");
  const big = "x".repeat(1000);
  const odd: [string[], number][] = [
    [[`| ${big} | a | b |`, "|---|---|---|", `| ${big} | thirteen char | thirteen char |`], 42],
    [[`| ${big} | b |`, "|---|---|", "| 漢字漢字漢字 | 漢字漢字漢字漢字漢字漢字漢字 |"], 27],
    [["| a | b | c |", "|---|---|---|", "| x |"], 50],
  ];
  for (const [l, w] of odd) for (const line of drawTable(l, w, c)!) assert.ok(displayWidth(plainOf(line)) <= w + 2, `${w}: ${plainOf(line)}`);
  assert.ok(drawTable(["| a | b |", "|---|---|", "| x | end\\| |"], 80, c)!.some((l) => plainOf(l).includes("end|")), "a trailing escaped bar is kept");
  formatReply(`| ${Array(140000).fill("h").join(" | ")} |\n|${Array(140000).fill("---").join("|")}|\n| v |`, 80, c);
  formatReply(`| h |\n|---|\n${"| v |\n".repeat(140000)}`, 80, c);
  // Not a table (no rule row): kept as written.
  assert.equal(drawTable(["| a |", "| b |"], 80, c), null);
  assert.ok(formatReply("| just | bars |", 80, c).includes("| just | bars |"));
});

// ------------------------------------------------- where the agent works
// Owner, 19 Nov 2026: "it asks them if they want to run cloud or local and
// … existing project or new one — as simple as possible". Asked once per
// folder, remembered; flags skip it.


test("local mode helpers: names, tiers, call summaries, inside the folder, the folder's choice", () => {
  assert.equal(projectNameFor("/x/My App_2"), "my-app-2");
  assert.equal(projectNameFor("/x/2026 site"), "code-2026-site");
  assert.equal(projectNameFor("/x/___"), "code-project");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  assert.equal(localModelOf("fast"), "haiku");
  assert.equal(localModelOf(null), "sonnet");
  assert.equal(localModelOf("max"), "opus");
  assert.equal(localModelOf("claude-sonnet-5-5"), "claude-sonnet-5-5");
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-local-")));
  assert.equal(localCallSummary("Write", { file_path: path.join(d, "src/a.ts") }, d), "src/a.ts");
  assert.equal(localCallSummary("Read", { file_path: "/etc/hosts" }, d), "/etc/hosts");
  assert.equal(localCallSummary("Bash", { command: "npm  test\n" }, d), "npm test");
  assert.equal(localCallSummary("Grep", { pattern: "TODO", path: path.join(d, "src") }, d), "TODO in src");
  assert.equal(localCallSummary("WebFetch", { url: "https://x.dev/a" }, d), "https://x.dev/a");
  assert.equal(insideFolder(d, "src/new.ts"), true, "a file not made yet");
  assert.equal(insideFolder(d, "../x"), false);
  assert.equal(insideFolder(d, "/etc/hosts"), false);
  fs.symlinkSync(os.tmpdir(), path.join(d, "out"));
  assert.equal(insideFolder(d, "out/x.txt"), false, "a link out of the folder is outside");
  assert.equal(insideFolder(d + "-sibling", d), false);
  assert.equal(insideFolder(d, "out/../x"), false, "a .. after a link goes up from where the link leads");
  fs.mkdirSync(path.join(d, "sub"));
  assert.equal(insideFolder(d, "sub/../a"), true);
  fs.symlinkSync(path.join(d, "gone"), path.join(d, "dangling"));
  assert.equal(insideFolder(d, "dangling"), false, "a link that leads nowhere is outside");
  assert.equal(insideFolder(d, ""), false);
  assert.equal(insideFolder(d, 7), false);
  assert.equal(insideFolder("/", "/etc"), true);
  if (process.platform !== "win32") {
    // A backslash is part of a name here: "<folder>\\x" is a sibling, not inside (Codex).
    fs.symlinkSync(os.tmpdir(), `${d}\\escape`);
    assert.equal(insideFolder(d, `${d}\\escape/file`), false);
  }
  rememberSession(path.join(home, "s.json"), d, { context: "c", ws: "desk", agent: "coder", mode: "local" });
  // A folder kept by an older CLI: on this computer, with cloud agents — what it had.
  assert.deepEqual(folderChoice(path.join(home, "s.json"), d), { ws: "desk", mode: "local", localOnly: false, engine: null });
  rememberSession(path.join(home, "s.json"), d, { context: "c", ws: "desk", agent: "coder", mode: "local", localOnly: true });
  assert.equal(folderChoice(path.join(home, "s.json"), d)?.localOnly, true);
  rememberSession(path.join(home, "s.json"), d, { context: "c", ws: "desk", agent: "coder", mode: "cloud", localOnly: true });
  assert.equal(folderChoice(path.join(home, "s.json"), d)?.localOnly, true, "kept while the session works in the cloud: /local finds it again");
  assert.match(localPrompt(d), /cloud_jobs tool/);
  assert.doesNotMatch(localPrompt(d, "", false), /cloud_jobs|agents in the cloud/);
  rememberSession(path.join(home, "s.json"), d, { context: "c", ws: "desk", agent: "coder", mode: "local", engine: "foldrun" });
  assert.equal(folderChoice(path.join(home, "s.json"), d)?.engine, "foldrun");
  assert.equal(folderChoice(path.join(home, "s.json"), "/elsewhere"), null);
});

/** One scripted model turn as the Messages API streams it. */
test("/status explain ranks what used the model, its figures add up, and foldrun usage --session gives the same outside the session", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let calls = 0;
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-cx/messages`]: () => ({ messages: [] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    // Priced by the model that served the call (the answer's own), not the one asked for.
    // It is listed at $10 in, $100 out per million: 100 in + 5 out a call is $0.0015.
    "GET /v1/account/usage/rates": () => ({ catalogue: { models: { margin: 1, prices: [{ provider: "x", model: "claude-sonnet-test", inputPerMTok: 10, outputPerMTok: 100 }] } } }),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": (b) => {
      void b;
      calls++;
      return sse([{ type: "text", text: `answer ${calls}` }]);
    },
  });
  const args = ["code", d, "--local", "--to", "desk", "--context", "code-cx", "--url", s.url, "--token", "k"];
  const t = onTerminal(args, home, { TERM: "dumb", COLUMNS: "220" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/status explain\r");
    at = await t.until(/nothing has used the model yet/, at);
    t.send("one\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/answer 1/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    t.send("two\r");
    at = await t.until(/answer 2/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/status cost\r");
    at = await t.until(/\/status explain: where it went, row by row/, at);
    t.send("/status explain\r");
    at = await t.until(/where it went\s+2 rows, the largest first[\s\S]*turn 1 · on this computer\s+claude-sonnet-test\s+1 call\s+100 read\s+0% cached\s+0 written\s+5 out\s+≈\$0\.002[\s\S]*turn 2 · on this computer[\s\S]*in all: 2 model calls · 200 tokens read, 0% from the cache, 0 written to it · 10 out[\s\S]*\$0\.000 the cloud runs' cost, as their records hold it — the figure \/status cost shows[\s\S]*≈\$0\.003 on this computer[\s\S]*an estimate[\s\S]*foldrun usage --session code-cx/, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
    // A terminal that continues the conversation counts its turns on from the ones kept.
    const t2 = onTerminal([...args, "--continue"], home, { TERM: "dumb", COLUMNS: "220" });
    try {
      let at2 = await t2.until(/\w ❯ /);
      // The key made for this computer is kept: nothing is asked again.
      t2.send("three\r");
      at2 = await t2.until(/answer 3/, at2, 30_000);
      at2 = await t2.until(/\w ❯ /, at2);
      t2.send("/status explain\r");
      at2 = await t2.until(/where it went\s+1 row, the largest first\s+turn 3 · on this computer/, at2);
      t2.send("/quit\r");
      assert.equal(await t2.done, 0);
    } finally {
      t2.child.kill();
    }
    const cli = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
    const env = { ...outerEnv(), FOLDRUN_HOME: home, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1" };
    // Not execFileSync: the fake platform answers from this process's own loop.
    const run = (a: string[]) =>
      new Promise<{ code: number; out: string }>((done) => {
        const ch = spawn(process.execPath, [cli, ...a], { env });
        let out = "";
        let err = "";
        ch.stdout.on("data", (x) => (out += x));
        ch.stderr.on("data", (x) => (err += x));
        ch.on("close", (code) => done({ code: code ?? 1, out: code ? out + err : out }));
      });
    const j = JSON.parse((await run(["usage", "--session", "code-cx", "--json", "--url", s.url, "--token", "k"])).out);
    assert.equal(j.session, "code-cx");
    assert.deepEqual(j.rows.map((r: any) => r.turn).sort(), [1, 2, 3]);
    assert.deepEqual([j.totals.calls, j.totals.read, j.totals.output, j.totals.billedUsd, j.pricesRead, j.workspace], [3, 300, 15, 0, true, "desk"]);
    assert.equal(Number(j.totals.estimatedUsd.toFixed(6)), 0.0045);
    // The plan here does not pay for tokens: the payer is not called the plan.
    assert.equal(j.rows[0].paidBy, "the account's credits");
    assert.match((await run(["usage", "--session"])).out, /code-cx/);
    assert.match((await run(["usage", "--session", "code-cx", "--url", s.url, "--token", "k"])).out, /code-cx\s+desk · [\s\S]*where it went[\s\S]*in all: 3 model calls/);
    const none = await run(["usage", "--session", "nope"]);
    assert.notEqual(none.code, 0);
    assert.match(none.out, /no conversation nope has spend kept/);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a background job (FOL-293): started as a command is, its input asked every time with no always, reading and stopping it unasked", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "j1", name: "Bash", input: { command: "while read l; do echo got-$l; done", run_in_background: true } }]),
    () => sse([{ type: "tool_use", id: "j2", name: "Bash", input: { job: "b1", stdin: "hi\n" } }]),
    () => sse([{ type: "tool_use", id: "j3", name: "Bash", input: { job: "b1", wait: 500 } }]),
    () => sse([{ type: "tool_use", id: "j4", name: "Bash", input: { job: "b1", stop: true } }]),
    () => sse([{ type: "text", text: "Job handled." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-bg293/messages`]: () => ({ messages: [] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return (turns[asked.length - 1] ?? (() => sse([{ type: "text", text: "(no more)" }])))();
    },
  });
  const t = onTerminal(["code", d, "--local", "--no-sandbox", "--to", "desk", "--context", "code-bg293", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("start the reader\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/allow\? \[y\]es/, at, 30_000);
    t.send("y\r");
    at = await t.until(/typed into the background job b1[\s\S]*> hi[\s\S]*allow\? \[y\]es · \[n\]o/, at, 30_000);
    t.send("y\r");
    at = await t.until(/Job handled\./, at, 30_000);
    const result = (n: number) => JSON.stringify((asked[n]?.messages ?? []).at(-1));
    assert.match(result(1), /job b1 is running/);
    assert.match(result(3), /got-hi/, "the wait read what the job printed, unasked");
    assert.match(result(4), /stopped|SIGTERM/, "the stop ran unasked");
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("/resume find finds a conversation by a line only a tool printed and goes back to it; /rename names it; foldrun sessions search finds it from the shell", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "s1", name: "Bash", input: { command: "printf 'ERR-%s\\n' ZX81" } }]),
    () => sse([{ type: "text", text: "it printed a code" }]),
    () => sse([{ type: "text", text: "a new start" }]),
    () => sse([{ type: "text", text: "back again" }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-se/messages`]: () => ({ messages: [] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return (turns[asked.length - 1] ?? (() => sse([{ type: "text", text: "(no more)" }])))();
    },
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-se", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/resume find\r");
    at = await t.until(/\/resume find <words> — every word on one line/, at);
    t.send("run it\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/allow\? \[y\]es/, at, 30_000);
    t.send("y\r");
    at = await t.until(/it printed a code/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/rename the printing one\r");
    at = await t.until(/this conversation is now called: the printing one/, at);
    t.send("/resume new\r");
    at = await t.until(/a fresh conversation/, at);
    t.send("hello\r");
    at = await t.until(/a new start/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    // The words are in no message and in no command: only in what the command printed.
    t.send("/resume find err-zx81\r");
    at = await t.until(/ 1  the printing one · [^\n]* · local turn 1 · tool output\s+ERR-ZX81\s+go back to which\? a number, or Enter to stay:/, at);
    t.send("1\r");
    at = await t.until(/back in: the printing one/, at);
    at = await alone(t, "/resume", at);
    at = await t.until(/ 1  hello · [\s\S]*\/resume find <words> finds one by what was said in it/, at);
    t.send("and now\r");
    at = await t.until(/back again/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    // The agent reads the conversation it went back to: the tool's output is in what was sent.
    assert.match(JSON.stringify(asked[3].messages), /ERR-ZX81/);
    t.send("/resume find nothing-like-this\r");
    at = await t.until(/nothing found in the 2 conversations of this folder kept on this computer — turns in the cloud/, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
    const cli = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
    const env = { ...outerEnv(), FOLDRUN_HOME: home, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1" };
    const j = JSON.parse(execFileSync(process.execPath, [cli, "sessions", "search", "ERR-ZX81", "--json"], { env, encoding: "utf8", cwd: os.tmpdir() }));
    assert.deepEqual(j.hits.map((h: any) => [h.session, h.name, h.workspace, h.turn, h.who, h.line]), [["code-se", "the printing one", "desk", 1, "tool output", "ERR-ZX81"]]);
    const shown = execFileSync(process.execPath, [cli, "sessions", "search", "err-zx81"], { env, encoding: "utf8", cwd: os.tmpdir() });
    assert.match(shown, /the printing one · desk \(acme\) · [\s\S]*foldrun code \S+ --local --url \S+ --to desk --agent coder --context code-se --continue[\s\S]*local turn 1 tool output: ERR-ZX81[\s\S]*only conversations worked on this computer are searched/);
    assert.match(execFileSync(process.execPath, [cli, "sessions", "search", "err-zx81", "--here"], { env, encoding: "utf8", cwd: os.tmpdir() }), /nothing found in the 0 conversations kept on this computer for this folder/);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a cloud patch taken file by file: two of three go in, the third is left out, /undo takes back exactly those two, and the agent's next turn is told", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const THREE =
    "diff --git a/a.txt b/a.txt\nindex 7898192..422c2b7 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n a\n+b\n" +
    "diff --git a/two.txt b/two.txt\nnew file mode 100644\nindex 0000000..f719efd\n--- /dev/null\n+++ b/two.txt\n@@ -0,0 +1 @@\n+two\n" +
    "diff --git a/three.txt b/three.txt\nnew file mode 100644\nindex 0000000..2bdf67a\n--- /dev/null\n+++ b/three.txt\n@@ -0,0 +1 @@\n+three\n";
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => ({ ok: true, runId: RUN, snapshot: ID, context: "code-pf" }),
    [`GET ${WS}/runs/${RUN}`]: () => ({
      id: RUN, flow: "adhoc:coder", status: "completed", snapshot: { id: ID }, startedAt: "2026-11-19T01:00:00.000Z", finishedAt: "2026-11-19T01:00:05.000Z",
      steps: [{ agent: "coder", group: 1, status: "completed", attempts: 1, costUsd: 0.02, events: [{ t: "2026-11-19T01:00:01.000Z", type: "text", text: "Made three changes." }], result: "Made three changes." }],
    }),
    [`GET ${WS}/runs/${RUN}/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "changed" }), "application/json") : raw(THREE, "text/x-diff")),
    [`GET ${WS}/sessions/code-pf/messages`]: () => ({ messages: [] }),
  });
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-pf", "--url", s.url, "--token", "k"], home, { COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("make three changes\r");
    at = await t.until(/send it\? \[y\]es/, at);
    t.send("y\r");
    at = await t.until(/apply it to[^\n]*\(f: file by file\)/, at, 30_000);
    t.send("f\r");
    at = await t.until(/1\/3 a\.txt \|\s+1 \+[^\n]*take it\? \[y\/n\] \(d shows it\)/, at);
    t.send("d\r");
    at = await t.until(/\+b\s[\s\S]*1\/3 a\.txt[^\n]*take it\?/, at);
    assert.doesNotMatch(t.out().slice(at - 400), /\+two/, "d shows that file's change alone");
    t.send("y\r");
    at = await t.until(/2\/3 two\.txt[^\n]*take it\?/, at);
    t.send("n\r");
    at = await t.until(/3\/3 three\.txt[^\n]*take it\?/, at);
    t.send("y\r");
    at = await t.until(/a\.txt[^\n]*\n[^\n]*three\.txt[^\n]*\n[^\n]*2 files changed[\s\S]*apply these 2 of 3 files\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/left out: two\.txt — the whole patch is kept at [\s\S]*✓ applied[\s\S]*\/undo takes it back/, at);
    at = await t.until(/\w ❯ /, at);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "a\nb\n");
    assert.equal(fs.readFileSync(path.join(d, "three.txt"), "utf8"), "three\n");
    assert.equal(fs.existsSync(path.join(d, "two.txt")), false, "the refused file is not in the folder");
    // The agent's next turn knows which went in and which was refused.
    t.send("go on\r");
    // The fake platform answers with the same patch, which no longer applies: said, and the prompt comes back.
    at = await t.until(/send it\? \[y\]es|does not apply/, at, 30_000);
    if (!/does not apply/.test(t.out().slice(at - 200, at))) {
      t.send("y\r");
      at = await t.until(/does not apply/, at, 30_000);
    }
    at = await t.until(/\w ❯ /, at);
    const posts = s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run"));
    assert.equal(posts.length, 2);
    assert.match(JSON.parse(posts[1]!.body).task, /Changes applied, to: a\.txt, three\.txt\. Changes declined by the person, to: two\.txt — for these the folder is as it was before/);
    // Kept with the conversation: a restart, or the other side taking over, is told the same.
    const kept = JSON.parse(fs.readFileSync(path.join(home, "code-sessions.json"), "utf8"));
    assert.deepEqual(Object.values(kept as Record<string, any>)[0].transcript[0].part, { taken: ["a.txt", "three.txt"], refused: ["two.txt"] });
    // /undo takes back exactly what was applied.
    // /undo alone lists what can be taken back (FOL-263); Enter takes the patch.
    at = await alone(t, "/undo", at);
    at = await t.until(/take back the last change/, at);
    t.send("y\r");
    at = await t.until(/taken back/, at);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "a\n");
    assert.equal(fs.existsSync(path.join(d, "three.txt")), false);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("every new session asks where (last answer ticked, Enter keeps it); the project is asked once per folder; --continue and --cloud ask nothing; exit leaves", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    "GET /v1/workspaces": () => ({ workspaces: [{ name: "desk" }, { name: "other" }] }),
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
  });
  const t = onTerminal(["code", d, "--url", s.url, "--token", "k"], home);
  try {
    // Three ways to work (FOL-263): the cloud is the third.
    let at = await t.until(/Where should this session work\?[\s\S]*This computer only[\s\S]*This computer, agents in the cloud[\s\S]*The cloud[\s\S]*Esc to cancel/);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\x1b[B\x1b[B\r");
    at = await t.until(/works\s+in the cloud/, at);
    at = await t.until(/Which project\?[\s\S]*1\. desk[\s\S]*2\. other[\s\S]*3\. \+ New project\s+named foldrun-code-sess-[\s\S]*Esc to cancel/, at);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\r");
    at = await t.until(/project\s+desk/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
  }
  const again = onTerminal(["code", d, "--url", s.url, "--token", "k"], home);
  try {
    let at = await again.until(/Where should this session work\?[\s\S]*Enter keeps what this folder had last time[\s\S]*3\. The cloud[^\n]*✔[\s\S]*Esc to cancel/);
    await new Promise((r) => setTimeout(r, 100));
    again.send("\r");
    at = await again.until(/\w ❯ /, at);
    assert.doesNotMatch(again.out(), /Which project/);
    assert.match(again.out(), /project\s+desk[\s\S]*works\s+in the cloud/);
    again.send("exit\r");
    assert.equal(await again.done, 0);
  } finally {
    again.child.kill();
  }
  for (const extra of [["--continue"], ["--cloud"]]) {
    const third = onTerminal(["code", d, ...extra, "--url", s.url, "--token", "k"], home);
    try {
      await third.until(/\w ❯ /);
      assert.doesNotMatch(third.out(), /Where should|Which project/, extra.join(" "));
      third.send("quit\r");
      assert.equal(await third.done, 0);
    } finally {
      third.child.kill();
    }
  }
  s.close();
});

test("a folder that works on this computer is never sent to the cloud by a script's --task: it must say --local or --cloud; --cloud --task is one turn", async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({ [`GET ${WS}`]: () => ({ name: "desk" }), [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }) });
  try {
    rememberSession(path.join(home, "code-sessions.json"), d, { context: "code-x", ws: "desk", agent: "coder", mode: "local" });
    const cli = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
    const r = spawnSync(process.execPath, [cli, "code", d, "--task", "do it", "--url", s.url, "--token", "k"], { encoding: "utf8", env: { ...process.env, FOLDRUN_HOME: home, NO_COLOR: "1" } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /works on this computer — say where this script's turn runs: --local -p[\s\S]*--cloud -p/);
    assert.equal(s.seen.length, 0, "nothing reached the platform");
    // --cloud --task is one turn: the folder still works on this computer after.
    // The stub has no cloud turn to give, so the call waits out its timeout:
    // 2 s, not the default 30 s that put this file over its 180 s cap on CI.
    spawnSync(process.execPath, [cli, "code", d, "--cloud", "--task", "do it", "--url", s.url, "--token", "k"], { encoding: "utf8", env: { ...process.env, FOLDRUN_HOME: home, NO_COLOR: "1", FOLDRUN_TIMEOUT: "2" } });
    assert.equal(Object.values(JSON.parse(fs.readFileSync(path.join(home, "code-sessions.json"), "utf8")) as any[])[0].mode, "local");
  } finally {
    s.close();
  }
});

test("--local: foldrun's own agent; a key for this computer after a yes; reads run, changes and commands are asked; a command hiding a line never runs; the key never reaches a command; the turn line names the foldrun plan; --continue carries the conversation", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "text", text: "Looking first." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: path.join(d, "a.txt") } }]),
    () => sse([{ type: "tool_use", id: "t2", name: "Write", input: { file_path: path.join(d, "b.txt"), content: "bee\n" } }]),
    () => sse([{ type: "tool_use", id: "t3", name: "Bash", input: { command: "echo key=${ANTHROPIC_AUTH_TOKEN:-none} > k.txt" } }, { type: "tool_use", id: "t3b", name: "Bash", input: { command: "echo safe #\u001b]0;\ntouch pwn\n#\u0007" } }]),
    () => sse([{ type: "text", text: "Wrote **b.txt**." }]),
    () => sse([{ type: "text", text: "Yes, b.txt." }]),
    () => sse([{ type: "text", text: "Still here." }]),
  ];
  let keysMade = 0;
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: fast\n---\nYou code.\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => {
      keysMade++;
      const body = JSON.parse(String(b));
      assert.equal(body.purpose, "gateway");
      // FOL-208: an account key — the plan first, bought credits only up
      // to its wallet budget, and a daily limit on every call.
      assert.equal(body.credential, "account");
      assert.ok(body.dailyUsd > 0, "a key with a limit");
      assert.ok(body.walletUsd > 0 && body.walletUsd <= 20, "a wallet budget");
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return turns[asked.length - 1]!();
    },
  });
  try {
    // A startup file bash would run before every command: never for the agent's.
    const hook = path.join(home, "bash-env.sh");
    fs.writeFileSync(hook, `echo sourced > ${JSON.stringify(path.join(home, "hook-ran"))}\n`);
    const t = onTerminal(["code", d, "--local", "--to", "desk", "--url", s.url, "--token", "k"], home, { BASH_ENV: hook, ENV: hook });
    try {
      let at = await t.until(/works\s+on this computer/);
      assert.doesNotMatch(t.out(), /Which engine|Claude/);
      at = await t.until(/\w ❯ /, at);
      t.send("add b\r");
      // Answered the moment each question shows: the prompt listens before
      // it prints, so an instant reply is the question's.
      const answer = async (k: string) => t.send(k);
      at = await t.until(/make it\? \[y\/N\]/, at);
      await answer("y\r");
      at = await t.until(/Read a\.txt/, at);
      at = await t.until(/Write b\.txt[\s\S]*a new file · 1 line[\s\S]*allow\?/, at);
      assert.doesNotMatch(t.out().slice(0, at), /Read a\.txt[\s\S]*allow\?[\s\S]*Write/, "a read in the folder is not asked");
      assert.equal(fs.existsSync(path.join(d, "b.txt")), false, "nothing written before the yes");
      await answer("y\r");
      at = await t.until(/\$ echo key=[\s\S]*allow\?/, at);
      await answer("y\r");
      at = await t.until(/hidden control characters — not run[\s\S]*✓ done[\s\S]*on foldrun Pro plan[\s\S]*changed b\.txt/, at);
      assert.equal(fs.existsSync(path.join(d, "pwn")), false, "a command that hides a line never runs");
      assert.equal(fs.readFileSync(path.join(d, "b.txt"), "utf8"), "bee\n");
      const ran = JSON.stringify(asked[3]?.messages?.at(-1)?.content ?? null).slice(0, 600);
      assert.ok(fs.existsSync(path.join(d, "k.txt")), `the allowed command ran: ${ran}`);
      assert.equal(fs.readFileSync(path.join(d, "k.txt"), "utf8").trim(), "key=none", "the commands never see the model key");
      assert.equal(fs.existsSync(path.join(home, "hook-ran")), false, "BASH_ENV is not run before the agent's commands");
      at = await t.until(/\w ❯ /, at);
      t.send("did you?\r");
      at = await t.until(/Yes, b\.txt\./, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      assert.equal(await t.done, 0);
    } finally {
      t.child.kill();
    }
    assert.equal(keysMade, 1);
    assert.match(String(asked[0].model), /haiku/);
    const seen = s.seen.filter((x: any) => x.url === "/v1/messages");
    assert.equal(seen[0]!.headers.authorization, "Bearer fr_gw_test", "the computer's key, not the person's token");
    assert.match(JSON.stringify(asked[4].messages), /add b[\s\S]*bee[\s\S]*did you\?/, "the next turn carries the first");
    assert.equal(fs.statSync(path.join(home, "code-local-keys.json")).mode & 0o777, 0o600);
    const kept = fs.readdirSync(path.join(home, "code-engine"));
    assert.equal(kept.length, 1);
    assert.equal(fs.statSync(path.join(home, "code-engine", kept[0]!)).mode & 0o777, 0o600);
    assert.doesNotMatch(fs.readFileSync(path.join(home, "code-sessions.json"), "utf8"), /fr_gw_test/);

    // The next day: no questions, the same engine, the conversation goes on.
    const again = onTerminal(["code", d, "--to", "desk", "--continue", "--url", s.url, "--token", "k"], home);
    try {
      let at = await again.until(/works\s+on this computer[\s\S]*continuing/);
      assert.doesNotMatch(again.out(), /make it\?/);
      at = await again.until(/\w ❯ /, at);
      again.send("still?\r");
      at = await again.until(/Still here\./, at);
      again.send("/quit\r");
      await again.done;
    } finally {
      again.child.kill();
    }
    assert.match(JSON.stringify(asked[5].messages), /add b[\s\S]*did you\?[\s\S]*still\?/);
  } finally {
    s.close();
  }
});

test("--local, cloud_jobs with /permissions cloud ask: starting is asked (no sends nothing); after a yes the run's patch is asked again and put into the folder; the agent hears what became of it", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  // Asking first is the person's choice (FOL-382): off unless set.
  fs.writeFileSync(path.join(home, "code-prefs.json"), JSON.stringify({ cloudAsk: true }));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "c1", name: "cloud_jobs", input: { tasks: ["add b"] } }]),
    () => sse([{ type: "text", text: "Fine, not then." }]),
    () => sse([{ type: "tool_use", id: "c2", name: "cloud_jobs", input: { tasks: ["add b to a.txt\nthen run the tests"] } }]),
    // The call answered at once (FOL-382): the agent collects the job.
    () => sse([{ type: "tool_use", id: "c3", name: "cloud_jobs", input: { wait: true } }]),
    () => sse([{ type: "text", text: "The cloud agent added b." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\nYou code.\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "POST /v1/keys": () => ({ id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: 100, walletUsd: 20 }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => ({ ok: true, runId: RUN, snapshot: ID }),
    [`GET ${WS}/runs/${RUN}`]: () => ({
      id: RUN, flow: "adhoc:coder", status: "completed", snapshot: { id: ID },
      steps: [{ agent: "coder", group: 1, status: "completed", attempts: 1, costUsd: 0.07, result: "Added b; tests pass." }],
    }),
    [`GET ${WS}/runs/${RUN}/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "changed", modified: ["a.txt"] }), "application/json") : raw(PATCH, "text/x-diff")),
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return turns[asked.length - 1]!();
    },
  });
  try {
    const t = onTerminal(["code", d, "--local", "--engine", "foldrun", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("use the cloud\r");
      at = await t.until(/make it\? \[y\/N\]/, at);
      t.send("y\r");
      at = await t.until(/1 cloud job: sends a copy of this folder to desk[^\n]*no cloud job has finished[\s\S]*1\. add b[\s\S]*\/permissions cloud ask is on[\s\S]*\[a\]lways for cloud jobs this session[\s\S]*allow\?|allow\?[\s\S]*cloud jobs this session/, at);
      t.send("n\r");
      at = await t.until(/Fine, not then\./, at);
      assert.equal(s.seen.filter((x: any) => x.url === `${WS}/snapshots`).length, 0, "no: nothing sent");
      at = await t.until(/\w ❯ /, at);
      t.send("ok go\r");
      at = await t.until(/1\. add b to a\.txt[\s\S]*then run the tests[\s\S]*allow\?/, at);
      t.send("y\r");
      at = await t.until(/send it\? \[y\]es/, at);
      t.send("y\r"); // the upload preview (FOL-212): nothing leaves before this yes
      at = await t.until(/sent the folder to desk[\s\S]*cloud job #1 · run-sess-1/, at);
      at = await t.until(/✓ cloud job #1 · completed[\s\S]*cloud job #1's changes, into this folder:[\s\S]*a\.txt \|\s+1 \+[\s\S]*\[a\]lways for cloud jobs' changes this session[\s\S]*\[d\]iff/, at);
      assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "a\n", "nothing applied before the yes");
      t.send("d\r");
      at = await t.until(/\+b[\s\S]*allow\?/, at);
      t.send("y\r");
      at = await t.until(/applied[\s\S]*The cloud agent added b\.[\s\S]*✓ done[\s\S]*changed a\.txt/, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      assert.equal(await t.done, 0);
    } finally {
      t.child.kill();
    }
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "a\nb\n");
    assert.ok(asked[0].tools.some((x: any) => x.name === "cloud_jobs"), "the model is offered the tool");
    assert.match(JSON.stringify(asked[1].messages), /person said no/);
    assert.match(JSON.stringify(asked[3].messages.at(-1)), /Started 1 cloud job on a copy of this folder[\s\S]*#1 run run-sess-1/, "the call answers once the job has started");
    const result = JSON.stringify(asked[4].messages.at(-1));
    assert.match(result, /\[cloud jobs: 1 finished, none still running\][\s\S]*#1 run run-sess-1: completed/);
    assert.match(result, /Added b; tests pass\./);
    assert.match(result, /Put into the folder/);
    const runs = s.seen.filter((x: any) => x.method === "POST" && x.url === `${WS}/agents/coder/run`);
    assert.equal(runs.length, 1);
    const sent = JSON.parse(runs[0]!.body);
    assert.equal(sent.snapshot, ID);
    assert.equal(sent.task, "add b to a.txt\nthen run the tests");
    assert.equal(sent.context, undefined, "its own conversation, not this one");
  } finally {
    s.close();
  }
});

test("--local, cloud_jobs in a folder of repositories (FOL-351): no path is refused with their names, .. is refused, path: repo-b sends repo-b alone and its patch goes into repo-b, f takes it file by file there, /undo takes it back there", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  // The session's folder is no repository; it holds two.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-code-repos-"));
  for (const [name, file] of [["repo-a", "only-a.txt"], ["repo-b", "a.txt"]] as const) {
    const d = path.join(root, name);
    fs.mkdirSync(d);
    const git = (...a: string[]) => execFileSync("git", ["-C", d, "-c", "user.email=t@t", "-c", "user.name=t", ...a]);
    git("init", "-q");
    fs.writeFileSync(path.join(d, file), "a\n");
    git("add", "-A");
    git("commit", "-qm", "base");
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  // Two files, so the per-file view is offered: paths relative to repo-b, as the platform makes them from its copy.
  const TWO = PATCH + "diff --git a/two.txt b/two.txt\nnew file mode 100644\nindex 0000000..f719efd\n--- /dev/null\n+++ b/two.txt\n@@ -0,0 +1 @@\n+two\n";
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "c1", name: "cloud_jobs", input: { tasks: ["add b"] } }]),
    () => sse([{ type: "tool_use", id: "c2", name: "cloud_jobs", input: { tasks: ["add b"], path: "../x" } }]),
    () => sse([{ type: "tool_use", id: "c3", name: "cloud_jobs", input: { tasks: ["add b to a.txt"], path: "repo-b" } }]),
    () => sse([{ type: "tool_use", id: "c4", name: "cloud_jobs", input: { wait: true } }]),
    () => sse([{ type: "text", text: "The cloud agent added b in repo-b." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\nYou code.\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "POST /v1/keys": () => ({ id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: 100, walletUsd: 20 }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => ({ ok: true, runId: RUN, snapshot: ID }),
    [`GET ${WS}/runs/${RUN}`]: () => ({
      id: RUN, flow: "adhoc:coder", status: "completed", snapshot: { id: ID },
      steps: [{ agent: "coder", group: 1, status: "completed", attempts: 1, costUsd: 0.07, result: "Added b." }],
    }),
    // The patch as the platform makes it: paths relative to the repository it was sent.
    [`GET ${WS}/runs/${RUN}/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "changed", modified: ["a.txt"], added: ["two.txt"] }), "application/json") : raw(TWO, "text/x-diff")),
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return turns[asked.length - 1]!();
    },
  });
  try {
    const t = onTerminal(["code", root, "--local", "--engine", "foldrun", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("use the cloud on repo-b\r");
      at = await t.until(/make it\? \[y\/N\]/, at);
      t.send("y\r");
      at = await t.until(/send it\? \[y\]es/, at);
      t.send("d\r"); // every path that goes: repo-b's, and nothing of repo-a
      at = await t.until(/send it\? \[y\]es/, at);
      const shown = t.out();
      assert.match(shown, /1 cloud job: sends a copy of the repository repo-b in this folder to desk/);
      assert.match(shown, /repository repo-b in this folder\)/, "the upload preview says what goes");
      assert.match(shown, /a\.txt/);
      assert.doesNotMatch(shown, /only-a\.txt/, "nothing of repo-a goes");
      t.send("y\r");
      at = await t.until(/sent the repository repo-b to desk[\s\S]*cloud job #1 · run-sess-1/, at);
      at = await t.until(/✓ cloud job #1 · completed[\s\S]*changes, into the repository repo-b in this folder \(paths below are in it\):[\s\S]*a\.txt\s+\|\s+1 \+[\s\S]*allow\?/, at);
      assert.equal(fs.readFileSync(path.join(root, "repo-b", "a.txt"), "utf8"), "a\n", "nothing applied before the yes");
      t.send("f\r"); // file by file, read from repo-b
      at = await t.until(/1\/2 a\.txt\s+\|\s+1 \+[^\n]*take it\?/, at);
      t.send("y\r");
      at = await t.until(/2\/2 two\.txt[^\n]*take it\?/, at);
      t.send("n\r");
      at = await t.until(/apply these 1 of 2 files\? \[y\/N\]/, at);
      t.send("y\r");
      at = await t.until(/The cloud agent added b in repo-b\.[\s\S]*✓ done/, at);
      at = await t.until(/\w ❯ /, at);
      assert.equal(fs.readFileSync(path.join(root, "repo-b", "a.txt"), "utf8"), "a\nb\n", "applied inside repo-b");
      assert.equal(fs.existsSync(path.join(root, "a.txt")), false, "never at the folder's top");
      assert.equal(fs.existsSync(path.join(root, "repo-b", "two.txt")), false, "the file said no to stays out");
      // /undo takes it back in repo-b.
      at = await alone(t, "/undo", at);
      at = await t.until(/take back the last change/, at);
      t.send("y\r");
      at = await t.until(/taken back/, at);
      assert.equal(fs.readFileSync(path.join(root, "repo-b", "a.txt"), "utf8"), "a\n");
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      assert.equal(await t.done, 0);
    } finally {
      t.child.kill();
    }
    const said = (k: number) => JSON.stringify(asked[k].messages.at(-1));
    assert.match(said(1), /is not a git repository, but it holds 2: \\"repo-a\\", \\"repo-b\\"\. Call cloud_jobs again with path/);
    assert.match(said(2), /climbs out with/);
    assert.match(said(3), /Started 1 cloud job on a copy of this folder[\s\S]*#1 run run-sess-1/);
    assert.match(said(4), /partly put into the folder \(1 of 2 files\)[\s\S]*It changed repo-b\/a\.txt, repo-b\/two\.txt\.[\s\S]*repo-b\/a\.txt[\s\S]*repo-b\/two\.txt/);
    assert.equal(s.seen.filter((x: any) => x.url === `${WS}/snapshots`).length, 1, "one snapshot, for the call with path");
    assert.equal(s.seen.filter((x: any) => x.method === "POST" && x.url === `${WS}/agents/coder/run`).length, 1);
  } finally {
    s.close();
  }
});

test("--local: a reply cut off at the output limit says so, is shown, and the next turn goes on from its words (FOL-211)", { skip: !hasPty ? "needs python3's pty" : !coreEndsHonestly ? "needs the @foldrun/core release with FOL-211" : false, timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "text", text: "Here is the first half of the pla" }], "max_tokens"),
    () => sse([{ type: "text", text: "n, and the rest." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\nYou code.\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "POST /v1/keys": () => ({ id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: 100, walletUsd: 20 }),
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return turns[asked.length - 1]!();
    },
  });
  try {
    const t = onTerminal(["code", d, "--local", "--engine", "foldrun", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("plan it\r");
      at = await t.until(/make it\? \[y\/N\]/, at);
      t.send("y\r");
      at = await t.until(/cut off at the output limit[\s\S]*Here is the first half of the pla[\s\S]*✗ not finished/, at);
      assert.doesNotMatch(t.out().slice(0, at), /✓ done/, "a cut-off reply is not a finished one");
      at = await t.until(/\w ❯ /, at);
      t.send("continue\r");
      at = await t.until(/and the rest\.[\s\S]*✓ done/, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      assert.equal(await t.done, 0);
    } finally {
      t.child.kill();
    }
    // The second turn carries what the person saw, and why it stopped.
    const carried = JSON.stringify(asked[1].messages);
    assert.match(carried, /Here is the first half of the pla/);
    assert.match(carried, /this turn did not finish: the reply was cut off at the output limit/);
    assert.match(carried, /continue/);
  } finally {
    s.close();
  }
});

test("--local, cloud_jobs: Ctrl-C while they work stops every run on the platform and applies nothing", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let n = 0;
  let calls = 0;
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "POST /v1/keys": () => ({ id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: 100, walletUsd: 20 }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => ({ ok: true, runId: `run-c-${++n}`, snapshot: ID }),
    [`GET ${WS}/runs/run-c-1`]: () => ({ timedOut: true }),
    [`GET ${WS}/runs/run-c-2`]: () => ({ timedOut: true }),
    [`POST ${WS}/runs/run-c-1/stop`]: () => ({ ok: true }),
    [`POST ${WS}/runs/run-c-2/stop`]: () => ({ ok: true }),
    // Started once; then the agent waits for them (FOL-382: the call answers at once).
    "POST /v1/messages": () => sse([++calls === 1 ? { type: "tool_use", id: "c1", name: "cloud_jobs", input: { tasks: ["one", "two"] } } : { type: "tool_use", id: `w${calls}`, name: "cloud_jobs", input: { wait: true } }]),
  });
  try {
    const t = onTerminal(["code", d, "--local", "--engine", "foldrun", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("go\r");
      at = await t.until(/make it\? \[y\/N\]/, at);
      t.send("y\r");
      // Not asked by default (FOL-382): only what leaves is shown, once.
      at = await t.until(/send it\? \[y\]es/, at);
      t.send("y\r"); // the upload preview (FOL-212): nothing leaves before this yes
      at = await t.until(/cloud job #2 · run-c-2/, at);
      await new Promise((r) => setTimeout(r, 300));
      t.send("\x03");
      at = await t.until(/stopping/, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      await t.done;
    } finally {
      t.child.kill();
    }
    const stops = s.seen.filter((x: any) => x.method === "POST" && /\/runs\/run-c-\d\/stop$/.test(x.url)).map((x: any) => x.url).sort();
    assert.deepEqual(stops, [`${WS}/runs/run-c-1/stop`, `${WS}/runs/run-c-2/stop`]);
    assert.equal(s.seen.filter((x: any) => x.method === "POST" && x.url === `${WS}/agents/coder/run`).length, 2, "started once, not again by the wait");
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "a\n");
  } finally {
    s.close();
  }
});

test("--local, cloud_jobs (FOL-382): one call starts many jobs without the folder, unasked; the call answers at once and the turn goes on; the results come back summary first", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  let release: () => void = () => {};
  const done = new Promise<void>((r) => (release = r));
  let started = 0;
  /** What the platform had seen when the agent's next model call came: the jobs still running. */
  let runningAtNextCall = -1;
  const record = (id: string) => ({ id, status: "completed", steps: [{ agent: "researcher", result: `report of ${id}`, costUsd: 0.02 }] });
  const runRoutes: Record<string, any> = {};
  for (const n of [1, 2, 3, 4, 5]) {
    const id = `run-p-${n}`;
    // Long-polled: "still running" until released, after a short wait as the platform's own wait does.
    runRoutes[`GET ${WS}/runs/${id}`] = (_b: string, q: URLSearchParams) =>
      q.get("wait") === "true" ? Promise.race([done.then(() => ({ id, status: "completed" })), new Promise((r) => setTimeout(() => r({ timedOut: true }), 300))]) : record(id);
  }
  const turns = [
    () => sse([{ type: "tool_use", id: "c1", name: "cloud_jobs", input: { folder: false, agent: "researcher", description: "load test", tasks: ["one", "two", "three", "four", "five"] } }]),
    () => {
      runningAtNextCall = started;
      release();
      return sse([{ type: "tool_use", id: "c2", name: "cloud_jobs", input: { wait: true } }]);
    },
    () => sse([{ type: "text", text: "All five reported." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }, { name: "researcher" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\nYou code.\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "POST /v1/keys": () => ({ id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: 100, walletUsd: 20 }),
    "GET /v1/account/usage/compute": () => ({ compute: { vcpu: 16, stepVcpu: 2 }, inUse: { vcpu: 4, memGiB: 8, diskGiB: 0, steps: 2 }, waiting: [], runsWaiting: { waiting: 0, limit: 50 } }),
    [`POST ${WS}/agents/researcher/run`]: () => ({ ok: true, runId: `run-p-${++started}` }),
    ...runRoutes,
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return (turns[asked.length - 1] ?? (() => sse([{ type: "text", text: "(no more)" }])))();
    },
  });
  try {
    const t = onTerminal(["code", d, "--local", "--engine", "foldrun", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("launch as many agents as you can in the cloud\r");
      at = await t.until(/make it\? \[y\/N\]/, at);
      t.send("y\r");
      // Unasked, still shown before anything goes: how many, where, each task whole.
      at = await t.until(/5 cloud jobs, side by side in desk on [^\n]* as its agent researcher[\s\S]*1\. one[\s\S]*5\. five[\s\S]*started without a question — \/permissions cloud ask asks first/, at);
      at = await t.until(/cloud job #5 · run-p-5/, at);
      at = await t.until(/All five reported\.[\s\S]*✓ done/, at);
      assert.doesNotMatch(t.out(), /allow\?/, "not asked: cloud jobs start without a question unless /permissions cloud ask");
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      assert.equal(await t.done, 0);
    } finally {
      t.child.kill();
    }
    // Many in one call, both ways: five runs of the project's agent, the tasks alone sent.
    const runs = s.seen.filter((x: any) => x.method === "POST" && x.url === `${WS}/agents/researcher/run`);
    assert.deepEqual(runs.map((x: any) => JSON.parse(x.body).task).sort(), ["five", "four", "one", "three", "two"]);
    assert.ok(runs.every((x: any) => JSON.parse(x.body).snapshot === undefined), "no folder sent");
    // Not blocked: the agent's next call came while all five were still running.
    assert.equal(runningAtNextCall, 5);
    const first = JSON.stringify(asked[1].messages.at(-1));
    assert.match(first, /Started 5 cloud jobs[\s\S]*#1 run run-p-1[\s\S]*#5 run run-p-5/);
    assert.match(first, /2 steps running on the account, holding 4 of its 16 vCPU; room for about 6 more/, "the platform's room, from GET /v1/account/usage/compute");
    // The results: summary first, one line a job, then each report.
    // As each finished: to the wait, or between calls after it — every one reaches the agent, none twice.
    const back = JSON.stringify(asked.slice(1).map((x) => x.messages.at(-1)));
    for (const n of [1, 2, 3, 4, 5]) assert.equal(back.split(`--- #${n} (run run-p-${n})`).length, 2, `#${n} once`);
    assert.match(back, /\[cloud jobs: \d finished/);
    for (const n of [1, 2, 3, 4, 5]) assert.match(back, new RegExp(`#${n} run run-p-${n}: completed, \\$0\\.02[\\s\\S]*report of run-p-${n}`));
  } finally {
    s.close();
  }
});

test("--local with no bought credits: says so in one line before any key is made or a model is asked", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 3, boughtUsd: 0 }, plan: { id: "free", name: "Free", paysForTokens: false }, usdPerCredit: 0.01 } }),
  });
  try {
    const t = onTerminal(["code", d, "--local", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("hi\r");
      at = await t.until(/need bought credits — this account has none: \S+\/dashboard\/billing\r?\n/, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      await t.done;
    } finally {
      t.child.kill();
    }
    assert.equal(s.seen.filter((x: any) => x.url === "/v1/keys" || x.url === "/v1/messages").length, 0, "no key made, no model asked");
    assert.doesNotMatch(s.seen.map((x: any) => x.url).join(" "), /\/v1\/keys|\/v1\/messages/);
  } finally {
    s.close();
  }
});

test("--local on a foldrun Pro plan with room: no bought credit needed, and the agent asks for foldrun's tier, not a Claude model", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: FAST\n---\nYou code.\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme" }),
    // The wallet cannot be read: the plan is asked all the same (Codex review).
    "GET /v1/billing/coding-plan": () => ({ plan: { plan: "pro", periodEnd: "2026-12-20T00:00:00Z", extraUsage: false }, allowance: { windows: [], extraUsage: false, room: true, freeAt: null } }),
    "POST /v1/keys": () => ({ id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: 100, walletUsd: 20 }),
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return sse([{ type: "text", text: "Hello." }]);
    },
  });
  try {
    const t = onTerminal(["code", d, "--local", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("hi\r");
      at = await t.until(/paid by your foldrun plan[\s\S]*make it\? \[y\/N\]/, at);
      t.send("y\r");
      at = await t.until(/Hello\.[\s\S]*on foldrun Pro plan/, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      assert.equal(await t.done, 0);
    } finally {
      t.child.kill();
    }
    assert.equal(asked[0]?.model, "foldrun/fast");
  } finally {
    s.close();
  }
});
