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
import {serve, raw, failing} from "./fake-platform.ts";



const WS = "/v1/workspaces/desk";
const ID = "c".repeat(64);
const RUN = "run-sess-1";
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

// Whether this machine can put the walls up at all (CI runners have no
// bubblewrap): asked in a process of its own, because opening narrows PATH.
const canSandbox = (() => {
  if (!hasPty) return false;
  const probe = `const m = await import("@foldrun/core/local-sandbox"); const w = await m.openLocalSandbox({ cwd: process.env.PROBE_DIR, sites: [] }); if (m.isRefusal(w)) process.exit(3); await w.close(); process.exit(0);`;
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-probe-")));
  try {
    execFileSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: path.join(import.meta.dirname, ".."), env: { ...process.env, PROBE_DIR: dir }, stdio: "ignore", timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
})();

// The engine's serverTools option ships in a newer core than the one installed until the CLI's range moves.
const coreServerTools = typeof (/** @type {any} */ (await import("@foldrun/core/engine-common")) as any).serverToolsOf === "function";
// FOL-240's core module ships in a newer core than the one installed until the CLI's range moves.
const coreResources = await import("@foldrun/core/local-resources" as string).then(() => true, () => false);
async function messagingPlatform(ctx: string, models: Array<(n: number) => unknown>, opts: { sender?: string; text?: string } = {}) {
  const asked: any[] = [];
  const takes: any[] = [];
  const back: any[] = [];
  const state = { arrived: false, used: false, held: false };
  const msg = { id: "m345", from: "bo@example.com", sender: opts.sender ?? "key:k-bo", fromContext: "code-other", text: opts.text ?? "Please check the build script.", at: "2026-11-27T01:00:00.000Z" };
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/${ctx}/messages`]: (_b, q) => {
      if (q.get("with") === "code-other") {
        return { with: "code-other", messages: [
          // An earlier message from the session, taken in before: the sign-in a trust is pinned to.
          { id: "m0", from: "bo@example.com", sender: "key:k-bo", fromContext: "code-other", context: ctx, text: "hello from the API session", at: "2026-11-27T00:00:00.000Z", usedLocally: true, direction: "in" },
          ...(state.arrived ? [{ ...msg, context: ctx, direction: "in", ...(state.used ? { usedLocally: true } : {}) }] : []),
          ...back.map((b, i) => ({ id: `r${i}`, context: "code-other", fromContext: ctx, text: b.text, at: "2026-11-27T01:05:00.000Z", direction: "out" })),
        ] };
      }
      return { messages: state.arrived && !state.used && !state.held ? [msg] : [] };
    },
    [`POST ${WS}/sessions/${ctx}/messages/take`]: (b) => {
      const body = JSON.parse(String(b));
      takes.push(body);
      if (body.ids) {
        state.held = true;
        return { taken: [msg], refused: [], hold: "lt-bbbbbbbbbbbbbbbbbbbbbbbb" };
      }
      state.held = false;
      if (body.outcome === "used") state.used = true;
      return { used: 1 };
    },
    [`POST ${WS}/sessions/code-other/messages`]: (b) => {
      back.push(JSON.parse(String(b)));
      return { ok: true, message: { id: `r${back.length}` } };
    },
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => ({ id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: JSON.parse(String(b)).dailyUsd, walletUsd: JSON.parse(String(b)).walletUsd }),
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return (models[asked.length - 1] ?? (() => sse([{ type: "text", text: "(no more)" }])))(asked.length);
    },
  });
  return { s, asked, takes, back, state, msg };
}

const later = (ms: number, v: unknown) => new Promise((r) => setTimeout(() => r(v), ms));

test("--local-only with --local or --cloud is refused before anything is asked", () => {
  const cli = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
  for (const pair of [["--local-only", "--cloud"], ["--local-only", "--local"]]) {
    const r = spawnSync(process.execPath, [cli, "code", ".", ...pair, "--task", "x", "--url", "http://127.0.0.1:9", "--token", "k"], { encoding: "utf8", env: { ...process.env, FOLDRUN_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-")) } });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /--local-only, --local or --cloud — one of them/);
  }
});

test("a message queued with Tab while a turn runs is sent when that turn has finished, in order; a stopped turn sends none and puts it back on the line", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "q1", name: "Bash", input: { command: "sleep 3" } }]),
    () => sse([{ type: "text", text: "first done" }]),
    () => sse([{ type: "text", text: "second done" }]),
    () => sse([{ type: "text", text: "third done" }]),
    () => sse([{ type: "tool_use", id: "q2", name: "Bash", input: { command: "sleep 20" } }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-qu/messages`]: () => ({ messages: [] }),
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
  const lastSaid = (i: number) => {
    const m = asked[i].messages.filter((x: any) => x.role === "user").at(-1);
    return typeof m.content === "string" ? m.content : m.content.map((x: any) => x.text ?? "").join("");
  };
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-qu", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("first\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/sleep 3[\s\S]*allow\? \[y\]es/, at, 30_000);
    t.send("y\r");
    await new Promise((r) => setTimeout(r, 400));
    // Two messages for after the turn; a third typed, queued, and taken back.
    t.send("second");
    await new Promise((r) => setTimeout(r, 60));
    t.send("\t");
    at = await t.until(/⏭ second · queued for after this turn \(1\)/, at);
    t.send("third");
    await new Promise((r) => setTimeout(r, 60));
    t.send("\t");
    at = await t.until(/⏭ third · queued for after this turn \(2\)/, at);
    t.send("oops");
    await new Promise((r) => setTimeout(r, 60));
    t.send("\t");
    at = await t.until(/⏭ oops · queued for after this turn \(3\)/, at);
    t.send("\t");
    at = await t.until(/taken back from the queue \(2 left\)/, at);
    for (let i = 0; i < 4; i++) t.send("\x7f");
    await new Promise((r) => setTimeout(r, 60));
    // A tab inside pasted text is not a request to queue; the queue's own command acts at once.
    t.send("\x1b[200~a\tb\x1b[201~");
    await new Promise((r) => setTimeout(r, 60));
    for (let i = 0; i < 3; i++) t.send("\x7f");
    await new Promise((r) => setTimeout(r, 60));
    t.send("drop me");
    await new Promise((r) => setTimeout(r, 60));
    t.send("\t");
    at = await t.until(/⏭ drop me · queued for after this turn \(3\)/, at);
    t.send("/queue rm 3");
    await new Promise((r) => setTimeout(r, 60));
    t.send("\t");
    at = await t.until(/dropped: drop me/, at);
    at = await t.until(/first done/, at, 30_000);
    at = await t.until(/❯ second · from the queue \(1 more\)/, at);
    at = await t.until(/second done/, at, 30_000);
    at = await t.until(/❯ third · from the queue/, at);
    at = await t.until(/third done/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    assert.equal(asked.length, 4);
    assert.match(lastSaid(2), /second$/);
    assert.match(lastSaid(3), /third$/);
    // A turn that is stopped sends nothing after it.
    t.send("long one\r");
    at = await t.until(/sleep 20[\s\S]*allow\? \[y\]es/, at, 30_000);
    t.send("y\r");
    await new Promise((r) => setTimeout(r, 400));
    t.send("never sent");
    await new Promise((r) => setTimeout(r, 60));
    t.send("\t");
    at = await t.until(/⏭ never sent · queued for after this turn \(1\)/, at);
    t.send("\x03");
    at = await t.until(/the turn did not finish, so the queued message was not sent — it is on your line/, at, 30_000);
    at = await t.until(/\w ❯ never sent/, at);
    assert.equal(asked.length, 5, "nothing was sent after the stop");
    // It is the person's to send now: Enter does.
    t.send("\r");
    at = await t.until(/\(no more\)/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    assert.equal(asked.length, 6);
    assert.match(lastSaid(5), /never sent$/);
    t.send("/queue\r");
    at = await t.until(/nothing is queued/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("on a turn on this computer what is typed shows on the working line — after a permission prompt, while a command runs — and Enter sends it into the turn (FOL-306)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "b1", name: "Bash", input: { command: "sleep 4; echo slept" } }]),
    () => sse([{ type: "text", text: "Finished." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-ty/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local", "--no-sandbox", "--to", "desk", "--context", "code-ty", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "160" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("one\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/sleep 4; echo slept[\s\S]*\[y\]es/, at, 30_000);
    t.send("y\r");
    // The command runs: the input line is there before a key is pressed,
    // its hint saying Enter reaches the agent (FOL-325); what is typed now
    // is shown on it as it is typed.
    // The line carries the prompt's lead, the project (owner, 26 Nov 2026).
    at = await t.until(/desk\u00a0❯ Enter: tell the agent now · Tab: queue it for after the turn/, at, 5_000);
    await new Promise((r) => setTimeout(r, 300));
    t.send("also check the readme");
    at = await t.until(/desk\u00a0❯ also check the readme/, at, 5_000);
    t.send("\r");
    at = await t.until(/Finished\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
  // It reached the agent in this turn, with the command's result.
  assert.match(JSON.stringify(asked[1]?.messages ?? []), /also check the readme/);
});

test("a line typed while the turn looks up the plan answers nothing: the computer's key is made without a question (FOL-306; 28 Nov 2026)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let keys = 0;
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-tk/messages`]: () => ({ messages: [] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => new Promise((r) => setTimeout(() => r({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }), 4000)),
    "POST /v1/keys": () => (keys++, { id: "key-1", key: "fr_gw_test", gatewayUrl: "http://127.0.0.1:1", credential: "account" }),
  });
  const t = onTerminal(["code", d, "--local", "--no-sandbox", "--to", "desk", "--context", "code-tk", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "160" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("one\r");
    await new Promise((r) => setTimeout(r, 1500));
    // Typed while the plan is looked up.
    t.send("y\r");
    at = await t.until(/paid by your foldrun plan/, at, 10_000);
    await new Promise((r) => setTimeout(r, 800));
    assert.doesNotMatch(t.out(), /make it\?|\[y\/N\]/, "no question about the key");
  } finally {
    t.child.kill();
    s.close();
  }
  assert.equal(keys, 1, "made once, unasked");
});

test("a line being typed when a permission prompt comes is drawn again after it, not hidden till the turn ends (FOL-306, Codex)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "b1", name: "Bash", input: { command: "sleep 2; echo first" } }]),
    () => sse([{ type: "tool_use", id: "b2", name: "Bash", input: { command: "sleep 3; echo second" } }]),
    () => sse([{ type: "text", text: "Both ran." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-td/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local", "--no-sandbox", "--to", "desk", "--context", "code-td", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "160" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("one\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/sleep 2; echo first[\s\S]*\[y\]es/, at, 30_000);
    t.send("y\r");
    await new Promise((r) => setTimeout(r, 500));
    t.send("draft ");
    at = await t.until(/❯ draft/, at, 5_000);
    at = await t.until(/sleep 3; echo second[\s\S]*\[y\]es/, at, 30_000);
    t.send("y\r");
    // The second command runs: the draft is on the working line again, its space kept (Codex).
    await new Promise((r) => setTimeout(r, 400));
    t.send("words");
    at = await t.until(/❯ draft words/, at, 5_000);
    at = await t.until(/Both ran\./, at, 30_000);
    // And it starts the next message.
    at = await t.until(/\w ❯ draft words/, at, 5_000);
    t.send("\x03\x03");
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a named file is read into text on foldrun's servers: into text for the agent, or just the text with no model call, kept every time and listed in /permissions (FOL-268)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  fs.writeFileSync(path.join(d, "note.m4a"), "fake audio bytes");
  fs.writeFileSync(path.join(d, "scan.pdf"), "%PDF fake");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const extracts: { name: string | null; bytes: number }[] = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-f268/messages`]: () => ({ messages: [] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "POST /v1/extract": (b, q) => {
      extracts.push({ name: q.get("name"), bytes: Buffer.byteLength(String(b)) });
      return q.get("name") === "note.m4a" ? { kind: "audio", text: "Meet at nine on Friday.", seconds: 4 } : { kind: "document", text: "Invoice 42\nTotal: 10 USD", pages: 1 };
    },
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return sse([{ type: "text", text: "Friday at nine." }]);
    },
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-f268", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "120" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("when is the meeting? @note.m4a\r");
    at = await t.until(/note\.m4a — audio[\s\S]*Into text for the agent[\s\S]*Just the text/, at);
    t.send("\r");
    at = await t.until(/✓ note\.m4a read into text \(4 s · 23 characters\) — the agent is given the text, not the file/, at, 30_000);
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/Friday at nine\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    const sent = JSON.stringify(asked[0]?.messages ?? []);
    assert.match(sent, /when is the meeting\? @note\.m4a/);
    assert.match(sent, /\[The audio note\.m4a, transcribed on foldrun's servers — you are given its text, not the file:\]\\nMeet at nine on Friday\./);
    // Just the text, every time for documents: no model call, and kept.
    t.send("@scan.pdf\r");
    at = await t.until(/scan\.pdf — document/, at);
    t.send("4");
    at = await t.until(/scan\.pdf · 1 page · 24 characters · read on foldrun's servers, no model call[\s\S]*Invoice 42[\s\S]*Total: 10 USD[\s\S]*nothing was sent to the model/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/permissions\r");
    at = await t.until(/Show them/, at);
    t.send("\r");
    at = await t.until(/documents you name: just give me the text \(kept for every folder\)/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("again @scan.pdf\r");
    at = await t.until(/Invoice 42[\s\S]*nothing was sent to the model/, at, 30_000);
    assert.doesNotMatch(t.out().slice(at - 400), /scan\.pdf — document/, "a kept choice is not asked again");
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
    assert.equal(asked.length, 1, "just the text makes no model call");
    assert.deepEqual(extracts.map((e) => e.name), ["note.m4a", "scan.pdf", "scan.pdf"]);
    assert.equal(extracts[0]!.bytes, "fake audio bytes".length, "the file's bytes went to the platform");
  } finally {
    t.child.kill();
    s.close();
  }
});

test("an image sent to the model as it is: the token estimate shown, the image block in the turn, nothing uploaded (FOL-268)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const ihdr = Buffer.alloc(16);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "latin1");
  ihdr.writeUInt32BE(640, 8);
  ihdr.writeUInt32BE(480, 12);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(64, 7)]);
  fs.writeFileSync(path.join(d, "shot.png"), png);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  let extracted = 0;
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-i268/messages`]: () => ({ messages: [] }),
    // The agent says media: as-is, so the list starts at "as it is" (FOL-268).
    [`GET ${WS}/source`]: (_b, q) => (q.get("path") === "agents/coder/agent.md" ? { content: "---\nname: coder\nmedia: as-is\n---\nYou code.\n", sha256: "x" } : { files: [] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "POST /v1/extract": () => {
      extracted += 1;
      return { text: "never" };
    },
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return sse([{ type: "text", text: "The button is cut off." }]);
    },
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-i268", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "140" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("what is wrong here? @shot.png\r");
    at = await t.until(/shot\.png — image[\s\S]*❯ 3\. Send it to the model as it is\s+about 410 input tokens/, at);
    t.send("\r");
    at = await t.until(/✓ shot\.png goes to the model as it is — about 410 input tokens/, at, 30_000);
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/The button is cut off\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    const user = (asked[0]?.messages ?? []).filter((m: any) => m.role === "user").at(-1);
    const blocks = Array.isArray(user?.content) ? user.content : [];
    assert.ok(blocks.some((b: any) => b.type === "image" && b.source?.media_type === "image/png" && b.source?.data === png.toString("base64")), JSON.stringify(blocks).slice(0, 300));
    assert.ok(blocks.some((b: any) => b.type === "text" && /Sent with this message as an image: shot\.png/.test(b.text)));
    // The next turn still has the image in the conversation, and sends no new one.
    t.send("and now?\r");
    at = await t.until(/The button is cut off\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    const second = JSON.stringify(asked[1]?.messages ?? []);
    assert.equal(second.split(png.toString("base64")).length - 1, 1, "the image once, from the conversation");
    t.send("/quit\r");
    assert.equal(await t.done, 0);
    assert.equal(extracted, 0, "an image sent as it is is not uploaded to be read");
  } finally {
    t.child.kill();
    s.close();
  }
});

test("the local agent browses on this computer with the cloud's web tool, asked first; a call that needs the cloud is refused by name (FOL-267)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "w1", name: "web", input: { action: "browse", url: "https://example.com", mode: "aria" } }]),
    () => sse([{ type: "tool_use", id: "w2", name: "web", input: { action: "browse", proxy: "MY_PROXY" } }]),
    () => sse([{ type: "text", text: "Read the page." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-w267/messages`]: () => ({ messages: [] }),
    // The agent's file grants the web (FOL-383: browse only for an agent that has it).
    [`GET ${WS}/source`]: (_b, q) => (q.get("path") === "agents/coder/agent.md" ? { content: "---\nname: coder\ntools: [web]\n---\nYou code.\n" } : { content: "" }),
    "GET /v1/account/agents-md": () => ({ content: "" }),
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
  // This computer's browser, set up: the gallery's web tool on disk (a stand-in run.mjs) and the driver installed.
  const web = path.join(home, "gallery", new URL(s.url).host, "tools", "web");
  fs.mkdirSync(web, { recursive: true });
  fs.writeFileSync(path.join(web, "tool.md"), '---\nname: web\ndescription: "browse: a real browser — JavaScript runs. Use it when fetch is empty. Start with fetch."\nargs:\n  action: "browse"\n  url: "(browse) The page to open"\n  mode: "(browse) What comes back"\n  proxy: "(browse) Optional NAME of a secret holding a proxy URL"\n---\n');
  fs.writeFileSync(path.join(web, "run.mjs"), 'const ARGS = { "browse": [ "url", "mode", "proxy" ] };\nconsole.log("PAGE " + process.argv.slice(2).join(" "));\n');
  fs.writeFileSync(path.join(web, "browse.mjs"), "");
  fs.mkdirSync(path.join(home, "browser", "node_modules", "playwright"), { recursive: true });
  fs.writeFileSync(path.join(home, "browser", "node_modules", "playwright", "package.json"), '{"version":"1.63.0"}');
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-w267", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "140" });
  try {
    let at = await t.until(/\w ❯ /);
    // The web is in the cloud by default (FOL-383): this test browses on this computer.
    t.send("/where web here\r");
    at = await t.until(/The web on this computer/, at);
    t.send("read example.com\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/Web[\s\S]*browse https:\/\/example\.com[\s\S]*outside the sandbox[\s\S]*"mode": "aria"[\s\S]*\[y\]es/, at, 30_000);
    t.send("y\r");
    at = await t.until(/"proxy": "MY_PROXY"[\s\S]*\[y\]es/, at, 30_000);
    t.send("y\r");
    at = await t.until(/Read the page\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    const tool = (asked[0]?.tools ?? []).find((x: any) => x.name === "web");
    assert.ok(tool, "the web tool is offered once this computer's browser is set up");
    assert.deepEqual(tool.input_schema.properties.action.enum, ["browse"]);
    assert.equal(tool.input_schema.properties.proxy, undefined, "a vault option is not offered");
    const results = (n: number) => JSON.stringify((asked[n]?.messages ?? []).at(-1));
    assert.match(results(1), /PAGE --action browse --url https:\/\/example\.com --mode aria --browser chrome --live true/);
    assert.match(results(2), /proxy uses a secret from foldrun's vault/);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("the agent's web.browse block holds on this computer as in the cloud: its defaults reach the browser, what is not kept is named (FOL-267)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "w1", name: "web", input: { action: "browse", url: "https://example.com" } }]),
    () => sse([{ type: "text", text: "Done browsing." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-wb267/messages`]: () => ({ messages: [] }),
    [`GET ${WS}/source`]: (_b, q) =>
      q.get("path") === "agents/coder/agent.md"
        ? { content: "---\nname: coder\ntools: [web]\nweb:\n  browse:\n    device: iPhone 15\n    deny: [eval]\n    headless: false\n---\nYou code.\n", sha256: "x" }
        : q.get("path") === "AGENTS.md" ? { content: "---\nweb:\n  browse:\n    locale: fr-FR\n---\n", sha256: "y" } : { files: [] },
    "GET /v1/account/agents-md": () => ({ content: "", sha256: null, exists: false }),
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
  const web = path.join(home, "gallery", new URL(s.url).host, "tools", "web");
  fs.mkdirSync(web, { recursive: true });
  fs.writeFileSync(path.join(web, "tool.md"), '---\nname: web\ndescription: "browse: a real browser — JavaScript runs. Use it. Start."\nargs:\n  action: "browse"\n  url: "(browse) The page to open"\n---\n');
  fs.writeFileSync(path.join(web, "run.mjs"), 'const ARGS = { "browse": [ "url" ] };\nconsole.log("DEVICE=" + process.env.FOLDRUN_BROWSER_DEVICE + " DENY=" + process.env.FOLDRUN_BROWSER_DENY + " HEADLESS=" + process.env.FOLDRUN_BROWSER_HEADLESS + " LOCALE=" + process.env.FOLDRUN_BROWSER_LOCALE);\n');
  fs.writeFileSync(path.join(web, "browse.mjs"), "");
  fs.mkdirSync(path.join(home, "browser", "node_modules", "playwright"), { recursive: true });
  fs.writeFileSync(path.join(home, "browser", "node_modules", "playwright", "package.json"), '{"version":"1.63.0"}');
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-wb267", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "140" });
  try {
    let at = await t.until(/\w ❯ /);
    // The web is in the cloud by default (FOL-383): this test browses on this computer.
    t.send("/where web here\r");
    at = await t.until(/The web on this computer/, at);
    t.send("browse\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/Web[\s\S]*\[y\]es/, at, 30_000);
    t.send("y\r");
    at = await t.until(/Done browsing\./, at, 30_000);
    const result = JSON.stringify((asked[1]?.messages ?? []).at(-1));
    // The agent's block, whole: the project's applies only when the agent has none (core webConfig), so no locale.
    assert.match(result, /DEVICE=undefined DENY=eval HEADLESS=0 LOCALE=undefined/, result.slice(0, 400));
    assert.match(result, /not kept on this computer — device: not applied to the window kept open on this computer; headless: the window on this computer is always visible/);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a message the agent sends shows in this session's transcript as a line of the thread (FOL-307)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "s1", name: "session_send", input: { to: "code-api", text: "Which routes moved?" } }]),
    () => sse([{ type: "text", text: "Asked them." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-ss7/messages`]: () => ({ messages: [] }),
    [`POST ${WS}/sessions/code-api/messages`]: () => ({ ok: true, message: { id: "m9" } }),
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
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-ss7", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "120" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("ask the api session\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/a message to the session code-api[\s\S]*\[y\]es/, at, 30_000);
    t.send("y\r");
    at = await t.until(/→ you to code-api · \d\d:\d\d · waiting for code-api\r?\n\s+Which routes moved\?/, at, 30_000);
    at = await t.until(/Asked them\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("/sessions <id> shows the thread with that session, both ways, oldest first (FOL-307)", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-th7/messages`]: (_b, q) =>
      q.get("with") === "code-api"
        ? { with: "code-api", messages: [
            { id: "a", fromContext: "code-th7", context: "code-api", text: "what changed?", at: "2026-11-25T01:00:00.000Z", run: "run-1", direction: "out" },
            { id: "b", fromContext: "code-api", from: "bo", text: "the routes moved", at: "2026-11-25T01:02:00.000Z", direction: "in" },
          ] }
        : { messages: [] },
    "GET /v1/me": () => ({ account: "acme" }),
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-th7", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "120" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/sessions code-api\r");
    at = await t.until(/code-th7 and code-api · 2 messages[\s\S]*→ you to code-api · 01:00 · code-api read it in a turn[\s\S]*what changed\?[\s\S]*← code-api \(bo\) · 01:02 · waiting for you[\s\S]*the routes moved/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/sessions code-th7\r");
    at = await t.until(/that is this session/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a message from another session shows at an idle prompt with no key pressed; Enter shows it whole and asks once; a yes takes it into the turn (FOL-305)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  let arrived = false;
  const msg = { id: "m1", from: "ana", fromContext: "code-other", text: "Line one of the note.\n\nPlease check the build." };
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-ms/messages`]: () => ({ messages: arrived ? [msg] : [] }),
    [`POST ${WS}/sessions/code-ms/messages/take`]: () => ({ taken: [msg] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return sse([{ type: "text", text: "Checked it." }]);
    },
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-ms", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "120", FOLDRUN_CODE_MESSAGE_POLL_MS: "300" });
  try {
    let at = await t.until(/\w ❯ /);
    await new Promise((r) => setTimeout(r, 700));
    assert.doesNotMatch(t.out().slice(at), /a message from/, "nothing before one arrives");
    arrived = true;
    at = await t.until(/✉ a message from code-other — Line one of the note\. Please check the build\.[\s\S]*Enter on an empty line takes it into a turn/, at, 10_000);
    // Said once, however often it is looked for.
    await new Promise((r) => setTimeout(r, 900));
    assert.equal((t.out().slice(at).match(/a message from code-other/g) ?? []).length, 0, "said once");
    t.send("\r");
    at = await t.until(/1 message from other sessions[\s\S]*Line one of the note\.\r?\n\s*\n\s+Please check the build\.[\s\S]*take it into a turn now\? \[y\/N\]/, at, 10_000);
    t.send("y\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/Checked it\./, at, 30_000);
    assert.doesNotMatch(t.out().slice(at - 4000), /include it in this turn\?/, "not asked a second time");
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
  const sent = JSON.stringify(asked[0]?.messages ?? []);
  assert.match(sent, /Please check the build\./, "the message went with the turn");
});

test("on a real terminal what is typed stays on the line when a message is said above it (FOL-305)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let arrived = false;
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-mt/messages`]: () => ({ messages: arrived ? [{ id: "m1", fromContext: "code-other", text: "hi" }] : [] }),
    "GET /v1/me": () => ({ account: "acme" }),
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-mt", "--url", s.url, "--token", "k"], home, { TERM: "xterm-256color", COLUMNS: "120", FOLDRUN_CODE_MESSAGE_POLL_MS: "300" });
  try {
    let at = await t.until(/desk.*❯/);
    t.send("half typ");
    at = await t.until(/half typ/, at);
    arrived = true;
    at = await t.until(/a message from code-other/, at, 10_000);
    // Drawn again under the line that was said, so the person goes on typing where they were.
    at = await t.until(/half typ/, at, 5_000);
    t.send("\x03");
    t.send("\x03");
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a yes at the prompt to a message that is gone by the turn sends nothing (FOL-305, Codex)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let calls = 0;
  let gone = false;
  const msg = { id: "m1", from: "ana", fromContext: "code-other", text: "Do the thing." };
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-mg/messages`]: () => ({ messages: gone ? [] : [msg] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "POST /v1/messages": () => (calls++, sse([{ type: "text", text: "should not run" }])),
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-mg", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "120", FOLDRUN_CODE_MESSAGE_POLL_MS: "300" });
  try {
    let at = await t.until(/\w ❯ /);
    at = await t.until(/✉ a message from code-other/, at, 10_000);
    t.send("\r");
    at = await t.until(/take it into a turn now\? \[y\/N\]/, at, 10_000);
    gone = true;
    t.send("y\r");
    at = await t.until(/no longer waiting[\s\S]*nothing sent/, at, 20_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
  assert.equal(calls, 0);
});

test("an empty Enter with a message waiting and a no starts nothing (FOL-305)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let calls = 0;
  const msg = { id: "m1", from: "ana", fromContext: "code-other", text: "Do the thing." };
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-mn/messages`]: () => ({ messages: [msg] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "POST /v1/messages": () => (calls++, sse([{ type: "text", text: "should not run" }])),
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-mn", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "120", FOLDRUN_CODE_MESSAGE_POLL_MS: "300" });
  try {
    let at = await t.until(/\w ❯ /);
    at = await t.until(/✉ a message from code-other/, at, 10_000);
    t.send("\r");
    at = await t.until(/take it into a turn now\? \[y\/N\]/, at, 10_000);
    t.send("n\r");
    at = await t.until(/left waiting/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
  assert.equal(calls, 0);
});

for (const cols of [200, 80]) test(`the transcript reads as separate blocks with their own margins at ${cols} columns: a message from another session keeps its paragraphs, thinking wraps under its indent (FOL-311)`, { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const long = "I should check the AWS Well-Architected guidance first, because observability lives in the Operational Excellence pillar and the person asked how it relates to security, which is its own pillar with its own design principles and review questions.";
  const said = "Here is what I found so far.\n\nFirst paragraph: the logs go to CloudWatch.\nSecond line of it.\n\nSecond paragraph: alarms page the on-call person. " + "word ".repeat(40).trim();
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-fm/messages`]: () => ({ messages: [{ id: "m1", from: "ana", fromContext: "code-other", text: said }] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": () => sse([{ type: "thinking", thinking: `${long}\nThen answer.` }, { type: "text", text: "The answer.\n\nA second paragraph." }]),
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-fm", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: String(cols), FOLDRUN_CODE_MESSAGE_POLL_MS: "300" });
  try {
    let at = await t.until(/\w ❯ /);
    // Said at the prompt first (FOL-305), the prompt drawn again under it.
    at = await t.until(/✉ a message from code-other[\s\S]*\w ❯ /, at, 10_000);
    t.send("/model thinking on\r");
    at = await t.until(/\w ❯ /, at);
    const from = at;
    t.send("one\r");
    at = await t.until(/in this turn\? \[y\/N\]/, at, 30_000);
    t.send("y\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/✓ done/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    const screen = t.out().slice(from).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(/\r?\n/).map((l) => l.split("\r").pop() ?? "");
    const wide = screen.filter((l) => [...l].length > cols);
    assert.deepEqual(wide, [], "no line runs past the edge");
    // The message: its own block, a blank line above, paragraphs kept, every row under its margin.
    const head = screen.findIndex((l) => /1 message from other sessions/.test(l));
    assert.ok(head > 0 && screen[head - 1]!.trim() === "", "a blank line above the messages");
    const body = screen.slice(head + 2, screen.findIndex((l, i) => i > head && /in this turn\?/.test(l)));
    assert.match(body.join("\n"), /Here is what I found so far\.\n\n {4}First paragraph: the logs go to CloudWatch\.\n {4}Second line of it\.\n\n {4}Second paragraph/);
    for (const l of body) assert.ok(l === "" || l.startsWith("    "), `under the margin: ${JSON.stringify(l)}`);
    // Thinking: its own block, every row of it indented, the long line wrapped (not cut, not at column 0).
    const th = screen.findIndex((l) => /✻ thinking/.test(l));
    assert.ok(th > 0 && screen[th - 1]!.trim() === "", `a blank line above thinking: ${JSON.stringify(screen.slice(th - 3, th + 1))}`);
    const rows = screen.slice(th + 1, screen.findIndex((l, i) => i > th && /Then answer\./.test(l)) + 1);
    for (const l of rows) assert.ok(l.startsWith("    "), `thinking keeps its indent: ${JSON.stringify(l)}`);
    assert.equal(rows.map((l) => l.trim()).join(" ").replace(" Then answer.", ""), long);
    if (cols === 80) assert.ok(rows.length >= 4, "the long line wrapped at 80");
    // The reply's paragraphs, and the done line on its own after a blank line.
    assert.match(screen.join("\n"), /The answer\.\n\s*\n {2}A second paragraph\.\n\s*\n {2}✓ done/);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("/model thinking on shows the model's summary of its thinking above the reply, remembered for the person; off by default; /export --thinking writes it", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "thinking", thinking: "" }, { type: "text", text: "plain answer" }]),
    () => sse([{ type: "thinking", thinking: "Weighing two ways.\nThe second is shorter." }, { type: "text", text: "shown answer" }]),
    () => sse([{ type: "thinking", thinking: "" }, { type: "text", text: "quiet answer" }]),
    () => sse([{ type: "text", text: "last answer" }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-th/messages`]: () => ({ messages: [] }),
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
  const args = ["code", d, "--local", "--to", "desk", "--context", "code-th", "--url", s.url, "--token", "k"];
  const out = path.join(home, "out.md");
  let t = onTerminal(args, home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    // Typed alone, /model thinking says what it is (FOL-263: /thinking went into /model).
    t.send("/model thinking\r");
    at = await t.until(/thinking is not shown · \/model thinking on/, at);
    t.send("one\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/plain answer/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    assert.equal("thinking" in asked[0], false, "off by default: the request is as it was");
    // Chosen from /model's list: its third choice is Show its thinking.
    t.send("/model\r");
    at = await t.until(/3\. Show its thinking[\s\S]*Esc to cancel/, at);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\x1b[B\x1b[B");
    await new Promise((r) => setTimeout(r, 100));
    t.send("\r");
    at = await t.until(/a summary of the model's thinking is shown above its reply/, at);
    t.send("two\r");
    at = await t.until(/✻ thinking[\s\S]*Weighing two ways\.[\s\S]*The second is shorter\.[\s\S]*shown answer/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    assert.deepEqual(asked[1].thinking, { type: "adaptive", display: "summarized" });
    // The thinking block goes back to the model as it came.
    t.send("three\r");
    at = await t.until(/the model did not think aloud on this one[\s\S]*quiet answer/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    const before = asked[2].messages.find((m: any) => m.role === "assistant" && m.content.some((b: any) => b.type === "thinking" && b.thinking));
    assert.equal(before.content.find((b: any) => b.type === "thinking").signature, "sig");
    t.send(`/export --thinking ${out}\r`);
    at = await t.until(/out\.md — 3 turns/, at);
    const written = fs.readFileSync(out, "utf8");
    assert.match(written, /### Thinking \(the model's summary\)\n\n> Weighing two ways\.\n> The second is shorter\./);
    t.send(`/export ${out}.plain\r`);
    at = await t.until(/out\.md\.plain — 3 turns/, at);
    assert.doesNotMatch(fs.readFileSync(`${out}.plain`, "utf8"), /Weighing/);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
    // Remembered for the person: a new session asks for it without being told.
    t.child.kill();
    t = onTerminal(args, home, { TERM: "dumb", COLUMNS: "200" });
    at = await t.until(/\w ❯ /);
    t.send("/model thinking\r");
    at = await t.until(/thinking is shown/, at);
    t.send("four\r");
    at = await t.until(/last answer/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    assert.deepEqual(asked[3].thinking, { type: "adaptive", display: "summarized" });
    t.send("/model thinking off\r");
    at = await t.until(/thinking is not shown/, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("f at a command's question keeps a rule for the folder: later sessions run what it covers unasked, a joined command only when every part is covered; /permissions lists and removes; strict ignores", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const bash = (id: string, command: string) => () => sse([{ type: "tool_use", id, name: "Bash", input: { command } }]);
  const say = (text: string) => () => sse([{ type: "text", text }]);
  const turns = [
    bash("r1", "touch made-one.txt"), say("one done"),
    bash("r2", "touch made-two.txt"), say("two done"),
    bash("r3", "touch made-three.txt && rm made-one.txt"), say("three done"),
    bash("r4", "touch made-four.txt"), say("four done"),
    bash("r5", "touch made-five.txt"), say("five done"),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-ru/messages`]: () => ({ messages: [] }),
    [`GET ${WS}/sessions/code-rv/messages`]: () => ({ messages: [] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return (turns[asked.length - 1] ?? say("(no more)"))();
    },
  });
  const args = (context: string) => ["code", d, "--local", "--to", "desk", "--context", context, "--url", s.url, "--token", "k"];
  let t = onTerminal(args("code-ru"), home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("one\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/touch made-one\.txt[\s\S]*allow\? \[y\]es · \[a\]lways for this command · \[f\] always in this folder · \[n\]o/, at, 30_000);
    t.send("f\r");
    at = await t.until(/\[e\] exactly this command · \[p\] every command that starts with touch · \[n\]either/, at);
    t.send("p\r");
    at = await t.until(/kept for this folder/, at);
    at = await t.until(/one done/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    assert.ok(fs.existsSync(path.join(d, "made-one.txt")));
    assert.equal(fs.existsSync(path.join(d, ".foldrun")), false);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
    t.child.kill();
    // Another session in the same folder: what the rule covers is not asked.
    t = onTerminal(args("code-rv"), home, { TERM: "dumb", COLUMNS: "200" });
    at = await t.until(/\w ❯ /);
    t.send("two\r");
    at = await t.until(/two done/, at, 30_000);
    assert.doesNotMatch(t.out(), /made-two\.txt[\s\S]*allow\?/);
    assert.ok(fs.existsSync(path.join(d, "made-two.txt")));
    at = await t.until(/\w ❯ /, at);
    // A joined command with a part no rule covers is asked.
    t.send("three\r");
    at = await t.until(/touch made-three\.txt && rm made-one\.txt[\s\S]*allow\? \[y\]es/, at, 30_000);
    t.send("n\r");
    at = await t.until(/three done/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    assert.ok(fs.existsSync(path.join(d, "made-one.txt")), "the refused command did not run");
    at = await alone(t, "/permissions", at);
    at = await t.until(/kept for this folder, every session:[\s\S]* 1 commands that start with  touch/, at);
    at = await t.until(/\w ❯ /, at);
    // Strict: the rule is not used.
    t.send("/permissions strict\r");
    at = await t.until(/asked too/, at);
    t.send("four\r");
    at = await t.until(/touch made-four\.txt[\s\S]*allow\? \[y\]es · \[a\]lways for this command · \[n\]o/, at, 30_000);
    t.send("y\r");
    at = await t.until(/four done/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/permissions relaxed\r");
    at = await t.until(/run without a question/, at);
    at = await alone(t, "/permissions", at);
    at = await t.until(/ 1 commands that start with  touch/, at);
    // Remove a rule… from /permissions' list asks for the rest of the line (FOL-259).
    t.send("/permissions\r");
    at = await t.until(/What the agent may do without asking[\s\S]*Relaxed[^\n]*✔[\s\S]*5\. Remove a rule…[\s\S]*Esc to cancel/, at);
    await new Promise((r) => setTimeout(r, 100));
    t.send("5");
    at = await t.until(/Remove a rule — the rule's number \(Esc to go back\): /, at);
    t.send("1\r");
    at = await t.until(/removed: commands that start with  touch — it is asked again/, at);
    t.send("five\r");
    at = await t.until(/touch made-five\.txt[\s\S]*allow\? \[y\]es/, at, 30_000);
    t.send("y\r");
    at = await t.until(/five done/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a turn on this computer holds the other sessions' messages it carries and marks them used once the model read it (FOL-236)", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const taken: any[] = [];
  let used = false;
  const note = { id: "sm-l1", workspace: "desk", context: "code-tk", from: "ana@example.com", sender: "user:u1", fromContext: "code-api", text: "the API moved to /v2", at: "2026-11-24T01:00:00.000Z" };
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\nYou code.\n", sha256: "x" }),
    [`GET ${WS}/sessions/code-tk/messages`]: () => ({ messages: used ? [] : [note] }),
    [`POST ${WS}/sessions/code-tk/messages/take`]: (b) => {
      const body = JSON.parse(String(b));
      taken.push(body);
      if (body.ids) return { taken: [note], refused: [], hold: "lt-aaaaaaaaaaaaaaaaaaaaaaaa" };
      used = body.outcome === "used";
      return { used: 1 };
    },
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => ({ id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: JSON.parse(String(b)).dailyUsd, walletUsd: JSON.parse(String(b)).walletUsd }),
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      if (asked.length === 1) assert.deepEqual(taken, [{ ids: ["sm-l1"] }], "held before the turn is sent, not used yet");
      return sse([{ type: "text", text: `Reply ${asked.length}.` }]);
    },
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-tk", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("go\r");
    for (;;) {
      at = await t.until(/include it in this turn\? \[y\/N\]|\[y\/N\]|Reply 1\./, at);
      const seen = t.out().slice(0, at);
      if (/Reply 1\./.test(seen.slice(-40))) break;
      t.send("y\r");
    }
    at = await t.until(/\w ❯ /, at);
    assert.match(JSON.stringify(asked[0].messages), /the API moved to \/v2/, "the message went in the turn");
    assert.deepEqual(taken, [{ ids: ["sm-l1"] }, { hold: "lt-aaaaaaaaaaaaaaaaaaaaaaaa", outcome: "used" }], "used once the model read the turn");
    t.send("again\r");
    at = await t.until(/Reply 2\./, at);
    assert.equal(taken.length, 2, "used, it is not offered again");
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a turn on this computer that never reached the model holds nothing, and offers its messages again (FOL-236, Codex)", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const calls: any[] = [];
  const note = { id: "sm-f1", workspace: "desk", context: "code-fr", from: "ana@example.com", sender: "user:u1", text: "look at /v2", at: "2026-11-24T01:00:00.000Z" };
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\nYou code.\n", sha256: "x" }),
    [`GET ${WS}/sessions/code-fr/messages`]: () => ({ messages: [note] }),
    [`POST ${WS}/sessions/code-fr/messages/take`]: (b) => {
      const body = JSON.parse(String(b));
      calls.push(body);
      return body.ids ? { taken: [note], refused: [], hold: "lt-bbbbbbbbbbbbbbbbbbbbbbbb" } : { freed: true };
    },
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    // No key for this computer: the platform refuses it, so nothing reaches a model.
    "POST /v1/keys": () => failing(403, { error: "only an admin of every workspace may mint one" }),
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-fr", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("go\r");
    at = await t.until(/include it in this turn\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/only an admin of every project may make a model key/, at);
    at = await t.until(/\w ❯ /, at);
    await new Promise((r) => setTimeout(r, 300));
    // Held only once the turn is about to be sent, after the key: refused there, nothing was held (Codex round 11).
    assert.deepEqual(calls, [], "never held — the turn stopped at the key");
    t.send("again\r");
    at = await t.until(/include it in this turn\? \[y\/N\]/, at);
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    assert.equal(calls.length, 0, "declined: nothing held");
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("/rename and /resume (FOL-264): a name kept on the platform too; /resume lists the project's cloud conversations; /rename alone renames the project after the webhook warning, and the session goes on there", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const named: any[] = [];
  const renamed: any[] = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-rn/messages`]: () => ({ messages: [] }),
    [`PATCH ${WS}/sessions/code-rn`]: (b) => {
      named.push(JSON.parse(String(b)));
      return { context: "code-rn", name: JSON.parse(String(b)).name };
    },
    [`GET ${WS}/sessions`]: () => ({ sessions: [
      { context: "code-rn", name: null, turns: 1, agent: "coder", lastAt: "2026-11-24T09:00:00.000Z", lastStatus: "completed", lastRun: "r0", startedBy: null, lastSummary: null },
      { context: "code-far", name: "the billing fix", turns: 4, agent: "coder", lastAt: "2026-11-24T08:00:00.000Z", lastStatus: "completed", lastRun: "r9", startedBy: null, lastSummary: "x" },
    ] }),
    [`PATCH ${WS}`]: (b) => {
      renamed.push(JSON.parse(String(b)));
      return { name: "desk2", renamed: true, brokeWebhooks: ["intake"] };
    },
    [`GET /v1/workspaces/desk2/sessions`]: () => ({ sessions: [] }),
  });
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-rn", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/rename tidy imports\r");
    at = await t.until(/this conversation is now called: tidy imports/, at);
    assert.deepEqual(named, [{ name: "tidy imports" }], "kept on the platform too");
    at = await t.until(/\w ❯ /, at);
    t.send("/resume\r");
    at = await t.until(/1\. the billing fix\s+2026-11-24 08:00 · in the cloud/, at);
    t.send("\u001b");
    at = await t.until(/\w ❯ /, at);
    t.send("/resume all\r");
    at = await t.until(/the billing fix .*in the cloud · not kept on this computer/, at);
    assert.doesNotMatch(t.out().slice(at - 2000, at), /1 +code-rn|tidy imports ·/, "the conversation in hand is not offered");
    at = await t.until(/\w ❯ /, at);
    t.send("/rename\r");
    at = await t.until(/This project…/, at);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\u001b[B");
    await new Promise((r) => setTimeout(r, 100));
    t.send("\r");
    at = await t.until(/the project's new name: /, at);
    t.send("desk2\r");
    at = await t.until(/changes every webhook URL it has[\s\S]*Rename it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/the project is now desk2 — this session goes on there/, at);
    at = await t.until(/webhook URLs changed for intake/, at);
    assert.deepEqual(renamed, [{ name: "desk2" }]);
    at = await t.until(/\w ❯ /, at);
    t.send("/resume all\r");
    at = await t.until(/\w ❯ /, at);
    assert.ok(s.seen.some((x: any) => x.url === "/v1/workspaces/desk2/sessions"), "the session goes on under the new name");
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("working here with agents in the cloud asks nothing about git at the start, and git is never offered around a folder of repositories (the report, FOL-274)", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-repos-"));
  // A folder of projects: each one its own repository, the folder around them none.
  for (const r of ["one", "two"]) assert.equal(spawnSync("git", ["init", "-q", path.join(d, r)]).status, 0);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\nYou code.\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme" }),
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-rp", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    assert.doesNotMatch(t.out().slice(0, at), /Set it up here \(git init\)/, "not asked at the start");
    t.send("/where cloud\r");
    at = await t.until(/holds git repositories of its own \(one, two|two, one/, at);
    assert.equal(fs.existsSync(path.join(d, ".git")), false, "no repository made around them");
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a folder of repositories is told three levels down, hidden folders and bare repositories too (Codex round 14)", async () => {
  const { reposBelow } = await import("../src/commands.mjs");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-rb-"));
  try {
    assert.deepEqual(reposBelow(d), []);
    assert.equal(spawnSync("git", ["init", "-q", path.join(d, "clients/team/app")]).status, 0);
    assert.equal(spawnSync("git", ["init", "-q", "--bare", path.join(d, ".hidden/store.git")]).status, 0);
    assert.deepEqual(reposBelow(d).map((x: string) => path.relative(d, x)).sort(), [".hidden/store.git", "clients/team/app"]);
    assert.equal(spawnSync("git", ["init", "-q", path.join(d, "org/clients/team/app")]).status, 0);
    assert.ok(reposBelow(d).some((x: string) => path.relative(d, x) === "org/clients/team/app"), "four levels down too (Codex round 15)");
    // A folder that cannot be read makes the search incomplete: git is then not offered (Codex round 16).
    if (process.getuid?.() !== 0) {
      const e = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-rb-locked-"));
      fs.mkdirSync(path.join(e, "locked"));
      fs.chmodSync(path.join(e, "locked"), 0o000);
      try {
        const { offerGitCheck } = await import("../src/commands.mjs");
        assert.match(String(offerGitCheck(e)), /too large to tell|cannot tell/);
      } finally {
        fs.chmodSync(path.join(e, "locked"), 0o755);
        fs.rmSync(e, { recursive: true, force: true });
      }
    }
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test("ask_person in a local turn (FOL-314): a list of choices, an answer of one's own, a question with no choices; refused with nobody to ask", async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "q1", name: "ask_person", input: { question: "Which colour for the button?", options: ["red", "green"] } }]),
    () => sse([{ type: "tool_use", id: "q2", name: "ask_person", input: { question: "And the border?", options: ["thin", "none"], answer: "planted by the model" } }]),
    () => sse([{ type: "tool_use", id: "q3", name: "ask_person", input: { question: "Ship it now?" } }]),
    () => sse([{ type: "text", text: "Asked everything." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-q314/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-q314", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("style the button\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/the agent asks you:[\s\S]*Which colour for the button\?[\s\S]*1\. red[\s\S]*2\. green[\s\S]*3\. type my own answer/, at, 30_000);
    t.send("2");
    at = await t.until(/answered: green[\s\S]*And the border\?[\s\S]*type my own answer/, at, 30_000);
    t.send("3");
    at = await t.until(/your answer:/, at, 30_000);
    t.send("a dashed one\r");
    at = await t.until(/Ship it now\?[\s\S]*your answer \(Enter for none\):/, at, 30_000);
    t.send("\r");
    at = await t.until(/Asked everything\./, at, 30_000);
    const result = (n: number) => JSON.stringify((asked[n]?.messages ?? []).at(-1));
    assert.ok((asked[0].tools ?? []).some((x: any) => x.name === "ask_person"), "offered to the model");
    assert.match(result(1), /The person answered: green/);
    assert.match(result(2), /The person answered: a dashed one/);
    assert.doesNotMatch(result(2), /planted by the model/, "an answer the model wrote is never taken as the person's");
    assert.match(result(3), /The person gave no answer/);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("Symbols inside the sandbox (FOL-297): unasked, its server run from the project's package cache inside the walls", { skip: canSandbox ? false : "needs the sandbox" }, async () => {
  const { packageCacheFor } = await import("../src/code-sandbox.mjs");
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const cache = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-xdg-")));
  fs.writeFileSync(path.join(d, "a.ts"), "export function add(a: number, b: number) { return a + b; }\n");
  fs.writeFileSync(path.join(d, "b.ts"), 'import {add} from "./a";\nconsole.log(add(1, 2));\n');
  // A stand-in for the pinned TypeScript server, where the real one is installed; it writes where it ran.
  const bin = path.join(packageCacheFor(d, { XDG_CACHE_HOME: cache }), "lsp", "typescript-7.0.2", "node_modules", ".bin");
  fs.mkdirSync(bin, { recursive: true });
  const target = new URL(`file://${fs.realpathSync(d)}/a.ts`).href;
  fs.writeFileSync(path.join(bin, "tsc"), `#!/usr/bin/env node
let buf = Buffer.alloc(0);
const send = (m) => { const s = JSON.stringify(m); process.stdout.write("Content-Length: " + Buffer.byteLength(s) + "\\r\\n\\r\\n" + s); };
let escaped = "no";
try { require("node:fs").writeFileSync(require("node:os").homedir() + "/foldrun-lsp-escape-test", "x"); escaped = "yes"; } catch {}
process.stdin.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const h = buf.indexOf("\\r\\n\\r\\n"); if (h < 0) return;
    const n = Number(/Content-Length: (\\d+)/i.exec(buf.subarray(0, h).toString())[1]);
    if (buf.length < h + 4 + n) return;
    const m = JSON.parse(buf.subarray(h + 4, h + 4 + n).toString()); buf = buf.subarray(h + 4 + n);
    if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { capabilities: {} } });
    else if (m.method === "textDocument/definition") send({ jsonrpc: "2.0", id: m.id, result: [{ uri: ${JSON.stringify(target)}, range: { start: { line: 0, character: 16 }, end: { line: 0, character: 19 } } }], escaped });
    else if (m.id !== undefined && m.method) send({ jsonrpc: "2.0", id: m.id, result: null });
  }
});
`, { mode: 0o755 });
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "y1", name: "Symbols", input: { action: "definition", file_path: "b.ts", line: 2, symbol: "add" } }]),
    () => sse([{ type: "text", text: "Found it." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-y297/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-y297", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200", FOLDRUN_CODE_SANDBOX: "", XDG_CACHE_HOME: cache });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("where is add defined\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/Found it\./, at, 60_000);
    assert.doesNotMatch(t.out().slice(at), /allow\?/, "not asked");
    assert.ok((asked[0].tools ?? []).some((x: any) => x.name === "Symbols"), "offered inside the walls");
    const result = JSON.stringify((asked[1]?.messages ?? []).at(-1));
    assert.match(result, /definition of add at b\.ts:2:13:\\na\.ts:1:17  export function add/);
    assert.equal(fs.existsSync(path.join(os.homedir(), "foldrun-lsp-escape-test")), false, "the server ran inside the walls: it could not write the home folder");
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
    fs.rmSync(path.join(os.homedir(), "foldrun-lsp-escape-test"), { force: true });
  }
});

test("a cloud agent's question in a cloud turn (FOL-298): shown as a list here, the answer sent to the run, which then finishes", { skip: hasPty ? false : "needs a pty" }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let answered: any = null;
  let release: () => void = () => {};
  const done = new Promise<void>((r) => (release = r));
  const step = (status: string) => ({
    agent: "coder", group: 1, status, attempts: 1, costUsd: 0.02,
    events: [{ t: "2026-11-25T01:00:01.000Z", type: "info", text: "asked a person: Which database?" }, ...(answered ? [{ t: "2026-11-25T01:00:09.000Z", type: "text", text: `Using ${answered.answer}.` }] : [])],
    questions: [{ id: "q-1", question: "Which database?", options: ["Postgres", "SQLite"], askedAt: "2026-11-25T01:00:01.000Z", ...(answered ? { answer: answered.answer } : {}) }],
    ...(answered ? { result: `Using ${answered.answer}.` } : {}),
  });
  const record = () => ({ id: RUN, flow: "adhoc:coder", status: answered ? "completed" : "running", snapshot: { id: ID }, startedAt: "2026-11-25T01:00:00.000Z", ...(answered ? { finishedAt: "2026-11-25T01:00:10.000Z" } : {}), steps: [step(answered ? "completed" : "running")] });
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => ({ ok: true, runId: RUN, snapshot: ID, context: "code-me" }),
    [`GET ${WS}/runs/${RUN}`]: () => record(),
    [`GET ${WS}/runs/${RUN}/stream`]: async () => {
      await done;
      return raw(`event: run\ndata: ${JSON.stringify(record())}\n\nevent: done\ndata: {}\n\n`, "text/event-stream");
    },
    [`POST ${WS}/runs/${RUN}/answer`]: (b) => {
      answered = JSON.parse(String(b));
      release();
      return { ok: true, answer: answered.answer };
    },
    [`GET ${WS}/runs/${RUN}/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "unchanged", bytes: 0, modified: [], added: [], deleted: [] }), "application/json") : raw("", "text/x-diff")),
    [`GET ${WS}/sessions/code-me/messages`]: () => ({ messages: [] }),
  });
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home, { COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("pick a database\r");
    at = await t.until(/send it\? \[y\]es/, at, 30_000);
    t.send("y\r");
    at = await t.until(/coder \(in the cloud\) asks you:[\s\S]*Which database\?[\s\S]*1\. Postgres[\s\S]*2\. SQLite[\s\S]*type my own answer/, at, 30_000);
    t.send("2");
    at = await t.until(/answered: SQLite/, at, 15_000);
    at = await t.until(/Using SQLite\./, at, 30_000);
    assert.deepEqual(answered, { question: "q-1", answer: "SQLite" });
    at = await t.until(/\w ❯ /, at, 30_000); // the turn is over: /quit is a command, not a line typed into it
    t.send("/quit\r");
    await t.ended();
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a cloud agent's question in a script's cloud turn (FOL-298): said on stderr with the command that answers it, no list, nothing sent", async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let streamed = false;
  let answers = 0;
  const step = () => ({
    agent: "coder", group: 1, status: streamed ? "failed" : "running", attempts: 1, costUsd: 0.01,
    events: [{ t: "2026-11-26T01:00:01.000Z", type: "info", text: "asked a person: Which database?" }],
    questions: [{ id: "q-7", question: "Which database?", options: ["Postgres", "SQLite"], askedAt: "2026-11-26T01:00:01.000Z", ...(streamed ? { unanswered: true } : {}) }],
  });
  const record = () => ({ id: RUN, flow: "adhoc:coder", status: streamed ? "failed" : "running", snapshot: { id: ID }, startedAt: "2026-11-26T01:00:00.000Z", ...(streamed ? { finishedAt: "2026-11-26T01:00:05.000Z" } : {}), steps: [step()] });
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => ({ ok: true, runId: RUN, snapshot: ID, context: "code-me" }),
    [`GET ${WS}/runs/${RUN}`]: () => record(),
    [`GET ${WS}/runs/${RUN}/stream`]: async () => {
      const first = `event: run\ndata: ${JSON.stringify(record())}\n\n`;
      await new Promise((r) => setTimeout(r, 1500));
      streamed = true;
      return raw(`${first}event: run\ndata: ${JSON.stringify(record())}\n\nevent: done\ndata: {}\n\n`, "text/event-stream");
    },
    [`POST ${WS}/runs/${RUN}/answer`]: () => {
      answers++;
      return { ok: true };
    },
    [`GET ${WS}/runs/${RUN}/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "unchanged", bytes: 0, modified: [], added: [], deleted: [] }), "application/json") : raw("", "text/x-diff")),
    [`GET ${WS}/sessions/code-me/messages`]: () => ({ messages: [] }),
  });
  try {
    const cli = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
    const r = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
      const child = spawn(process.execPath, [cli, "code", d, "--cloud", "--to", "desk", "--context", "code-me", "-p", "pick a database", "--yes", "--url", s.url, "--token", "k"], { env: { ...process.env, FOLDRUN_HOME: home, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (b) => (out += b));
      child.stderr.on("data", (b) => (err += b));
      const kill = setTimeout(() => child.kill("SIGKILL"), 60_000);
      child.on("close", (code) => (clearTimeout(kill), resolve({ code, out, err })));
    });
    assert.match(r.err, /coder \(in the cloud\) asks: Which database\?/, r.err + r.out);
    assert.match(r.err, /choices: 1\. Postgres · 2\. SQLite/);
    assert.match(r.err, new RegExp(`foldrun answer ${RUN} --question q-7`));
    assert.doesNotMatch(r.out + r.err, /setRawMode|↑↓ to move|type my own answer/);
    assert.equal(answers, 0, "nothing is sent for a person who was not asked");
    assert.notEqual(r.code, null, "it ended by itself, not by the test's kill");
    assert.notEqual(r.code, 0, "the run ended unanswered: a failed turn");
    // -p at a terminal is a script's turn too: told, never a list (Codex).
    streamed = false;
    const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "-p", "pick a database", "--yes", "--url", s.url, "--token", "k"], home, { COLUMNS: "200" });
    try {
      await t.until(/coder \(in the cloud\) asks: Which database\?[\s\S]*foldrun answer/, 0, 30_000);
      await t.ended();
      assert.doesNotMatch(t.out(), /↑↓ to move|type my own answer/);
      assert.equal(answers, 0);
    } finally {
      t.child.kill();
    }
  } finally {
    s.close();
  }
});

test("a cloud agent's question answered elsewhere (FOL-298): the one on the screen is taken back, nothing is sent", { skip: hasPty ? false : "needs a pty" }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let posted = false;
  let elsewhere = false;
  const record = () => ({
    id: RUN, flow: "adhoc:coder", status: elsewhere ? "completed" : "running", snapshot: { id: ID }, startedAt: "2026-11-25T01:00:00.000Z", ...(elsewhere ? { finishedAt: "2026-11-25T01:00:10.000Z" } : {}),
    steps: [{
      agent: "coder", group: 1, status: elsewhere ? "completed" : "running", attempts: 1, costUsd: 0.02, events: [], ...(elsewhere ? { result: "Using Postgres." } : {}),
      questions: [{ id: "q-1", question: "Which database?", options: ["Postgres", "SQLite"], askedAt: "2026-11-25T01:00:01.000Z", ...(elsewhere ? { answer: "Postgres", by: "dashboard" } : {}) }],
    }],
  });
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => ({ ok: true, runId: RUN, snapshot: ID, context: "code-me" }),
    [`GET ${WS}/runs/${RUN}`]: () => record(),
    [`GET ${WS}/runs/${RUN}/stream`]: async () => {
      await new Promise((r) => setTimeout(r, 2500));
      elsewhere = true;
      return raw(`event: run\ndata: ${JSON.stringify(record())}\n\nevent: done\ndata: {}\n\n`, "text/event-stream");
    },
    [`POST ${WS}/runs/${RUN}/answer`]: () => {
      posted = true;
      return { ok: true };
    },
    [`GET ${WS}/runs/${RUN}/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "unchanged", bytes: 0, modified: [], added: [], deleted: [] }), "application/json") : raw("", "text/x-diff")),
    [`GET ${WS}/sessions/code-me/messages`]: () => ({ messages: [] }),
  });
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home, { COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("pick a database\r");
    at = await t.until(/send it\? \[y\]es/, at, 30_000);
    t.send("y\r");
    at = await t.until(/coder \(in the cloud\) asks you:[\s\S]*type my own answer/, at, 30_000);
    at = await t.until(/answered elsewhere, or no longer asked/, at, 30_000);
    at = await t.until(/\w ❯ /, at, 30_000);
    assert.equal(posted, false, "nothing sent for a question already answered");
    t.send("/quit\r");
    await t.ended();
  } finally {
    t.child.kill();
    s.close();
  }
});

test("the web in the cloud by default (FOL-383, FOL-267): the web tool browses through the gateway's door with the session's key, unasked; the agent's locks go with it", async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const browsed: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "w1", name: "web", input: { action: "browse", url: "https://shop.example/", steps: [{ click: "#more" }] } }]),
    () => sse([{ type: "text", text: "Read the page." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-b267/messages`]: () => ({ messages: [] }),
    [`GET ${WS}/source`]: (_b, q) => (q.get("path") === "agents/coder/agent.md" ? { content: "---\nname: coder\ntools: [web]\nweb:\n  browse:\n    allowed_domains: [\"*.shop.example\"]\n---\nYou code.\n" } : { content: "" }),
    "GET /v1/account/agents-md": () => ({ content: "" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/foldrun/browse": (b) => {
      browsed.push({ body: JSON.parse(String(b)) });
      return { url: "https://shop.example/", text: "# Shop\nThree hats." };
    },
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return (turns[asked.length - 1] ?? (() => sse([{ type: "text", text: "(no more)" }])))();
    },
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-b267", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    // No /where: the web is in the cloud unless the person says here.
    t.send("read the shop\r");
    at = await t.until(/paid by your foldrun plan/, at);
    // A cloud browse is not asked by default (owner, 26 Nov 2026: /permissions web ask turns asking on).
    await t.until(/Read the page\./, at, 30_000);
    assert.doesNotMatch(t.out().slice(at), /\[y\]es/, "nothing asked before the cloud browse");
    const door = (s as any).seen.find((x: any) => x.url === "/v1/foldrun/browse");
    assert.equal(door.headers["x-api-key"], "fr_gw_test", "the session's own key");
    assert.ok(door.headers["idempotency-key"], "an Idempotency-Key");
    assert.equal(browsed.length, 1, "one call, through the door");
    assert.deepEqual(browsed[0].body, { url: "https://shop.example/", mode: "markdown", steps: [{ click: "#more" }], allowed_domains: ["*.shop.example"] });
    assert.ok((asked[0].tools ?? []).some((x: any) => x.name === "web" && /cloud/.test(x.description)), "the cloud web tool is offered");
    assert.match(JSON.stringify(asked[1].messages.at(-1)), /Three hats/);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("search and fetch on foldrun's servers in a local turn (FOL-304): offered once the gateway says it runs them, and as the agent's web.actions allow", { skip: coreServerTools ? false : "needs a core with the engine's serverTools (FOL-304)" }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "text", text: "First answer." }]),
    () => sse([{ type: "text", text: "Second answer." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-s304/messages`]: () => ({ messages: [] }),
    [`GET ${WS}/source`]: (_b, q) => (q.get("path") === "agents/coder/agent.md" ? { content: "---\nname: coder\ntools: [web]\nweb:\n  actions: [search, browse]\n---\nYou code.\n" } : { content: "" }),
    "GET /v1/account/agents-md": () => ({ content: "" }),
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
  }, { headers: { "foldrun-server-tools": "web_search_20250305,web_fetch_20250910,foldrun_web_browse_20251125" } });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-s304", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("hello\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/First answer\./, at, 30_000);
    at = await t.until(/\w ❯ /, at, 30_000);
    t.send("again\r");
    await t.until(/Second answer\./, at, 30_000);
    const types = (n: number) => (asked[n].tools ?? []).filter((x: any) => x.type).map((x: any) => `${x.type}:${x.name}`);
    // The gateway was asked once before the first turn (its models answer carries the header).
    assert.ok((s as any).seen.some((x: any) => x.url === "/v1/models" && x.headers.authorization === "Bearer fr_gw_test"), "asked with the session's key, as the engine sends it");
    assert.deepEqual(types(0), ["web_search_20250305:web_search"], "search only: the agent's web.actions do not hold fetch");
    assert.deepEqual(types(1), ["web_search_20250305:web_search"]);
    t.send("/where local\r");
    at = await t.until(/This computer only/, 0, 15_000);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("/where web here (FOL-383): search and fetch run from this computer under the same names, unasked; no server tools go to the gateway; /permissions web ask asks", async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "f1", name: "web_fetch", input: { url: "http://127.0.0.1:9/secret" } }]),
    () => sse([{ type: "text", text: "Fetched." }]),
    () => sse([{ type: "tool_use", id: "f2", name: "web_fetch", input: { url: "http://127.0.0.1:9/again" } }]),
    () => sse([{ type: "text", text: "Asked first." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-w383/messages`]: () => ({ messages: [] }),
    [`GET ${WS}/source`]: (_b, q) => (q.get("path") === "agents/coder/agent.md" ? { content: "---\nname: coder\ntools: [web]\n---\nYou code.\n" } : { content: "" }),
    "GET /v1/account/agents-md": () => ({ content: "" }),
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
  }, { headers: { "foldrun-server-tools": "web_search_20250305,web_fetch_20250910,foldrun_web_browse_20251125" } });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-w383", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/where web here\r");
    at = await t.until(/The web on this computer/, at);
    t.send("fetch it\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/Fetched\./, at, 30_000);
    const names = (n: number) => (asked[n].tools ?? []).map((x: any) => (x.type ? `${x.type}:${x.name}` : x.name));
    assert.ok(names(0).includes("web_search") && names(0).includes("web_fetch"), "search and fetch offered as this computer's own tools");
    assert.ok(!names(0).some((x: string) => /^web_(search|fetch)_\d{8}:/.test(x)), "no server tools sent to the gateway");
    // This computer's own services are never fetched for a page: the answer says it was refused.
    assert.match(JSON.stringify(asked[1].messages.at(-1)), /on this computer or its local network/);
    at = await t.until(/\w ❯ /, at, 30_000);
    t.send("/permissions web ask\r");
    at = await t.until(/web calls are asked first/, at);
    t.send("fetch again\r");
    at = await t.until(/\[y\]es/, at, 30_000);
    t.send("n\r");
    await t.until(/Asked first\./, at, 30_000);
    t.send("/permissions web bypass\r");
    await t.until(/web calls run without asking/, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("the web for an agent whose file names no tools: [web] (FOL-383, FOL-412): on by default, in the cloud or here", async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-n383/messages`]: () => ({ messages: [] }),
    [`GET ${WS}/source`]: (_b, q) => (q.get("path") === "agents/coder/agent.md" ? { content: "---\nname: coder\n---\nYou code.\n" } : { content: "" }),
    "GET /v1/account/agents-md": () => ({ content: "" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return sse([{ type: "text", text: `Answer ${asked.length}.` }]);
    },
  }, { headers: { "foldrun-server-tools": "web_search_20250305,web_fetch_20250910" } });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-n383", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("hello\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/Answer 1\./, at, 30_000);
    at = await t.until(/\w ❯ /, at, 30_000);
    t.send("/where web here\r");
    at = await t.until(/The web on this computer/, at);
    t.send("again\r");
    await t.until(/Answer 2\./, at, 30_000);
    for (const req of asked) {
      const names = (req.tools ?? []).map((x: any) => x.name);
      // FOL-412: every web tool foldrun offers is on by default, tools: [web] or not; with /where web here, search and fetch run here.
      assert.ok(names.includes("web") || names.some((n: string) => /search|fetch/.test(n)), `the web is offered without tools: [web] (${names.join(", ")})`);
    }
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("CPU and memory on this computer (FOL-240): asked once at the start, shown and changed under /permissions resources, kept for the computer", { skip: coreResources ? false : "needs a core with local-resources (FOL-240)" }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-r240/messages`]: () => ({ messages: [] }),
    [`GET ${WS}/source`]: (_b, q) => (q.get("path") === "agents/coder/agent.md" ? { content: "---\nname: coder\nsize: heavy\n---\nYou code.\n" } : { content: "" }),
    "GET /v1/account/agents-md": () => ({ content: "" }),
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-r240", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200", FOLDRUN_CODE_RESOURCES: "" });
  try {
    let at = await t.until(/How much of this computer may foldrun use\?[\s\S]*Light[\s\S]*Balanced[\s\S]*Most[\s\S]*No limit/);
    t.send("\r");
    at = await t.until(/\w ❯ /, at, 30_000);
    t.send("/permissions resources\r");
    at = await t.until(/allowed .*\(kept for this computer\)[\s\S]*coder asks +4 cores, 8 GiB \(its size:\/resources:\)[\s\S]*memory in force [^\n]*(sampled|not yet held)/, at); // macOS samples it; Linux holds it in a later step (CI runs Linux)
    t.send("/permissions resources memory 1Gi\r");
    at = await t.until(/this session: memory 1Gi/, at);
    t.send("/permissions resources\r");
    at = await t.until(/memory in force 1 GiB/, at);
    t.send("/permissions resources save\r");
    at = await t.until(/kept as this computer's budget: cpu=[\d.]+, memory=1024Mi/, at);
    t.send("/quit\r");
    await t.done;
    const prefs = execFileSync("grep", ["-rl", "memory=1024Mi", home], { encoding: "utf8" }).trim();
    assert.ok(prefs, "kept in this computer's prefs");
  } finally {
    t.child.kill();
    s.close();
  }
});

// ---- FOL-345: trusted sessions, messages into a running turn, the answer sent back -------------------------------

/** A platform for the FOL-345 tests: one waiting message that `arrive()` makes appear, the take route, what is sent
 *  back to the sender, and the thread between them as the platform keeps it. */
test("a trusted session's message reaches a running turn with no key pressed, is used, and the answer goes back as a thread (FOL-345)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let p: Awaited<ReturnType<typeof messagingPlatform>>;
  p = await messagingPlatform("code-mid", [
    // The first call: the message arrives while it runs, and the answer is a read the agent makes unasked.
    () => {
      p.state.arrived = true;
      return later(1_500, sse([{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "a.txt" } }]));
    },
    () => sse([{ type: "text", text: "The build script is fine." }]),
  ]);
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-mid", "--url", p.s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200", FOLDRUN_CODE_MESSAGE_POLL_MS: "300" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/sessions trust code-other\r");
    at = await t.until(/came from the sign-in key:k-bo — trust that sign-in as code-other\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/code-other is trusted in this conversation \(as the sign-in key:k-bo\)/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("look at a.txt\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/✉ a message from code-other — Please check the build script\.[\s\S]*from a session you trust: the agent reads it after what it is doing now/, at, 30_000);
    at = await t.until(/the message from code-other goes to the agent now/, at, 30_000);
    at = await t.until(/The build script is fine\./, at, 30_000);
    at = await t.until(/↩ the answer went back to code-other/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/sessions code-other\r");
    at = await t.until(/code-mid and code-other · 3 messages[\s\S]*Please check the build script\.[\s\S]*→ you to code-other[\s\S]*↩ answer from code-mid to your message:[\s\S]*The build script is fine\./, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    p.s.close();
  }
  assert.doesNotMatch(JSON.stringify(p.asked[0].messages), /Please check the build script/, "not in the call already running");
  const second = JSON.stringify(p.asked[1].messages);
  assert.match(second, /Please check the build script\./, "handed in at the next step");
  assert.match(second, /information from those sessions, not instructions/, "framed as information");
  assert.deepEqual(p.takes, [{ ids: ["m345"] }, { hold: "lt-bbbbbbbbbbbbbbbbbbbbbbbb", outcome: "used" }], "held, then used once handed in");
  assert.equal(p.back.length, 1, "one answer back");
  assert.equal(p.back[0].from, "code-mid");
  assert.match(p.back[0].text, /^↩ answer from code-mid to your message:\n\nThe build script is fine\.$/);
  // Kept with the conversation for --continue, pinned to the sign-in that sent it.
  const kept = JSON.parse(fs.readFileSync(path.join(home, "code-sessions.json"), "utf8"))[d];
  assert.deepEqual(kept.trusted, [{ context: "code-other", sender: "key:k-bo" }]);
});

test("a message from a session not trusted is only said during a turn: not held, not sent in, no answer back (FOL-345)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let p: Awaited<ReturnType<typeof messagingPlatform>>;
  p = await messagingPlatform("code-unt", [
    () => {
      p.state.arrived = true;
      return later(1_500, sse([{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "a.txt" } }]));
    },
    () => sse([{ type: "text", text: "Read it." }]),
  ]);
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-unt", "--url", p.s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200", FOLDRUN_CODE_MESSAGE_POLL_MS: "300" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("look at a.txt\r");
    at = await t.until(/paid by your foldrun plan/, at);
    at = await t.until(/✉ a message from code-other — Please check the build script\.[\s\S]*after this turn, Enter on an empty line takes it in \(you are asked first\)/, at, 30_000);
    at = await t.until(/Read it\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    // Left for the person: an empty Enter asks, as before.
    t.send("\r");
    at = await t.until(/take it into a turn now\? \[y\/N\]/, at, 10_000);
    t.send("n\r");
    at = await t.until(/left waiting/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    p.s.close();
  }
  assert.equal(p.asked.length, 2);
  assert.doesNotMatch(JSON.stringify(p.asked), /Please check the build script/, "never sent to the model");
  assert.deepEqual(p.takes, [], "never held");
  assert.deepEqual(p.back, [], "nothing sent back");
});

test("a trusted session's message at an empty prompt starts a turn by itself, and its answer goes back (FOL-345)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const p = await messagingPlatform("code-idle", [() => sse([{ type: "text", text: "Checked: it builds." }])]);
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-idle", "--url", p.s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200", FOLDRUN_CODE_MESSAGE_POLL_MS: "300" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/sessions trust code-other\r");
    at = await t.until(/came from the sign-in key:k-bo — trust that sign-in as code-other\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/code-other is trusted/, at);
    at = await t.until(/\w ❯ /, at);
    p.state.arrived = true;
    at = await t.until(/✉ a message from code-other \(a session you trust\) — a turn starts for it/, at, 10_000);
    at = await t.until(/paid by your foldrun plan/, at, 30_000);
    at = await t.until(/Checked: it builds\./, at, 30_000);
    at = await t.until(/↩ the answer went back to code-other/, at, 30_000);
    assert.doesNotMatch(t.out(), /take it into a turn now\?|include it in this turn\?/, "nobody was asked about the message");
    at = await t.until(/\w ❯ /, at);
    // Used: it starts nothing again.
    await new Promise((r) => setTimeout(r, 1_000));
    assert.equal(p.asked.length, 1);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    p.s.close();
  }
  assert.match(JSON.stringify(p.asked[0].messages), /Please check the build script\./);
  assert.deepEqual(p.takes, [{ ids: ["m345"] }, { hold: "lt-bbbbbbbbbbbbbbbbbbbbbbbb", outcome: "used" }]);
  assert.equal(p.back.length, 1);
  assert.match(p.back[0].text, /^↩ answer from code-idle to your message:\n\nChecked: it builds\.$/);
});

test("the answer is not sent back a second time when the agent answered the sender itself with session_send (FOL-345)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const p = await messagingPlatform("code-own", [
    () => sse([{ type: "tool_use", id: "s1", name: "session_send", input: { to: "code-other", text: "It builds, details follow." } }]),
    () => sse([{ type: "text", text: "Told code-other." }]),
  ]);
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-own", "--url", p.s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200", FOLDRUN_CODE_MESSAGE_POLL_MS: "300" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/sessions trust code-other\r");
    at = await t.until(/came from the sign-in key:k-bo — trust that sign-in as code-other\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/code-other is trusted/, at);
    at = await t.until(/\w ❯ /, at);
    p.state.arrived = true;
    at = await t.until(/a turn starts for it/, at, 10_000);
    at = await t.until(/paid by your foldrun plan/, at, 30_000);
    // The agent's own message is asked about, as every session_send is.
    at = await t.until(/a message to the session code-other[\s\S]*allow\? \[y\]es/, at, 30_000);
    t.send("y\r");
    at = await t.until(/Told code-other\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    p.s.close();
  }
  assert.doesNotMatch(String(p.back.map((b) => b.text)), /↩ answer from/, "no answer sent back on top");
  assert.deepEqual(p.back.map((b) => b.text), ["It builds, details follow."]);
});

