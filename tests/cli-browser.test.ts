// `foldrun browser` — a real Chrome on this computer, driven by the gallery's
// own browser program (web/browse.mjs), for an AI app such as Claude Code over
// MCP (17 Nov 2026). The browser itself is proven by hand on a Mac; these
// prove what the CLI decides: which Chrome, which Playwright, what a call is
// started with and — above all — what it is NOT started with.
//
//   node --test tests/cli-browser.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, cli } from "./fake-platform.ts";
import { findChrome, playwrightVersion, callEnv, humanise, shapeOutput, TOOLS, browserPaths } from "../src/browser.mjs";

test("Chrome is found where each system installs it, and nowhere else", () => {
  const only = (want: string) => (p: string) => p === want;
  assert.equal(findChrome("darwin", {}, only("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  assert.equal(findChrome("darwin", {}, only("/Users/a/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), "/Users/a"), "/Users/a/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  const win = "C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
  assert.equal(findChrome("win32", { ProgramFiles: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, only(win)), win);
  assert.equal(findChrome("linux", {}, only("/usr/bin/google-chrome-stable")), "/usr/bin/google-chrome-stable");
  assert.equal(findChrome("linux", {}, () => false), null);
});

test("Playwright is the version the browser program itself names", () => {
  assert.equal(playwrightVersion("needs Playwright: `npm i -g playwright@1.64.2`, then"), "1.64.2");
  assert.equal(playwrightVersion("no hint here"), "1.63.0", "an older program falls back to the runner image's");
});

test("a call gets a minimal environment: never the foldrun token or any other secret", () => {
  const paths = browserPaths(() => "/h/.foldrun");
  const env = callEnv(paths, { PATH: "/bin", HOME: "/h", FOLDRUN_TOKEN: "fr_secret", OPENAI_API_KEY: "sk-x", GITHUB_TOKEN: "ghp_x" });
  assert.equal(env.FOLDRUN_TOKEN, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.PATH, "/bin");
  assert.equal(env.FOLDRUN_BROWSER_DESKTOP, "1", "Chrome as Chrome starts — no container switches");
  assert.equal(env.FOLDRUN_BROWSER_HEADLESS, "0", "a window the person can take over");
  assert.equal(env.FOLDRUN_BROWSER_LIVE_ROOT, path.join("/h/.foldrun", "browser", "chrome"), "sign-ins in a profile that lasts");
  assert.equal(env.FOLDRUN_BROWSER_LIVE_IDLE_MS, "0", "never closed while the person is away");
});

test("pointer moves are a person's unless a step says otherwise", () => {
  assert.deepEqual(humanise([{ click: "@e1" }, { fill: "#q", text: "x" }, { hover: "a", human: false }, { drag: "a", to: "b" }]),
    [{ click: "@e1", human: true }, { fill: "#q", text: "x" }, { hover: "a", human: false }, { drag: "a", to: "b", human: true }]);
});

test("the model reads what happened and the page, not the session chatter", () => {
  const text = shapeOutput({
    code: 0, timedOut: false,
    stderr: "browser: live session live — reattached, the page is as the last call left it\nbrowser: chrome\naction 1: click @e3 (human) — ok\npage: https://x.test/\n",
    stdout: "link \"Next\" [ref=e9]\n",
  });
  assert.equal(text, "action 1: click @e3 (human) — ok\npage: https://x.test/\nlink \"Next\" [ref=e9]");
});

test("every tool tells the model what it is for, and the hand-over tool names what only a person can do", () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ["browser_open", "browser_read", "browser_act", "browser_screenshot", "browser_wait_for_person", "browser_close"]);
  const wait = TOOLS.find((t) => t.name === "browser_wait_for_person")!;
  for (const w of ["sign-in", "SMS", "passkey", "payment", "puzzle"]) assert.match(wait.description, new RegExp(w));
});

