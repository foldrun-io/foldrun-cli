// `foldrun code --resources cpu=1,memory=1Gi` and `--no-resources` (FOL-330): the start question is not asked, the
// figures are in force for the session and not kept, and a value that cannot be read is refused — never ignored.
// Its own file: the PTY tests of cli-code-session.test.ts already come near the per-file time limit on CI.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { serve } from "./fake-platform.ts";

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


// FOL-240's core module ships in a newer core than the one installed until the CLI's range moves.
const coreResources = await import("@foldrun/core/local-resources" as string).then(() => true, () => false);
const skip = !coreResources ? "needs a core with local-resources (FOL-240)" : !hasPty ? "needs python3's pty" : false;

async function platform() {
  return serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-r330/messages`]: () => ({ messages: [] }),
    [`GET ${WS}/source`]: () => ({ content: "" }),
    "GET /v1/account/agents-md": () => ({ content: "" }),
  });
}

test("--resources sets the budget for this session: no start question, shown as in force, not kept (FOL-330)", { skip, timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--resources", "cpu=1,memory=1Gi", "--context", "code-r330", "--url", s.url, "--token", "k"], home, { COLUMNS: "200", FOLDRUN_CODE_RESOURCES: "" });
  try {
    let at = await t.until(/\w ❯ /, 0, 30_000);
    assert.doesNotMatch(t.out(), /How much of this computer may foldrun use\?/, "the flag answers it");
    t.send("/permissions resources\r");
    at = await t.until(/allowed +1 core, 1 GiB \(--resources\)/, at);
    at = await t.until(/memory in force 1 GiB/, at);
    t.send("/permissions resources save\r");
    at = await t.until(/not kept — --resources sets this computer's budget for this session/, at);
    t.send("/quit\r");
    await t.done;
    assert.equal(spawnSync("grep", ["-rl", "memory=", home]).status, 1, "nothing kept for this computer");
  } finally {
    t.child.kill();
    s.close();
  }
});

test("--no-resources: no start question, no limit this session, and it does not take the folder after it (FOL-330)", { skip, timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const t = onTerminal(["code", "--no-resources", d, "--local", "--to", "desk", "--context", "code-r330", "--url", s.url, "--token", "k"], home, { COLUMNS: "200", FOLDRUN_CODE_RESOURCES: "" });
  try {
    let at = await t.until(/\w ❯ /, 0, 30_000);
    assert.doesNotMatch(t.out(), /How much of this computer may foldrun use\?/);
    t.send("/permissions resources\r");
    at = await t.until(/allowed +no limit, no limit \(--no-resources\)/, at);
    t.send("/quit\r");
    await t.done;
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a --resources that cannot be read, or contradicts --no-resources, is refused with its reason (FOL-330)", { skip: coreResources ? false : "needs a core with local-resources (FOL-240)", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await platform();
  const cli = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
  const run = (...flags: string[]) => spawnSync(process.execPath, [cli, "code", d, "--local", "--to", "desk", ...flags, "--task", "hi", "--url", s.url, "--token", "k"], { encoding: "utf8", env: { ...outerEnv(), FOLDRUN_CODE_SANDBOX: "off", FOLDRUN_HOME: home, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", FOLDRUN_CODE_RESOURCES: "", NO_COLOR: "1" }, timeout: 30_000 });
  try {
    for (const [flags, want] of [
      [["--resources", "banana"], /--resources: "banana" — write cpu=2,memory=4Gi, or off/],
      [["--resources", "cpu=999"], /--resources: cpu=999 — between 0\.5 and this computer's/],
      [["--resources"], /--resources needs a value/],
      [["--resources", "off", "--no-resources"], /--resources and --no-resources together/],
    ] as [string[], RegExp][]) {
      const r = run(...flags);
      assert.notEqual(r.status, 0, flags.join(" "));
      assert.match(r.stdout + r.stderr, want, flags.join(" "));
    }
  } finally {
    s.close();
  }
});
