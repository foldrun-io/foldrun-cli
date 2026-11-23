// foldrun code as a person uses it (19 Nov 2026): a real terminal (a pty,
// through python3's pty module), typing /help, !command, a pasted
// two-line message, d at the apply prompt, /undo, /quit — and --continue
// picking the conversation up again. Plus the helpers in code-session.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { serve, raw } from "./fake-platform.ts";
import {
  codeCompleter, joinMessage, shellNote, withNotes, colorPatch, helpText, readHistory, appendHistory, lastSession, rememberSession,
  friendlyTool, friendlyError, folderRelative, formatSecs, formatBytes, formatCost, shortModel, homeTilde,
} from "../src/code-session.mjs";

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

function onTerminal(args: string[], home: string, extraEnv: Record<string, string> = {}) {
  const cli = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
  const child = spawn("python3", ["-c", "import pty,sys; sys.exit(pty.spawn(sys.argv[1:]) >> 8)", process.execPath, cli, ...args], {
    env: { ...outerEnv(), FOLDRUN_HOME: home, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1", SHELL: "/bin/sh", TERM: "dumb", ...extraEnv },
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
  return { send: (t: string) => child.stdin.write(t), until, done, out: () => out, child };
}

test("a session on a terminal: /help, !command sent with the next message, a pasted message is one turn, d shows the diff, /undo, /quit, then --continue", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home);
  try {
    let at = await t.until(/\w ❯ /);
    assert.match(t.out(), /session code-me/);

    t.send("/help\r");
    at = await t.until(/\/undo\s+take back/, at);
    at = await t.until(/\w ❯ /, at);

    t.send("!echo hello-from-shell\r");
    at = await t.until(/goes with your next message/, at);
    assert.match(t.out(), /hello-from-shell/);
    at = await t.until(/\w ❯ /, at);

    // Two lines in one write: a paste — one message, one turn.
    t.send("add b\rand keep it short\r");
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

    t.send("/undo\r");
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

test("a bracketed paste is one message however slowly it arrives; Enter after it sends it; the terminal's paste mode is off again after", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
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
    assert.match(t.out(), /\x1b\[\?2004l[\s\S]*apply it to/, "paste mode off before the turn");
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

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
    t.send("/model\r");
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
    t.send("/model\r");
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
    t.send("/model\r");
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
    at = await t.until(/next: y then add c/, at);
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

test("the reply: markdown drawn, wrapped to the screen, words already shown left out, the sandbox's folder name gone", async () => {
  const { formatReply, withoutSaid, replyPaths } = await import("../src/code-session.mjs");
  const c = { bold: (x: string) => `<b>${x}</b>`, cyan: (x: string) => `<c>${x}</c>`, dim: (x: string) => `<d>${x}</d>` };
  const out = formatReply("- **`calc.py`:** `add` now returns `a + b` instead of `a - b`, which is what the test checks for.\n## Next\n```\nx = 1\n```\nlone * star", 40, c);
  const lines = out.split("\n");
  assert.equal(lines[0], "  • <c><b>calc.py</b></c><b>:</b> <c>add</c> now returns <c>a + b</c>");
  assert.match(lines[1]!, /^ {4}instead of/, "a list item's next line sits under its text");
  for (const l of lines) assert.ok(l.replace(/<\/?[bcd]>/g, "").length <= 38, `within the screen: ${l}`);
  assert.ok(lines.includes("  <b>Next</b>"), "a heading is bold, its # gone");
  assert.ok(lines.includes("    <d>x = 1</d>") && !out.includes("```"), "fenced code kept, its fences gone");
  assert.ok(lines.includes("  lone * star"), "a lone mark is shown as written");
  const said = "The folder holds one file with an obvious bug. I'll fix it.";
  assert.equal(withoutSaid(`${said}\nI fixed the bug.`, [said]), "I fixed the bug.");
  assert.equal(replyPaths("built in `snapshot/site/`; open snapshot/site/index.html"), "built in `site/`; open site/index.html");
  assert.equal(replyPaths("what to change in `snapshot/`. The snapshot holds one file"), "what to change in your folder. The snapshot holds one file");
  assert.equal(replyPaths("wrote /work/agents/coder/snapshot/test.py"), "wrote test.py");
  assert.equal(replyPaths("see https://example.com/snapshot/report"), "see https://example.com/snapshot/report", "a web address is left alone");
  assert.equal(replyPaths("```\ncd snapshot/site\n```"), "```\ncd snapshot/site\n```", "fenced code is left as written");
});

// ------------------------------------------------- where the agent works
// Owner, 19 Nov 2026: "it asks them if they want to run cloud or local and
// … existing project or new one — as simple as possible". Asked once per
// folder, remembered; flags skip it.

import { folderChoice, projectNameFor, localModelOf, localCallSummary, insideFolder, isLeave } from "../src/code-session.mjs";

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
  assert.deepEqual(folderChoice(path.join(home, "s.json"), d), { ws: "desk", mode: "local", engine: null });
  rememberSession(path.join(home, "s.json"), d, { context: "c", ws: "desk", agent: "coder", mode: "local", engine: "foldrun" });
  assert.equal(folderChoice(path.join(home, "s.json"), d)?.engine, "foldrun");
  assert.equal(folderChoice(path.join(home, "s.json"), "/elsewhere"), null);
});

/** One scripted model turn as the Messages API streams it. */
function sse(content: Array<{ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown }>, stop?: string) {
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
  out += ev({ type: "message_delta", delta: { stop_reason: stop ?? (content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn") }, usage: { output_tokens: 5 } });
  out += ev({ type: "message_stop" });
  return raw(out, "text/event-stream");
}

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
    let at = await t.until(/Where should this session work\?[\s\S]*On this computer[\s\S]*In the cloud[\s\S]*Esc to cancel/);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\x1b[B\r");
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
    let at = await again.until(/Where should this session work\?[\s\S]*Enter keeps the cloud[\s\S]*Esc to cancel/);
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

test("a folder that works on this computer is never sent to the cloud by a script's --task; --cloud --task is", async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({ [`GET ${WS}`]: () => ({ name: "desk" }), [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }) });
  try {
    rememberSession(path.join(home, "code-sessions.json"), d, { context: "code-x", ws: "desk", agent: "coder", mode: "local" });
    const cli = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
    const r = spawnSync(process.execPath, [cli, "code", d, "--task", "do it", "--url", s.url, "--token", "k"], { encoding: "utf8", env: { ...process.env, FOLDRUN_HOME: home, NO_COLOR: "1" } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /works on this computer[\s\S]*--cloud --task/);
    assert.equal(s.seen.length, 0, "nothing reached the platform");
    // --cloud --task is one turn: the folder still works on this computer after.
    spawnSync(process.execPath, [cli, "code", d, "--cloud", "--task", "do it", "--url", s.url, "--token", "k"], { encoding: "utf8", env: { ...process.env, FOLDRUN_HOME: home, NO_COLOR: "1" } });
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

test("--local, cloud_agents: sending the folder is asked (no sends nothing); after a yes the run's patch is asked again and put into the folder; the agent hears what became of it", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "c1", name: "cloud_agents", input: { tasks: ["add b"] } }]),
    () => sse([{ type: "text", text: "Fine, not then." }]),
    () => sse([{ type: "tool_use", id: "c2", name: "cloud_agents", input: { tasks: ["add b to a.txt\nthen run the tests"] } }]),
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
      at = await t.until(/Cloud agents[\s\S]*sends a copy of this folder to desk[\s\S]*1\. add b[\s\S]*\[a\]lways for cloud agents this session[\s\S]*allow\?|allow\?[\s\S]*cloud agents this session/, at);
      t.send("n\r");
      at = await t.until(/Fine, not then\./, at);
      assert.equal(s.seen.filter((x: any) => x.url === `${WS}/snapshots`).length, 0, "no: nothing sent");
      at = await t.until(/\w ❯ /, at);
      t.send("ok go\r");
      at = await t.until(/1\. add b to a\.txt[\s\S]*then run the tests[\s\S]*allow\?/, at);
      t.send("y\r");
      at = await t.until(/send it\? \[y\]es/, at);
      t.send("y\r"); // the upload preview (FOL-212): nothing leaves before this yes
      at = await t.until(/sent the folder to desk[\s\S]*cloud agent 1 · run-sess-1/, at);
      at = await t.until(/✓ cloud agent 1 · completed[\s\S]*cloud agent 1's changes, into this folder:[\s\S]*a\.txt \|\s+1 \+[\s\S]*\[a\]lways for cloud agents' changes this session[\s\S]*\[d\]iff/, at);
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
    assert.ok(asked[0].tools.some((x: any) => x.name === "cloud_agents"), "the model is offered the tool");
    assert.match(JSON.stringify(asked[1].messages), /person said no/);
    const result = JSON.stringify(asked[3].messages.at(-1));
    assert.match(result, /Cloud agent 1 \(run run-sess-1\): completed/);
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

// The CLI runs the published @foldrun/core: this turns on by itself once
// the CLI's range reaches the core release that has endOf (FOL-211).
const coreEndsHonestly = typeof ((await import("@foldrun/core/engine-loop")) as Record<string, unknown>).endOf === "function";

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

test("--local, cloud_agents: Ctrl-C while they work stops every run on the platform and applies nothing", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let n = 0;
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
    "POST /v1/messages": () => sse([{ type: "tool_use", id: "c1", name: "cloud_agents", input: { tasks: ["one", "two"] } }]),
  });
  try {
    const t = onTerminal(["code", d, "--local", "--engine", "foldrun", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("go\r");
      at = await t.until(/make it\? \[y\/N\]/, at);
      t.send("y\r");
      at = await t.until(/2 at once[\s\S]*allow\?/, at);
      t.send("y\r");
      at = await t.until(/send it\? \[y\]es/, at);
      t.send("y\r"); // the upload preview (FOL-212): nothing leaves before this yes
      at = await t.until(/cloud agent 2 · run-c-2/, at);
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
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "a\n");
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

test("--local on a foldrun Pro plan whose tier the plan does not pay for: the wallet's rule, not the plan's room", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: max\n---\nYou code.\n", sha256: "x" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 0, boughtUsd: 0 }, plan: { id: "free", name: "Free", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "GET /v1/billing/coding-plan": () => ({ plan: { plan: "pro", periodEnd: "2026-12-20T00:00:00Z", extraUsage: false }, allowance: { windows: [], extraUsage: false, room: true, freeAt: null }, codeTiers: { fast: { covered: true }, default: { covered: true }, max: { covered: false } } }),
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
    assert.doesNotMatch(s.seen.map((x: any) => x.url).join(" "), /\/v1\/keys|\/v1\/messages/, "no key made, no model asked");
  } finally {
    s.close();
  }
});

test("--local on a foldrun Pro plan past its allowance, extra usage off: the limit and its reset, no key made, whatever the wallet holds", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 0, boughtUsd: 9 }, plan: { id: "free", name: "Free", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "GET /v1/billing/coding-plan": () => ({ plan: { plan: "pro", periodEnd: "2026-12-20T00:00:00Z", extraUsage: false }, allowance: { windows: [], extraUsage: false, room: false, freeAt: "2026-11-27T00:00:00Z" } }),
  });
  try {
    const t = onTerminal(["code", d, "--local", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("hi\r");
      at = await t.until(/used your foldrun Pro allowance — it resets [^;]+; top up and turn on pay as you go to carry on from your balance: foldrun billing pay-as-you-go on \(or \S+\/dashboard\/billing\)\r?\n/, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      await t.done;
    } finally {
      t.child.kill();
    }
    assert.doesNotMatch(s.seen.map((x: any) => x.url).join(" "), /\/v1\/keys|\/v1\/messages/, "no key made, no model asked");
  } finally {
    s.close();
  }
});

test("--local with no foldrun subscription (23 Nov 2026): said before the turn, whatever the wallet holds — no key made, no model asked", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 0, boughtUsd: 50 }, plan: { id: "free", name: "Free", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "GET /v1/billing/coding-plan": () => ({ plan: null, allowance: null, entitlement: { kind: "none" }, extraUsage: null }),
  });
  try {
    const t = onTerminal(["code", d, "--local", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("hi\r");
      at = await t.until(/no active foldrun subscription — start one with foldrun billing plan pro \(or Billing → Plans\), then try again\r?\n/, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      await t.done;
    } finally {
      t.child.kill();
    }
    assert.doesNotMatch(s.seen.map((x: any) => x.url).join(" "), /\/v1\/keys|\/v1\/messages/, "no key made, no model asked");
  } finally {
    s.close();
  }
});

test("--engine claude is refused, naming why; a folder that used Claude Code is not resumed as one", () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const cli = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
  const r = spawnSync(process.execPath, [cli, "code", d, "--cloud", "--engine", "claude", "--task", "x", "--url", "http://127.0.0.1:9", "--token", "k"], { encoding: "utf8", env: { ...process.env, FOLDRUN_HOME: home, NO_COLOR: "1" } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /Claude Code is no longer an engine for foldrun code/);
  rememberSession(path.join(home, "s.json"), d, { context: "c", ws: "desk", agent: "coder", mode: "local", engine: "claude" });
  assert.equal(folderChoice(path.join(home, "s.json"), d)?.engine, null, "an old Claude Code choice reads as none");
});

test("leaving: exit, quit, /exit, /quit and Ctrl-D end the session; a sentence with the word does not", () => {
  for (const w of ["exit", "quit", "/exit", "/quit", " Exit ", "QUIT", null]) assert.equal(isLeave(w), true, String(w));
  for (const w of ["exit the loop early", "quit?", "exits", "/exits", "", "please exit"]) assert.equal(isLeave(w), false, w);
});

test("validConversation: alternating, nothing empty, every tool call answered next", async () => {
  const { validConversation } = await import("../src/code-session.mjs");
  const u = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
  const a = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
  const call = { role: "assistant", content: [{ type: "tool_use", id: "x", name: "Read", input: {} }] };
  const res = { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] };
  assert.equal(validConversation([]), true);
  assert.equal(validConversation([u("a"), a("b")]), true);
  assert.equal(validConversation([u("a"), call, res, a("done")]), true);
  assert.equal(validConversation([u("a"), call]), false, "a call with no result");
  assert.equal(validConversation([u("a"), call, u("no result"), a("b")]), false);
  assert.equal(validConversation([u("a"), a("b"), { role: "user", content: [{ type: "tool_result", tool_use_id: "zz", content: "" }] }, a("c")]), false, "a result for no call");
  assert.equal(validConversation([a("b"), u("a")]), false);
  assert.equal(validConversation([u("a"), { role: "assistant", content: [] }]), false);
});

test("trimConversation: whole turns from the front, still starting with the person", async () => {
  const { trimConversation } = await import("../src/code-session.mjs");
  const big = "x".repeat(400);
  const list = [
    { role: "user", content: [{ type: "text", text: `one ${big}` }] },
    { role: "assistant", content: [{ type: "tool_use", id: "a", name: "Read", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: big }] },
    { role: "assistant", content: [{ type: "text", text: "done" }] },
    { role: "user", content: [{ type: "text", text: "two" }] },
    { role: "assistant", content: [{ type: "text", text: "ok" }] },
  ];
  assert.equal(trimConversation(list).length, 6);
  const cut = trimConversation(list, 200);
  assert.equal(cut.length, 2);
  assert.equal((cut[0]!.content[0] as any).text, "two");
  assert.deepEqual(trimConversation(list, 10), [], "one turn too big on its own leaves nothing");
  assert.equal(trimConversation([{ role: "user", content: [{ type: "text", text: "é".repeat(150) }] }, { role: "assistant", content: [{ type: "text", text: "ok" }] }], 200).length, 0, "bytes, not characters");
});

for (const answer of ["y", "n"]) {
  test(`--local with a key kept before CLI 27.3: asked once to swap it — ${answer === "y" ? "yes makes an account key and revokes the old one" : "no keeps it and never asks again"}`, { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
    const d = repo();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
    const s = await serve({
      [`GET ${WS}`]: () => ({ name: "desk" }),
      [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
      [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\n", sha256: "x" }),
      "GET /v1/me": () => ({ account: "acme" }),
      "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
      "POST /v1/keys": (b: string) => ({ id: "new-1", key: "fr_gw_new", gatewayUrl: s.url, credential: JSON.parse(b).credential, walletUsd: JSON.parse(b).walletUsd, dailyUsd: JSON.parse(b).dailyUsd, capUsd: null }),
      "DELETE /v1/keys": () => ({ ok: true }),
      "POST /v1/messages": () => sse([{ type: "text", text: "Done." }]),
    });
    const file = path.join(home, "code-local-keys.json");
    fs.writeFileSync(file, JSON.stringify({ [`${s.url}#acme`]: { id: "old-1", key: "fr_gw_old", gatewayUrl: s.url } }), { mode: 0o600 });
    // A lock a session that died left behind (its process gone) is taken over.
    if (answer === "y") {
      fs.mkdirSync(`${file}.lock`);
      fs.writeFileSync(path.join(`${file}.lock`, "owner"), "999999:dead");
    }
    try {
      const t = onTerminal(["code", d, "--local", "--engine", "foldrun", "--to", "desk", "--url", s.url, "--token", "k"], home);
      try {
        let at = await t.until(/\w ❯ /);
        t.send("go\r");
        at = await t.until(/older kind[\s\S]*swap it\? \[y\/N\]/, at);
        t.send(`${answer}\r`);
        at = await t.until(/Done\./, at);
        at = await t.until(/\w ❯ /, at);
        t.send("/quit\r");
        await t.done;
      } finally {
        t.child.kill();
      }
      const kept = JSON.parse(fs.readFileSync(file, "utf8"))[`${s.url}#acme`];
      const deletes = s.seen.filter((x: any) => x.method === "DELETE" && x.url === "/v1/keys");
      const posts = s.seen.filter((x: any) => x.method === "POST" && x.url === "/v1/keys");
      if (answer === "y") {
        assert.equal(kept.key, "fr_gw_new");
        assert.equal(kept.kind, "account");
        assert.equal(JSON.parse(posts[0].body).credential, "account");
        assert.deepEqual(JSON.parse(deletes[0].body), { id: "old-1" }, "the old key is revoked");
        assert.equal(fs.existsSync(`${file}.lock`), false, "the lock is released");
      } else {
        assert.equal(kept.key, "fr_gw_old");
        assert.equal(kept.upgradeAsked, true, "not asked again");
        assert.equal(posts.length + deletes.length, 0, "nothing made, nothing revoked");
      }
    } finally {
      s.close();
    }
  });
}

test("--local swap on a platform that makes the older kind of key: the new one is revoked at once, the old one kept and used, not asked again", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": () => ({ id: "new-1", key: "fr_gw_new", gatewayUrl: s.url, capUsd: null, dailyUsd: 100 }),
    "DELETE /v1/keys": () => ({ ok: true }),
  });
  const file = path.join(home, "code-local-keys.json");
  fs.writeFileSync(file, JSON.stringify({ [`${s.url}#acme`]: { id: "old-1", key: "fr_gw_old", gatewayUrl: s.url } }), { mode: 0o600 });
  try {
    const t = onTerminal(["code", d, "--local", "--engine", "foldrun", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("go\r");
      at = await t.until(/swap it\? \[y\/N\]/, at);
      t.send("y\r");
      at = await t.until(/does not make plan-first keys yet/, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      await t.done;
    } finally {
      t.child.kill();
    }
    const deletes = s.seen.filter((x: any) => x.method === "DELETE" && x.url === "/v1/keys").map((x: any) => JSON.parse(x.body).id);
    assert.deepEqual(deletes, ["new-1"], "only the key just made is revoked");
    const kept = JSON.parse(fs.readFileSync(file, "utf8"))[`${s.url}#acme`];
    assert.equal(kept.key, "fr_gw_old");
    assert.equal(kept.upgradeAsked, true, "kept, and the swap is not offered again on this platform");
  } finally {
    s.close();
  }
});

test("--local on a platform from before plan-first keys: the older kind is offered on its own terms, asked separately, and kept as asked about", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b: string) =>
      JSON.parse(b).credential === "account"
        ? { __status: 400, body: { error: 'credential must be "login" (the operator\'s Claude login) or left out' } }
        : { id: "old-kind", key: "fr_gw_older", gatewayUrl: s.url, capUsd: 20, dailyUsd: null },
    "POST /v1/messages": () => sse([{ type: "text", text: "Done." }]),
  });
  const file = path.join(home, "code-local-keys.json");
  try {
    const t = onTerminal(["code", d, "--local", "--engine", "foldrun", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("go\r");
      at = await t.until(/make it\? \[y\/N\]/, at);
      t.send("y\r");
      at = await t.until(/only the older kind[\s\S]*make that instead\? \[y\/N\]/, at);
      t.send("y\r");
      at = await t.until(/Done\./, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      await t.done;
    } finally {
      t.child.kill();
    }
    const posts = s.seen.filter((x: any) => x.method === "POST" && x.url === "/v1/keys").map((x: any) => JSON.parse(x.body));
    assert.equal(posts[0].credential, "account");
    assert.deepEqual({ capUsd: posts[1].capUsd, credential: posts[1].credential }, { capUsd: 20, credential: undefined });
    const kept = JSON.parse(fs.readFileSync(file, "utf8"))[`${s.url}#acme`];
    assert.equal(kept.key, "fr_gw_older");
    assert.equal(kept.upgradeAsked, true, "no swap offered for it on this platform");
  } finally {
    s.close();
  }
});

test("nextConversation: a compacted turn goes on from the compacted conversation (FOL-213)", async () => {
  const { nextConversation, validConversation } = await import("../src/code-session.mjs");
  const u = (t: string) => ({ role: "user", content: [{ type: "text", text: t }] });
  const a = (t: string) => ({ role: "assistant", content: [{ type: "text", text: t }] });
  const history = [u("one"), a("1"), u("two"), a("2")];
  // Not compacted: as before.
  assert.deepEqual(nextConversation({ history, turn: [u("three"), a("3")], compacted: null, done: true, note: "" }), [...history, u("three"), a("3")]);
  assert.deepEqual(nextConversation({ history, turn: [u("three"), a("half")], compacted: null, done: false, note: "(cut)" }), [...history, u("three"), a("(cut)")]);
  // Compacted part-way: the summary and the newest part, then what followed.
  const compacted = [{ role: "user", content: [{ type: "text", text: "summary" }, { type: "text", text: "three" }] }];
  const done = nextConversation({ history, turn: [a("3")], compacted, done: true, note: "" });
  assert.deepEqual(done, [...compacted, a("3")]);
  assert.equal(validConversation(done), true);
  const cut = nextConversation({ history, turn: [a("half")], compacted, done: false, note: "(cut)" });
  assert.deepEqual(cut, [...compacted, a("(cut)")]);
  assert.equal(validConversation(cut), true);
});

test("a steered turn that fails keeps what was asked and answered on the way; a trim never starts at a tool result (FOL-213, Codex)", async () => {
  const { nextConversation, validConversation, trimConversation } = await import("../src/code-session.mjs");
  const u = (t: string) => ({ role: "user", content: [{ type: "text", text: t }] });
  const a = (t: string) => ({ role: "assistant", content: [{ type: "text", text: t }] });
  const history = [u("before"), a("ok")];
  const turn = [u("go"), a("first answer"), u("use metric"), a("second, cut")];
  const kept = nextConversation({ history, turn, compacted: null, done: false, note: "(this turn did not finish)" });
  assert.deepEqual(kept.map((m: any) => m.content[0].text), ["before", "ok", "go", "first answer", "use metric", "(this turn did not finish)"]);
  assert.ok(validConversation(kept));
  // A message sent mid-turn rides with the answers to calls: not a place to cut.
  const call = { role: "assistant", content: [{ type: "tool_use", id: "r", name: "Read", input: {} }] };
  const answers = { role: "user", content: [{ type: "tool_result", tool_use_id: "r", content: "x" }, { type: "text", text: "use metric" }] };
  assert.equal(validConversation([answers, a("done")]), false, "a tool result with no call before it");
  const big = "y".repeat(800_000);
  const trimmed = trimConversation([u(big), a(big), u("go"), call, answers, a("done")], 1_000_000);
  assert.equal((trimmed[0] as any).content[0].text, "go");
  assert.ok(validConversation(trimmed));
});

test("the upload preview (FOL-212): no sends zero bytes; it names untracked files and ones named like secrets; a yes covers those paths for the session", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  fs.writeFileSync(path.join(d, "notes.txt"), "not in git yet\n");
  fs.writeFileSync(path.join(d, ".env.example"), "API_URL=https://example.com\n");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home, { FOLDRUN_NO_TICKER: "1" });
  const sent = () => s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/snapshots")).length;
  try {
    let at = await t.until(/\w ❯ /);
    t.send("add b\r");
    at = await t.until(/sends a copy of this folder to desk[\s\S]*not in git yet[\s\S]*notes\.txt[\s\S]*named like secrets[\s\S]*\.env\.example[\s\S]*send it\? \[y\]es/, at);
    t.send("n\r");
    at = await t.until(/not sent — nothing left this computer/, at);
    assert.equal(sent(), 0, "no: zero bytes sent");
    assert.equal(s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run")).length, 0);
    at = await t.until(/\w ❯ /, at);
    t.send("add b\r");
    at = await t.until(/send it\? \[y\]es/, at);
    t.send("y\r");
    at = await t.until(/apply it to/, at);
    assert.equal(sent(), 1);
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    // The same paths again: the yes covers them, nothing is asked.
    t.send("again\r");
    at = await t.until(/apply it to/, at);
    assert.equal(sent(), 2);
    assert.doesNotMatch(t.out().slice(t.out().lastIndexOf("again")), /send it\?/);
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    await s.close();
  }
});

// ------------------------------------------------ one key (22 Nov 2026)

test("--local with a sign-in that has model access: a fresh machine gets a reply with no second key — nothing asked, nothing minted, the sign-in sent to the models URL and never seen by a command", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "echo t=${FOLDRUN_TOKEN:-none} a=${ANTHROPIC_AUTH_TOKEN:-none} > env.txt" } }]),
    () => sse([{ type: "text", text: "Hello there." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\nYou code.\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme", actor: { kind: "key", id: "login-1", origin: "cli-login", modelAccess: { capUsd: null, dailyUsd: 100, walletUsd: 20 } }, modelsUrl: s.url }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": () => {
      throw new Error("no key may be minted");
    },
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return turns[asked.length - 1]!();
    },
  });
  try {
    // A CI-style key in the environment: it, too, is the model key, and the
    // agent's commands never see it.
    const t = onTerminal(["code", d, "--local", "--to", "desk", "--url", s.url], home, { FOLDRUN_TOKEN: "fr_api_signed" });
    try {
      let at = await t.until(/\w ❯ /);
      t.send("hi\r");
      at = await t.until(/\$ echo t=[\s\S]*allow\?/, at);
      assert.doesNotMatch(t.out(), /make it\? \[y\/N\]|swap it\?/, "no second key is offered");
      t.send("y\r");
      at = await t.until(/Hello there\./, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      assert.equal(await t.done, 0);
    } finally {
      t.child.kill();
    }
    assert.equal(s.seen.filter((x: any) => x.url === "/v1/keys").length, 0, "zero key-mint requests");
    const models = s.seen.filter((x: any) => x.url === "/v1/messages");
    assert.equal(models.length, 2);
    for (const m of models) assert.equal(m.headers.authorization, "Bearer fr_api_signed", "the sign-in itself");
    assert.equal(fs.readFileSync(path.join(d, "env.txt"), "utf8").trim(), "t=none a=none", "no command sees the reusable key");
    assert.equal(fs.existsSync(path.join(home, "code-local-keys.json")), false, "nothing kept beside it");
    assert.doesNotMatch(JSON.stringify(asked), /fr_api_signed/, "never in the model's context");
  } finally {
    s.close();
  }
});

