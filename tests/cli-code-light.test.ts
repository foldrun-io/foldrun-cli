// FOL-273: foldrun code stays light, and leaves nothing running. An idle
// session and one after a turn on this computer are held under a ceiling of
// modules loaded and memory used — what FOL-265 cut, so a change that pulls
// all of core (or a heavy library) back onto the start or a turn fails here
// instead of in someone's terminal. And after /quit, nothing the session
// started is still running.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { serve, raw } from "./fake-platform.ts";

const WS = "/v1/workspaces/desk";
const CLI = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
const PROBE = path.join(import.meta.dirname, "fixtures", "weight-probe.mjs");
const hasPty = spawnSync("python3", ["-c", "import pty"]).status === 0 && process.platform !== "win32";
const hasHooks = typeof (module as unknown as { registerHooks?: unknown }).registerHooks === "function";
const skip = !hasPty ? "needs python3's pty" : !hasHooks ? "needs module.registerHooks (Node 22.15+)" : false;

function repo(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-code-light-"));
  const git = (...a: string[]) => execFileSync("git", ["-C", d, "-c", "user.email=t@t", "-c", "user.name=t", ...a]);
  git("init", "-q");
  fs.writeFileSync(path.join(d, "a.txt"), "a\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  return d;
}

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

function onTerminal(args: string[], home: string, out: string) {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.BASH_ENV;
  delete env.ENV;
  const child = spawn("python3", ["-c", "import pty,sys; sys.exit(pty.spawn(sys.argv[1:]) >> 8)", process.execPath, "--import", PROBE, CLI, ...args], {
    env: { ...env, FOLDRUN_CODE_SANDBOX: "off", FOLDRUN_HOME: home, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1", SHELL: "/bin/sh", TERM: "dumb", FOLDRUN_NO_AUTO_UPDATE: "1", FOLDRUN_WEIGHT_OUT: out },
  });
  let screen = "";
  child.stdout.on("data", (x) => (screen += x));
  child.stderr.on("data", (x) => (screen += x));
  const done = new Promise<number>((r) => child.on("close", (code) => r(code ?? 1)));
  const until = async (re: RegExp, from = 0, ms = 20_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const m = re.exec(screen.slice(from));
      if (m) return from + m.index + m[0].length;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`waited for ${re} — the screen:\n${screen}`);
  };
  return { send: (t: string) => child.stdin.write(t), until, done, child, screen: () => screen };
}

async function localPlatform(model: (n: number) => ReturnType<typeof raw>) {
  let calls = 0;
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: default\n---\nYou code.\n", sha256: "x" }),
    [`GET ${WS}/sessions/code-lt/messages`]: () => ({ messages: [] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/messages": () => model(++calls),
  });
  return s;
}

const seedKey = (home: string, url: string) =>
  fs.writeFileSync(path.join(home, "code-local-keys.json"), JSON.stringify({ [`${url}#acme`]: { id: "key-1", key: "fr_gw_test", gatewayUrl: url, kind: "account" } }), { mode: 0o600 });

type Weight = { modules: number; builtin: number; rssMb: number; heapMb: number; urls: string[] };
const weigh = (f: string): Weight => JSON.parse(fs.readFileSync(f, "utf8"));

// Ceilings, set 24 Nov 2026 from what was measured on macOS (Node 26):
// idle 38 modules (14 of them node: built-ins), 45 MB resident, 13 MB heap;
// after one turn 50 modules, 51 MB, 16 MB. The module counts are the sharp
// edge — they do not move with the machine — and sit about 50% above what
// was measured; memory gets a wide margin, since CI machines differ.
const CEILING = {
  idle: { modules: 60, heapMb: 40, rssMb: 160 },
  turn: { modules: 80, heapMb: 60, rssMb: 200 },
};
/** What FOL-265 took off the start and the turn: never loaded by either. */
const NEVER = [/@foldrun\/core\/dist\/index\.js$|core[^/]*\/dist\/index\.js$/, /engine-mcp\.js$/, /step-exec\.js$/, /runner\.js$/];

test("an idle session and one after a turn on this computer stay under their ceilings, and never load all of core", { skip, timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await localPlatform(() => sse([{ type: "text", text: "Done." }]));
  seedKey(home, s.url);
  const idleOut = path.join(home, "idle.json");
  const turnOut = path.join(home, "turn.json");
  try {
    const args = ["code", d, "--local", "--to", "desk", "--context", "code-lt", "--url", s.url, "--token", "k"];
    const a = onTerminal(args, home, idleOut);
    await a.until(/\w ❯ /);
    a.send("/quit\r");
    assert.equal(await a.done, 0, a.screen());
    const b = onTerminal([...args, "--continue"], home, turnOut);
    let at = await b.until(/\w ❯ /);
    b.send("hello\r");
    at = await b.until(/Done\./, at, 30_000);
    await b.until(/\w ❯ /, at);
    b.send("/quit\r");
    assert.equal(await b.done, 0, b.screen());
    for (const [kind, file] of [["idle", idleOut], ["turn", turnOut]] as const) {
      const w = weigh(file);
      const max = CEILING[kind];
      const said = `${kind}: ${w.modules} modules, ${w.rssMb} MB resident, ${w.heapMb} MB heap`;
      assert.ok(w.modules <= max.modules, `${said} — over ${max.modules} modules`);
      assert.ok(w.heapMb <= max.heapMb, `${said} — over ${max.heapMb} MB heap`);
      assert.ok(w.rssMb <= max.rssMb, `${said} — over ${max.rssMb} MB resident`);
      for (const re of NEVER) assert.ok(!w.urls.some((u) => re.test(u)), `${kind} loaded ${w.urls.find((u) => re.test(u))}`);
    }
  } finally {
    s.close();
  }
});

test("nothing a turn started is left running: a command that leaves a job in the background returns at once, and the job is gone by the next prompt and after /quit", { skip, timeout: 90_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  // A number no other process on the machine is likely to sleep for.
  const secs = String(3000 + Math.floor(Math.random() * 900));
  // Exactly this command line, nothing that merely contains it (Codex).
  const running = () => spawnSync("pgrep", ["-f", `^sleep ${secs}$`], { encoding: "utf8" }).stdout.trim();
  const s = await localPlatform((n) => (n === 1 ? sse([{ type: "tool_use", id: "b1", name: "Bash", input: { command: `sleep ${secs} & echo started` } }]) : sse([{ type: "text", text: "Started it." }])));
  seedKey(home, s.url);
  let t: ReturnType<typeof onTerminal> | undefined;
  try {
    t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-lt", "--url", s.url, "--token", "k"], home, path.join(home, "w.json"));
    let at = await t.until(/\w ❯ /);
    t.send("start it\r");
    at = await t.until(/allow\? \[y\]es/, at, 30_000);
    const asked = Date.now();
    t.send("y\r");
    // Not the Bash timeout (two minutes): the call returned when the shell ended.
    at = await t.until(/Started it\./, at, 15_000);
    assert.ok(Date.now() - asked < 15_000);
    at = await t.until(/\w ❯ /, at);
    assert.equal(running(), "", "the job ended with the turn");
    t.send("/quit\r");
    assert.equal(await t.done, 0, t.screen());
    assert.equal(running(), "", "and nothing after /quit");
  } finally {
    t?.child.kill();
    for (const pid of running().split("\n").filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        /* gone */
      }
    }
    s.close();
  }
});
