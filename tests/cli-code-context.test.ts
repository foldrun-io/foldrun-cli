// foldrun code knows the folder and foldrun (24 Nov 2026): AGENTS.md and
// CLAUDE.md read from the repository's top down, skills and the folder's own
// slash commands, the list under the prompt while a /command is typed, one
// session moving between this computer and the cloud, and sessions that
// message each other. Helpers first, then a real terminal (a pty).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { serve, raw } from "./fake-platform.ts";
import {
  folderInstructions, folderSkills, folderCommands, frontmatterLines, expandCommand, skillMessage, skillsNote, foldrunKnowledge, cloudBrief, carryNote, exportTranscript, slashMatches, readBody, readOnlyCommand } from "../src/code-context.mjs";
import { CODE_COMMANDS, helpText, codeCompleter, friendlyTool, localCallSummary, localPrompt, commandMenu, MENU_COMMANDS } from "../src/code-session.mjs";
import { foldrunDocsCall, sessionMessageOf, goalVerdict, usageBlock } from "../src/commands.mjs";

const hasPty = spawnSync("python3", ["-c", "import pty"]).status === 0 && process.platform !== "win32";

function repo(files: Record<string, string>): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-code-ctx-")));
  const git = (...a: string[]) => execFileSync("git", ["-C", d, "-c", "user.email=t@t", "-c", "user.name=t", ...a]);
  git("init", "-q");
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), text);
  }
  git("add", "-A");
  git("commit", "-qm", "base");
  return d;
}

const SKILL = "---\nname: release-notes\ndescription: Write release notes. Use when asked for a changelog entry.\n---\nNotes go in NOTES.md, newest first.\n";

test("instructions: AGENTS.md and CLAUDE.md, from the repository's top down to the folder; a link to the same file read once; nothing from outside", () => {
  const d = repo({ "AGENTS.md": "top agents\n", "CLAUDE.md": "top claude\n", "pkg/AGENTS.md": "pkg agents\n", "pkg/x.txt": "x\n", ".claude/CLAUDE.md": "dot claude\n" });
  const top = folderInstructions(d);
  assert.deepEqual(top.files.map((f) => f.path), ["AGENTS.md", "CLAUDE.md", path.join(".claude", "CLAUDE.md")]);
  assert.match(top.text, /Contents of AGENTS\.md[^\n]*\n\ntop agents/);
  const sub = folderInstructions(path.join(d, "pkg"));
  assert.deepEqual(sub.files.map((f) => f.path), ["AGENTS.md", "CLAUDE.md", path.join(".claude", "CLAUDE.md"), path.join("pkg", "AGENTS.md")], "the nearest is read last");
  assert.ok(sub.text.indexOf("top agents") < sub.text.indexOf("pkg agents"));

  // CLAUDE.md a link to AGENTS.md: one file, read once.
  const linked = repo({ "AGENTS.md": "only once\n" });
  fs.symlinkSync("AGENTS.md", path.join(linked, "CLAUDE.md"));
  assert.equal(folderInstructions(linked).files.length, 1);

  // A link that leads out of the repository is not read.
  const out = repo({ "x.txt": "x\n" });
  const secret = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-outside-")), "secret.md");
  fs.writeFileSync(secret, "OUTSIDE-SECRET\n");
  fs.symlinkSync(secret, path.join(out, "AGENTS.md"));
  assert.equal(folderInstructions(out).text, "");

  // A long file is cut, and says so.
  const long = repo({ "AGENTS.md": "a".repeat(50_000) });
  const cut = folderInstructions(long);
  assert.equal(cut.files[0]!.cut, true);
  assert.match(cut.text, /the rest of this file is cut/);
  // No room left for a nearer file's text: it is still named, to be read.
  const deep = repo({ "AGENTS.md": "a".repeat(40_000), "CLAUDE.md": "b".repeat(40_000), ".claude/CLAUDE.md": "c".repeat(40_000), "pkg/AGENTS.md": "NEAREST\n", "pkg/x.txt": "x\n" });
  const full = folderInstructions(path.join(deep, "pkg"));
  assert.deepEqual(full.files.at(-1), { path: path.join("pkg", "AGENTS.md"), chars: 0, cut: true });
  assert.match(full.text, /pkg\/AGENTS\.md also holds instructions for you/);
});

test("skills: .claude/skills, skills/ and a foldrun project's own; name and description from the frontmatter; a name with a control character or a path in it is left out", () => {
  const d = repo({
    ".claude/skills/release-notes/SKILL.md": SKILL,
    "skills/House Style/SKILL.md": "# House style\n\nWrite plainly.\n",
    "workspaces/main/skills/triage/SKILL.md": "---\ndescription: >\n  Sort incoming\n  tickets.\n---\nbody\n",
    ".claude/skills/bad\u001bname/SKILL.md": "---\nname: \"ok\u001b[31m\"\n---\nx\n",
    ".claude/skills/empty/notes.txt": "no skill file\n",
  });
  const skills = folderSkills(d);
  assert.deepEqual(skills.map((k) => k.name), ["house-style", "release-notes", "triage"]);
  assert.equal(skills.find((k) => k.name === "release-notes")!.description, "Write release notes. Use when asked for a changelog entry.");
  assert.equal(skills.find((k) => k.name === "house-style")!.description, "Write plainly.");
  assert.equal(skills.find((k) => k.name === "triage")!.description, "Sort incoming tickets.");
  assert.equal(skills.find((k) => k.name === "triage")!.file, path.join("workspaces", "main", "skills", "triage", "SKILL.md"));
  const note = skillsNote(skills);
  assert.match(note, /read its file with the Read tool first/);
  assert.match(note, /- release-notes: Write release notes\.[^\n]*— \.claude\/skills\/release-notes\/SKILL\.md/);
  assert.equal(skillsNote([]), "");
  // For an agent whose working folder is a subfolder: the path as that folder reads it.
  fs.mkdirSync(path.join(d, "pkg"));
  assert.equal(folderSkills(path.join(d, "pkg"), { relativeTo: path.join(d, "pkg") }).find((k) => k.name === "house-style")!.file, path.join("..", "skills", "House Style", "SKILL.md"));
  assert.match(skillMessage(skills[1]!, "Notes go in NOTES.md", "for 1.0"), /skill "release-notes"[\s\S]*Notes go in NOTES\.md[\s\S]*What to do with it: for 1\.0$/);
});

