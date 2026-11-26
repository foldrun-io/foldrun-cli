// A /command typed while a turn runs (FOL-380): run beside the turn or held for after it, never sent to the
// agent. On a real terminal (python3's pty), against a fake platform and gateway. Its own file: the PTY tests of
// cli-code-session.test.ts already come near the per-file time limit on CI.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { serve, raw } from "./fake-platform.ts";

const WS = "/v1/workspaces/desk";
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

/** The test's environment without what makes bash run a file before every
 *  command (CI sets BASH_ENV to its own setup script, which failed inside
 *  the agent's commands — dev-deploy 44642683485). */
function outerEnv() {
  const env = { ...process.env };
  delete env.BASH_ENV;
  delete env.ENV;
  return env;
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

test("commandDuringTurn: the one list of what runs beside a turn and what waits for its end (FOL-380)", async () => {
  const { commandDuringTurn } = await import("../src/code-session.mjs");
  const known = (n: string) => ["/status", "/help", "/sessions", "/queue", "/todos", "/goal", "/where", "/model", "/compact", "/undo", "/quit", "/deploy-notes"].includes(n);
  for (const l of ["/status", "/status cost", "/help", "/sessions", "/sessions send-later", "/queue clear", "/todos", "/goal", "/status line off", "/nosuch", "/STATUS"]) assert.equal(commandDuringTurn(l, known), "beside", l);
  for (const l of ["/model", "/model max", "/model effort high", "/compact", "/undo", "/quit", "/todos add x", "/goal ship it", "/status context", "/sessions send code-x hi", "/where", "/where web cloud", "/where cloud", "/where local+cloud", "/where send fix it", "/deploy-notes"]) assert.equal(commandDuringTurn(l, known), "after", l);
  // Messages, as at the prompt: a path, an escaped slash, words.
  for (const l of ["/Users/x/a.ts fix this", "\\/status", "fix /status", ""]) assert.equal(commandDuringTurn(l, known), null, l);
});

test("a /command typed with Enter during a turn is never sent to the agent: /status runs beside it, /todos add after it, an unknown one is said back, a path is a message (FOL-380)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "b1", name: "Bash", input: { command: "sleep 5; echo slept" } }]),
    () => sse([{ type: "text", text: "Finished." }]),
    () => sse([{ type: "tool_use", id: "b2", name: "Bash", input: { command: "sleep 20" } }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-tc/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local", "--no-sandbox", "--to", "desk", "--context", "code-tc", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "160" });
  // Typed, then Enter as a key of its own (a key with the text reads as a paste).
  const enter = async (line: string) => {
    t.send(line);
    await new Promise((r) => setTimeout(r, 80));
    t.send("\r");
  };
  try {
    let at = await t.until(/\w ❯ /);
    t.send("one\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/sleep 5; echo slept[\s\S]*\[y\]es/, at, 30_000);
    t.send("y\r");
    at = await t.until(/Enter: tell the agent now/, at, 5_000);
    await new Promise((r) => setTimeout(r, 300));
    // Safe beside the turn: run now, while the command still runs.
    await enter("/status");
    at = await t.until(/\/status · runs now, beside the turn/, at, 5_000);
    at = await t.until(/session\s+code-tc[\s\S]*works\s+on this computer/, at, 5_000);
    assert.equal(asked.length, 1, "/status ran while the turn was still on its command");
    // Changes the session: held for after the turn.
    await enter("/todos add write the tests");
    at = await t.until(/⏭ \/todos add write the tests · runs after this turn \(1\)/, at, 5_000);
    // No such command: said back now, as at the prompt.
    await enter("/nosuch thing");
    at = await t.until(/\/nosuch is not a command/, at, 5_000);
    // A path is a message, as at the prompt.
    await enter("/tmp/x.ts look at this too");
    at = await t.until(/↳ \/tmp\/x\.ts look at this too · the agent reads it after/, at, 5_000);
    at = await t.until(/Finished\./, at, 30_000);
    // The held command runs once the turn is over, as typed.
    at = await t.until(/❯ \/todos add write the tests · from the queue/, at, 10_000);
    at = await t.until(/write the tests/, at, 5_000);
    at = await t.until(/\w ❯ /, at);
    assert.equal(asked.length, 2, "no turn was started for a command");
    const said = JSON.stringify(asked.map((a) => a.messages));
    assert.match(said, /look at this too/);
    assert.doesNotMatch(said, /\/status|\/todos|write the tests|\/nosuch/);
    // A turn that stops: the queued message goes back on the line, the held command is never joined into it (Codex).
    t.send("long one\r");
    at = await t.until(/sleep 20[\s\S]*allow\? \[y\]es/, at, 30_000);
    t.send("y\r");
    await new Promise((r) => setTimeout(r, 400));
    t.send("follow up");
    await new Promise((r) => setTimeout(r, 80));
    t.send("\t");
    at = await t.until(/⏭ follow up · queued for after this turn \(1\)/, at);
    await enter("/todos add later");
    at = await t.until(/⏭ \/todos add later · runs after this turn \(2\)/, at);
    t.send("\x03");
    at = await t.until(/the queued message was not sent — it is on your line/, at, 30_000);
    at = await t.until(/this was not run — on an empty line ↑ \(or Ctrl-R\) brings it back: \/todos add later/, at);
    at = await t.until(/\w ❯ follow up/, at);
    t.send("\r");
    at = await t.until(/\(no more\)/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
  assert.equal(asked.length, 4);
  const last = JSON.stringify(asked[3].messages.at(-1));
  assert.match(last, /follow up/);
  assert.doesNotMatch(last, /\/todos|later/);
});
