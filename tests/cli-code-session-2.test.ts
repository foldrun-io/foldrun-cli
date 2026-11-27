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
import {serve, raw} from "./fake-platform.ts";
import {rememberSession} from "../src/code-session.mjs";
import {folderChoice, isLeave} from "../src/code-session.mjs";

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

test("/update: its list, check, and auto-update off and on, kept for every foldrun on this computer (FOL-335)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  // npm, as foldrun asks it: `view foldrun version` says a newer one is out.
  const npmDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-npm-"));
  const npm = path.join(npmDir, "npm");
  fs.writeFileSync(npm, `#!${process.execPath}\nif (process.argv[2] === "view") { console.log("999.0.0"); process.exit(0); }\nprocess.exit(1);\n`, { mode: 0o755 });
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\n---\n", sha256: "x" }),
    [`GET ${WS}/sessions/code-up/messages`]: () => ({ messages: [] }),
    "GET /v1/me": () => ({ account: "acme", actor: { kind: "key", id: "login-1", modelAccess: { capUsd: null, dailyUsd: 100, walletUsd: 0 } }, modelsUrl: s.url }),
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-up", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200", FOLDRUN_NPM: npm, FOLDRUN_HOME: home });
  try {
    let at = await t.until(/session\s+code-up · new[\s\S]*\w ❯ /);
    // Alone: its list; Esc changes nothing.
    t.send("/update\r");
    at = await t.until(/Update foldrun[\s\S]*Update to the latest[\s\S]*Check for a new release[\s\S]*Turn auto-update off\s+now on[\s\S]*Start again/, at);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\x1b");
    at = await t.until(/nothing changed[\s\S]*\w ❯ /, at);
    t.send("/update check\r");
    at = await t.until(/foldrun 999\.0\.0 is out[^\n]*a major version[^\n]*\/update now takes it · auto-update on/, at);
    t.send("/update auto off\r");
    at = await t.until(/auto-update off — nothing installs by itself/, at);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "update.json"), "utf8")), { auto: false });
    // The list says what it is now.
    t.send("/update\r");
    at = await t.until(/Turn auto-update on\s+now off/, at);
    await new Promise((r) => setTimeout(r, 100));
    t.send("\x1b");
    at = await t.until(/nothing changed[\s\S]*\w ❯ /, at);
    t.send("/update auto on\r");
    at = await t.until(/auto-update on — foldrun looks for a newer release once a day/, at);
    t.send("/update sideways\r");
    at = await t.until(/\/update has no sideways — \/update now · check · auto on\|off · restart/, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "update.json"), "utf8")), { auto: true });
  // foldrun update reads the same setting.
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, "..", "bin/foldrun.mjs"), "update", "--auto"], { encoding: "utf8", env: { ...process.env, FOLDRUN_HOME: home } });
  assert.match(r.stdout, /auto-update is on/);
});

