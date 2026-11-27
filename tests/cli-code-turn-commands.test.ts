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

test("typing / during a turn opens the prompt's / list under the input line: /per shows /permissions, ↓ moves, Tab completes, Esc closes it and the turn goes on, a paste stays text (FOL-434)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  fs.mkdirSync(path.join(d, "src"));
  fs.writeFileSync(path.join(d, "src", "deep.ts"), "x\n");
  execFileSync("git", ["-C", d, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
  execFileSync("git", ["-C", d, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "more"]);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "b1", name: "Bash", input: { command: "sleep 12; echo slept" } }]),
    () => sse([{ type: "text", text: "Finished." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-tl/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local", "--no-sandbox", "--to", "desk", "--context", "code-tl", "--url", s.url, "--token", "k"], home, { TERM: "xterm-256color", COLUMNS: "120" });
  const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));
  /** The last whole frame drawn so far whose input line shows `typed` and nothing after it on the row. */
  const frameWith = (typed: string) => t.out().split("\x1b[?2026h").filter((f) => f.includes("\x1b[?2026l") && new RegExp(`❯ ${typed.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?:\\x1b\\[K|\\s*$)`, "m").test(f)).at(-1) ?? "";
  /** The keys, then a moment: each key read on its own (a key with text reads as a paste). */
  const key = async (k: string) => {
    t.send(k);
    await pause();
  };
  try {
    let at = await t.until(/\w ❯ /);
    t.send("one\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/sleep 12; echo slept[\s\S]*\[y\]es/, at, 30_000);
    t.send("y\r");
    at = await t.until(/Enter: tell the agent now/, at, 5_000);
    await pause(300);
    // /per: the list under the line, /permissions in it and chosen, as at the prompt.
    await key("/per");
    at = await t.until(/❯ \/permissions/, at, 5_000);
    let frame = frameWith("/per");
    assert.ok(frame, "a frame shows /per on the input line");
    assert.match(frame, /❯ \/permissions \[strict/, "the list is drawn under the input line");
    assert.match(frame, /\x1b\[\d+A\r/, "the cursor goes back up to the input line");
    // Esc: the list away, the turn still running, nothing sent.
    await key("\x1b");
    await pause(200);
    frame = frameWith("/per");
    assert.ok(frame && !/\/permissions/.test(frame), "Esc took the list away (a frame of /per with no list)");
    assert.equal(asked.length, 1, "Esc did not stop or touch the turn");
    // Enter with the list closed: the line as typed, a command the session does not have (said back, not sent).
    await key("\r");
    at = await t.until(/\/per is not a command — did you mean \/permissions/, at, 5_000);
    // /s: ↓ ↓ ↑ chooses the second, Tab puts it on the line (and a space when it takes more).
    const { CODE_COMMANDS } = await import("../src/code-session.mjs");
    const { slashMatches } = await import("../src/code-context.mjs");
    const second = slashMatches("/s", CODE_COMMANDS.map(([n, desc]) => ({ name: String(n).split(" ")[0], hint: String(n).split(" ").slice(1).join(" "), desc: String(desc) })))[1];
    assert.ok(second, "/s has two commands to choose from");
    await key("/s");
    at = await t.until(/❯ \/s/, at, 5_000);
    await key("\x1b[B");
    await key("\x1b[B");
    await key("\x1b[A");
    assert.match(frameWith("/s"), new RegExp(`❯ ${second.name}`), "↓ ↓ ↑ chose the second");
    await key("\t");
    const line = `${second.name}${second.hint ? " " : ""}`;
    assert.ok(frameWith(line), `Tab put ${line} on the line`);
    await key("\x7f".repeat(line.length));
    // /sta, Tab: the line is /status, never queued; Enter runs it beside the turn.
    await key("/sta");
    at = await t.until(/❯ \/status/, at, 5_000);
    await key("\t");
    assert.doesNotMatch(t.out().slice(at), /queued for after this turn|runs after this turn/, "Tab completed, it did not queue");
    assert.ok(frameWith("/status ") || frameWith("/status"), "Tab put /status on the line");
    await key("\r");
    at = await t.until(/\/status · runs now, beside the turn/, at, 5_000);
    // @path: the folder's files under the line, Tab walks into a folder then takes the file.
    await key("see @sr");
    at = await t.until(/❯ @src\//, at, 5_000);
    await key("\t");
    at = await t.until(/❯ @src\/deep\.ts/, at, 5_000);
    await key("\t");
    assert.ok(frameWith("see @src/deep.ts "), "Tab took the file");
    // Clear the line: Backspace for each character.
    await key("\x7f".repeat("see @src/deep.ts ".length));
    // A paste that starts with /: text, no list, Enter sends it as typed — never swapped for a command.
    await key("\x1b[200~/sta\x1b[201~");
    frame = frameWith("/sta");
    assert.ok(frame && !/❯ \/status/.test(frame), "no list on a paste");
    await key("\r");
    at = await t.until(/\/sta is not a command/, at, 5_000);
    assert.equal(asked.length, 1, "the turn was still on its command throughout");
    at = await t.until(/Finished\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.ended(), 0);
  } finally {
    t.child.kill();
    s.close();
  }
  assert.equal(asked.length, 2, "no turn was started by the keys");
  assert.doesNotMatch(JSON.stringify(asked.map((a) => a.messages)), /\/per|\/sta|deep\.ts/);
});

// Whether this machine can put the walls up at all (CI runners have no bubblewrap), asked in a process of its own.
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

test("two tool calls at once, one asked (bash_outside) and one not (Bash in the sandbox): the y typed answers the question, the asked call runs, and the input line is drawn only while a reader reads it (FOL-434)", { skip: canSandbox ? false : "no local sandbox on this machine", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([
      { type: "tool_use", id: "o1", name: "bash_outside", input: { command: `echo outside-ran > ${path.join(d, "outside.txt")}`, reason: "needs the network as you" } },
      { type: "tool_use", id: "b1", name: "Bash", input: { command: "sleep 1; echo inside-ran" } },
    ]),
    () => sse([{ type: "text", text: "Both done." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-pa/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-pa", "--url", s.url, "--token", "k"], home, { TERM: "xterm-256color", COLUMNS: "160", FOLDRUN_CODE_SANDBOX: "" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("one\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/allow\? \[y\]es · \[n\]o/, at, 60_000);
    const asking = at;
    await new Promise((r) => setTimeout(r, 2_500));
    // While the question is on the screen, no working rows are drawn under it: nobody reads keys for them.
    assert.doesNotMatch(t.out().slice(asking), /working/, "no ticker under the question");
    t.send("y");
    await new Promise((r) => setTimeout(r, 80));
    t.send("\r");
    at = await t.until(/Both done\./, at, 30_000);
    assert.equal(fs.readFileSync(path.join(d, "outside.txt"), "utf8"), "outside-ran\n");
    // Every frame that draws the input line while it is empty shows the hint: a reader is reading it.
    const frames = t.out().split("\x1b[?2026h").filter((f) => f.includes("\x1b[?2026l") && /working/.test(f) && /❯ (?:\x1b\[K|\s*$)/m.test(f));
    const bad = frames.filter((f) => !/Enter: tell the agent now/.test(f));
    assert.deepEqual(bad.length, 0, `an input line drawn with no reader: ${JSON.stringify(bad.slice(0, 3))}`);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.ended(), 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a question over the input line (FOL-434): it waits for a pause in the typing, a paste never answers it, two come one after the other, and what was typed is still there after", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "r1", name: "Read", input: { file_path: path.join(d, "a.txt") } }]),
    // The asked calls come while the person is typing.
    () => new Promise((r) => setTimeout(r, 1_500)).then(() => sse([
      { type: "tool_use", id: "b1", name: "Bash", input: { command: "echo first > f1.txt" } },
      { type: "tool_use", id: "b2", name: "Bash", input: { command: "echo second > f2.txt" } },
    ])),
    () => sse([{ type: "text", text: "All done." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-qv/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local", "--no-sandbox", "--to", "desk", "--context", "code-qv", "--url", s.url, "--token", "k"], home, { TERM: "xterm-256color", COLUMNS: "160" });
  const pause = (ms = 150) => new Promise((r) => setTimeout(r, ms));
  try {
    let at = await t.until(/\w ❯ /);
    t.send("one\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/Enter: tell the agent now/, at, 10_000);
    // Typing, a key every 250 ms for about 3 s: the question that comes meanwhile waits for a pause.
    const typing = "keep this text";
    let lastKey = 0;
    for (const ch of typing) {
      t.send(ch);
      lastKey = Date.now();
      await pause(250);
    }
    assert.doesNotMatch(t.out().slice(at), /allow\? \[y\]es/, "no question while the person typed");
    at = await t.until(/echo first > f1\.txt[\s\S]*allow\? \[y\]es/, at, 15_000);
    assert.ok(Date.now() - lastKey >= 900, `shown a second after the last key, not ${Date.now() - lastKey} ms`);
    // A paste is text, never the answer: a pasted "y" and line break leave the question open.
    t.send("\x1b[200~y\r\x1b[201~");
    await pause(700);
    assert.ok(!fs.existsSync(path.join(d, "f1.txt")), "a paste did not answer");
    assert.doesNotMatch(t.out().slice(at), /echo second/, "the second question waits for the first");
    // Ctrl-U clears it, then a typed y and Enter answer.
    t.send("\x15");
    await pause();
    t.send("y");
    await pause(80);
    t.send("\r");
    at = await t.until(/echo second > f2\.txt[\s\S]*allow\? \[y\]es/, at, 15_000);
    t.send("y");
    await pause(80);
    t.send("\r");
    at = await t.until(/All done\./, at, 30_000);
    // What was typed while the questions came is on the next prompt's line, as typed.
    at = await t.until(/❯ (?:\x1b\[\d+G)?keep this text/, at, 10_000);
    t.send("\x15");
    await pause();
    t.send("/quit\r");
    assert.equal(await t.ended(), 0);
  } finally {
    t.child.kill();
    s.close();
  }
  assert.equal(fs.readFileSync(path.join(d, "f1.txt"), "utf8"), "first\n");
  assert.equal(fs.readFileSync(path.join(d, "f2.txt"), "utf8"), "second\n");
  assert.doesNotMatch(JSON.stringify(asked.map((a) => a.messages)), /keep this text/, "the typed text was never sent");
});