test("the folder's own commands: .claude/commands/<name>.md, a subfolder as <folder>:<name>; $ARGUMENTS and $1 filled once, what was typed never read as a placeholder", () => {
  const d = repo({
    ".claude/commands/fix-tests.md": "---\ndescription: Run the tests and fix what fails\nargument-hint: [which]\n---\nRun the tests. Extra: $ARGUMENTS\n",
    ".claude/commands/db/migrate.md": "Migrate $1 to $2.\n",
    ".claude/commands/plain.md": "Tidy the imports.\n",
    ".claude/commands/Not A Name.md": "x\n",
  });
  const cmds = folderCommands(d);
  assert.deepEqual(cmds.map((x) => x.name), ["db:migrate", "fix-tests", "plain"]);
  assert.equal(cmds[1]!.description, "Run the tests and fix what fails");
  assert.equal(cmds[1]!.hint, "[which]");
  assert.deepEqual(readBody(d, cmds[1]!.file), { text: "Run the tests. Extra: $ARGUMENTS", cut: false });
  fs.writeFileSync(path.join(d, ".claude/commands/plain.md"), "x".repeat(40_001));
  assert.equal(readBody(d, ".claude/commands/plain.md").cut, true, "a procedure is sent whole or not at all");
  assert.equal(expandCommand("Run the tests. Extra: $ARGUMENTS", "only calc"), "Run the tests. Extra: only calc");
  assert.equal(expandCommand("Migrate $1 to $2.", "users v2"), "Migrate users to v2.");
  assert.equal(expandCommand("Tidy the imports.", "in src"), "Tidy the imports.\n\nin src", "no placeholder: what was typed follows");
  assert.equal(expandCommand("Say $ARGUMENTS", "$1 and $ARGUMENTS"), "Say $1 and $ARGUMENTS", "filled once");
  assert.equal(readBody(d, "../outside.md").text, null);
});

test("frontmatter lines: plain values, quotes off, a folded block joined; no frontmatter leaves the text", () => {
  assert.deepEqual(frontmatterLines("---\nname: \"a b\"\ndescription: |\n  one\n  two\nx-y: 3\n---\nbody\n"), { data: { name: "a b", description: "one two", "x-y": "3" }, body: "body\n" });
  assert.deepEqual(frontmatterLines("no front\n"), { data: {}, body: "no front\n" });
});

test("what the agent knows of foldrun: automation is a scheduled flow, the docs are read before answering, deploys are the person's call", () => {
  const local = foldrunKnowledge({ ws: "desk", url: "https://api.example", mode: "local" });
  assert.match(local, /project "desk" on https:\/\/api\.example/);
  assert.match(local, /trigger: schedule/);
  assert.match(local, /foldrun deploy/);
  assert.match(local, /foldrun_docs tool/);
  assert.match(local, /Mention GitHub Actions, cron or another host only when they ask/);
  assert.match(local, /session_send/);
  const cloud = foldrunKnowledge({ ws: "desk", url: "https://api.example", mode: "cloud" });
  assert.doesNotMatch(cloud, /foldrun_docs|session_send/, "tools only the local agent has are not promised in the cloud");
  assert.match(localPrompt("/x", local), /About foldrun/);
});

