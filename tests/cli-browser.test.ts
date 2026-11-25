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
  const s = await serve({ "/v1/library/gallery": () => gallery });
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
  const s = await serve({ "/v1/library/gallery": () => gallery });
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
  assert.match(r.out, /browser driver\s+not installed/);
  assert.doesNotMatch(r.out, /Playwright/, "what it is built on is not named (FOL-271)");
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

// ---------------------------------------------- web action=browse, here (FOL-267)

const { localWebDefinition, localWebArgv, runLocalWeb, browseHelp, notHere } = await import("../src/browser.mjs");
const { readFrontmatter } = await import("@foldrun/core");

function webGallery() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-web-"));
  fs.writeFileSync(path.join(dir, "tool.md"), [
    "---",
    "name: web",
    "description: >",
    "  The web. search: a query. fetch: a page. browse: a real browser — JavaScript runs; mode= picks what comes back. Use it when fetch is empty. Start with fetch.",
    "args:",
    '  action: "search | fetch | browse"',
    '  url: "(fetch) One page · (browse) The page to open"',
    '  mode: "(browse) What comes back"',
    '  actions: "(browse) Optional JSON array of steps"',
    '  proxy: "(browse) Optional NAME of a secret holding a proxy URL"',
    '  captcha_solver: "(browse) Optional capsolver"',
    '  identity: "(browse) Optional name of an entry"',
    '  browser: "(browse) Optional engine"',
    '  live: "(browse) Optional true"',
    "---",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "run.mjs"), `const ARGS = { "fetch": [ "url" ], "browse": [ "url", "mode", "actions", "proxy", "captcha_solver", "identity", "browser", "live" ] };
console.log(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: Object.keys(process.env).filter((k) => k.startsWith("FOLDRUN") || /KEY|TOKEN/.test(k)).sort() }));
console.error("browser: live session live");
console.error("wrote outputs/page.png");
`);
  fs.writeFileSync(path.join(dir, "browse.mjs"), "");
  return dir;
}

test("FOL-267: the local web tool is the gallery's own browse — its options, minus what needs the cloud", () => {
  const dir = webGallery();
  const d = localWebDefinition(path.join(dir, "browse.mjs"), readFrontmatter);
  assert.ok(d);
  assert.deepEqual(d!.names, ["url", "mode", "actions", "browser", "live"], "vault secrets, the solver and identities are not offered");
  assert.deepEqual(d!.input_schema.properties.action.enum, ["browse"]);
  assert.equal(d!.input_schema.properties.url.description, "The page to open", "the browse part of each help line");
  assert.match(d!.description, /browse: a real browser/);
  assert.match(d!.description, /Never type a password/);
  assert.equal(browseHelp({ x: "(fetch) a · (browse) b · (map) c" }).x, "b");
});

