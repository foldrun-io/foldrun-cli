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
    env: { ...outerEnv(), FOLDRUN_CODE_SANDBOX: "off", FOLDRUN_HOME: home, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1", SHELL: "/bin/sh", TERM: "dumb", ...extraEnv },
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

import { folderChoice, localPrompt, projectNameFor, localModelOf, localCallSummary, insideFolder, isLeave } from "../src/code-session.mjs";

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

test("--local, cloud_jobs: sending the folder is asked (no sends nothing); after a yes the run's patch is asked again and put into the folder; the agent hears what became of it", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "c1", name: "cloud_jobs", input: { tasks: ["add b"] } }]),
    () => sse([{ type: "text", text: "Fine, not then." }]),
    () => sse([{ type: "tool_use", id: "c2", name: "cloud_jobs", input: { tasks: ["add b to a.txt\nthen run the tests"] } }]),
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
    assert.ok(asked[0].tools.some((x: any) => x.name === "cloud_jobs"), "the model is offered the tool");
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

test("--local, cloud_jobs: Ctrl-C while they work stops every run on the platform and applies nothing", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
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
    "POST /v1/messages": () => sse([{ type: "tool_use", id: "c1", name: "cloud_jobs", input: { tasks: ["one", "two"] } }]),
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
      // The offer to wait in this session (FOL-252): a no hands back.
      at = await t.until(/wait here and carry on at [^\n]*\? \[y\/N\]/, at);
      t.send("n\r");
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

/** A plan whose allowance is used until `freeAt`, then has room — as the platform would answer over time. */
function resettingPlan(inMs: number) {
  // The clock starts at the first time the plan is asked for (a turn), not when the test begins: a slow start is not a reset.
  let freeAt = "";
  return {
    answer: () => {
      freeAt ||= new Date(Date.now() + inMs).toISOString();
      const free = Date.now() >= Date.parse(freeAt);
      return { plan: { plan: "pro", periodEnd: "2026-12-20T00:00:00Z", extraUsage: false }, allowance: { windows: [], extraUsage: false, room: free, freeAt: free ? null : freeAt } };
    },
  };
}

test("the allowance is used before a turn: the open session waits for the reset and sends the message once (FOL-252)", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const plan = resettingPlan(6000);
  const asked: any[] = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: fast\n---\nYou code.\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/billing/coding-plan": plan.answer,
    "POST /v1/keys": () => ({ id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: 100, walletUsd: 20 }),
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return sse([{ type: "text", text: "Hello after the reset." }]);
    },
  });
  try {
    const t = onTerminal(["code", d, "--local", "--no-sandbox", "--to", "desk", "--url", s.url, "--token", "k"], home, { COLUMNS: "200" });
    try {
      let at = await t.until(/\w ❯ /);
      t.send("say hello\r");
      at = await t.until(/used your foldrun Pro allowance/, at);
      at = await t.until(/wait here and carry on at [^\n]*, in \ds\? \[y\/N\]/, at);
      assert.equal(asked.length, 0, "nothing is sent before the reset");
      t.send("y\r");
      at = await t.until(/waiting in this session — nothing is scheduled; closing the terminal ends it\. Ctrl-C stops waiting\./, at);
      at = await t.until(/carrying on in \ds/, at);
      at = await t.until(/the allowance has reset — carrying on/, at, 30_000);
      at = await t.until(/make it\? \[y\/N\]/, at);
      t.send("y\r");
      at = await t.until(/Hello after the reset\./, at);
      at = await t.until(/\w ❯ /, at);
      t.send("/quit\r");
      assert.equal(await t.done, 0);
    } finally {
      t.child.kill();
    }
    // Once, not twice: one turn, with the person's own message.
    assert.equal(asked.length, 1);
    assert.match(JSON.stringify(asked[0].messages.at(-1)), /say hello/);
  } finally {
    s.close();
  }
});

test("the wait for the reset is this session's alone: Ctrl-C stops it and nothing is sent; closing the terminal ends the process (FOL-252)", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const plan = resettingPlan(3600_000);
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    "GET /v1/billing/coding-plan": plan.answer,
  });
  try {
    const t = onTerminal(["code", d, "--local", "--no-sandbox", "--to", "desk", "--url", s.url, "--token", "k"], home, { COLUMNS: "200" });
    try {
      let at = await t.until(/\w ❯ /);
      t.send("say hello\r");
      at = await t.until(/wait here and carry on at [^\n]*\? \[y\/N\]/, at);
      t.send("y\r");
      at = await t.until(/carrying on in (59m|1h)/, at);
      t.send("\x03");
      at = await t.until(/stopped waiting — nothing was sent/, at);
      at = await t.until(/\w ❯ /, at);
      // Again, and this time the terminal is closed mid-wait: the process ends with it.
      t.send("say hello\r");
      at = await t.until(/wait here and carry on at [^\n]*\? \[y\/N\]/, at);
      t.send("y\r");
      at = await t.until(/carrying on in (59m|1h)/, at);
      // The CLI itself — the process inside the terminal, not the wrapper that holds the pty.
      const cli = spawnSync("pgrep", ["-P", String(t.child.pid)], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean).map(Number);
      assert.equal(cli.length, 1, "one process in the terminal");
      t.child.kill("SIGKILL"); // the terminal goes: its pty closes, and the CLI gets the hangup
      await t.done.catch(() => null);
      let gone = false;
      for (let i = 0; i < 50 && !gone; i++) {
        await new Promise((r) => setTimeout(r, 100));
        try {
          process.kill(cli[0]!, 0);
        } catch {
          gone = true;
        }
      }
      assert.ok(gone, "the CLI is gone with its terminal: nothing is left waiting");
    } finally {
      t.child.kill();
    }
    assert.doesNotMatch(s.seen.map((x: any) => x.url).join(" "), /\/v1\/keys|\/v1\/messages/, "no key made, no model asked");
    // Nothing was handed to the system to run later.
    assert.equal(fs.readdirSync(home).some((f) => /cron|launch|sched|timer/i.test(f)), false);
  } finally {
    s.close();
  }
});