test("--local on an older install: a sign-in without model access keeps using the machine key it cached, asks nothing, mints nothing", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme", actor: { kind: "key", id: "login-1", modelAccess: null }, modelsUrl: s.url }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/messages": () => sse([{ type: "text", text: "Done." }]),
  });
  const file = path.join(home, "code-local-keys.json");
  fs.writeFileSync(file, JSON.stringify({ [`${s.url}#acme`]: { id: "old-1", key: "fr_gw_cached", gatewayUrl: s.url, kind: "account" } }), { mode: 0o600 });
  try {
    const t = onTerminal(["code", d, "--local", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("go\r");
      at = await t.until(/Done\./, at);
      assert.doesNotMatch(t.out(), /make it\?|swap it\?/);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      await t.done;
    } finally {
      t.child.kill();
    }
    assert.equal(s.seen.filter((x: any) => x.url === "/v1/keys").length, 0);
    assert.equal(s.seen.find((x: any) => x.url === "/v1/messages")!.headers.authorization, "Bearer fr_gw_cached");
  } finally {
    s.close();
  }
});

test("--local: a key kept from a retired models address goes to the one the platform names now", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  // 23 Nov 2026: dev-llm.foldrun.io retired for api.foldrun.dev. A key kept
  // with the old address must not be sent there.
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme", actor: { kind: "key", id: "login-1", modelAccess: null }, modelsUrl: s.url }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/messages": () => sse([{ type: "text", text: "Done." }]),
  });
  const file = path.join(home, "code-local-keys.json");
  fs.writeFileSync(file, JSON.stringify({ [`${s.url}#acme`]: { id: "old-1", key: "fr_gw_cached", gatewayUrl: "http://127.0.0.1:9", kind: "account" } }), { mode: 0o600 });
  try {
    const t = onTerminal(["code", d, "--local", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("go\r");
      at = await t.until(/Done\./, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      await t.done;
    } finally {
      t.child.kill();
    }
    assert.equal(s.seen.find((x: any) => x.url === "/v1/messages")!.headers.authorization, "Bearer fr_gw_cached", "the kept key, at the platform's models address");
  } finally {
    s.close();
  }
});