test("FOL-267: a call is the cloud's arguments plus this window; what cannot run here is refused by name", () => {
  const dir = webGallery();
  const d = localWebDefinition(path.join(dir, "browse.mjs"), readFrontmatter)!;
  assert.deepEqual((localWebArgv({ action: "browse", url: "https://example.com", mode: "aria" }, d) as any).argv, ["--action", "browse", "--url", "https://example.com", "--mode", "aria", "--browser", "chrome", "--live", "true"]);
  const steps = (localWebArgv({ action: "browse", actions: [{ click: "@e3" }] }, d) as any).argv;
  assert.deepEqual(JSON.parse(steps[steps.indexOf("--actions") + 1]), [{ click: "@e3", human: true }]);
  assert.deepEqual((localWebArgv({ action: "browse", live: "end" }, d) as any).argv, ["--action", "browse", "--browser", "chrome", "--live", "end"]);
  const refused = (input: Record<string, unknown>) => (localWebArgv(input, d) as any).problem as string;
  assert.match(refused({ action: "fetch", url: "x" }), /^web action=fetch does not run on this computer/);
  assert.match(refused({ action: "browse", proxy: "P" }), /^proxy uses a secret from foldrun's vault/);
  assert.match(refused({ action: "browse", identity: "au-phone" }), /^identity names an entry/);
  assert.match(refused({ action: "browse", browser: "firefox" }), /firefox runs in the cloud/);
  assert.match(refused({ action: "browse", live: "false" }), /always stays open/);
  assert.match(refused({ action: "browse", depth: "2" }), /does not take depth/);
});

test("FOL-267: a local call runs run.mjs in the browser's folder with the window's environment, no secrets", async () => {
  const dir = webGallery();
  const paths = browserPaths(() => fs.mkdtempSync(path.join(os.tmpdir(), "local-web-home-")));
  fs.mkdirSync(paths.work, { recursive: true });
  const r: any = await runLocalWeb({ browse: path.join(dir, "browse.mjs"), paths }, ["--action", "browse", "--url", "https://example.com"]);
  assert.equal(r.code, 0, r.stderr);
  const said = JSON.parse(r.stdout);
  assert.deepEqual(said.argv, ["--action", "browse", "--url", "https://example.com"]);
  assert.equal(fs.realpathSync(said.cwd), fs.realpathSync(paths.work));
  assert.deepEqual(said.env, ["FOLDRUN_BROWSER_DESKTOP", "FOLDRUN_BROWSER_HEADLESS", "FOLDRUN_BROWSER_LIVE_IDLE_MS", "FOLDRUN_BROWSER_LIVE_ROOT", "FOLDRUN_BROWSER_MODULES"]);
  assert.match(shapeOutput(r), /wrote outputs\/page\.png/);
  assert.doesNotMatch(shapeOutput(r), /live session/, "the session chatter is left out");
  // A link where uploads come from or outputs go is refused before anything runs (Codex).
  fs.mkdirSync(path.join(paths.work, "uploads"), { recursive: true });
  fs.symlinkSync(os.homedir(), path.join(paths.work, "uploads", "home"));
  const linked: any = await runLocalWeb({ browse: path.join(dir, "browse.mjs"), paths }, ["--action", "browse"]);
  assert.equal(linked.code, 1);
  assert.match(linked.stderr, /uploads\/home is a link/);
  fs.rmSync(path.join(paths.work, "uploads", "home"));
  fs.symlinkSync(os.homedir(), path.join(paths.work, "elsewhere"));
  assert.match(((await runLocalWeb({ browse: path.join(dir, "browse.mjs"), paths }, ["--action", "browse"])) as any).stderr, /elsewhere is a link/, "anywhere in work/");
  fs.rmSync(path.join(paths.work, "elsewhere"));
  // A turn already stopped runs nothing.
  const gone = new AbortController();
  gone.abort();
  assert.match(((await runLocalWeb({ browse: path.join(dir, "browse.mjs"), paths }, [], { signal: gone.signal })) as any).stderr, /stopped before it started/);
  assert.match(notHere("state", "Optional name of a login kept across runs") ?? "", /profile keeps them already/);
  // Stopped with the turn.
  fs.writeFileSync(path.join(dir, "run.mjs"), "setTimeout(() => {}, 60000);");
  const stop = new AbortController();
  const p = runLocalWeb({ browse: path.join(dir, "browse.mjs"), paths }, [], { signal: stop.signal });
  stop.abort();
  assert.notEqual(((await p) as any).code, 0);
});

test("FOL-267: browser mcp also serves the cloud's full web tool, refused options named, beside the six", async () => {
  const dir = home();
  const toolMd = '---\nname: web\ndescription: "browse: a real browser — JavaScript runs. Use it when fetch is empty. Start with fetch."\nargs:\n  action: "browse"\n  url: "(browse) The page to open"\n  mode: "(browse) What comes back"\n  proxy: "(browse) Optional NAME of a secret holding a proxy URL"\n---\n';
  const runMjs = 'const ARGS = { "browse": [ "url", "mode", "proxy" ] };\nconsole.log("PAGE " + process.argv.slice(2).join(" "));\n';
  const full = { tools: [{ ...gallery.tools[0], files: [...gallery.tools[0].files, { kind: "tools", file: "web/tool.md", content: toolMd }, { kind: "tools", file: "web/run.mjs", content: runMjs }] }] };
  const s = await serve({ "/v1/library/gallery": () => full });
  const msgs = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "browser_read", arguments: {} } },
    { jsonrpc: "2.0", id: 3, method: "tools/list" },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "web", arguments: { action: "browse", url: "https://example.com", mode: "text" } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "web", arguments: { action: "browse", proxy: "P" } } },
  ];
  const r = await cli(["browser", "mcp", "--url", s.url, "--token", "k"], { env: { FOLDRUN_HOME: dir }, input: msgs.map((m) => JSON.stringify(m)).join("\n") + "\n" });
  s.close();
  const answers = new Map(r.out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l)).map((m: any) => [m.id, m]));
  const tools = answers.get(3).result.tools;
  assert.equal(tools.length, 7, r.out);
  const web = tools.find((t: any) => t.name === "web");
  assert.deepEqual(Object.keys(web.inputSchema.properties).sort(), ["action", "mode", "url"]);
  assert.match(answers.get(4).result.content[0].text, /PAGE --action browse --url https:\/\/example\.com --mode text --browser chrome --live true/);
  assert.equal(answers.get(5).result.isError, true);
  assert.match(answers.get(5).result.content[0].text, /proxy uses a secret from foldrun's vault/);
});
