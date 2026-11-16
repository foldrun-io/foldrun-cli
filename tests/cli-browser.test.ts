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
import { spawn } from "node:child_process";
import { serve, cli } from "./fake-platform.ts";
import { findChrome, playwrightVersion, callEnv, humanise, shapeOutput, TOOLS, browserPaths, windowOpen, callTool, MAX_SHOT_BYTES } from "../src/browser.mjs";

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
  assert.equal(env.FOLDRUN_BROWSER_MODULES, path.join("/h/.foldrun", "browser"), "the Playwright setup installed, not a global one");
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
  assert.deepEqual(open.env, ["FOLDRUN_BROWSER_DESKTOP", "FOLDRUN_BROWSER_HEADLESS", "FOLDRUN_BROWSER_LIVE_IDLE_MS", "FOLDRUN_BROWSER_LIVE_ROOT", "FOLDRUN_BROWSER_MODULES"], "no token, no key reaches a call");
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

test("browser reset stops the window's Chrome first, and never a process that is not ours", { skip: process.platform === "win32" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-browser-"));
  const chrome = path.join(dir, "browser", "chrome");
  const live = path.join(chrome, "live-live");
  fs.mkdirSync(path.join(live, "profile"), { recursive: true });
  const hold = (...args: string[]) => spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", "--", ...args], { stdio: "ignore" });
  const alive = (p: ReturnType<typeof hold>) => p.exitCode === null && p.signalCode === null;

  // An old live.json whose pid now belongs to another program: our Chrome is
  // not running, so the profile goes and the other program is left alone.
  const stranger = hold("--not-a-browser");
  fs.writeFileSync(path.join(live, "live.json"), JSON.stringify({ pid: stranger.pid, endpoint: "http://127.0.0.1:9" }));
  await new Promise((r) => setTimeout(r, 300));
  const r1 = await cli(["browser", "reset", "--yes"], { env: { FOLDRUN_HOME: dir } });
  assert.equal(r1.code, 0, r1.out);
  assert.ok(alive(stranger), "a process that is not the foldrun window's Chrome is left alone");
  assert.ok(!fs.existsSync(chrome), "the profile goes");
  stranger.kill("SIGKILL");

  // A Chrome that is ours (its command line names the profile), signed out so
  // the program cannot close it: it is stopped before the profile goes.
  fs.mkdirSync(path.join(live, "profile"), { recursive: true });
  const ours = hold(`--user-data-dir=${path.join(live, "profile")}`);
  fs.writeFileSync(path.join(live, "live.json"), JSON.stringify({ pid: ours.pid, endpoint: "http://127.0.0.1:9" }));
  await new Promise((r) => setTimeout(r, 300));
  const r2 = await cli(["browser", "reset", "--yes"], { env: { FOLDRUN_HOME: dir } });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(r2.code, 0, r2.out);
  assert.ok(!alive(ours), "the window's Chrome is stopped");
  assert.ok(!fs.existsSync(chrome), "then the profile goes");
});

test("the window is open only while Chrome shows a page: on macOS a closed window leaves Chrome running with none", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-browser-"));
  const paths = browserPaths(() => dir);
  const live = path.join(paths.chrome, "live-live");
  fs.mkdirSync(live, { recursive: true });
  const listing = (list: unknown) => (async () => ({ json: async () => list })) as unknown as typeof fetch;
  assert.equal(await windowOpen(paths, listing([{ type: "page" }])), false, "no live session: closed");
  fs.writeFileSync(path.join(live, "live.json"), JSON.stringify({ pid: process.pid, endpoint: "http://127.0.0.1:9" }));
  assert.equal(await windowOpen(paths, listing([{ type: "page", url: "https://a/" }])), true);
  assert.equal(await windowOpen(paths, listing([{ type: "service_worker" }])), false, "Chrome running, no window");
  assert.equal(await windowOpen(paths, (async () => { throw new Error("refused"); }) as unknown as typeof fetch), true, "not answering is no proof of closed");
});

test("browser_screenshot takes what is in view unless asked for the whole page, and refuses a picture too big to send", async () => {
  // 17 Nov 2026: a screenshot of a 450-comment thread, asked without
  // full_page, came back as the whole page — 23 MB — and closed Claude
  // Code's MCP connection ("Connection closed").
  const dir = home();
  const paths = browserPaths(() => dir);
  fs.mkdirSync(paths.work, { recursive: true });
  const fake = path.join(dir, "fake-browse.mjs");
  fs.writeFileSync(fake, `import fs from "node:fs"; import path from "node:path";
const a = process.argv.slice(2); const steps = JSON.parse(a[a.indexOf("--actions") + 1]);
const shot = steps.find((s) => s.screenshot);
fs.mkdirSync(path.dirname(shot.screenshot), { recursive: true });
fs.writeFileSync(shot.screenshot, Buffer.alloc(shot.full ? ${MAX_SHOT_BYTES + 1} : 1000));
fs.writeFileSync("last-steps.json", JSON.stringify(steps));
console.log('{"get":"url","value":"https://example.com/"}');
`);
  const ctx = { browse: fake, paths };
  const steps = () => JSON.parse(fs.readFileSync(path.join(paths.work, "last-steps.json"), "utf8"));

  const view: any = await callTool(ctx, "browser_screenshot", {});
  assert.equal(view.isError, undefined, JSON.stringify(view));
  assert.equal(steps()[0].full, false, "the viewport, said out loud: the program's own default is the whole page");
  assert.equal(view.content[0].type, "image");

  const whole: any = await callTool(ctx, "browser_screenshot", { full_page: true });
  assert.equal(steps()[0].full, true);
  assert.equal(whole.isError, true);
  assert.match(whole.content[0].text, /too big to send.*no full_page/);
  assert.deepEqual(fs.readdirSync(path.join(paths.work, "outputs")), [], "the picture is not left behind");
});