test("--local with a sign-in refused for models: the kept machine keys are left alone and the person is told to sign in again", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme", actor: { kind: "key", id: "login-1", modelAccess: { capUsd: null, dailyUsd: 100, walletUsd: 0 } }, modelsUrl: s.url }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/messages": () => ({ __status: 401, body: { type: "error", error: { type: "authentication_error", message: "API key revoked" } } }),
  });
  const file = path.join(home, "code-local-keys.json");
  const other = { [`https://elsewhere.test#acme`]: { id: "x", key: "fr_gw_other", gatewayUrl: "https://elsewhere.test", kind: "account" } };
  fs.writeFileSync(file, JSON.stringify(other), { mode: 0o600 });
  try {
    const t = onTerminal(["code", d, "--local", "--to", "desk", "--url", s.url, "--token", "k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("go\r");
      at = await t.until(/your sign-in was refused for model calls[\s\S]*foldrun login/, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      await t.done;
    } finally {
      t.child.kill();
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), other, "untouched");
  } finally {
    s.close();
  }
});

test("--local, sign-in: another terminal switches the token between turns — the new one is asked about again, never sent to the models URL the old one was given (Codex review)", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme", actor: { kind: "key", id: "login-1", modelAccess: { capUsd: null, dailyUsd: 100, walletUsd: 0 } }, modelsUrl: s.url }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/messages": () => sse([{ type: "text", text: "Done." }]),
  });
  const creds = (token: string) => fs.writeFileSync(path.join(home, "credentials.json"), JSON.stringify({ current: "acme", profiles: { acme: { url: s.url, token, account: "acme" } } }), { mode: 0o600 });
  creds("fr_api_first");
  try {
    const t = onTerminal(["code", d, "--local", "--to", "desk", "--url", s.url], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("one\r");
      at = await t.until(/Done\./, at);
      at = await t.until(/\w ❯ /, at);
      creds("fr_api_second");
      t.send("two\r");
      at = await t.until(/Done\./, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      await t.done;
    } finally {
      t.child.kill();
    }
    const models = s.seen.filter((x: any) => x.url === "/v1/messages").map((x: any) => x.headers.authorization);
    assert.deepEqual(models, ["Bearer fr_api_first", "Bearer fr_api_second"]);
    const me = s.seen.filter((x: any) => x.url === "/v1/me").map((x: any) => x.headers.authorization);
    assert.ok(me.includes("Bearer fr_api_second"), "the new token was asked about before it was sent");
    const askedAt = s.seen.findIndex((x: any) => x.url === "/v1/me" && x.headers.authorization === "Bearer fr_api_second");
    const sentAt = s.seen.findIndex((x: any) => x.url === "/v1/messages" && x.headers.authorization === "Bearer fr_api_second");
    assert.ok(askedAt >= 0 && askedAt < sentAt, "asked about before it was sent");
  } finally {
    s.close();
  }
});

