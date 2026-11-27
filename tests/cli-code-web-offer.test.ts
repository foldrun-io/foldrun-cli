// Search and fetch in a local turn (FOL-332): when they are not offered, /where web says why — the platform's copy
// of the agent has no web, the gateway did not answer — and a gateway ask that failed is made again at the next
// message instead of leaving the session without them. On a real terminal (python3's pty), against a fake platform
// and gateway. Its own file: the PTY tests of cli-code-session.test.ts already come near the per-file time limit on CI.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { serve, raw, failing } from "./fake-platform.ts";

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


const ANNOUNCED = "web_search_20250305,web_fetch_20250910,foldrun_web_browse_20251125";
const coreServerTools = typeof ((await import("@foldrun/core/engine-common")) as any).serverToolsOf === "function";
const skip = !coreServerTools ? "needs a core with the engine's serverTools (FOL-304)" : !hasPty ? "needs python3's pty" : false;

/** One session: two messages, with /where web typed after each. `models` answers GET /v1/models, call by call. */
async function session(agentMd: string, models: (n: number) => unknown, files: { project?: string; account?: string } = {}) {
  const saved: string[] = [];
  const d = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const asked: any[] = [];
  let modelsCalls = 0;
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`GET ${WS}/sessions/code-w332/messages`]: () => ({ messages: [] }),
    [`PUT ${WS}/source`]: (b) => {
      agentMd = JSON.parse(String(b)).content;
      saved.push(agentMd);
      return { ok: true };
    },
    [`GET ${WS}/source`]: (_b, q) => (q.get("path") === "agents/coder/agent.md" ? { content: agentMd, sha256: `sha-${saved.length}` } : q.get("path") === "AGENTS.md" ? { content: files.project ?? "" } : { content: "" }),
    "GET /v1/account/agents-md": () => ({ content: files.account ?? "" }),
    "GET /v1/me": () => ({ account: "acme" }),
    "GET /v1/account/usage": () => ({ credits: { pots: { planUsd: 1, boughtUsd: 5 }, plan: { id: "pro", name: "Pro", paysForTokens: false }, usdPerCredit: 0.01 } }),
    "GET /v1/models": () => models(++modelsCalls),
    "POST /v1/keys": (b) => {
      const body = JSON.parse(String(b));
      return { id: "key-1", key: "fr_gw_test", gatewayUrl: s.url, credential: "account", dailyUsd: body.dailyUsd, walletUsd: body.walletUsd };
    },
    "POST /v1/messages": (b) => {
      asked.push(JSON.parse(String(b)));
      return sse([{ type: "text", text: `Answer ${asked.length}.` }]);
    },
  });
  const t = onTerminal(["code", d, "--local", "--to", "desk", "--context", "code-w332", "--url", s.url, "--token", "k"], home, { TERM: "dumb", COLUMNS: "300" });
  const types = (n: number) => (asked[n].tools ?? []).filter((x: any) => x.type).map((x: any) => x.name);
  const send = async (msg: string, n: number, at: number) => {
    t.send(`${msg}\r`);
    if (n === 1) {
      at = await t.until(/make it\? \[y\/N\]/, at);
      t.send("y\r");
    }
    at = await t.until(new RegExp(`Answer ${n}\\.`), at, 30_000);
    return t.until(/\w ❯ /, at, 30_000);
  };
  const close = async () => {
    t.send("/quit\r");
    await t.done;
  };
  return { t, types, asked0: () => asked[0].tools ?? [], toolsOf: (n: number) => asked[n].tools ?? [], saved, send, close, stop: () => { t.child.kill(); s.close(); } };
}
const announces = () => raw("{}", "application/json", { "foldrun-server-tools": ANNOUNCED });

test("an agent with no tools: [web] is offered search and fetch all the same: every tool the API runs is on by default (FOL-412)", { skip, timeout: 120_000 }, async () => {
  const x = await session("---\nname: coder\ntools: [write, code]\n---\nYou code.\n", announces);
  try {
    let at = await x.t.until(/\w ❯ /);
    at = await x.send("hello", 1, at);
    assert.ok(x.types(0).length > 0, "search and fetch offered");
    await x.close();
  } finally {
    x.stop();
  }
});

test("the project's or account's AGENTS.md narrows the web for every agent: disallowedTools turns it off, web.actions keeps only what it lists (FOL-412, Codex)", { skip, timeout: 120_000 }, async () => {
  const plain = "---\nname: coder\n---\nYou code.\n";
  for (const files of [{ project: "---\ndisallowedTools: [web]\n---\n" }, { account: "---\ndisallowedTools: [web]\n---\n" }]) {
    const x = await session(plain, announces, files);
    try {
      let at = await x.t.until(/\w ❯ /);
      at = await x.send("hello", 1, at);
      assert.deepEqual(x.types(0), [], JSON.stringify(files));
      await x.close();
    } finally {
      x.stop();
    }
  }
  const x = await session(plain, announces, { account: "---\nweb:\n  actions: [search]\n---\n" });
  try {
    let at = await x.t.until(/\w ❯ /);
    at = await x.send("hello", 1, at);
    assert.deepEqual(x.types(0), ["web_search"]);
    await x.close();
  } finally {
    x.stop();
  }
});

