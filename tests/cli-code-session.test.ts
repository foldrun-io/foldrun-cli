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

const WS = "/api/workspaces/desk";
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
function onTerminal(args: string[], home: string, extraEnv: Record<string, string> = {}) {
  const cli = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
  const child = spawn("python3", ["-c", "import pty,sys; sys.exit(pty.spawn(sys.argv[1:]) >> 8)", process.execPath, cli, ...args], {
    env: { ...process.env, FOLDRUN_HOME: home, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1", SHELL: "/bin/sh", TERM: "dumb", ...extraEnv },
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
  const t = onTerminal(["code", d, "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home);
  try {
    let at = await t.until(/you ›/);
    assert.match(t.out(), /session code-me/);

    t.send("/help\r");
    at = await t.until(/\/undo\s+take back/, at);
    at = await t.until(/you ›/, at);

    t.send("!echo hello-from-shell\r");
    at = await t.until(/goes with your next message/, at);
    assert.match(t.out(), /hello-from-shell/);
    at = await t.until(/you ›/, at);

    // Two lines in one write: a paste — one message, one turn.
    t.send("add b\rand keep it short\r");
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
    at = await t.until(/you ›/, at);

    t.send("/undo\r");
    at = await t.until(/take back the last change/, at);
    t.send("y\r");
    at = await t.until(/taken back/, at);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "a\n");
    at = await t.until(/you ›/, at);

    t.send("/nope\r");
    at = await t.until(/is not a command — \/help lists them/, at);
    at = await t.until(/you ›/, at);

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
  const t = onTerminal(["code", d, "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home, { TERM: "xterm-256color", FOLDRUN_NO_TICKER: "1" });
  try {
    let at = await t.until(/you ›/);
    assert.match(t.out(), /\x1b\[\?2004h/, "paste mode on while the prompt waits");
    t.send("\x1b[200~add b\r");
    await new Promise((r) => setTimeout(r, 200)); // far past the 30 ms grouping
    t.send("and keep it short\x1b[201~");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run")).length, 0, "nothing sent before Enter");
    t.send("\r");
    at = await t.until(/apply it to/, at);
    const posts = s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run"));
    assert.equal(posts.length, 1);
    assert.match(JSON.parse(posts[0]!.body).task as string, /add b\nand keep it short$/);
    assert.match(t.out(), /\x1b\[\?2004l[\s\S]*apply it to/, "paste mode off before the turn");
    t.send("n\r");
    at = await t.until(/you ›/, at);
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