test("--local, sign-in refused with 403 by the gateway: the next message goes on the machine key this computer kept (a platform half-way through an upgrade)", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme", actor: { kind: "key", id: "login-1", modelAccess: { capUsd: null, dailyUsd: 100, walletUsd: 0 } }, modelsUrl: s.url }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/messages": () => (s.seen.filter((x: any) => x.url === "/v1/messages").length === 1 ? { __status: 403, body: { type: "error", error: { type: "permission_error", message: "this is not a gateway key" } } } : sse([{ type: "text", text: "Done." }])),
  });
  fs.writeFileSync(path.join(home, "code-local-keys.json"), JSON.stringify({ [`${s.url}#acme`]: { id: "old-1", key: "fr_gw_cached", gatewayUrl: s.url, kind: "account" } }), { mode: 0o600 });
  try {
    const t = onTerminal(["code", d, "--local", "--to", "desk", "--url", s.url, "--token", "fr_api_k"], home);
    try {
      let at = await t.until(/\w ❯ /);
      t.send("one\r");
      at = await t.until(/your sign-in cannot call models here[\s\S]*a key for this computer instead/, at);
      at = await t.until(/\w ❯ /, at);
      t.send("two\r");
      at = await t.until(/Done\./, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      await t.done;
    } finally {
      t.child.kill();
    }
    const models = s.seen.filter((x: any) => x.url === "/v1/messages").map((x: any) => x.headers.authorization);
    assert.deepEqual(models, ["Bearer fr_api_k", "Bearer fr_gw_cached"]);
    assert.equal(s.seen.filter((x: any) => x.url === "/v1/keys").length, 0);
  } finally {
    s.close();
  }
});