test("/update restart starts foldrun again on the same folder, place and conversation (FOL-261, FOL-335)", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
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
      // The first turn runs a slow command, so /update restart can be typed while it runs.
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
    await typeThenEnter("/update restart");
    at = await t.until(/⏭ \/update restart · runs after this turn/, at);
    await typeThenEnter("/update restart");
    at = await t.until(/foldrun starts again after this turn already/, at);
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
    t.send("/update restart\r");
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
  assert.doesNotMatch(JSON.stringify(asked[1].messages), /\/update restart/, "never words for the agent");
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

test("one change across two files (FOL-294): asked once with every change shown, applied together, /undo takes both back", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-many-"));
  fs.writeFileSync(path.join(d, "a.txt"), "old name here\n");
  fs.writeFileSync(path.join(d, "b.txt"), "calls old name\n");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "r1", name: "Read", input: { file_path: path.join(d, "a.txt") } }, { type: "tool_use", id: "r2", name: "Read", input: { file_path: path.join(d, "b.txt") } }]),
    () => sse([{ type: "tool_use", id: "e1", name: "Edit", input: { edits: [
      { file_path: path.join(d, "a.txt"), old_string: "old name", new_string: "new name" },
      { file_path: path.join(d, "b.txt"), old_string: "old name", new_string: "new name" },
    ] } }]),
    () => sse([{ type: "text", text: "Renamed in both." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: fast\n---\nYou code.\n", sha256: "x" }),
    [`GET ${WS}/sessions/code-m294/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local-only", "--to", "desk", "--context", "code-m294", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("rename it\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/2 changes in 2 files — all applied, or none[\s\S]*a\.txt[\s\S]*- old name[\s\S]*\+ new name[\s\S]*b\.txt[\s\S]*- old name[\s\S]*allow\?/, at, 30_000);
    t.send("y\r");
    at = await t.until(/Renamed in both\.[\s\S]*\w ❯ /, at, 30_000);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "new name here\n", t.out().slice(-2500));
    assert.equal(fs.readFileSync(path.join(d, "b.txt"), "utf8"), "calls new name\n");
    t.send("/undo 1\r");
    at = await t.until(/a\.txt — put back as it was before[\s\S]*b\.txt — put back as it was before[\s\S]*\[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/\w ❯ /, at);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "old name here\n");
    assert.equal(fs.readFileSync(path.join(d, "b.txt"), "utf8"), "calls old name\n");
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a patch that was refused is not reported as a change (FOL-294): a file changed after it was read leaves both files as they were and no 'changed' line", { skip: hasPty ? false : "needs python3's pty", timeout: 120_000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-stale-"));
  fs.writeFileSync(path.join(d, "a.txt"), "alpha\n");
  fs.writeFileSync(path.join(d, "b.txt"), "beta\n");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "r1", name: "Read", input: { file_path: path.join(d, "a.txt") } }, { type: "tool_use", id: "r2", name: "Read", input: { file_path: path.join(d, "b.txt") } }]),
    () => {
      // Someone else changes a.txt after the agent read it: the patch below is stale.
      fs.writeFileSync(path.join(d, "a.txt"), "alpha CHANGED OUTSIDE\n");
      return sse([{ type: "tool_use", id: "e1", name: "Edit", input: { edits: [
        { file_path: path.join(d, "a.txt"), old_string: "alpha\n", new_string: "A1\n" },
        { file_path: path.join(d, "b.txt"), old_string: "beta", new_string: "B1" },
      ] } }]);
    },
    () => sse([{ type: "text", text: "It was refused." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/source`]: () => ({ path: "agents/coder/agent.md", content: "---\nname: coder\nmodel: fast\n---\nYou code.\n", sha256: "x" }),
    [`GET ${WS}/sessions/code-m294s/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local-only", "--to", "desk", "--context", "code-m294s", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("change both\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/2 changes in 2 files — all applied, or none[\s\S]*allow\?/, at, 30_000);
    t.send("y\r");
    at = await t.until(/It was refused\.[\s\S]*\w ❯ /, at, 30_000);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "alpha CHANGED OUTSIDE\n", "the stale patch changed nothing");
    assert.equal(fs.readFileSync(path.join(d, "b.txt"), "utf8"), "beta\n", "all or none: b.txt is as it was");
    assert.doesNotMatch(t.out().slice(at - 1500), /changed a\.txt|\/diff shows it/, "no line says a file changed");
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t.child.kill();
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
    at = await t.until(/This computer only; the web on this computer — \/where local · local\+cloud · cloud · send <task> · web here\|cloud/, at);
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
    // It answered at once (FOL-382): the agent collects the job.
    () => sse([{ type: "tool_use", id: "a3", name: "cloud_jobs", input: { wait: true } }]),
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
    // The cloud job without the folder: started without a question (FOL-382), only the task sent.
    at = await t.until(/cloud job #1 · run-sub-1 · What is six times seven\?/, at);
    at = await t.until(/✓ cloud job #1 · completed/, at);
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
  // The call answered once it had started; the result came between calls or to the wait (FOL-382).
  assert.match(JSON.stringify(asked[5].messages.at(-1)), /Started 1 cloud job[\s\S]*#1 run run-sub-1/);
  assert.match(JSON.stringify([asked[5].messages.at(-1), asked[6].messages.at(-1)]), /Six times seven is 42\.[\s\S]*saw none of this folder/);
  // The person's own change to the todo list reaches the agent as a note; the added folder is named.
  assert.match(JSON.stringify(asked[7].messages.at(-1)), /The person changed the session's todo list themselves/);
  assert.match(JSON.stringify(asked[7].system), /also added these folders for you to read/);
});

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
    at = await t.until(/bypass on — nothing is asked[\s\S]*Kept for your next sessions/, at);
    t.send("do it\r");
    at = await t.until(/make it\? yes — \/permissions bypass asks nothing/, at); // FOL-411: not asked
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

test("/permissions remembers the last choice (FOL-397): bypass is kept for the next session at a terminal and said at the start; relaxed and reset forget it", { skip: canSandbox ? false : "no local sandbox on this machine", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const prefs = () => { try { return JSON.parse(fs.readFileSync(path.join(home, "code-prefs.json"), "utf8")); } catch { return {}; } };
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-kept/messages`]: () => ({ messages: [] }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": () => sse([{ type: "text", text: "ok" }]),
  });
  let t: ReturnType<typeof onTerminal> | undefined;
  const open = () => (t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-kept", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200", FOLDRUN_CODE_SANDBOX: "" }));
  try {
    t = open();
    let at = await t.until(/\w ❯ /);
    assert.doesNotMatch(t.out(), /BYPASS/, "nothing kept yet");
    t.send("/permissions bypass\r");
    at = await t.until(/Kept for your next sessions/, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
    assert.equal(prefs().permissions, "bypass", "kept for this computer");

    t = open();
    at = await t.until(/\w ❯ /);
    assert.match(t.out(), /BYPASS nothing is asked[\s\S]*your last \/permissions choice/, "a new session starts in bypass and says so");
    at = await alone(t, "/permissions", at);
    at = await t.until(/bypass: nothing is asked, outside the sandbox too — kept for your next sessions/, at);
    // /resume new keeps the kept mode (it is the person's choice, not the old conversation's).
    // Bypass asks nothing (FOL-411): the computer's model key is made without "make it?".
    t.send("hi\r");
    at = await t.until(/make it\? yes — \/permissions bypass asks nothing/, at);
    at = await t.until(/\bok\b/, at, 30_000);
    assert.doesNotMatch(t.out(), /make it\? \[y\/N\]/, "not asked");
    at = await t.until(/\w ❯ /, at);
    t.send("/resume new\r");
    at = await t.until(/a fresh conversation/, at);
    at = await t.until(/\w ❯ /, at);
    at = await alone(t, "/permissions", at);
    at = await t.until(/bypass: nothing is asked/, at);
    t.send("/permissions relaxed\r");
    at = await t.until(/bypass off/, at);
    t.send("/quit\r");
    assert.equal(await t.done, 0);
    assert.equal(prefs().permissions, undefined, "relaxed forgets it");

    t = open();
    at = await t.until(/\w ❯ /);
    assert.doesNotMatch(t.out(), /BYPASS/);
    t.send("/permissions strict\r");
    at = await t.until(/asked too/, at);
    assert.equal(prefs().permissions, "strict");
    t.send("/permissions reset\r");
    at = await t.until(/forgotten/, at);
    assert.equal(prefs().permissions, undefined, "reset forgets it");
    t.send("/quit\r");
    assert.equal(await t.done, 0);
  } finally {
    t?.child.kill();
    s.close();
  }
});