test("a trust holds only for the sign-in it is pinned to: the same session id from another sign-in is asked about (FOL-345, Codex)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const p = await messagingPlatform("code-pin", [() => sse([{ type: "text", text: "x" }])], { sender: "key:k-mallory" });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-pin", "--url", p.s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200", FOLDRUN_CODE_MESSAGE_POLL_MS: "300" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/sessions trust code-other\r");
    at = await t.until(/came from the sign-in key:k-bo — trust that sign-in as code-other\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/as the sign-in key:k-bo/, at);
    at = await t.until(/\w ❯ /, at);
    p.state.arrived = true;
    at = await t.until(/✉ a message from code-other[\s\S]*Enter on an empty line takes it into a turn \(you are asked first\)/, at, 10_000);
    await new Promise((r) => setTimeout(r, 1_500));
    assert.doesNotMatch(t.out().slice(at), /a turn starts/);
    t.send("/sessions untrust code-other\r");
    at = await t.until(/code-other is not trusted any more/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/sessions trust\r");
    at = await t.until(/no session is trusted here/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    p.s.close();
  }
  assert.equal(p.asked.length, 0, "nothing started for it");
  assert.deepEqual(p.takes, []);
});

test("an answer sent back from a trusted session never starts a turn by itself (FOL-345)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const p = await messagingPlatform("code-rep", [() => sse([{ type: "text", text: "x" }])], { text: "↩ answer from code-other to your message:\n\nit builds" });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-rep", "--url", p.s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200", FOLDRUN_CODE_MESSAGE_POLL_MS: "300" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/sessions trust code-other\r");
    at = await t.until(/came from the sign-in key:k-bo — trust that sign-in as code-other\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/code-other is trusted/, at);
    at = await t.until(/\w ❯ /, at);
    p.state.arrived = true;
    at = await t.until(/✉ a message from code-other[\s\S]*an answer to your message · Enter on an empty line takes it into a turn/, at, 10_000);
    await new Promise((r) => setTimeout(r, 1_500));
    assert.doesNotMatch(t.out().slice(at), /a turn starts/);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    p.s.close();
  }
  assert.equal(p.asked.length, 0, "no turn, no model call");
  assert.deepEqual(p.takes, []);
});