test("--local: `foldrun use` in another terminal mid-session does not move this session — it keeps the profile it started on (Codex review)", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme", actor: { kind: "key", id: "login-1", modelAccess: { capUsd: null, dailyUsd: 100, walletUsd: 0 } }, modelsUrl: s.url }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/messages": () => sse([{ type: "text", text: "Done." }]),
  });
  const creds = (current: string) =>
    fs.writeFileSync(path.join(home, "credentials.json"), JSON.stringify({ current, profiles: { acme: { url: s.url, token: "fr_api_acme", account: "acme" }, other: { url: "https://other.test", token: "fr_api_other", account: "other" } } }), { mode: 0o600 });
  creds("acme");
  try {
    const t = onTerminal(["code", d, "--local", "--to", "desk"], home, { FOLDRUN_URL: "" });
    try {
      let at = await t.until(/\w ❯ /);
      t.send("one\r");
      at = await t.until(/Done\./, at);
      at = await t.until(/\w ❯ /, at);
      creds("other");
      t.send("two\r");
      at = await t.until(/Done\./, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      await t.done;
    } finally {
      t.child.kill();
    }
    const tokens = new Set(s.seen.map((x: any) => x.headers.authorization));
    assert.deepEqual([...tokens], ["Bearer fr_api_acme"], "every call, both turns, as the profile it started on");
  } finally {
    s.close();
  }
});