test("/permissions bypass asks no question (FOL-411): a cloud turn's files go and its changes go in unasked, said in a grey line; after relaxed, send it? is asked again", { skip: hasPty ? false : "needs python3's pty", timeout: 60_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  fs.writeFileSync(path.join(home, "code-prefs.json"), JSON.stringify({ permissions: "bypass" }));
  const s = await platform();
  const t = onTerminal(["code", d, "--cloud", "--to", "desk", "--context", "code-by", "--url", s.url, "--token", "k"], home);
  try {
    let at = await t.until(/\w ❯ /);
    assert.match(t.out(), /BYPASS/, "the kept bypass is on");
    t.send("add b\r");
    at = await t.until(/send it\? yes — \/permissions bypass asks nothing/, at);
    at = await t.until(/apply it\? yes — \/permissions bypass asks nothing/, at, 30_000);
    at = await t.until(/\/undo takes it back/, at);
    assert.equal(fs.readFileSync(path.join(d, "a.txt"), "utf8"), "a\nb\n", "applied without a question");
    assert.doesNotMatch(t.out(), /send it\? \[y\]es|apply it to/, "neither question was asked");
    at = await t.until(/\w ❯ /, at);
    t.send("/permissions relaxed\r");
    at = await t.until(/bypass off/, at);
    at = await t.until(/\w ❯ /, at);
    // A yes given by bypass is not kept: the same files are asked about once bypass is off.
    t.send("add c\r");
    at = await t.until(/send it\? \[y\]es/, at);
    t.send("n\r");
    at = await t.until(/\w ❯ /, at);
    t.send("/quit\r");
    assert.equal(await t.ended(), 0);
  } finally {
    t.child.kill();
    s.close();
  }
});

