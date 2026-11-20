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
function sse(content: Array<{ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown }>) {
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

test("every new session asks where (last answer ticked, Enter keeps it); the project is asked once per folder; --continue and --cloud ask nothing; exit leaves", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({
    "GET /api/workspaces": () => ({ workspaces: [{ name: "desk" }, { name: "other" }] }),
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
    "GET /api/me": () => ({ account: "acme" }),
    "GET /api/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /api/keys": (b) => {
      keysMade++;
      const body = JSON.parse(String(b));
      assert.equal(body.purpose, "gateway");
      assert.ok(body.capUsd > 0, "a key with a limit");
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, capUsd: body.capUsd };
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
    "GET /api/me": () => ({ account: "acme" }),
    "POST /api/keys": () => ({ id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, capUsd: 20 }),
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

test("--local, cloud_agents: Ctrl-C while they work stops every run on the platform and applies nothing", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  let n = 0;
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\n", sha256: "x" }),
    "GET /api/me": () => ({ account: "acme" }),
    "POST /api/keys": () => ({ id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, capUsd: 20 }),
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
    "GET /api/usage": () => ({ credits: { pots: { planUsd: 3, boughtUsd: 0 }, plan: { id: "free", name: "Free", paysForTokens: false }, usdPerCredit: 0.01 } }),
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
    assert.equal(s.seen.filter((x: any) => x.url === "/api/keys" || x.url === "/v1/messages").length, 0, "no key made, no model asked");
    assert.doesNotMatch(s.seen.map((x: any) => x.url).join(" "), /\/api\/keys|\/v1\/messages/);
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