/** A home with Playwright "installed", and a gallery whose browse.mjs reports what it was given. */
function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-browser-"));
  const pw = path.join(dir, "browser", "node_modules", "playwright");
  fs.mkdirSync(pw, { recursive: true });
  fs.writeFileSync(path.join(pw, "package.json"), JSON.stringify({ name: "playwright", version: "1.63.0" }));
  return dir;
}
const fakeBrowse = `// install hint: npm i -g playwright@1.63.0
console.log(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: Object.keys(process.env).filter((k) => /FOLDRUN|TOKEN|KEY/.test(k)).sort() }));
`;
const gallery = { tools: [{ name: "web", kind: "tools", title: "Web", description: "", files: [{ kind: "tools", file: "web/browse.mjs", content: fakeBrowse }], installed: null }] };

test("browser mcp: initialize, list, and each tool call is one browse.mjs call with the right switches", async () => {
  const dir = home();
  const s = await serve({ "/api/library/gallery": () => gallery });
  const msgs = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "browser_open", arguments: { url: "https://example.com" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "browser_act", arguments: { actions: [{ click: "@e13" }], read: "interactive" } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "browser_open", arguments: { url: "file:///etc/passwd" } } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "browser_close", arguments: {} } },
  ];
  // The gallery is fetched in the background as the server starts; a call
  // waits for it when nothing is on disk yet.
  const r = await cli(["browser", "mcp", "--url", s.url, "--token", "k"], {
    env: { FOLDRUN_HOME: dir, FOLDRUN_TOKEN_EXTRA: "x", SOME_API_KEY: "sk-nope" },
    input: msgs.map((m) => JSON.stringify(m)).join("\n") + "\n",
  });
  s.close();
  const answers = new Map(r.out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l)).map((m: any) => [m.id, m]));
  assert.equal(answers.get(1).result.serverInfo.name, "foldrun-browser", r.out);
  assert.equal(answers.get(1).result.protocolVersion, "2025-06-18");
  assert.match(answers.get(1).result.instructions, /browser_wait_for_person/);
  assert.equal(answers.get(2).result.tools.length, 6);

  const said = (id: number) => JSON.parse(answers.get(id).result.content[0].text.split("\n").find((l: string) => l.startsWith("{")));
  const open = said(3);
  assert.deepEqual(open.argv.slice(0, 7), ["--browser", "chrome", "--live", "true", "--url", "https://example.com", "--mode"]);
  assert.equal(fs.realpathSync(open.cwd), fs.realpathSync(path.join(dir, "browser", "work")), "calls run in the browser's own folder");
  assert.deepEqual(open.env, ["FOLDRUN_BROWSER_DESKTOP", "FOLDRUN_BROWSER_HEADLESS", "FOLDRUN_BROWSER_LIVE_IDLE_MS", "FOLDRUN_BROWSER_LIVE_ROOT"], "no token, no key reaches a call");
  assert.ok(fs.existsSync(path.join(dir, "browser", "work", "AGENTS.md")), "uploads are confined to work/, whatever the folders above hold");

  const act = said(4);
  assert.deepEqual(JSON.parse(act.argv[act.argv.indexOf("--actions") + 1]), [{ click: "@e13", human: true }]);
  assert.deepEqual(act.argv.slice(-4), ["--mode", "aria", "--interactive", "true"]);

  assert.equal(answers.get(5).result.isError, true, "only http(s) pages");
  assert.deepEqual(said(6).argv, ["--browser", "chrome", "--live", "end"]);
});

test("browser mcp without Playwright says how to set it up instead of failing obscurely", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-browser-"));
  const s = await serve({ "/api/library/gallery": () => gallery });
  const r = await cli(["browser", "mcp", "--url", s.url, "--token", "k"], {
    env: { FOLDRUN_HOME: dir },
    input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "browser_read", arguments: {} } }) + "\n",
  });
  s.close();
  const m = JSON.parse(r.out.split("\n").find((l) => l.startsWith("{"))!);
  assert.equal(m.result.isError, true);
  assert.match(m.result.content[0].text, /foldrun browser setup/);
});

test("browser doctor, signed out: says what is missing and exits 1", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-browser-"));
  const r = await cli(["browser", "doctor"], { env: { FOLDRUN_HOME: dir } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /browser program\s+not signed in — `foldrun login` first/);
  assert.match(r.out, /Playwright\s+not installed/);
});
