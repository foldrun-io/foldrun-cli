// koder's mark (FOL-415): its own file, so cli-code-session.test.ts stays under the per-file limit on CI.
// In a real terminal (a pty, through python3's pty module); the helpers are cli-code-session.test.ts's.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { serve, raw } from "./fake-platform.ts";
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

test("/status attribution off|on (FOL-415): koder's mark on commits, pull requests, issues and exports; kept for the person, on by default", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-at", "--url", s.url, "--token", "k"], home, { TERM: "xterm-256color", FOLDRUN_NO_TICKER: "1", NO_COLOR: "1", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("/status attribution\r");
    at = await t.until(/koder's mark is on · \/status attribution off/, at);
    t.send("/status attribution off\r");
    at = await t.until(/koder's mark off/, at);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, "code-prefs.json"), "utf8")).attribution, false, "kept for the person");
    t.send("/status attribution on\r");
    at = await t.until(/koder's mark on — commits end with Co-Authored-By: koder <noreply@foldrun\.io>/, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "code-prefs.json"), "utf8")).attribution, undefined, "on again: nothing kept");
  const { attributionNote, KODER_TRAILER, KODER_SIGNATURE } = await import("../src/code-session.mjs");
  assert.equal(KODER_TRAILER, "Co-Authored-By: koder <noreply@foldrun.io>");
  assert.match(attributionNote(), /end it with a blank line and this trailer: Co-Authored-By: koder <noreply@foldrun\.io>/);
  assert.ok(attributionNote().includes(KODER_SIGNATURE));
  // The logo is foldrun's mark from foldrun.io, a picture GitHub draws (FOL-415).
  assert.match(KODER_SIGNATURE, /^<img src="https:\/\/foldrun\.io\/favicon\.svg" width="16" height="16" alt="koder"> Generated with \[koder\]\(https:\/\/foldrun\.io\) from foldrun\.io$/);
  const logo = await fetch("https://foldrun.io/favicon.svg").then((r) => r.ok ? r.headers.get("content-type") : null, () => "offline");
  if (logo !== "offline") assert.match(String(logo), /^image\/svg\+xml/, "the logo's address answers with a picture");
  assert.equal(attributionNote(false), "");
  for (const mark of [attributionNote(), KODER_SIGNATURE]) assert.doesNotMatch(mark, /claude|anthropic/i, "never another product's name in koder's marks");
});