test("the allowance runs out while a turn works: after the reset the agent is told to carry on, not sent the task again; a cloud turn refused at the door goes once (FOL-252)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let freeAt: string | null = null;
  const used = () => freeAt !== null && Date.now() < Date.parse(freeAt);
  const plan = () => ({ plan: { plan: "pro", periodEnd: "2026-12-20T00:00:00Z", extraUsage: false }, allowance: { windows: [], extraUsage: false, room: !used(), freeAt: used() ? freeAt : null } });
  const refusal = { __status: 402, body: { type: "error", error: { type: "billing_error", code: "allowance_used", message: "foldrun's models: this week's allowance is used" } } };
  const asked: any[] = [];
  let runs = 0;
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: fast\n---\nYou code.\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/billing/coding-plan": plan,
    "POST /v1/keys": () => ({ id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: 100, walletUsd: 20 }),
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      if (asked.length === 1) {
        freeAt = new Date(Date.now() + 5000).toISOString();
        return refusal;
      }
      return sse([{ type: "text", text: "Carried on." }]);
    },
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => {
      runs++;
      if (runs === 1) {
        freeAt = new Date(Date.now() + 5000).toISOString();
        return { __status: 402, body: { error: "this week's allowance is used", code: "allowance_used" } };
      }
      return { ok: true, runId: RUN, snapshot: ID, context: "code-w" };
    },
    [`GET ${WS}/runs/${RUN}`]: () => ({
      id: RUN, flow: "adhoc:coder", status: "completed", snapshot: { id: ID }, startedAt: "2026-11-19T01:00:00.000Z", finishedAt: "2026-11-19T01:00:05.000Z",
      steps: [{ agent: "coder", group: 1, status: "completed", attempts: 1, costUsd: 0.02, events: [{ t: "2026-11-19T01:00:01.000Z", type: "text", text: "Done in the cloud." }], result: "Done in the cloud." }],
    }),
    [`GET ${WS}/runs/${RUN}/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "unchanged" }), "application/json") : raw("", "text/x-diff")),
    [`GET ${WS}/sessions/code-w/messages`]: () => ({ messages: [] }),
  });
  try {
    const t = onTerminal(["code", d, "--local", "--no-sandbox", "--to", "desk", "--context", "code-w", "--url", s.url, "--token", "k"], home, { COLUMNS: "200" });
    try {
      let at = await t.until(/\w ❯ /);
      t.send("do the long task\r");
      at = await t.until(/make it\? \[y\/N\]/, at);
      t.send("y\r");
      at = await t.until(/the gateway would not pay for this: foldrun's models: this week's allowance is used/, at, 30_000);
      at = await t.until(/wait here and carry on at [^\n]*\? \[y\/N\]/, at);
      t.send("y\r");
      at = await t.until(/the allowance has reset — carrying on/, at, 40_000);
      at = await t.until(/Carried on\./, at, 30_000);
      at = await t.until(/\w ❯ /, at);
      assert.equal(asked.length, 2, "one call refused, one after the reset");
      const last = JSON.stringify(asked[1].messages.at(-1));
      assert.match(last, /Your last turn stopped part-way: the plan's allowance had run out\. It has reset now\./);
      assert.doesNotMatch(last, /do the long task/, "the task is in the conversation already: not sent again as a new one");
      // The record keeps what the person asked, with the note that it carried on.
      const keptW = Object.values(JSON.parse(fs.readFileSync(path.join(home, "code-sessions.json"), "utf8")) as Record<string, any>)[0];
      assert.equal(keptW.transcript.at(-1).you, "do the long task\n(carried on after the allowance reset)");
      assert.match(JSON.stringify(asked[1].messages), /do the long task/);

      // A cloud turn refused at the door: no run was started, so the same message goes — once.
      t.send("/where cloud\r");
      at = await t.until(/\w ❯ /, at);
      t.send("now in the cloud\r");
      at = await t.until(/send it\? \[y\]es/, at, 30_000);
      t.send("y\r");
      at = await t.until(/wait here and carry on at [^\n]*\? \[y\/N\] $/, at, 30_000);
      t.send("y\r");
      at = await t.until(/the allowance has reset — carrying on/, at, 40_000);
      at = await t.until(/send it\? \[y\]es|Done in the cloud\./, at, 30_000);
      if (!/Done in the cloud\./.test(t.out().slice(at - 300, at))) {
        t.send("y\r");
        at = await t.until(/Done in the cloud\./, at, 30_000);
      }
      at = await t.until(/\w ❯ /, at);
      assert.equal(runs, 2, "refused once, started once");
      const posts = s.seen.filter((x: any) => x.method === "POST" && x.url.endsWith("/agents/coder/run"));
      assert.match(JSON.parse(posts[1]!.body).task, /now in the cloud$/);
      t.send("/quit\r");
      await t.done;
    } finally {
      t.child.kill();
    }
  } finally {
    s.close();
  }
});

for (const listed of [true, false]) {
  test(`a ceiling agreed for the turn sent after the reset stops it — ${listed ? "at about the sum, by listed prices" : "when the model that answered has no listed price"} (FOL-252)`, { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
    const d = repo();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
    const plan = resettingPlan(4000);
    let calls = 0;
    const s = await serve({
      [`GET ${WS}`]: () => ({ name: "desk" }),
      [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
      [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: fast\n---\nYou code.\n", sha256: "x" }),
      "GET /v1/me": () => ({ account: "acme" }),
      "GET /v1/billing/coding-plan": plan.answer,
      // 100 tokens read at $1,000 a million is ten cents: past a five-cent ceiling at the first call.
      "GET /v1/account/usage/rates": () => ({ catalogue: { models: { prices: [{ model: listed ? "claude-sonnet-test" : "some-other-model", inputPerMTok: 1000, outputPerMTok: 1000 }] } } }),
      "POST /v1/keys": () => ({ id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: 100, walletUsd: 20 }),
      "POST /v1/messages": () => {
        calls++;
        // It would go on calling a tool for ever: only the ceiling ends it.
        return sse([{ type: "tool_use", id: `t${calls}`, name: "Read", input: { file_path: path.join(d, "a.txt") } }], "tool_use");
      },
    });
    try {
      const t = onTerminal(["code", d, "--local", "--no-sandbox", "--to", "desk", "--url", s.url, "--token", "k"], home, { COLUMNS: "200" });
      try {
        let at = await t.until(/\w ❯ /);
        t.send("read the file\r");
        at = await t.until(/wait here and carry on at [^\n]*\? \[y\/N\] \(y 2: stop that turn at about \$2, an estimate at listed prices\)/, at);
        t.send("y 0.05\r");
        at = await t.until(/The turn stops at about \$0\.05\./, at);
        at = await t.until(/the allowance has reset — carrying on/, at, 30_000);
        at = await t.until(/make it\? \[y\/N\]/, at);
        t.send("y\r");
        at = await t.until(listed ? /stopped at the ceiling: about \$0\.10 of \$0\.05 \(an estimate at listed prices; the call that passed it is counted\)/ : /stopped: claude-sonnet-test answered, and the platform lists no price for it, so the \$0\.05 ceiling could not be kept/, at, 30_000);
        at = await t.until(/\w ❯ /, at);
        t.send("/quit\r");
        await t.done;
      } finally {
        t.child.kill();
      }
      assert.equal(calls, 1, "no call after the one that passed it");
    } finally {
      s.close();
    }
  });
}

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

test("leaving: exit, quit, /quit and Ctrl-D end the session; /exit is gone (FOL-263); a sentence with the word does not", () => {
  for (const w of ["exit", "quit", "/quit", " Exit ", "QUIT", null]) assert.equal(isLeave(w), true, String(w));
  for (const w of ["exit the loop early", "quit?", "exits", "/exits", "/exit", "", "please exit"]) assert.equal(isLeave(w), false, w);
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

test("/restart starts foldrun again on the same folder, place and conversation (FOL-261)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\n", sha256: "x" }),
    [`GET ${WS}/sessions/code-rs/messages`]: () => ({ messages: [] }),
    "GET /v1/me": () => ({ account: "acme", actor: { kind: "key", id: "login-1", modelAccess: { capUsd: null, dailyUsd: 100, walletUsd: 0 } }, modelsUrl: s.url }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => ({ id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: JSON.parse(String(b)).dailyUsd }),
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      // The first turn runs a slow command, so /restart can be typed while it runs.
      if (asked.length === 1) return sse([{ type: "tool_use", id: "q1", name: "Bash", input: { command: "sleep 3" } }]);
      return sse([{ type: "text", text: `answer ${asked.length - 1}` }]);
    },
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-rs", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/session\s+code-rs · new[\s\S]*\w ❯ /);
    at = await alone(t, "/status", at);
    at = await t.until(/foldrun\s+\d+\.\d+\.\d+/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("first\r");
    at = await t.until(/sleep 3[\s\S]*allow\? \[y\]es/, at, 30_000);
    t.send("y\r");
    await new Promise((r) => setTimeout(r, 400));
    // Typed with Enter while the turn runs: queued once, however often (Codex), never sent to the agent.
    const typeThenEnter = async (x: string) => {
      t.send(x);
      await new Promise((r) => setTimeout(r, 60));
      t.send("\r");
    };
    await typeThenEnter("/restart");
    at = await t.until(/⏭ \/restart · queued for after this turn/, at);
    await typeThenEnter("/restart");
    at = await t.until(/\/restart is queued already/, at);
    at = await t.until(/answer 1/, at, 30_000);
    at = await t.until(/starting foldrun again — the same conversation \(code-rs\)/, at);
    // A new process: its own box, the same session, and the turn before it is still in the conversation.
    at = await t.until(/works\s+on this computer[\s\S]*session\s+code-rs · continuing[\s\S]*\w ❯ /, at);
    t.send("second\r");
    at = await t.until(/answer 2/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    // Strict approvals go on with it; a second restart is started by the first process, not stacked on the second.
    t.send("/permissions strict\r");
    at = await t.until(/the commands that only look are asked too/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/restart\r");
    at = await t.until(/session\s+code-rs · continuing[\s\S]*\w ❯ /, at);
    const tree = spawnSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" }).stdout;
    const ours = tree.split("\n").filter((l) => l.includes("code-rs") && l.includes("foldrun.mjs") && !l.includes("python"));
    assert.equal(ours.length, 2, `the first process and the session now:\n${ours.join("\n")}`);
    t.send("/permissions\r");
    at = await t.until(/Strict[^\n]*✔/, at);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\x1b");
    at = await t.until(/nothing changed[\s\S]*\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
  assert.doesNotMatch(JSON.stringify(asked[1].messages), /\/restart/, "never words for the agent");
  assert.match(JSON.stringify(asked[2].messages), /first[\s\S]*answer 1[\s\S]*second/, "the conversation went on");
});

test("the session names its account (FOL-260): a box row and /status for the default profile, --profile and a token; the prompt names the profile when several are signed in", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\n", sha256: "x" }),
    "GET /v1/me": () => ({ account: "acme", actor: { kind: "key", id: "login-1", modelAccess: { capUsd: null, dailyUsd: 100, walletUsd: 0 } }, modelsUrl: s.url }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
  });
  const creds = (profiles: Record<string, unknown>) => fs.writeFileSync(path.join(home, "credentials.json"), JSON.stringify({ current: "acme", profiles }), { mode: 0o600 });
  const run = async (args: string[], env: Record<string, string>, box: RegExp, prompt: RegExp, status: RegExp) => {
    const t = onTerminal(["code", d, "--local", "--to", "desk", ...args], home, { FOLDRUN_URL: "", COLUMNS: "200", ...env });
    try {
      let at = await t.until(box);
      at = await t.until(prompt, at);
      at = await alone(t, "/status", at);
      at = await t.until(status, at);
      t.send("/quit\r");
      assert.equal(await t.done, 0);
    } finally {
      t.child.kill();
    }
  };
  try {
    // One profile: named in the box and /status; the prompt is the project alone.
    creds({ acme: { url: s.url, token: "fr_api_acme", account: "acme", email: "ana@example.com" } });
    await run([], {}, /account\s+acme · ana@example\.com · acme/, /\n\s*desk ❯ $/, /account\s+acme · ana@example\.com · acme/);
    // Two signed in: --profile picks one, and the prompt leads with it.
    creds({ acme: { url: s.url, token: "fr_api_acme", account: "acme", email: "ana@example.com" }, mehdi: { url: s.url, token: "fr_api_mehdi", account: "taleghani" } });
    await run(["--profile", "mehdi"], {}, /account\s+mehdi · api key · taleghani/, /mehdi · desk ❯ $/, /account\s+mehdi · api key · taleghani/);
    await run([], {}, /account\s+acme · ana@example\.com/, /acme · desk ❯ $/, /account\s+acme · ana@example\.com/);
    // Another sign-in under the same profile name in another terminal: the session stops rather than run as someone else.
    {
      const t2 = onTerminal(["code", d, "--local", "--to", "desk", "--profile", "mehdi"], home, { FOLDRUN_URL: "", COLUMNS: "200" });
      try {
        await t2.until(/mehdi · desk ❯ $/);
        creds({ acme: { url: s.url, token: "fr_api_acme", account: "acme", email: "ana@example.com" }, mehdi: { url: s.url, token: "fr_api_other", account: "other-co", email: "bo@example.com" } });
        t2.send("/status\r");
        await t2.until(/the profile mehdi now signs in as bo@example\.com · other-co[\s\S]*this session ran as mehdi · api key · taleghani and stops here/);
        assert.equal(await t2.done, 1);
      } finally {
        t2.child.kill();
      }
      creds({ acme: { url: s.url, token: "fr_api_acme", account: "acme", email: "ana@example.com" }, mehdi: { url: s.url, token: "fr_api_mehdi", account: "taleghani" } });
    }
    // A token is named by where it came from; no profile in the prompt.
    await run(["--url", s.url, "--token", "k"], {}, /account\s+--token \(an API key\)/, /\n\s*desk ❯ $/, /account\s+--token \(an API key\)/);
    await run(["--url", s.url], { FOLDRUN_TOKEN: "k" }, /account\s+FOLDRUN_TOKEN \(an API key\)/, /\n\s*desk ❯ $/, /account\s+FOLDRUN_TOKEN/);
  } finally {
    s.close();
  }
});

test("no git needed on this computer (FOL-274): a folder without git starts, the agent edits a file, /undo takes it back; picking the cloud offers git init and no stays here", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-nogit-"));
  fs.writeFileSync(path.join(d, "a.txt"), "first\n");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "r1", name: "Read", input: { file_path: path.join(d, "a.txt") } }]),
    () => sse([{ type: "tool_use", id: "e1", name: "Write", input: { file_path: path.join(d, "a.txt"), content: "changed\n" } }]),
    () => sse([{ type: "text", text: "Changed a.txt." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: fast\n---\nYou code.\n", sha256: "x" }),
    [`GET ${WS}/sessions/code-ng/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local-only", "--to", "desk", "--context", "code-ng", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/the agent sends nothing to the cloud; this folder has no git, which the cloud needs[\s\S]*\w ❯ /);
    t.send("change it\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/Write a\.txt[\s\S]*allow\?/, at);
    t.send("y\r");
    at = await t.until(/✓ done[\s\S]*\w ❯ /, at);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "changed\n", t.out().slice(-2500));
    t.send("/diff\r");
    at = await t.until(/this folder has no git, so there is no last commit to compare with/, at);
    t.send("/undo 1\r");
    at = await t.until(/a\.txt — put back as it was before[\s\S]*\[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/\w ❯ /, at);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "first\n", "taken back without git");
    t.send("/where cloud\r");
    at = await t.until(/the cloud needs git to send a copy and bring changes back\. Set it up here \(git init\)\? \[y\/N\]/, at);
    t.send("n\r");
    at = await t.until(/staying where you are — the cloud needs git/, at);
    t.send("/where\r");
    at = await t.until(/1\. This computer only\s+the agent sends nothing to th[^\n]*✔[\s\S]*3\. The cloud\s+needs git[\s\S]*Esc to cancel/, at);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\r");
    at = await t.until(/This computer only — \/where local · local\+cloud · cloud · send <task>/, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
  assert.ok(!fs.existsSync(path.join(d, ".git")), "no git made without a yes");
});