test("a dev server outside the sandbox (FOL-296): bash_outside run_in_background is asked, gives job o1; reading it is not asked, typing into it is; Bash's job calls cannot reach it", { skip: canSandbox ? false : "needs the sandbox", timeout: 120_000 }, async () => {
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  const turns = [
    () => sse([{ type: "tool_use", id: "i1", name: "Bash", input: { command: "sleep 30", run_in_background: true } }]),
    () => sse([{ type: "tool_use", id: "s1", name: "bash_outside", input: { command: "while read l; do echo srv-$l; done", reason: "a dev server: the sandbox cannot listen on a port", run_in_background: true } }]),
    () => sse([{ type: "tool_use", id: "s1b", name: "Bash", input: { command: "echo while-live > live.txt" } }]),
    () => sse([{ type: "tool_use", id: "s2", name: "Bash", input: { job: "o1", stdin: "sneak\n" } }]),
    () => sse([{ type: "tool_use", id: "s3", name: "bash_outside", input: { job: "o1", stdin: "hi\n" } }]),
    () => sse([{ type: "tool_use", id: "s4", name: "bash_outside", input: { job: "o1", wait: 500 } }]),
    () => sse([{ type: "tool_use", id: "s5", name: "bash_outside", input: { job: "o1", stop: true } }]),
    () => sse([{ type: "text", text: "Server handled." }]),
  ];
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-o296/messages`]: () => ({ messages: [] }),
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
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-o296", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "200", FOLDRUN_CODE_SANDBOX: "" });
  try {
    let at = await t.until(/\w ❯ /);
    t.send("run the server\r");
    at = await t.until(/make it\? \[y\/N\]/, at);
    t.send("y\r");
    at = await t.until(/runs as you until this turn ends, not after — while it runs, the agent's commands and file changes in this folder are asked too[\s\S]*OUTSIDE the sandbox[\s\S]*while read l[\s\S]*allow\? \[y\]es · \[n\]o/, at, 60_000);
    t.send("y\r");
    // Commands inside the sandbox — unasked otherwise — are asked while the server runs.
    at = await t.until(/a server started outside the sandbox is running[\s\S]*echo while-live[\s\S]*allow\?/, at, 60_000);
    t.send("y\r");
    at = await t.until(/a server started outside the sandbox is running[\s\S]*typed into the background job o1[\s\S]*> sneak[\s\S]*allow\?/, at, 60_000);
    t.send("y\r");
    at = await t.until(/OUTSIDE the sandbox[\s\S]*typed into the background job o1[\s\S]*> hi[\s\S]*allow\? \[y\]es · \[n\]o/, at, 60_000);
    t.send("y\r");
    at = await t.until(/Server handled\./, at, 30_000);
    const result = (n: number) => JSON.stringify((asked[n + 1]?.messages ?? []).at(-1));
    // What ran on inside the sandbox is ended before the server starts: nothing changes what it runs unasked.
    assert.match(result(1), /ended 1 process group commands inside the sandbox had left running[\s\S]*job o1 is running/);
    assert.equal(fs.readFileSync(path.join(d, "live.txt"), "utf8"), "while-live\n");
    assert.match(result(3), /no background job o1 in this step/, "Bash's jobs are not the outside ones, even when let through");
    assert.match(result(5), /srv-hi/, "the wait read it, unasked");
    assert.doesNotMatch(result(5), /srv-sneak/);
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
    at = await t.until(/works\s+on this computer · cloud jobs on[\s\S]*agents in the cloud may take heavy jobs, started without a question \(\/where, \/permissions cloud\)/, at);
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
    at = await t.until(/This computer only; the web on this computer — \/where local · local\+cloud · cloud · send <task> · web here\|cloud/, at);
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