test("deploying (FOL-270): the agent suggests cloudhost.ir when the person wants it online, reads the built-in deploy page, deploys nothing before a yes", () => {
  const local = foldrunKnowledge({ ws: "desk", url: "https://api.example", mode: "local" });
  assert.match(local, /website, app or API you built online — to deploy it, host it, publish it[\s\S]*suggest cloudhost\.ir[\s\S]*foldrun_docs page "deploy"[\s\S]*another host, help with that instead[\s\S]*Deploy nothing before they agree/);
  assert.match(local, /A foldrun flow or agent is not this: `foldrun deploy` puts those on foldrun/);
  assert.doesNotMatch(foldrunKnowledge({ ws: "desk", url: "https://api.example", mode: "cloud" }), /cloudhost/, "not told where it is not delivered");
  assert.match(foldrunDocsCall({}).text, /^deploy — Deploying a website, app or API \(cloudhost\.ir\)$/m);
  const page = foldrunDocsCall({ page: "deploy" });
  assert.ok(!page.isError);
  assert.match(page.text, /https:\/\/api\.cloudhost\.ir\/mcp/);
  assert.match(page.text, /Bearer \$\{CLOUDHOST_API_KEY\}/, "a reference, never a key");
  assert.match(page.text, /Production only when they say so/);
  assert.match(foldrunDocsCall({ page: "deploy", find: "previews first" }).text, /^## Previews first/);
});

test("foldrun_docs: the list of pages, one page, a part of a page; a name that is not a page — never a path", () => {
  const list = foldrunDocsCall({});
  assert.match(list.text, /^foldrun's docs pages:\n/);
  assert.match(list.text, /^flows — /m);
  const page = foldrunDocsCall({ page: "Scheduling.md" });
  assert.ok(!page.isError);
  assert.match(page.text, /schedule/i);
  const part = foldrunDocsCall({ page: "flows", find: "trigger" });
  assert.match(part.text, /trigger/i);
  assert.ok(part.text.length < foldrunDocsCall({ page: "flows" }).text.length + 1);
  for (const bad of ["../package", "/etc/passwd", "nope"]) {
    const r = foldrunDocsCall({ page: bad });
    assert.equal(r.isError, true);
    assert.match(r.text, /the pages are:/);
  }
  assert.equal(friendlyTool("foldrun_docs"), "Read foldrun docs");
  assert.equal(localCallSummary("foldrun_docs", { page: "flows", find: "trigger" }, "/x"), "flows · trigger");
  assert.equal(localCallSummary("session_send", { to: "code-1", text: "hi" }, "/x"), "code-1");
});

test("the cloud's first message names the folder's instruction files and skills, not their text", () => {
  const d = repo({ "AGENTS.md": "SECRET-WORD\n", ".claude/skills/release-notes/SKILL.md": SKILL });
  const sent = new Set(["AGENTS.md", ".claude/skills/release-notes/SKILL.md"]);
  const brief = cloudBrief(d, sent);
  assert.match(brief, /read this folder's instructions and follow them: AGENTS\.md\./);
  assert.match(brief, /This folder has skills[^\n]*: \.claude\/skills\/release-notes\/SKILL\.md\./);
  assert.doesNotMatch(brief, /Write release notes/, "paths only: nothing read from disk after the yes rides along");
  assert.doesNotMatch(brief, /SECRET-WORD/);
  assert.equal(cloudBrief(repo({ "x.txt": "x\n" }), new Set(["x.txt"])), "", "a folder with neither: the message goes as typed");
  // A skill the upload leaves out (git-ignored) is not named: its description never rode along.
  assert.doesNotMatch(cloudBrief(d, new Set(["AGENTS.md"])), /release-notes/);
  // Started in a subfolder: only what is under it goes up, named as the copy has it.
  const sub = repo({ "AGENTS.md": "top\n", "pkg/AGENTS.md": "pkg\n", "pkg/skills/lint/SKILL.md": SKILL.replace("release-notes", "lint"), ".claude/skills/release-notes/SKILL.md": SKILL });
  const fromSub = cloudBrief(path.join(sub, "pkg"), new Set(["AGENTS.md", "skills/lint/SKILL.md"]));
  assert.match(fromSub, /follow them: AGENTS\.md\./);
  assert.match(fromSub, /read the file and follow it: skills\/lint\/SKILL\.md\./);
  assert.doesNotMatch(fromSub, /release-notes|pkg\//);
});

test("one session, two places: each side is told once what the other did; the newest kept when it must be cut", () => {
  const t = [
    { where: "local" as const, you: "fix add", agent: "fixed add in calc.py" },
    { where: "cloud" as const, you: "add docstrings", agent: "added two docstrings", applied: false },
    { where: "local" as const, you: "thanks", agent: "ok" },
  ];
  const toCloud = carryNote(t, "cloud", 0);
  assert.match(toCloud, /on the person's own computer/);
  assert.match(toCloud, /The person: fix add\nThe agent: fixed add in calc\.py/);
  assert.match(toCloud, /The person: thanks/);
  assert.doesNotMatch(toCloud, /add docstrings/, "its own turns are not told back to it");
  assert.equal(carryNote(t, "cloud", 3), "", "told already");
  assert.match(carryNote(t, "local", 1), /in foldrun's cloud[\s\S]*added two docstrings\n\(its changes are NOT in the folder/);
  assert.match(carryNote([{ where: "cloud", you: "x", agent: "y", applied: true }], "local", 0), /\(its changes were applied to the folder\)/);
  assert.match(toCloud, /trust the files over what was said/);
  assert.equal(carryNote(t, "local", 2), "");
  const long = [{ where: "local" as const, you: "old", agent: "x".repeat(2_000) }, { where: "local" as const, you: "new", agent: "y".repeat(2_000) }];
  const cut = carryNote(long, "cloud", 0, 3_000);
  assert.match(cut, /earlier exchanges left out/);
  assert.match(cut, /The person: new/);
  assert.doesNotMatch(cut, /The person: old/);
  assert.match(exportTranscript(t, { ws: "desk", context: "code-1", dir: "~/x" }), /## 2\. You \(in the cloud\)\n\nadd docstrings\n\n### foldrun code\n\nadded two docstrings/);
});

test("suggestions: what starts with the typed part first, then what holds it; nothing once the line is more than the command", () => {
  const all = [...CODE_COMMANDS.map(([n, d]) => ({ name: String(n).split(" ")[0]!, desc: String(d) })), { name: "/fix-tests", desc: "Run the tests", kind: "command" }];
  assert.equal(slashMatches("/", all).length, all.length);
  assert.deepEqual(slashMatches("/co", all).map((x) => x.name), ["/compact"]);
  assert.deepEqual(slashMatches("/st", all).map((x) => x.name), ["/status", "/restart", "/fix-tests"]);
  assert.deepEqual(slashMatches("/se", all).map((x) => x.name), ["/setup", "/sessions"]);
  assert.deepEqual(slashMatches("/model max", all), []);
  assert.deepEqual(slashMatches("hello", all), []);
  assert.deepEqual(slashMatches("/zzz", all), []);
  const names = CODE_COMMANDS.map(([n]) => String(n).split(" ")[0]);
  for (const n of ["/where", "/model", "/resume", "/setup", "/compact", "/plan", "/goal", "/init", "/review", "/permissions", "/export", "/sessions", "/undo", "/status"]) assert.ok(names.includes(n), n);
  // Gone into the command they belong to (FOL-263), with no other name.
  for (const n of ["/rewind", "/doctor", "/usage", "/context", "/cost", "/local", "/cloud", "/skills", "/memory", "/copy", "/clear", "/effort", "/thinking", "/mcp", "/agents", "/add-dir"]) assert.ok(!names.includes(n), n);
  assert.equal(new Set(names).size, names.length, "no command listed twice");
  const help = helpText({ extra: [{ name: "/fix-tests", hint: "[which]", desc: "Run the tests" }] });
  assert.match(help, /this folder's own:\n\/fix-tests \[which\]\s+Run the tests/);
  assert.deepEqual(codeCompleter(() => [], () => ["/fix-tests"])("/fi")[0], ["/fix-tests"]);
});

test("a command typed alone opens one list (FOL-259): every choice is a line the command takes; the cursor starts where typing it alone did; /help marks them", () => {
  const names = new Set(CODE_COMMANDS.map(([n]) => String(n).split(" ")[0]));
  const full = {
    thinking: true, localOnly: false, mode: "local", sandboxOff: false, strict: false,
    past: [{ said: "hello", at: "2026-11-24T10:00:00Z" }], turns: [{ turn: 1, label: "change things" }],
    todos: [{ content: "a", status: "pending" }], mcp: [{ name: "kit", state: "on", source: "project" }, { name: "web", state: "waiting", source: "yours" }, { name: "web", state: "hidden", source: "project" }, { name: "bad", state: "problem" }],
  };
  for (const cmd of MENU_COMMANDS) {
    assert.ok(names.has(cmd), `${cmd} is a command`);
    const m = commandMenu(cmd, full)!;
    assert.ok(m, cmd);
    assert.ok(m.choices.some((x) => x.v === m.start), `${cmd}: the cursor starts on a choice`);
    if (m.tick !== null) assert.ok(m.choices.some((x) => x.v === m.tick), `${cmd}: the tick is a choice`);
    for (const x of m.choices) {
      assert.ok(names.has(x.v.split(" ")[0]!), `${cmd}: ${x.v} is a command line`);
      // A choice that asks ends in …; so does one that opens a list of its own (/model's Model…, the owner's words).
      if (x.ask) assert.ok(x.name.endsWith("…"), `${cmd}: ${x.name} — a choice that asks ends in …`);
      else if (x.name.endsWith("…")) assert.ok(["/model", "/model effort"].includes(x.v), `${cmd}: ${x.name} ends in … but neither asks nor opens a list`);
      if (x.ask) assert.ok(x.v.endsWith(" "), `${cmd}: ${x.v} is a line still to finish`);
    }
  }
  // /model: the model, how hard it thinks, and its thinking shown or not — the choice is the other one.
  assert.deepEqual(commandMenu("/model", { thinking: false })!.choices.map((x) => x.v), ["/model", "/model effort", "/model thinking on"]);
  assert.equal(commandMenu("/model", { thinking: true })!.choices[2]!.v, "/model thinking off");
  // /setup: what the agent reads and reaches; its MCP servers are a list of their own.
  assert.deepEqual(commandMenu("/setup", {})!.choices.map((x) => x.v), ["/setup instructions", "/setup skills", "/setup agents", "/setup mcp", "/setup dirs", "/setup dirs ", "/setup check"]);
  // A hidden or broken server is listed by /setup mcp, never offered an action; a server is removed from its own file.
  assert.deepEqual(commandMenu("/setup mcp", full)!.choices.map((x) => x.v), ["/setup mcp ", "/setup mcp off kit", "/setup mcp tools kit", "/setup mcp restart kit", "/setup mcp on web", "/setup mcp add ", "/setup mcp rm kit --project", "/setup mcp rm web", "/setup mcp forget "]);
  // /where: the tick is where it works now.
  assert.equal(commandMenu("/where", { mode: "local" })!.tick, "/where local+cloud");
  // Nothing to choose from: the command says so, as before.
  assert.deepEqual(commandMenu("/resume", {})!.choices.map((x) => x.v), ["/resume find ", "/resume new"], "none kept: Find and New, the cursor on Find");
  assert.equal(commandMenu("/resume", {})!.start, "/resume find ");
  assert.equal(commandMenu("/undo", {}), null);
  assert.equal(commandMenu("/queue", {}), null, "its messages are sent or dropped before the prompt: no list");
  assert.equal(commandMenu("/diff", full), null);
  const help = helpText();
  assert.match(help, /^typed alone, a command marked ▸ opens a list/);
  assert.match(help, /▸ \/setup \[/);
  assert.match(help, /▸ \/model \[/);
  assert.doesNotMatch(help, /\/diff\s+▸/);
});

// ------------------------------------------------------------ on a terminal

import crypto from "node:crypto";
/** How the CLI names the sign-in a session's carry belongs to: --token k. */
const OWNER_K = crypto.createHash("sha256").update("t:k").digest("hex").slice(0, 24);
void OWNER_K;

const WS = "/v1/workspaces/desk";
const ID = "c".repeat(64);
const RUN = "run-ctx-1";
const PATCH = "diff --git a/a.txt b/a.txt\nindex 7898192..422c2b7 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n a\n+b\n";

function platform() {
  return serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => ({ ok: true, runId: RUN, snapshot: ID, context: "code-me" }),
    [`GET ${WS}/runs/${RUN}`]: () => ({
      id: RUN, flow: "adhoc:coder", status: "completed", snapshot: { id: ID }, startedAt: "2026-11-24T01:00:00.000Z", finishedAt: "2026-11-24T01:00:05.000Z",
      steps: [{ agent: "coder", group: 1, status: "completed", attempts: 1, costUsd: 0.02, events: [{ t: "2026-11-24T01:00:01.000Z", type: "text", text: "Added b." }], result: "Added b." }],
    }),
    [`GET ${WS}/runs/${RUN}/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "changed" }), "application/json") : raw(PATCH, "text/x-diff")),
    [`GET ${WS}/sessions/code-me/messages`]: () => ({ messages: [] }),
  });
}

function onTerminal(args: string[], home: string, extraEnv: Record<string, string> = {}) {
  const cli = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.BASH_ENV;
  delete env.ENV;
  // A terminal 100 wide: the list's rows are clipped to it.
  const child = spawn("python3", ["-c", "import pty,sys,os,fcntl,struct,termios\npid,fd=pty.fork()\nif pid==0: os.execvp(sys.argv[1],sys.argv[1:])\nfcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',40,100,0,0))\nimport select\nwhile True:\n  r,_,_=select.select([fd,0],[],[])\n  try:\n    if fd in r:\n      d=os.read(fd,65536)\n      if not d: break\n      os.write(1,d)\n    if 0 in r:\n      d=os.read(0,65536)\n      if not d: break\n      os.write(fd,d)\n  except OSError: break\n_,st=os.waitpid(pid,0)\nsys.exit(st>>8)", process.execPath, cli, ...args], {
    env: { ...env, FOLDRUN_CODE_SANDBOX: "off", FOLDRUN_HOME: home, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1", SHELL: "/bin/sh", TERM: "xterm", ...extraEnv },
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
    throw new Error(`waited for ${re} — the screen:\n${out.slice(from)}`);
  };
  const type = async (t: string) => {
    child.stdin.write(t);
    await new Promise((r) => setTimeout(r, 150));
  };
  /** A command typed alone opens its list (FOL-259): Enter at once does what it did before. */
  const alone = async (cmd: string, from = 0) => {
    child.stdin.write(`${cmd}\r`);
    await until(/↑↓ to move · Enter to choose · Esc to cancel/, from);
    await type("\r");
  };
  return { type, until, done, out: () => out, child, alone };
}

test("on a terminal: / shows the commands under the line, typing narrows them, ↓ and Tab choose, Enter runs the chosen one; the folder's command and skill are offered and sent; /setup instructions, /setup skills, /sessions", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo({
    "a.txt": "a\n",
    "AGENTS.md": "House rule: be brief.\n",
    ".claude/skills/release-notes/SKILL.md": SKILL,
    ".claude/commands/fix-tests.md": "---\ndescription: Run the tests and fix what fails\n---\nRun the tests. Extra: $ARGUMENTS\n",
  });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home);
  try {
    let at = await t.until(/reads AGENTS\.md\s+·\s+1 skill\s+·\s+1 command of this folder/);
    at = await t.until(/desk ❯ /, at);

    // "/" alone: the list, the first chosen, more below.
    await t.type("/");
    at = await t.until(/❯ \/where \[local\|local\+cloud…\s+where this session works/, at);
    at = await t.until(/commands — keep typing to narrow/, at);
    // Typing narrows it to what matches — the folder's own command too.
    await t.type("fi");
    at = await t.until(/❯ \/fix-tests\s+Run the tests and fix what fails/, at);
    // Esc puts it away; the line stays. Ctrl-C clears the line.
    await t.type("\x1b");
    await t.type("\x03");
    at = await t.until(/desk ❯ /, at);

    // ↓ moves the choice, Tab puts it on the line; a command's word after it runs straight away.
    await t.type("/se");
    at = await t.until(/❯ \/setup/, at);
    await t.type("\x1b[B");
    at = await t.until(/❯ \/sessions/, at);
    await t.type("\x1b[A");
    await t.type("\t");
    await t.type(" skills\r");
    at = await t.until(/\/release-notes\s+Write release notes\./, at);
    at = await t.until(/desk ❯ /, at);

    // Enter on a part of a name runs the chosen command: /setup alone opens its list; Instructions is first.
    await t.type("/setu");
    at = await t.until(/❯ \/setup/, at);
    await t.alone("", at);
    at = await t.until(/AGENTS\.md \d+ tokens/, at);
    at = await t.until(/desk ❯ /, at);

    await t.type("/sessions list\r");
    at = await t.until(/code-me — this session/, at);
    at = await t.until(/desk ❯ /, at);

    // The folder's command: its text goes as the message, with what was typed.
    await t.type("/fix-tests only a.txt\r");
    at = await t.until(/this folder's command · \.claude\/commands\/fix-tests\.md/, at);
    at = await t.until(/send it\? \[y\]es/, at);
    await t.type("y\r");
    at = await t.until(/apply it to/, at);
    await t.type("n\r");
    at = await t.until(/desk ❯ /, at);
    const posts = s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run"));
    assert.equal(posts.length, 1);
    const task = JSON.parse(posts[0]!.body).task as string;
    assert.match(task, /Run the tests\. Extra: only a\.txt$/);
    // The cloud's first message names the instruction file and the skill.
    assert.match(task, /read this folder's instructions and follow them: AGENTS\.md\./);
    assert.match(task, /This folder has skills[^\n]*\.claude\/skills\/release-notes\/SKILL\.md/);

    // The skill by name; the cloud was briefed already, so not again.
    await t.type("/release-notes for 1.0\r");
    at = await t.until(/this folder's skill · \.claude\/skills\/release-notes\/SKILL\.md/, at);
    at = await t.until(/apply it to/, at);
    await t.type("n\r");
    at = await t.until(/desk ❯ /, at);
    const second = JSON.parse(s.seen.filter((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run"))[1]!.body).task as string;
    assert.match(second, /^Use this folder's skill "release-notes"/);
    assert.match(second, /Notes go in NOTES\.md, newest first\./);
    assert.match(second, /What to do with it: for 1\.0$/);

    // A name that is no command: what is near it is offered.
    await t.type("/statu");
    await t.type("\x1b");
    await t.type("s2\r");
    at = await t.until(/\/status2 is not a command — /, at);
    at = await t.until(/write \\\/ first/, at);
    at = await t.until(/desk ❯ /, at);

    const exported = path.join(home, "session.md");
    await t.type(`/export ${exported}\r`);
    at = await t.until(/session\.md — 2 turns/, at);
    assert.match(fs.readFileSync(exported, "utf8"), /## 1\. You \(in the cloud\)/);
    await t.type(`/export ${exported}\r`);
    at = await t.until(/is already there — name another file/, at);
    await t.type("/resume new\r");
    at = await t.until(/a fresh conversation/, at);
    await t.type("/quit\r");
    assert.equal(await t.done, 0);
    if (process.env.SHOW_SCREEN) console.log(t.out());
  } finally {
    t.child.kill();
    s.close();
  }
});

test("on a terminal: /where cloud and /where local+cloud move one session; the other side is told what was done, once; --continue keeps it", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo({ "a.txt": "a\n" });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home, { TERM: "dumb" });
  try {
    let at = await t.until(/desk ❯ /);
    await t.type("/where cloud\r");
    at = await t.until(/already: The cloud/, at);
    await t.type("add b\r");
    at = await t.until(/send it\? \[y\]es/, at);
    await t.type("y\r");
    at = await t.until(/apply it to/, at);
    await t.type("y\r");
    at = await t.until(/desk ❯ /, at);
    await t.type("/where local+cloud\r");
    at = await t.until(/This computer, agents in the cloud from here on/, at);
    at = await t.until(/the agent there is told what the last turn did/, at);
    await t.alone("/status", at);
    at = await t.until(/works\s+on this computer/, at);
    await t.alone("/permissions", at);
    at = await t.until(/sending this folder's files to the cloud/, at);
    await t.type("/permissions reset\r");
    at = await t.until(/every change, command and send is asked again/, at);
    await t.alone("/undo", at);
    at = await t.until(/take back the last change/, at);
    await t.type("y\r");
    at = await t.until(/taken back/, at);
    await t.type("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
  // What the session keeps between starts: where it works, the exchange, how far each side was told.
  const kept = JSON.parse(fs.readFileSync(path.join(home, "code-sessions.json"), "utf8"))[d];
  assert.equal(kept.mode, "local");
  assert.deepEqual(kept.transcript, [{ where: "cloud", you: "add b", agent: "Added b.", applied: false, run: RUN }], "applied, then taken back with /undo");
  assert.match(kept.owner, /^[0-9a-f]{24}$/, "bound to the sign-in it was said under");
  assert.deepEqual(kept.told, { local: 0, cloud: 1 });
  assert.equal(fs.statSync(path.join(home, "code-sessions.json")).mode & 0o077, 0, "private to the person");
});

test("commands that only look run without a question — in the folder, git held to itself; anything the shell could turn into more is asked", (t) => {
  // The machine's own git config is not part of this test: a CI runner has
  // Git LFS in /etc/gitconfig, and with any filter configured status and
  // diff are asked — which is the rule, tested further down (CI, 23 Nov 2026).
  const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-gitcfg-")), "config");
  fs.writeFileSync(emptyConfig, "");
  const kept = { system: process.env.GIT_CONFIG_NOSYSTEM, global: process.env.GIT_CONFIG_GLOBAL };
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_CONFIG_GLOBAL = emptyConfig;
  t.after(() => {
    for (const [k, v] of [["GIT_CONFIG_NOSYSTEM", kept.system], ["GIT_CONFIG_GLOBAL", kept.global]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const d = fs.realpathSync(repo({ "src/a.ts": "a\n", "it's.txt": "x\n" }));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-out-"));
  fs.symlinkSync(outside, path.join(d, "link"));
  const at = `(cd '${d}' && `;
  // A filter program in the person's own config (Git LFS): what reads the working files is asked.
  fs.writeFileSync(emptyConfig, "[filter \"lfs\"]\n\tclean = git-lfs clean -- %f\n");
  assert.equal(readOnlyCommand("git status --short", d), null);
  assert.notEqual(readOnlyCommand("git log -3", d), null);
  fs.writeFileSync(emptyConfig, "");
  const git = "git --no-pager --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -c log.showSignature=false ";
  assert.equal(readOnlyCommand("pwd", d), `${at}pwd)`);
  assert.equal(readOnlyCommand("  date -u ", d), `${at}date -u)`);
  assert.equal(readOnlyCommand("ls -la src", d), `${at}ls -la src)`);
  assert.equal(readOnlyCommand("git status --short", d), `${at}${git}status --ignore-submodules=all --short)`);
  assert.equal(readOnlyCommand("git diff HEAD~2..HEAD -- src/a.ts", d), `${at}${git}diff --no-ext-diff --no-textconv --ignore-submodules=all HEAD~2..HEAD -- src/a.ts)`);
  assert.equal(readOnlyCommand("git log -p -3", d), `${at}${git}log --no-ext-diff --no-textconv -p -3)`);
  assert.equal(readOnlyCommand("git show HEAD:src/a.ts", d), `${at}${git}show --no-ext-diff --no-textconv HEAD:src/a.ts)`);
  assert.equal(readOnlyCommand("git branch --show-current", d), `${at}${git}branch --show-current)`);
  // A folder whose path has a quote in it is still one word to the shell.
  assert.equal(readOnlyCommand("pwd", "/work/it's here"), "(cd '/work/it'\\''s here' && pwd)");
  for (const asked of [
    "git status; rm -rf x", "git status && curl x", "git log | sh", "ls > out", "ls $(whoami)", "ls `id`", "ls *", "ls 'a b'", "ls a\\b", "git status\nrm x",
    "ls /etc", "ls ~", "ls ../other", "ls src/../../x", "ls link", "ls link/", "ls -R", "ls -L src", "ls nothing-here",
    "git show HEAD:../../secret", "git diff --no-index a b", "git diff --output=x", "git log --output=x", "git log --outp=x", "git log --ext-diff", "git log --format=x",
    "git -c core.pager=sh status", "git -C /tmp status", "git show --textconv", "git branch new-branch", "git branch -D main", "git push", "git commit -m x", "git checkout .",
    "git status --anything", "git diff -O x", "git log -S x", "git rev-parse --git-dir",
    "date -s 2020", "cat .env", "rm x", "npm test", "FOO=1 ls", "", "x".repeat(401),
  ]) assert.equal(readOnlyCommand(asked, d), null, asked);
  assert.equal(readOnlyCommand(undefined, d), null);
  // A repository whose own config names a program for git to run: every git lookup is asked.
  const run = (...a: string[]) => assert.equal(spawnSync("git", ["-C", d, ...a]).status, 0);
  run("config", "filter.x.clean", "sh -c 'touch owned'");
  assert.equal(readOnlyCommand("git status", d), null, "a filter in the repository's config");
  run("config", "--unset", "filter.x.clean");
  assert.notEqual(readOnlyCommand("git status", d), null);
  run("config", "include.path", "../evil");
  assert.equal(readOnlyCommand("git log -1", d), null, "an include in the repository's config");
  // A filter program configured anywhere (Git LFS in the person's own config): what reads the working files is asked, history is not.
  run("config", "--unset", "include.path");
  const lfs = { ...process.env };
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "user.name";
  process.env.GIT_CONFIG_VALUE_0 = "x";
  assert.notEqual(readOnlyCommand("git status", d), null, "a plain name from the environment");
  process.env.GIT_CONFIG_KEY_0 = "filter.lfs.clean";
  assert.equal(readOnlyCommand("git status", d), null);
  assert.equal(readOnlyCommand("git diff", d), null);
  assert.equal(readOnlyCommand("git log -1", d), null, "the environment's config is not the person's own file");
  process.env = lfs;
  // One package of a larger repository: git would show its neighbours.
  fs.mkdirSync(path.join(d, "pkg"));
  assert.equal(readOnlyCommand("git log -1", path.join(d, "pkg")), null);
  assert.equal(readOnlyCommand("ls", path.join(d, "pkg")), `(cd '${path.join(d, "pkg")}' && ls)`);
  // Not a repository: git is asked, the rest is not.
  assert.equal(readOnlyCommand("git status", outside), null);
  assert.equal(readOnlyCommand("ls", outside), `(cd '${outside}' && ls)`);
});

test("a goal: the reply's last line says whether it is met; anything else hands back to the person", () => {
  assert.equal(goalVerdict("Fixed it.\n\nGOAL MET"), "met");
  assert.equal(goalVerdict("Fixed it.\n**GOAL MET.**"), "met");
  assert.equal(goalVerdict("Half way.\nGOAL NOT MET: the tests still fail"), "not-met");
  assert.equal(goalVerdict("GOAL MET\nbut then more text"), "unsaid");
  assert.equal(goalVerdict("The goal met its end."), "unsaid");
  assert.equal(goalVerdict(""), "unsaid");
});

test("/usage: the plan and what is left, only what the platform answered", () => {
  const plain = (x: string) => x.replace(/\x1b\[[0-9;]*m/g, "");
  const full = plain(usageBlock({ credits: { pots: { planUsd: 872.941, boughtUsd: 50 }, plan: { name: "Scale", paysForTokens: false, resetsAt: "2026-12-13T15:33:54.587Z" } } }));
  assert.match(full, /plan\s+Scale — model calls are paid from the balance/);
  assert.match(full, /plan credit\s+\$872\.94 left — resets 2026-12-13/);
  assert.match(full, /bought credit\s+\$50\.00 left/);
  const none = plain(usageBlock({}));
  assert.match(none, /plan\s+not told by the platform/);
  assert.doesNotMatch(none, /\$/, "no number is made up");
});

test("on a terminal: /goal keeps the agent going until it says the goal is met; /status context, /plan and /compact answer", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo({ "a.txt": "a\n" });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const tasks: string[] = [];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: false }),
    [`POST ${WS}/agents/coder/run`]: (b: any) => {
      tasks.push(String(b.task ?? b.input ?? JSON.stringify(b)));
      return { ok: true, runId: RUN, snapshot: ID, context: "code-me" };
    },
    [`GET ${WS}/runs/${RUN}`]: () => {
      const said = tasks.length < 3 ? `Step ${tasks.length}.\nGOAL NOT MET: more to do` : "All done and checked.\nGOAL MET";
      return {
        id: RUN, flow: "adhoc:coder", status: "completed", snapshot: { id: ID }, startedAt: "2026-11-24T01:00:00.000Z", finishedAt: "2026-11-24T01:00:05.000Z",
        steps: [{ agent: "coder", group: 1, status: "completed", attempts: 1, costUsd: 0.02, tokens: { input: 48000, output: 100, cacheRead: 24000, cacheWrite: 24000 }, calls: [{ n: 1 }, { n: 2 }], events: [{ t: "2026-11-24T01:00:01.000Z", type: "text", text: said }], result: said }],
      };
    },
    [`GET ${WS}/runs/${RUN}/archive`]: () => raw(JSON.stringify({ status: "unchanged" }), "application/json"),
    [`GET ${WS}/sessions/code-me/messages`]: () => ({ messages: [] }),
  });
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-me", "--url", s.url, "--token", "k"], home, { TERM: "dumb" });
  try {
    let at = await t.until(/desk ❯ /);
    await t.type("/goal\r");
    at = await t.until(/no goal set/, at);
    await t.type("/goal the tests pass\r");
    at = await t.until(/goal set/, at);
    at = await t.until(/send it\? \[y\]es/, at);
    await t.type("y\r");
    // What a turn read, and how much of it was cached.
    at = await t.until(/read 48k tokens \(24k cached\) in 2 model calls/, at);
    at = await t.until(/goal not met yet — going on \(2 of 8\)/, at);
    at = await t.until(/goal not met yet — going on \(3 of 8\)/, at);
    at = await t.until(/having it checked once more before that is accepted/, at);
    at = await t.until(/goal met, and checked a second time: the tests pass/, at);
    at = await t.until(/desk ❯ /, at);
    await t.type("/goal\r");
    at = await t.until(/no goal set/, at);
    await t.type("/status context\r");
    at = await t.until(/in the cloud\s+the agent reads desk's own context there/, at);
    at = await t.until(/billed at the model.s cached rate/, at);
    await t.type("/plan how would you add c\r");
    at = await t.until(/\/plan works on this computer/, at);
    await t.type("/compact\r");
    at = await t.until(/the cloud keeps the conversation itself/, at);
    await t.type("/where local+cloud\r");
    at = await t.until(/This computer, agents in the cloud from here on/, at);
    await t.type("/status context\r");
    at = await t.until(/instructions\s+none in this folder/, at);
    at = await t.until(/conversation\s+not opened yet/, at);
    await t.type("/compact\r");
    at = await t.until(/nothing to shorten yet/, at);
    await t.alone("/permissions", at);
    at = await t.until(/commands that only look: pwd, date, ls, and git status/, at);
    await t.type("/permissions strict\r");
    at = await t.until(/the commands that only look are asked too/, at);
    await t.type("/setup check\r");
    at = await t.until(/✓ git\s/, at);
    at = await t.until(/✓ folder\s[^\n]*a git repository/, at);
    at = await t.until(/✓ project\s+desk with the agent coder/, at);
    at = await t.until(/desk ❯ /, at);
    await t.type("/resume all\r");
    at = await t.until(/no earlier conversation of this folder is kept/, at);
    await t.type("/resume new\r");
    at = await t.until(/a fresh conversation[^\n]*\/resume goes back to one/, at);
    await t.alone("/resume", at);
    at = await t.until(/ 1  \/goal the tests pass/, at);
    await t.type("/resume 1\r");
    at = await t.until(/back in: \/goal the tests pass/, at);
    await t.alone("/status", at);
    at = await t.until(/session\s+code-me/, at);
    // Back where that conversation was worked on, whatever side the session had moved to.
    at = await t.until(/works\s+in the cloud/, at);
    await t.type("/resume new\r");
    at = await t.until(/a fresh conversation/, at);
    await t.type("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
  assert.equal(tasks.length, 4, "four turns: the first, two the session sent by itself, and the check");
  for (const task of tasks) assert.match(task, /The person set a goal for this session: the tests pass/);
  assert.match(tasks[1]!, /Go on toward the goal\./);
  assert.match(tasks[3]!, /check it once more from the start/);
  // /resume new kept the conversation it left; --continue has it for /resume.
  const kept = JSON.parse(fs.readFileSync(path.join(home, "code-sessions.json"), "utf8"))[d];
  assert.equal(kept.past.length, 1);
  assert.equal(kept.past[0].context, "code-me");
  assert.equal(kept.past[0].said, "/goal the tests pass", "its first message, kept with it");
  // A plain start (no --continue) keeps the list.
  const s3 = await platform();
  const all = JSON.parse(fs.readFileSync(path.join(home, "code-sessions.json"), "utf8"));
  all[d].url = s3.url;
  fs.writeFileSync(path.join(home, "code-sessions.json"), JSON.stringify(all), { mode: 0o600 });
  const again = onTerminal(["code", d, "--cloud", "--to", "desk", "--url", s3.url, "--token", "k"], home, { TERM: "dumb" });
  try {
    const at3 = await again.until(/desk ❯ /);
    await again.alone("/resume", at3);
    await again.until(/ 1  \/goal the tests pass/, at3);
    await again.type("/quit\r");
    await again.done;
  } finally {
    again.child.kill();
    s3.close();
  }
});

test("a session message is sent exactly as it was shown: an id, plain text, 4,000 characters at most — a hidden character or a long id is refused, never cleaned for the screen only", () => {
  assert.deepEqual(sessionMessageOf({ to: "code-1a2b", text: "  add is fixed\r\nwhich python?  " }, "code-me"), { to: "code-1a2b", text: "add is fixed\nwhich python?" });
  for (const bad of [{ to: "code-me", text: "x" }, { to: "../x", text: "x" }, { to: `c${"a".repeat(128)}`, text: "x" }, { to: "code-1", text: "" }, { to: "code-1", text: "x".repeat(4_001) }, { to: "code-1", text: "ok\u001b[2Jhidden" }, { to: "code-1", text: "pay \u202Eevil" }, { to: "code-1", text: "zero\u200Bwidth" }, { to: "code-1", text: "tag\u{E0041}s" }, {}, null]) {
    assert.ok("problem" in sessionMessageOf(bad, "code-me"), JSON.stringify(bad));
  }
});

test("--continue keeps what the session carried even when it is left at once; /review in the cloud says where a review can run", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo({ "a.txt": "a\n" });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const file = path.join(home, "code-sessions.json");
  fs.writeFileSync(file, JSON.stringify({ [d]: { context: "code-me", ws: "desk", agent: "coder", url: s.url, mode: "cloud", transcript: [{ where: "cloud", you: "add b", agent: "Added b.", applied: true }], told: { local: 0, cloud: 1 }, shown: ["m1"], owner: OWNER_K, at: "2026-11-24T00:00:00.000Z" } }), { mode: 0o600 });
  const t = onTerminal(["code", d, "--continue", "--to", "desk", "--url", s.url, "--token", "k"], home, { TERM: "dumb" });
  try {
    let at = await t.until(/session code-me · continuing/);
    at = await t.until(/desk ❯ /, at);
    await t.type("/review\r");
    at = await t.until(/a review needs the folder's git history/, at);
    await t.type("/status cost\r");
    at = await t.until(/0 turns in the cloud in this conversation, since this terminal opened it/, at);
    await t.type("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
  const kept = JSON.parse(fs.readFileSync(file, "utf8"))[d];
  assert.deepEqual(kept.transcript, [{ where: "cloud", you: "add b", agent: "Added b.", applied: true }]);
  assert.deepEqual(kept.told, { local: 0, cloud: 1 });
  assert.deepEqual(kept.shown, ["m1"]);
  assert.equal(kept.briefed, undefined, "the cloud was never briefed in this conversation, and that is not guessed");

  // Another sign-in continuing the same folder gets none of it.
  const s2 = await platform();
  const all = JSON.parse(fs.readFileSync(file, "utf8"));
  all[d].url = s2.url;
  fs.writeFileSync(file, JSON.stringify(all), { mode: 0o600 });
  const other = onTerminal(["code", d, "--continue", "--to", "desk", "--url", s2.url, "--token", "another-account"], home, { TERM: "dumb" });
  try {
    const at2 = await other.until(/desk ❯ /);
    await other.type(`/export ${path.join(home, "other.md")}\r`);
    await other.until(/nothing to write yet/, at2);
    await other.type("/quit\r");
    await other.done;
  } finally {
    other.child.kill();
    s2.close();
  }
});

test("on a terminal, in the cloud: the session's todo list goes with the turn and comes back as the cloud agent left it; a goal's check runs here on the folder the applied patch left", { skip: hasPty ? false : "needs python3's pty", timeout: 90_000 }, async () => {
  const d = repo({ "a.txt": "a\n" });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const said = "Added b to a.txt.\n\nTODOS:\n- [x] write b\n- [ ] tell the team\nGOAL MET";
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => ({ ok: true, runId: RUN, snapshot: ID, context: "code-td" }),
    [`GET ${WS}/runs/${RUN}`]: () => ({
      id: RUN, flow: "adhoc:coder", status: "completed", snapshot: { id: ID }, startedAt: "2026-11-24T01:00:00.000Z", finishedAt: "2026-11-24T01:00:05.000Z",
      steps: [{ agent: "coder", group: 1, status: "completed", attempts: 1, costUsd: 0.02, events: [{ t: "2026-11-24T01:00:01.000Z", type: "text", text: said }], result: said }],
    }),
    [`GET ${WS}/runs/${RUN}/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "changed" }), "application/json") : raw(PATCH, "text/x-diff")),
    [`GET ${WS}/sessions/code-td/messages`]: () => ({ messages: [] }),
  });
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-td", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/desk ❯ /);
    await t.alone("/todos", at);
    at = await t.until(/no todo list/, at);
    await t.type("/todos add write b\r");
    at = await t.until(/○ write b/, at);
    await t.type('/goal --check "grep -q b a.txt" a.txt holds b\r');
    at = await t.until(/\$ grep -q b a\.txt[\s\S]*only when it exits 0\? \[y\/N\]/, at);
    await t.type("y\r");
    at = await t.until(/send it\? \[y\]es/, at);
    await t.type("y\r");
    at = await t.until(/apply it to/, at);
    await t.type("y\r");
    at = await t.until(/the todo list, as the cloud agent left it:[\s\S]*✔ write b[\s\S]*○ tell the team/, at);
    at = await t.until(/running your check: grep -q b a\.txt/, at);
    at = await t.until(/check passed \(exit 0\)/, at);
    at = await t.until(/desk ❯ /, at);
    await t.type("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
  const sent = JSON.parse(s.seen.find((x) => x.method === "POST" && x.url === `${WS}/agents/coder/run`)!.body).task;
  assert.match(sent, /This session keeps a todo list\. As it stands:\n- \[ \] write b\n/);
  assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "a\nb\n");
  // Kept for --continue, as the cloud agent left it.
  const kept = JSON.parse(fs.readFileSync(path.join(home, "code-sessions.json"), "utf8"))[d];
  assert.deepEqual(kept.todos, [{ content: "write b", status: "completed" }, { content: "tell the team", status: "pending" }]);
});