test("/where web names why search and fetch were not offered: the platform's copy of the agent turns the web off (FOL-332, FOL-412)", { skip, timeout: 120_000 }, async () => {
  const x = await session("---\nname: coder\ntools: [write, code]\ndisallowedTools: [web]\n---\nYou code.\n", announces);
  try {
    let at = await x.t.until(/\w ❯ /);
    at = await x.send("hello", 1, at);
    assert.deepEqual(x.types(0), []);
    x.t.send("/where web\r");
    await x.t.until(/last turn offered no search or fetch — agents\/coder\/agent\.md in the project desk on the platform[^\n]*turns the web off: disallowedTools: \[web\]/, at);
    await x.close();
  } finally {
    x.stop();
  }
});

test("a gateway ask that failed is made again at the next message, and /where web says what happened (FOL-332)", { skip, timeout: 120_000 }, async () => {
  const x = await session("---\nname: coder\ntools: [write, code, web]\n---\nYou code.\n", (n) => (n === 1 ? failing(503, { error: "edge" }) : announces()));
  try {
    let at = await x.t.until(/\w ❯ /);
    at = await x.send("hello", 1, at);
    assert.deepEqual(x.types(0), [], "the first ask failed: nothing offered");
    x.t.send("/where web\r");
    at = await x.t.until(/last turn offered no search or fetch — the gateway answered GET \/v1\/models with 503[^\n]*asked again at the next message/, at);
    at = await x.send("again", 2, at);
    assert.deepEqual(x.types(1), ["web_search", "web_fetch"], "asked again, and offered");
    x.t.send("/where web\r");
    await x.t.until(/last turn offered web_search and web_fetch/, at);
    await x.close();
  } finally {
    x.stop();
  }
});

// tools: [debate, review] (FOL-418): offered only when the agent's file grants them with a second model.
const announcesSecond = () => raw("{}", "application/json", { "foldrun-server-tools": `${ANNOUNCED},foldrun_debate_20261127,foldrun_review_20261127` });

test("debate and review: announced by the gateway but not offered until the agent's file grants them with second_model:, then sent with that model", { skip, timeout: 180_000 }, async () => {
  const offered = async (agentMd: string) => {
    const x = await session(agentMd, announcesSecond);
    try {
      let at = await x.t.until(/\w ❯ /);
      at = await x.send("hello", 1, at);
      const tools = (x.asked0() as { type?: string; name: string; model?: string }[]).filter((t) => t.type);
      await x.close();
      return tools.filter((t) => t.name === "foldrun_debate" || t.name === "foldrun_review").map((t) => `${t.name}:${t.model ?? "-"}`);
    } finally {
      x.stop();
    }
  };
  assert.deepEqual(await offered("---\nname: coder\ntools: [write, code]\n---\nYou code.\n"), [], "no grant, nothing offered");
  assert.deepEqual(await offered("---\nname: coder\ntools: [write, code, review]\n---\nYou code.\n"), [], "a grant with no second model, nothing offered");
  assert.deepEqual(await offered("---\nname: coder\ntools: [write, code, review]\nsecond_model: openai/gpt-x\n---\nYou code.\n"), ["foldrun_review:openai/gpt-x"]);
  assert.deepEqual(await offered("---\nname: coder\ntools: [write, code, debate, review]\nsecond_model: openai/gpt-x\ndisallowedTools: [debate]\n---\nYou code.\n"), ["foldrun_review:openai/gpt-x"], "disallowedTools takes one away");
  assert.deepEqual(await offered("---\nname: coder\ntools: [write, code, review]\nsecond_model: openai/gpt-x\ndisallowedTools: review\n---\nYou code.\n"), [], "one name, not a list, takes it away too");
  assert.deepEqual(await offered("---\nname: coder\ntools: [write, [[review]]]\nsecond_model: openai/gpt-x\n---\nYou code.\n"), [], "[[review]] is the author's own tool, not the built-in");
  assert.deepEqual(await offered("---\nname: coder\ntools: review\nsecond_model: openai/gpt-x\n---\nYou code.\n"), ["foldrun_review:openai/gpt-x"], "one name, not a list, grants it");
});

test("debate and review: a project's AGENTS.md takes them away; /model second none holds from the very next message", { skip, timeout: 180_000 }, async () => {
  const names = (tools: { type?: string; name: string }[]) => tools.filter((t) => t.type && /^foldrun_(debate|review)$/.test(t.name)).map((t) => t.name);
  const p = await session("---\nname: coder\ntools: [write, review]\nsecond_model: openai/gpt-x\n---\nYou code.\n", announcesSecond, { project: "---\ndisallowedTools: [review]\n---\n" });
  try {
    let at = await p.t.until(/\w ❯ /);
    at = await p.send("hello", 1, at);
    assert.deepEqual(names(p.asked0()), []);
    await p.close();
  } finally {
    p.stop();
  }
  const x = await session("---\nname: coder\ntools: [write, review]\nsecond_model: openai/gpt-x\n---\nYou code.\n", announcesSecond);
  try {
    let at = await x.t.until(/\w ❯ /);
    at = await x.send("hello", 1, at);
    assert.deepEqual(names(x.toolsOf(0)), ["foldrun_review"]);
    x.t.send("/model second none\r");
    at = await x.t.until(/no second opinion: debate and review are taken away/, at);
    assert.doesNotMatch(x.saved[0]!, /second_model|review/);
    at = await x.t.until(/\w ❯ /, at);
    at = await x.send("again", 2, at);
    assert.deepEqual(names(x.toolsOf(1)), [], "taken away from the next message");
    await x.close();
  } finally {
    x.stop();
  }
});