test("/undo takes back what the agent's Write and Edit did, never what a command did; /goal --check takes the person's command's word, not the agent's", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
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
    t.send("/undo\r");
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
    t.send("/undo list\r");
    at = await t.until(/ 1  change things · a\.txt changed, b\.txt created/, at);
    at = await t.until(/\w ❯ /, at);
    // Something else changes a file the agent wrote: every file or none.
    fs.writeFileSync(path.join(d, "b.txt"), "mine now\n");
    t.send("/undo 1\r");
    at = await t.until(/✗ b\.txt — it was changed since the agent last wrote it/, at);
    at = await t.until(/nothing was changed/, at);
    at = await t.until(/\w ❯ /, at);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "changed\n", "a.txt was not put back alone");
    fs.writeFileSync(path.join(d, "b.txt"), "bee\n");
    t.send("/undo 1\r");
    at = await t.until(/a\.txt — put back as it was before[\s\S]*b\.txt — removed \(the agent created it\)[\s\S]*\[y\/N\]/, at);
    t.send("\r");
    at = await t.until(/nothing changed/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/undo 1\r");
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

test("an MCP server named in a sub-agent's own file (mcpServers:) starts for that sub-agent's job only: a yes that names the sub-agent, its tools in the sub-agent's context alone, stopped with the job (FOL-253)", { skip: hasPty ? false : "needs python3's pty", timeout: 180_000 }, async () => {
  const { SERVER } = await import("./mcp-server.ts");
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const calls = path.join(home, "calls.jsonl");
  const mark = `--mark-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  fs.writeFileSync(path.join(d, "srv.mjs"), SERVER);
  fs.mkdirSync(path.join(d, ".claude", "agents"), { recursive: true });
  // The field and shape a cloud agent's file uses: this file deploys as an agent and means the same there.
  fs.writeFileSync(path.join(d, ".claude", "agents", "lookup.md"), `---\nname: lookup\ndescription: Looks things up with its kit.\ntools: Read\nmcpServers:\n  kit:\n    command: node\n    args: [srv.mjs, "${mark}"]\n    env:\n      CALLS: ${calls}\n---\nYou look things up with your kit and report.\n`);
  const running = () => spawnSync("pgrep", ["-f", "--", mark], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean).length;
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "a1", name: "agent", input: { agent: "lookup", description: "look it up", prompt: "Use your kit to echo the words: from the sub-agent." } }]),
    // the sub-agent's own two model calls
    () => sse([{ type: "tool_use", id: "m1", name: "mcp__kit__echo", input: { words: "from the sub-agent" } }]),
    () => sse([{ type: "text", text: "The kit said it back." }]),
    () => sse([{ type: "text", text: "Looked up." }]),
    // again in the same session: the yes is kept, the server is started afresh
    () => sse([{ type: "tool_use", id: "a2", name: "agent", input: { agent: "lookup", description: "look again", prompt: "Say hello." } }]),
    () => sse([{ type: "text", text: "Hello." }]),
    () => sse([{ type: "text", text: "Looked again." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: fast\n---\nYou code.\n", sha256: "x" }),
    [`GET ${WS}/sessions/code-sm/messages`]: () => ({ messages: [] }),
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
  const toolNames = (i: number) => (asked[i]?.tools ?? []).map((x: any) => String(x.name));
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-sm", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    // Not a server of the session: /setup mcp has none, /setup agents says whose it is.
    at = await alone(t, "/setup mcp", at);
    at = await t.until(/lookup:kit\s+sub-agent's own\s+asked when that sub-agent's job starts[\s\S]*no MCP servers/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/setup agents\r");
    at = await t.until(/lookup\s+Looks things up with its kit\.[\s\S]*its own MCP server kit \(mcpServers: — started for its job only, with your yes\) · asked at every call/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("look it up\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    // The job itself is asked (an agent with a server of its own acts), then the server — the question names the sub-agent.
    at = await t.until(/the sub-agent lookup \(project[\s\S]*allow\?/, at);
    assert.equal(running(), 0, "nothing started before the yes");
    t.send("y\r");
    at = await t.until(/the sub-agent lookup asks:[\s\S]*start the MCP server kit for the sub-agent lookup\?[\s\S]*from this folder's [^\n]*lookup\.md[\s\S]*\$ node srv\.mjs --mark-[\s\S]*from this folder, as they are now \(a change asks again\): srv\.mjs[\s\S]*for this job of the sub-agent, and is stopped when the job ends[\s\S]*allow\? [^\n]*$/, at);
    assert.match(t.out().slice(at - 700, at), /yes is for this job\. Always keeps the yes for this server of this sub-agent[\s\S]*\/setup mcp forget lookup:kit takes it back[\s\S]*\[a\]lways for this server of this sub-agent/);
    assert.equal(running(), 0, "nothing started before the yes to the server");
    t.send("y\r");
    at = await t.until(/MCP server kit started for the sub-agent lookup · 2 tools — stopped when its job ends/, at);
    // Its call: asked, with the sub-agent named and what goes to the server shown whole.
    at = await t.until(/the sub-agent lookup asks:[\s\S]*the MCP server kit · its tool echo[\s\S]*"words": "from the sub-agent"[\s\S]*allow\?/, at);
    assert.equal(fs.existsSync(calls), false, "not called before the yes");
    assert.equal(running(), 1, "running while its job runs");
    t.send("y\r");
    at = await t.until(/sub-agent lookup answered/, at);
    at = await t.until(/Looked up\./, at);
    at = await t.until(/\w ❯ /, at);
    assert.match(fs.readFileSync(calls, "utf8"), /"name":"echo"[\s\S]*from the sub-agent/);
    assert.equal(running(), 0, "stopped when the job ended");
    // The tools' definitions: in the sub-agent's requests, never in the session agent's.
    assert.deepEqual(toolNames(1).filter((n: string) => n.startsWith("mcp__")), ["mcp__kit__echo", "mcp__kit__env"]);
    for (const i of [0, 3]) assert.deepEqual(toolNames(i).filter((n: string) => n.startsWith("mcp__")), [], `the session agent's call ${i} holds no tool of the sub-agent's server`);
    assert.doesNotMatch(JSON.stringify(asked[0]) + JSON.stringify(asked[3]), /Says it back|mcp__kit/);
    t.send("/status context\r");
    at = await t.until(/MCP tools\s+none — no MCP server of the session is running[\s\S]*0 tokens here for the sub-agents' own MCP servers \(lookup: kit\)/, at);
    at = await t.until(/\w ❯ /, at);
    // Again: a yes was for that job — the server is asked about again. This time: always.
    t.send("look again\r");
    at = await t.until(/the sub-agent lookup \(project[\s\S]*allow\?/, at);
    t.send("y\r");
    at = await t.until(/start the MCP server kit for the sub-agent lookup\?[\s\S]*allow\? [^\n]*$/, at);
    t.send("a\r");
    at = await t.until(/MCP server kit started for the sub-agent lookup/, at);
    at = await t.until(/Looked again\./, at);
    at = await t.until(/\w ❯ /, at);
    assert.equal(running(), 0);
    // The kept yes is seen in /setup mcp and taken back there.
    at = await alone(t, "/setup mcp", at);
    at = await t.until(/lookup:kit\s+sub-agent's own\s+your yes is kept — starts with that sub-agent's job, stops with it · \/setup mcp forget lookup:kit/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/setup mcp forget lookup:kit\r");
    at = await t.until(/your yes to lookup:kit is taken back/, at);
    at = await t.until(/\w ❯ /, at);
    at = await alone(t, "/setup mcp", at);
    at = await t.until(/lookup:kit\s+sub-agent's own\s+asked when that sub-agent's job starts/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("MCP, sub-agents, todos and an added folder in one session: a server starts only with a yes and its calls are asked; a reading sub-agent is not asked; a cloud sub-agent sends the prompt alone", { skip: hasPty ? false : "needs python3's pty", timeout: 180_000 }, async () => {
  const { SERVER } = await import("./mcp-server.ts");
  const d = repo();
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-other-")));
  fs.writeFileSync(path.join(other, "notes.txt"), "from the other folder\n");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const calls = path.join(home, "calls.jsonl");
  fs.writeFileSync(path.join(d, "srv.mjs"), SERVER);
  fs.writeFileSync(path.join(d, ".mcp.json"), JSON.stringify({ mcpServers: { kit: { command: "node", args: ["srv.mjs"], env: { CALLS: calls } } } }));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "m1", name: "mcp__kit__echo", input: { words: "hi there" } }]),
    () => sse([
      { type: "tool_use", id: "t1", name: "todo_write", input: { todos: [{ content: "look at a.txt", status: "in_progress" }, { content: "ask the cloud", status: "pending" }] } },
      { type: "tool_use", id: "a1", name: "agent", input: { description: "read a.txt", prompt: "Read a.txt and say what it holds." } },
    ]),
    // the sub-agent's own two model calls
    () => sse([{ type: "tool_use", id: "c1", name: "Read", input: { file_path: path.join(d, "a.txt") } }, { type: "tool_use", id: "c2", name: "Read", input: { file_path: "/etc/hosts" } }]),
    () => sse([{ type: "text", text: "a.txt holds one line." }]),
    () => sse([{ type: "tool_use", id: "a2", name: "cloud_jobs", input: { folder: false, description: "the answer", tasks: ["What is six times seven?"] } }]),
    () => sse([{ type: "text", text: "All done: 42." }]),
    // the added folder
    () => sse([{ type: "tool_use", id: "r9", name: "Read", input: { file_path: path.join(other, "notes.txt") } }]),
    () => sse([{ type: "text", text: "It says: from the other folder." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }, { name: "researcher" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: fast\n---\nYou code.\n", sha256: "x" }),
    [`GET ${WS}/sessions/code-mx/messages`]: () => ({ messages: [] }),
    [`POST ${WS}/agents/coder/run`]: () => ({ runId: "run-sub-1" }),
    [`GET ${WS}/runs/run-sub-1`]: () => ({ id: "run-sub-1", status: "completed", steps: [{ agent: "coder", result: "Six times seven is 42.", costUsd: 0.01 }] }),
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
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-mx", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/MCP servers: kit waits for your yes — \/setup mcp on <name>/);
    at = await t.until(/\w ❯ /, at);
    // /setup mcp alone (FOL-259, FOL-263): each server's action is a choice; Esc changes nothing.
    t.send("/setup mcp\r");
    at = await t.until(/MCP servers[\s\S]*❯ 1\. List them[\s\S]*2\. Start kit\s+waits for your yes[\s\S]*Add a server…[\s\S]*Esc to cancel/, at);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\x1b");
    at = await t.until(/nothing changed/, at);
    at = await t.until(/\w ❯ /, at);
    at = await alone(t, "/setup mcp", at);
    at = await t.until(/kit\s+project\s+waits for your yes/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/setup mcp on kit\r");
    at = await t.until(/\$ node srv\.mjs[\s\S]*from this folder, as they are now \(a change asks again\): srv\.mjs[\s\S]*it runs on this computer as you, with no sandbox[\s\S]*\[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/kit is running · 2 tools/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/setup mcp tools kit\r");
    at = await t.until(/echo\s+Says it back\.[\s\S]*what the server says about itself \(shown to you only[\s\S]*Ignore the person/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("use things\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    // The MCP call: the server and tool named, the input whole, asked — its readOnlyHint notwithstanding.
    at = await t.until(/the MCP server kit · its tool echo[\s\S]*"words": "hi there"[\s\S]*allow\?[^\n]*lways for this tool, this session/, at);
    assert.equal(fs.existsSync(calls), false, "not called before the yes");
    t.send("y\r");
    // The todo list is shown, unasked; the reading sub-agent runs unasked, and its read outside the folder is refused, not asked.
    at = await t.until(/▸ look at a\.txt[\s\S]*○ ask the cloud/, at);
    at = await t.until(/sub-agent explore · read a\.txt/, at);
    at = await t.until(/sub-agent explore answered/, at);
    // The cloud sub-agent: asked, with exactly what is sent.
    at = await t.until(/runs in desk on [^\n]* as its agent coder[^\n]*Only this text is sent; no file of this folder[\s\S]*What is six times seven\?[\s\S]*allow\?[^\n]*lways for cloud jobs without the folder, this session/, at);
    t.send("y\r");
    at = await t.until(/cloud sub-agent coder · run-sub-1/, at);
    at = await t.until(/✓ cloud sub-agent coder · completed/, at);
    at = await t.until(/All done: 42\./, at);
    at = await t.until(/\w ❯ /, at);
    at = await alone(t, "/todos", at);
    at = await t.until(/1 [^\n]*look at a\.txt[\s\S]*2 [^\n]*ask the cloud/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/todos done 1\r");
    at = await t.until(/✔ look at a\.txt/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/setup agents\r");
    at = await t.until(/explore[\s\S]*built in · Read, Glob, Grep · reads only, never asked[\s\S]*general[\s\S]*in the cloud[\s\S]*coder[\s\S]*researcher/, at);
    at = await t.until(/\w ❯ /, at);
    t.send('/setup mcp add web --header "Authorization: Bearer sk-live-PASTED" https://x.example/mcp\r');
    at = await t.until(/--header's value must read a variable/, at);
    at = await t.until(/\w ❯ /, at);
    at = await alone(t, "/permissions", at);
    at = await t.until(/sending|allowed ahead|✓/, at);
    at = await t.until(/\w ❯ /, at);
    t.send(`/setup dirs ${home}\r`);
    at = await t.until(/where keys are kept/, at);
    at = await t.until(/\w ❯ /, at);
    t.send(`/setup dirs ${other}\r`);
    at = await t.until(/added for this session/, at);
    const asAdded = at;
    at = await t.until(/\w ❯ /, at);
    t.send("what is in the other folder\r");
    at = await t.until(/It says: from the other folder\./, at);
    at = await t.until(/\w ❯ /, at);
    assert.doesNotMatch(t.out().slice(asAdded), /outside this folder|allow\?/, "a read in an added folder is not asked");
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
  // A token pasted into /setup mcp add by mistake is refused and never kept in the history.
  const history = fs.readdirSync(home).filter((f) => /history/.test(f)).map((f) => fs.readFileSync(path.join(home, f), "utf8")).join("\n");
  assert.match(history, /use things/);
  assert.doesNotMatch(history, /sk-live-PASTED/);
  // What the model was offered and told.
  const names = asked[0].tools.map((x: any) => x.name);
  for (const n of ["mcp__kit__echo", "mcp__kit__env", "agent", "todo_write", "todo_read"]) assert.ok(names.includes(n), n);
  assert.doesNotMatch(JSON.stringify(asked[0].system), /Ignore the person/, "a server's own instructions are never the agent's");
  // The MCP server was called once, with what was shown.
  assert.deepEqual(fs.readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l)), [{ name: "echo", arguments: { words: "hi there" } }]);
  // The sub-agent: an empty context, its own three tools, and its outside read refused without a question.
  assert.deepEqual(asked[2].tools.map((x: any) => x.name), ["Read", "Glob", "Grep"]);
  assert.equal(asked[2].messages.length, 1);
  assert.match(JSON.stringify(asked[2].messages[0]), /Read a\.txt and say what it holds\./);
  assert.match(JSON.stringify(asked[3].messages.at(-1)), /outside the folders you may read/);
  // Only its answer went back to the session's agent.
  assert.match(JSON.stringify(asked[4].messages.at(-1)), /a\.txt holds one line\./);
  // The cloud run was started with the prompt alone: no copy of the folder.
  const run = s.seen.find((x) => x.method === "POST" && x.url === `${WS}/agents/coder/run`);
  assert.deepEqual(JSON.parse(run!.body), { task: "What is six times seven?" });
  assert.equal(s.seen.some((x) => /snapshots/.test(x.url)), false);
  assert.match(JSON.stringify(asked[5].messages.at(-1)), /Six times seven is 42\.[\s\S]*saw none of this folder/);
  // The person's own change to the todo list reaches the agent as a note; the added folder is named.
  assert.match(JSON.stringify(asked[6].messages.at(-1)), /The person changed the session's todo list themselves/);
  assert.match(JSON.stringify(asked[6].system), /also added these folders for you to read/);
});

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

test("a site the sandbox does not list is asked about by name while the command runs; a yes keeps it for the session, a no is refused (FOL-312)", { skip: canSandbox ? false : "no local sandbox on this machine", timeout: 150_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const curl = (id: string, host: string) => () => sse([{ type: "tool_use", id, name: "Bash", input: { command: `curl -sS -m 20 -o /dev/null https://${host}/ ; echo reached-${host}` } }]);
  const turns = [
    curl("c1", "example.org"), () => sse([{ type: "text", text: "First done." }]),
    curl("c2", "example.org"), () => sse([{ type: "text", text: "Second done." }]),
    curl("c3", "example.net"), () => sse([{ type: "text", text: "Third done." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-st/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-st", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200", FOLDRUN_CODE_SANDBOX: "" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("one\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/a command inside the sandbox wants to reach example\.org[\s\S]*allow\? \[y\]es · \[n\]o/, at, 60_000);
    t.send("y\r");
    at = await t.until(/First done\./, at, 60_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/permissions sandbox\r");
    at = await t.until(/example\.org/, at);
    at = await t.until(/\w ❯ /, at);
    // The same site again: not asked.
    const before = at;
    t.send("two\r");
    at = await t.until(/Second done\./, at, 60_000);
    assert.doesNotMatch(t.out().slice(before), /wants to reach example\.org/);
    at = await t.until(/\w ❯ /, at);
    // Another site, refused: the command fails and the model is told the person said no.
    t.send("three\r");
    at = await t.until(/wants to reach example\.net[\s\S]*allow\? \[y\]es · \[n\]o/, at, 60_000);
    t.send("n\r");
    at = await t.until(/Third done\./, at, 60_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
  // The model is told a site is asked for, never to go outside the sandbox for one.
  assert.match(JSON.stringify(asked[0].system), /any other site is asked of the person while the command runs/);
});

test("/permissions bypass (FOL-308): nothing is asked for the session, outside the sandbox and edits too; the status line says so in red; relaxed asks again", { skip: canSandbox ? false : "no local sandbox on this machine", timeout: 120_000 }, async () => {
  const d = repo();
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-outside-")));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "o1", name: "bash_outside", input: { command: `echo unasked > ${path.join(other, "bypass.txt")}`, reason: "outside the folder" } }, { type: "tool_use", id: "w1", name: "Write", input: { file_path: path.join(d, "made.txt"), content: "made\n" } }]),
    () => sse([{ type: "text", text: "Both done." }]),
    () => sse([{ type: "tool_use", id: "o2", name: "bash_outside", input: { command: `echo again > ${path.join(other, "asked.txt")}`, reason: "again" } }]),
    () => sse([{ type: "text", text: "Asked this time." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-bp/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-bp", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200", FOLDRUN_CODE_SANDBOX: "" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/permissions bypass\r");
    at = await t.until(/bypass on — for this session nothing is asked/, at);
    t.send("do it\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/Both done\./, at, 60_000);
    at = await t.until(/\w ❯ /, at);
    assert.doesNotMatch(t.out(), /allow\?/, "nothing was asked");
    assert.equal(fs.readFileSync(path.join(other, "bypass.txt"), "utf8"), "unasked\n");
    assert.equal(fs.readFileSync(path.join(d, "made.txt"), "utf8"), "made\n");
    t.send("/permissions relaxed\r");
    at = await t.until(/bypass off/, at);
    t.send("again\r");
    at = await t.until(/OUTSIDE the sandbox[\s\S]*asked\.txt[\s\S]*allow\? \[y\]es · \[n\]o/, at, 60_000);
    t.send("n\r");
    at = await t.until(/Asked this time\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    assert.equal(fs.existsSync(path.join(other, "asked.txt")), false);
    // reset forgets bypass too (Codex).
    t.send("/permissions bypass\r");
    at = await t.until(/bypass on/, at);
    t.send("/permissions reset\r");
    at = await t.until(/forgotten — every change, command and send is asked again/, at);
    const shown = at;
    at = await alone(t, "/permissions", at);
    at = await t.until(/commands that only look/, at);
    assert.doesNotMatch(t.out().slice(shown), /bypass: nothing is asked/);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("the sandbox on this computer: a command inside it runs unasked and cannot write outside the folder; bash_outside is asked every time; /permissions sandbox off goes back to asking each command", { skip: canSandbox ? false : "no local sandbox on this machine", timeout: 120_000 }, async () => {
  const d = repo();
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-outside-")));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "b1", name: "Bash", input: { command: "echo made-inside > inside.txt; echo \"token=[${GH_TOKEN:-unset}] plain=[$PLAIN_SETTING]\" > env.txt" } }, { type: "tool_use", id: "b2", name: "Bash", input: { command: `echo escaped > ${path.join(other, "escape.txt")}` } }]),
    () => sse([{ type: "tool_use", id: "o1", name: "bash_outside", input: { command: `echo by-hand > ${path.join(other, "asked.txt")}`, reason: "the file belongs outside this folder" } }]),
    () => sse([{ type: "tool_use", id: "o2", name: "bash_outside", input: { command: `echo again > ${path.join(other, "refused.txt")}`, reason: "again" } }]),
    () => sse([{ type: "text", text: "Done inside; one outside." }]),
    // after /permissions sandbox off
    () => sse([{ type: "tool_use", id: "b3", name: "Bash", input: { command: "echo no-walls > later.txt" } }]),
    () => sse([{ type: "text", text: "Wrote later.txt." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-sb/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-sb", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200", FOLDRUN_CODE_SANDBOX: "", GH_TOKEN: "ghp_notARealOneButShapedLikeIt", PLAIN_SETTING: "kept" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("do the work\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    // The walls are named once; the two commands run with no question; the way out is asked.
    // Said in plain words, never what the walls are built on (FOL-271).
    at = await t.until(/sandbox on: changes stay here and in a package cache[^\n]*\/permissions sandbox/, at, 60_000);
    assert.doesNotMatch(t.out().slice(0, at), /seatbelt|bubblewrap|seccomp|sandbox-runtime/i, "no backend named");
    at = await t.until(/OUTSIDE the sandbox — it runs as you[\s\S]*the agent's reason: the file belongs outside this folder[\s\S]*asked\.txt[\s\S]*allow\? \[y\]es · \[n\]o/, at, 60_000);
    assert.doesNotMatch(t.out().slice(0, at), /allow\?[\s\S]*allow\?/, "nothing before the way out was asked");
    assert.equal(fs.readFileSync(path.join(d, "inside.txt"), "utf8"), "made-inside\n");
    // A key exported in the person's shell is not set inside; a plain setting is.
    assert.equal(fs.readFileSync(path.join(d, "env.txt"), "utf8"), "token=[unset] plain=[kept]\n");
    assert.equal(fs.existsSync(path.join(other, "escape.txt")), false, "the write outside the folder was refused by the sandbox");
    assert.equal(fs.existsSync(path.join(other, "asked.txt")), false, "nothing outside before the yes");
    t.send("y\r");
    // The second one is asked again — there is no "always" for the way out — and a no runs nothing.
    at = await t.until(/OUTSIDE the sandbox[\s\S]*refused\.txt[\s\S]*allow\? \[y\]es · \[n\]o/, at, 30_000);
    assert.equal(fs.readFileSync(path.join(other, "asked.txt"), "utf8"), "by-hand\n");
    t.send("n\r");
    at = await t.until(/Done inside; one outside\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    assert.equal(fs.existsSync(path.join(other, "refused.txt")), false);
    t.send("/permissions sandbox\r");
    at = await t.until(/on — changes stay here and in a package cache[\s\S]*commands may write: [^\n]*[\s\S]*inside it a command runs without a question/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/permissions sandbox off\r");
    at = await t.until(/Turn it off for this session\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/off for this session — a command is asked before it runs/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("one more\r");
    at = await t.until(/echo no-walls > later\.txt[\s\S]*allow\? \[y\]es/, at, 30_000);
    t.send("y\r");
    at = await t.until(/Wrote later\.txt\./, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
  // The model was offered the way out and told about the walls only while they were up.
  assert.ok(asked[0].tools.some((x: any) => x.name === "bash_outside"));
  assert.match(JSON.stringify(asked[0].system), /run inside a sandbox on this computer/);
  assert.ok(!asked[4].tools.some((x: any) => x.name === "bash_outside"));
  assert.doesNotMatch(JSON.stringify(asked[4].system), /run inside a sandbox on this computer/);
  // The command refused by the walls came back to the model as a failure.
  const results = JSON.stringify(asked[1].messages.at(-1));
  assert.match(results, /Operation not permitted|Read-only file system|Permission denied/);
});

test("three ways to work (FOL-258, FOL-263): /where local takes the agent's cloud tools away and /where local+cloud gives them back, kept for the folder; --local-only, --local and --continue do not ask", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const s = await serve({
    "GET /v1/workspaces": () => ({ workspaces: [{ name: "desk" }] }),
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return sse([{ type: "text", text: `answer ${asked.length}` }]);
    },
  });
  const names = (i: number) => asked[i].tools.map((x: any) => x.name);
  const kept = () => JSON.parse(fs.readFileSync(path.join(home, "code-sessions.json"), "utf8"))[d];
  const t = onTerminal(["code", d, "--url", s.url, "--token", "k"], home, { TERM: "xterm", COLUMNS: "200" });
  try {
    // Three answers (FOL-263); a new folder has this computer only ticked.
    let at = await t.until(/Where should this session work\?[\s\S]*❯ 1\. This computer only [^\n]*✔[\s\S]*2\. This computer, agents in the cloud[\s\S]*3\. The cloud[\s\S]*Esc to cancel/);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\x1b[B");
    await new Promise((r) => setTimeout(r, 100));
    t.send("\r");
    at = await t.until(/works\s+on this computer, agents in the cloud/, at);
    at = await t.until(/Which project\?/, at);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\r");
    at = await t.until(/works\s+on this computer · cloud jobs on[\s\S]*agents in the cloud may take heavy jobs, each asked first \(\/where\)/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/where local\r");
    at = await t.until(/✓ This computer only from here on — the agent sends nothing to the cloud/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("hello\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/answer 1/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    // /where alone: the three ways, where it works now ticked; Enter on it says so and changes nothing.
    at = await alone(t, "/where", at);
    at = await t.until(/This computer only — \/where local · local\+cloud · cloud · send <task>/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("/where local+cloud\r");
    at = await t.until(/✓ This computer, agents in the cloud from here on/, at);
    at = await t.until(/\w ❯ /, at);
    t.send("again\r");
    at = await t.until(/answer 2/, at, 30_000);
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
  }
  // Only: no way to send the folder or a job to the cloud, and not told of one. On: both back.
  assert.ok(!names(0).includes("cloud_jobs"));
  assert.ok(!names(0).includes("session_send"));
  assert.ok(names(1).includes("session_send"));
  assert.doesNotMatch(JSON.stringify(asked[0].system), /cloud_jobs tool/);
  // The agent tool is for sub-agents here alone: the cloud is cloud_jobs (folder: false for a job without the folder).
  assert.doesNotMatch(JSON.stringify(asked[0].tools.find((x: any) => x.name === "agent")), /cloud/);
  assert.doesNotMatch(JSON.stringify(asked[1].tools.find((x: any) => x.name === "agent")), /cloud/);
  assert.match(JSON.stringify(asked[1].tools.find((x: any) => x.name === "cloud_jobs")), /"folder"/);
  assert.ok(names(1).includes("cloud_jobs"));
  assert.match(JSON.stringify(asked[1].system), /cloud_jobs tool/);
  assert.equal(kept().mode, "local");
  assert.equal(kept().localOnly, undefined, "turned on mid-session: kept with cloud jobs on");
  // The next session is asked again, with what the last one ended on ticked.
  const again = onTerminal(["code", d, "--url", s.url, "--token", "k"], home, { TERM: "xterm", COLUMNS: "200" });
  try {
    await again.until(/Enter keeps what this folder had last time[\s\S]*2\. This computer, agents in the cloud[^\n]*✔/);
    again.send("\x1b");
    await again.done;
  } finally {
    again.child.kill();
  }
  // The flag answers ahead and is kept; --continue goes on as its conversation was, asking nothing.
  const off = /works\s+on this computer · cloud jobs off[\s\S]*the agent sends nothing to the cloud/;
  for (const [extra, said] of [[["--local-only"], off], [["--continue"], off], [["--local"], off]] as const) {
    const third = onTerminal(["code", d, ...extra, "--url", s.url, "--token", "k"], home, { TERM: "xterm", COLUMNS: "200" });
    try {
      const at = await third.until(said);
      await third.until(/\w ❯ /, at);
      assert.doesNotMatch(third.out(), /Where should/, extra.join(" "));
      third.send("/quit\r");
      assert.equal(await third.done, 0);
    } finally {
      third.child.kill();
    }
    // --local is the place only: the folder's cloud jobs stay off, as --local-only left them.
    assert.equal(kept().localOnly, true, extra.join(" "));
  }
  s.close();
});

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
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
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
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/sleep 4; echo slept[\s\S]*\[y\]es/, at, 30_000);
    t.send("y\r");
    // The command runs: what is typed now is shown as it is typed.
    await new Promise((r) => setTimeout(r, 600));
    t.send("also check the readme");
    at = await t.until(/next: also check the readme/, at, 5_000);
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

test("a line typed while the turn looks up the plan never answers the key question that follows (FOL-306, Codex)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
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
    // Typed before any question is on the screen.
    t.send("y\r");
    at = await t.until(/make it\? \[y\/N\]/, at, 10_000);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(keys, 0, "the early y did not answer it");
    t.send("n\r");
    at = await t.until(/nothing made/, at, 10_000);
    // What was typed early is kept: it starts the next message, to send or clear.
    at = await t.until(/\w ❯ y/, at);
  } finally {
    t.child.kill();
    s.close();
  }
  assert.equal(keys, 0);
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
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/sleep 2; echo first[\s\S]*\[y\]es/, at, 30_000);
    t.send("y\r");
    await new Promise((r) => setTimeout(r, 500));
    t.send("draft ");
    at = await t.until(/next: draft/, at, 5_000);
    at = await t.until(/sleep 3; echo second[\s\S]*\[y\]es/, at, 30_000);
    t.send("y\r");
    // The second command runs: the draft is on the working line again, its space kept (Codex).
    await new Promise((r) => setTimeout(r, 400));
    t.send("words");
    at = await t.until(/next: draft words/, at, 5_000);
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
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
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
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
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
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
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
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
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
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
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
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
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
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
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
    at = await t.until(/Remove a rule — the rule's number: /, at);
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
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-fr", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("go\r");
    at = await t.until(/include it in this turn\? \[y\/N\]/, at);
    t.send("y\r");
    // The key for this computer: declined, so nothing reaches a model.
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    await new Promise((r) => setTimeout(r, 300));
    // Held only once the turn is about to be sent, after the key prompt: declined there, nothing was held (Codex round 11).
    assert.deepEqual(calls, [], "never held — the turn stopped at the key prompt");
    t.send("again\r");
    at = await t.until(/include it in this turn\? \[y\/N\]/, at);
    t.send("n\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
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