test("/rewind takes back what the agent's Write and Edit did, never what a command did; /goal --check takes the person's command's word, not the agent's", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    // turn 1: read, edit a.txt, create b.txt
    () => sse([{ type: "tool_use", id: "r1", name: "Read", input: { file_path: path.join(d, "a.txt") } }]),
    () => sse([{ type: "tool_use", id: "e1", name: "Write", input: { file_path: path.join(d, "a.txt"), content: "changed\n" } }, { type: "tool_use", id: "w1", name: "Write", input: { file_path: path.join(d, "b.txt"), content: "bee\n" } }]),
    () => sse([{ type: "text", text: "Changed a.txt and made b.txt." }]),
    // after the rewind
    () => sse([{ type: "text", text: "Understood." }]),
    // the goal: says met with nothing done; then makes the file; then says met
    () => sse([{ type: "text", text: "Looks fine.\nGOAL MET" }]),
    () => sse([{ type: "tool_use", id: "w2", name: "Write", input: { file_path: path.join(d, "done.txt"), content: "ok\n" } }]),
    () => sse([{ type: "text", text: "Made done.txt.\nGOAL MET" }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: fast\n---\nYou code.\n", sha256: "x" }),
    [`GET ${WS}/sessions/code-rw/messages`]: () => ({ messages: [] }),
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
  const before = fs.readFileSync(path.join(d, "a.txt"), "utf8");
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-rw", "--url", s.url, "--token", "k"], home, { TERM: "dumb" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/rewind\r");
    at = await t.until(/nothing to take back/, at);
    t.send("change things\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/Write a\.txt[\s\S]*allow\?/, at);
    t.send("y\r");
    at = await t.until(/a new file[\s\S]*allow\?/, at);
    t.send("y\r");
    at = await t.until(/✓ done/, at);
    at = await t.until(/\w ❯ /, at);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "changed\n");
    t.send("/rewind\r");
    at = await t.until(/ 1  change things · a\.txt changed, b\.txt created/, at);
    at = await t.until(/\w ❯ /, at);
    // Something else changes a file the agent wrote: every file or none.
    fs.writeFileSync(path.join(d, "b.txt"), "mine now\n");
    t.send("/rewind 1\r");
    at = await t.until(/✗ b\.txt — it was changed since the agent last wrote it/, at);
    at = await t.until(/nothing was changed/, at);
    at = await t.until(/\w ❯ /, at);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "changed\n", "a.txt was not put back alone");
    fs.writeFileSync(path.join(d, "b.txt"), "bee\n");
    t.send("/rewind 1\r");
    at = await t.until(/a\.txt — put back as it was before[\s\S]*b\.txt — removed \(the agent created it\)[\s\S]*\[y\/N\]/, at);
    t.send("\r");
    at = await t.until(/nothing changed/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/rewind 1\r");
    at = await t.until(/\[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/taken back: 2 files/, at);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), before);
    assert.equal(fs.existsSync(path.join(d, "b.txt")), false);
    at = await t.until(/\w ❯ /, at);
    t.send("ok?\r");
    at = await t.until(/Understood\./, at);
    at = await t.until(/\w ❯ /, at);
    assert.match(JSON.stringify(asked[3].messages.at(-1)), /took back the agent's file changes[^"]*a\.txt, b\.txt/, "the agent is told what was put back");
    // A goal with the person's own check.
    t.send("/goal --check test -f done.txt make it\r");
    at = await t.until(/the form is \/goal --check "<command>"/, at);
    at = await t.until(/\w ❯ /, at);
    t.send('/goal --check "test -f done.txt" done.txt exists\r');
    at = await t.until(/\$ test -f done\.txt[\s\S]*only when it exits 0\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/goal set/, at);
    at = await t.until(/the agent says the goal is met — running your check: test -f done\.txt/, at);
    at = await t.until(/the check failed \(exit 1\) — going on \(2 of 8\)/, at);
    at = await t.until(/Write done\.txt[\s\S]*allow\?/, at);
    t.send("y\r");
    at = await t.until(/check passed \(exit 0\): test -f done\.txt/, at);
    at = await t.until(/files the agent used Write or Edit on since the goal was set: done\.txt/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
  assert.match(JSON.stringify(asked[5].messages.at(-1)), /the person's check `test -f done\.txt` exited 1/);
});
