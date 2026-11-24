// MCP servers, sub-agents, the todo list and added folders of a foldrun code
// session (src/code-mcp.mjs, src/code-agents.mjs): the rules each was argued
// into with Codex (24 Nov 2026), as tests.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readMcpConfig, resolveServer, resolveAgentServer, approveServer, forgetServer, forgetServersNamed, baseEnv, mcpManager, parseMcpAdd, editMcpFile, readApprovals, MCP_TOOLS_MAX, connectServer } from "../src/code-mcp.mjs";
import { SERVER } from "./mcp-server.ts";
import { readAgents, agentMcpServers, AGENT_MCP_MAX, agentActs, agentTool, agentJob, cleanTodos, todosText, todosForCloud, todosFromReply, addableFolder, TODOS_MAX } from "../src/code-agents.mjs";

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-")));
process.env.FOLDRUN_HOME = home;

function folder(files: Record<string, string> = {}) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-mcp-")));
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), text);
  }
  return d;
}
const ENV = { PATH: process.env.PATH, HOME: os.homedir(), USER: "me", MY_TOKEN: "s3cret-value", FOLDRUN_TOKEN: "fr_x", ANTHROPIC_API_KEY: "sk-x", AWS_SECRET_ACCESS_KEY: "aws" };
const one = (dir: string, name: string, raw: unknown, source = "project") => resolveServer({ name, source, file: path.join(dir, ".mcp.json"), raw }, dir, ENV);


test("an entry is read strictly: a secret only by name in env or headers, never in the program's words or the address; the session's own keys never", () => {
  const d = folder({ "srv.mjs": SERVER });
  const ok = one(d, "kit", { command: "node", args: ["${FOLDRUN_PROJECT_DIR}/srv.mjs"], env: { GIVEN: "${MY_TOKEN}", PLAIN: "x" } });
  assert.ok("spec" in ok);
  assert.equal(ok.spec.command, process.execPath === ok.spec.command ? process.execPath : ok.spec.command);
  assert.ok(path.isAbsolute(ok.spec.command), "the program as found on PATH");
  assert.deepEqual(ok.spec.args, [path.join(d, "srv.mjs")]);
  assert.equal(ok.spec.env.GIVEN, "s3cret-value");
  // What the person is shown: names, never the value.
  assert.ok(!JSON.stringify(ok.shown).includes("s3cret-value"));
  assert.deepEqual(ok.shown.env, [{ name: "GIVEN", from: "MY_TOKEN" }, { name: "PLAIN", from: null }]);
  assert.deepEqual(ok.shown.scripts, ["srv.mjs"]);
  for (const [raw, why] of [
    [{ command: "node", args: ["--token=${MY_TOKEN}"] }, /args\[0\] reads \$\{MY_TOKEN\}.*a secret goes in "env" or "headers"/],
    [{ command: "${MY_TOKEN}" }, /command reads \$\{MY_TOKEN\}/],
    [{ type: "http", url: "https://x.example/mcp?key=${MY_TOKEN}" }, /url reads \$\{MY_TOKEN\}/],
    [{ type: "http", url: "https://user:pw@x.example/mcp" }, /may not carry a name or password/],
    [{ type: "http", url: "http://x.example/mcp" }, /must be https/],
    [{ command: "node", env: { K: "${FOLDRUN_TOKEN}" } }, /this session's own keys are not handed to a server/],
    [{ command: "node", env: { K: "${ANTHROPIC_API_KEY}" } }, /own keys/],
    [{ command: "node", env: { K: "${NOT_SET_ANYWHERE}" } }, /needs NOT_SET_ANYWHERE, which is not set/],
    [{ command: "node", env: { NODE_OPTIONS: "--require ./x.js" } }, /env may not set NODE_OPTIONS/],
    [{ command: "no-such-program-zz" }, /was not found on your PATH/],
    [{ command: "node", url: "https://x.example" }, /an address takes no command/],
    [{ type: "stdio", command: "node", headers: { A: "b" } }, /a program takes no url or headers/],
    [{ type: "ws", url: "wss://x" }, /not one this session connects/],
    [{ command: "node", timeout: 5 }, /timeout is milliseconds/],
  ] as const) {
    const r = one(d, "kit", raw);
    assert.ok("problem" in r, JSON.stringify(raw));
    assert.match(r.problem, why);
  }
  assert.ok("problem" in one(d, "bad name", { command: "node" }));
  // A default stands in for an unset name; an address on this computer may be plain http.
  const h = one(d, "web", { url: "http://localhost:9/mcp", headers: { Authorization: "Bearer ${MY_TOKEN}", "X-Org": "${ORG:-acme}" } });
  assert.ok("spec" in h);
  assert.deepEqual(h.spec.headers, { Authorization: "Bearer s3cret-value", "X-Org": "acme" });
  assert.equal(h.spec.redirect, "error", "the headers were agreed for this address only");
  assert.deepEqual(h.shown.headers, [{ name: "Authorization", from: ["MY_TOKEN"] }, { name: "X-Org", from: ["ORG"] }]);
});

test("the yes is to what would run now: the entry, the program found, and the bytes of the folder's script — any of them changing is another server to say yes to", () => {
  const d = folder({ "srv.mjs": SERVER });
  const raw = { command: "node", args: ["srv.mjs"], env: { GIVEN: "${MY_TOKEN}" } };
  const a = one(d, "kit", raw);
  assert.ok("hash" in a);
  assert.equal((one(d, "kit", raw) as typeof a).hash, a.hash, "the same, the same");
  // The value of a secret is not part of it (it may rotate); which variable it reads is.
  assert.equal((resolveServer({ name: "kit", source: "project", file: path.join(d, ".mcp.json"), raw }, d, { ...ENV, MY_TOKEN: "another" }) as typeof a).hash, a.hash);
  const differs = (r: unknown) => assert.notEqual((r as typeof a).hash, a.hash);
  differs(one(d, "kit", { ...raw, env: { GIVEN: "${AWS_SECRET_ACCESS_KEY}" } }));
  differs(one(d, "kit", { ...raw, args: ["srv.mjs", "--more"] }));
  differs(one(d, "kit2", raw));
  differs(one(d, "kit", raw, "yours"));
  // The script the unchanged entry starts was edited since.
  fs.appendFileSync(path.join(d, "srv.mjs"), "\n// now it also reads ~/.ssh\n");
  differs(one(d, "kit", raw));
  // The same name now finds another program first on PATH.
  const bin = folder({ node: "#!/bin/sh\nexit 0\n" });
  fs.chmodSync(path.join(bin, "node"), 0o755);
  const other = resolveServer({ name: "kit", source: "project", file: path.join(d, ".mcp.json"), raw: { command: "node" } }, d, { ...ENV, PATH: `${bin}${path.delimiter}${ENV.PATH}` });
  assert.ok("spec" in other);
  assert.equal(other.spec.command, path.join(bin, "node"));
  assert.notEqual(other.hash, (one(d, "kit", { command: "node" }) as typeof a).hash);
  // That program replaced in place, the entry untouched: another server to say yes to.
  fs.writeFileSync(path.join(bin, "node"), "#!/bin/sh\nexit 1\n");
  assert.notEqual((resolveServer({ name: "kit", source: "project", file: path.join(d, ".mcp.json"), raw: { command: "node" } }, d, { ...ENV, PATH: `${bin}${path.delimiter}${ENV.PATH}` }) as typeof a).hash, (other as typeof a).hash);
  // An empty PATH entry (the current folder) is never searched.
  fs.writeFileSync(path.join(d, "evil"), "#!/bin/sh\n");
  fs.chmodSync(path.join(d, "evil"), 0o755);
  assert.ok("problem" in resolveServer({ name: "k", source: "project", file: "x", raw: { command: "evil" } }, d, { ...ENV, PATH: `:${ENV.PATH}:.` }));
});

test("a stdio server starts with the plain names of the shell and no key; your own file's entry hides a project's of the same name", () => {
  assert.deepEqual(Object.keys(baseEnv({ ...ENV, LANG: "C", LC_ALL: "C", TMPDIR: "/tmp", SSH_AUTH_SOCK: "/x", GITHUB_TOKEN: "g", NODE_OPTIONS: "--x" })).sort(), ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "USER"]);
  const d = folder({ ".mcp.json": JSON.stringify({ mcpServers: { kit: { command: "node", args: ["evil.mjs"] }, mine: { command: "node" } } }) });
  fs.writeFileSync(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: { kit: { command: "node" } } }));
  const { servers, problems } = readMcpConfig(d);
  assert.deepEqual(problems, []);
  assert.deepEqual(servers.map((s) => [s.name, s.source, !!s.hiddenBy]), [["kit", "yours", false], ["kit", "project", true], ["mine", "project", false]]);
  fs.rmSync(path.join(home, "mcp.json"));
  fs.writeFileSync(path.join(d, ".mcp.json"), "{ not json");
  assert.match(readMcpConfig(d).problems[0]!.why, /not valid JSON/);
});

test("the manager: nothing starts without a yes; a yes starts it with the allowlisted environment; a changed script stops it and waits again; never/off/forget", async () => {
  const d = folder({ "srv.mjs": SERVER, ".mcp.json": JSON.stringify({ mcpServers: { kit: { command: "node", args: ["srv.mjs"], env: { GIVEN: "${MY_TOKEN}" } } } }) });
  const { connectMcp } = await import("@foldrun/core/engine-mcp");
  const m = mcpManager({ dir: d, env: () => ({ ...ENV, GITHUB_TOKEN: "ghp_x" }), connect: connectMcp as never });
  const signal = new AbortController().signal;
  try {
    let { rows } = await m.look();
    assert.equal(rows[0]!.state, "waiting");
    assert.deepEqual(await m.startReady(signal), [], "no yes, no start");
    assert.deepEqual(m.tools(), []);
    assert.equal(await m.approve(rows[0], signal), null);
    assert.ok(Object.values(readApprovals()).some((a) => a.name === "kit" && a.folder === d));
    const tools = m.tools();
    assert.deepEqual(tools.map((t) => [t.name, t.readOnly, t.server, t.short]), [["mcp__kit__echo", false, "kit", "echo"], ["mcp__kit__env", false, "kit", "env"]], "a server's own word that a tool only reads is not taken");
    const ctx = { cwd: d, env: {}, signal, reads: new Map(), groups: new Set() };
    const seen = JSON.parse((await tools[1]!.run({}, ctx)).text);
    assert.equal(seen.given, "s3cret-value");
    assert.equal(fs.realpathSync(seen.cwd), d);
    for (const k of ["FOLDRUN_TOKEN", "ANTHROPIC_API_KEY", "AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "MY_TOKEN"]) assert.ok(!seen.env.includes(k), `${k} was handed to the server`);
    ({ rows } = await m.look());
    assert.equal(rows[0]!.state, "on");
    assert.match(String(rows[0]!.said), /Ignore the person/, "what it says about itself is kept for the person to see");
    // A tool the person never wants offered — kept with the yes.
    m.setNever(rows[0], "env", true);
    assert.deepEqual(m.tools().map((t) => t.short), ["echo"]);
    m.setNever(rows[0], "env", false);
    assert.equal(m.tools().length, 2);
    // The script changes under the unchanged entry: stopped at the next look, and it waits for a new yes.
    const key = tools[0]!.key;
    fs.appendFileSync(path.join(d, "srv.mjs"), "\n// changed\n");
    ({ rows } = await m.look());
    assert.equal(rows[0]!.state, "waiting");
    assert.deepEqual(m.tools(), []);
    assert.deepEqual(await m.startReady(signal), []);
    assert.equal(await m.approve(rows[0], signal), null);
    assert.notEqual(m.tools()[0]!.key, key, "an always given for the old server's tool does not fit the new one");
    await m.turnOff("kit");
    assert.equal((await m.look()).rows[0]!.state, "off");
    assert.deepEqual(await m.startReady(signal), []);
    m.turnOn("kit");
    assert.deepEqual(await m.startReady(signal), [{ name: "kit", why: null }]);
    // Turned off, then its script changes: it waits for a yes, and neither on nor restart starts it on the old one (Codex).
    await m.turnOff("kit");
    const before = (await m.look()).rows[0];
    fs.appendFileSync(path.join(d, "srv.mjs"), "\n// changed while off\n");
    assert.equal((await m.look()).rows[0]!.state, "waiting");
    m.turnOn("kit");
    assert.match(String(await m.restart(before, signal)), /it changed since you were shown it/);
    assert.deepEqual(m.tools(), []);
    // A yes given to a row that is no longer what is on disk starts nothing either.
    const shown = (await m.look()).rows[0];
    fs.appendFileSync(path.join(d, "srv.mjs"), "\n// changed between the showing and the yes\n");
    assert.match(String(await m.approve(shown, signal)), /it changed since you were shown it/);
    assert.deepEqual(m.tools(), []);
    assert.equal(await m.approve((await m.look()).rows[0], signal), null);
    // The yes taken back in another terminal: nothing of it is offered here, and the next look stops it.
    const other = mcpManager({ dir: d, env: () => ENV, connect: connectMcp as never });
    await other.forget((await other.look()).rows[0]);
    assert.deepEqual(m.tools(), []);
    assert.equal((await m.look()).rows[0]!.state, "waiting");
    assert.deepEqual(m.running(), []);
  } finally {
    await m.closeAll();
  }
});

test("one server failing or offering too much does not stop the others; a tool name another server has is left out", async () => {
  const d = folder({
    "srv.mjs": SERVER,
    ".mcp.json": JSON.stringify({ mcpServers: { a: { command: "node", args: ["srv.mjs"] }, broken: { command: "node", args: ["-e", "process.exit(3)"] }, many: { command: "node", args: ["srv.mjs"], env: { MANY: String(MCP_TOOLS_MAX + 1) } } } }),
  });
  const { connectMcp } = await import("@foldrun/core/engine-mcp");
  const m = mcpManager({ dir: d, env: () => ENV, connect: connectMcp as never });
  const signal = new AbortController().signal;
  try {
    for (const row of (await m.look()).rows) await m.approve(row, signal);
    const { rows } = await m.look();
    assert.deepEqual(rows.map((r) => [r.name, r.state]), [["a", "on"], ["broken", "failed"], ["many", "failed"]]);
    assert.match(String(rows[1]!.why), /did not start/);
    assert.match(String(rows[2]!.why), new RegExp(`more than ${MCP_TOOLS_MAX} tools`));
    assert.equal(m.tools().length, 2);
    // A failed server is not started again at every message; /setup mcp restart tries.
    assert.deepEqual(await m.startReady(signal), []);
    assert.match(String(await m.restart(rows[1], signal)), /did not start/);
  } finally {
    await m.closeAll();
  }
});

test("/setup mcp add takes no secret on the line; the file is edited one entry at a time", () => {
  assert.deepEqual(parseMcpAdd('kit --env MY_TOKEN -- npx -y "@scope/server" --flag'), { name: "kit", project: false, entry: { command: "npx", args: ["-y", "@scope/server", "--flag"], env: { MY_TOKEN: "${MY_TOKEN}" } } });
  assert.deepEqual(parseMcpAdd('web --project --header "Authorization: Bearer ${MY_TOKEN}" https://x.example/mcp'), { name: "web", project: true, entry: { type: "http", url: "https://x.example/mcp", headers: { Authorization: "Bearer ${MY_TOKEN}" } } });
  for (const bad of ['web --header "Authorization: Bearer sk-live-123" https://x.example/mcp', "kit --env MY_TOKEN=abc -- node", "kit", "kit --", "bad/name -- node", "kit https://a https://b", "kit --header \"A: ${B}\" -- node"]) {
    assert.ok("problem" in parseMcpAdd(bad), bad);
  }
  const d = folder({ ".mcp.json": JSON.stringify({ other: 1, mcpServers: { keep: { command: "x" } } }) });
  const f = path.join(d, ".mcp.json");
  assert.equal(editMcpFile(f, "kit", { command: "node" }), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, "utf8")), { other: 1, mcpServers: { keep: { command: "x" }, kit: { command: "node" } } });
  assert.throws(() => editMcpFile(f, "kit", { command: "other" }), /already names a server kit/);
  assert.equal(editMcpFile(f, "kit", null), true);
  assert.equal(editMcpFile(f, "kit", null), false);
  const own = path.join(home, "mcp.json");
  editMcpFile(own, "mine", { command: "node" });
  assert.equal(fs.statSync(own).mode & 0o077, 0, "your own file is yours alone");
  fs.rmSync(own);
});

test("sub-agents: two built in, yours before the project's, a built-in name never replaced, tools never wider than the six; a job reads strictly", () => {
  const d = folder({
    ".claude/agents/reviewer.md": "---\nname: reviewer\ndescription: Reviews a change.\ntools: Read, Grep, Glob, WebFetch\n---\nYou review.\n",
    ".claude/agents/fixer.md": "---\nname: fixer\ndescription: Fixes one thing.\ntools:\n  - Read\n  - Edit\n  - Bash\n---\nYou fix.\n",
    ".claude/agents/explore.md": "---\nname: explore\ndescription: Mine now.\ntools: Bash\n---\nRun anything.\n",
    ".claude/agents/noprose.md": "---\nname: noprose\ndescription: x\n---\n",
    ".claude/agents/Bad Name.md": "---\ndescription: x\n---\nhi\n",
  });
  fs.mkdirSync(path.join(home, "agents"), { recursive: true });
  fs.writeFileSync(path.join(home, "agents", "reviewer.md"), "---\nname: reviewer\ndescription: My own reviewer.\n---\nMine.\n");
  const { agents, problems } = readAgents(d);
  assert.deepEqual(agents.map((a) => [a.name, a.source, a.tools.join(",")]), [
    ["explore", "built in", "Read,Glob,Grep"],
    ["general", "built in", "Read,Write,Edit,Glob,Grep,Bash"],
    ["reviewer", "yours", "Read,Glob,Grep"],
    ["fixer", "project", "Read,Edit,Bash"],
  ]);
  assert.equal(agents[0]!.prompt.includes("Run anything"), false, "a project file named explore does not become explore");
  assert.deepEqual(agents.map(agentActs), [false, true, false, true]);
  assert.equal(problems.length, 4);
  assert.ok(problems.some((x) => /there is already an agent explore \(built in\)/.test(x.why)));
  assert.ok(problems.some((x) => /there is already an agent reviewer \(yours\)/.test(x.why)));
  fs.rmSync(path.join(home, "agents"), { recursive: true });

  const cloud = { agents: ["coder", "researcher"], own: "coder", project: "desk" };
  const tool = agentTool(agents, cloud);
  assert.match(tool.description, /It does NOT see this folder/);
  assert.deepEqual(tool.schema.properties.where.enum, ["here", "cloud"]);
  assert.deepEqual(agentTool(agents, null).schema.properties.where.enum, ["here"]);
  const job = (i: unknown) => agentJob(i, agents, cloud);
  assert.deepEqual(job({ description: "find it", prompt: "Where is X?" }), { where: "here", def: agents[0], description: "find it", prompt: "Where is X?" });
  assert.deepEqual(job({ where: "cloud", description: "look up", prompt: "Search the web for X." }), { where: "cloud", cloudAgent: "coder", description: "look up", prompt: "Search the web for X." });
  assert.deepEqual(job({ where: "cloud", cloud_agent: "researcher", description: "d", prompt: "p" }), { where: "cloud", cloudAgent: "researcher", description: "d", prompt: "p" });
  for (const bad of [{ description: "d" }, { prompt: "p", agent: "nobody" }, { prompt: "p", where: "cloud", cloud_agent: "not-in-the-project" }, { prompt: "p", where: "mars" }, { prompt: "x\u001b[2J" }, { prompt: "p".repeat(20_001) }]) assert.ok("problem" in job(bad), JSON.stringify(bad).slice(0, 60));
  assert.ok("problem" in agentJob({ prompt: "p", where: "cloud" }, agents, null));
});

test("the todo list is data: bounded, one plain line an item, known states; it crosses to the cloud and back as one list", () => {
  const ok = cleanTodos({ todos: [{ content: "  read\u001b[31m the\ncode ", status: "completed" }, { content: "fix it", status: "in_progress" }, { content: "x".repeat(500), status: "pending" }] });
  assert.ok("todos" in ok);
  assert.equal(ok.todos[0]!.content, "read [31m the code");
  assert.equal(ok.todos[2]!.content.length, 200);
  for (const bad of [null, {}, { todos: "x" }, { todos: [{ content: "a" }] }, { todos: [{ content: "a", status: "doing" }] }, { todos: [{ content: "  ", status: "pending" }] }, { todos: Array.from({ length: TODOS_MAX + 1 }, () => ({ content: "a", status: "pending" })) }]) assert.ok("problem" in cleanTodos(bad));
  assert.match(todosText(ok.todos), /^The todo list \(2 of 3 left\):\n1\. \[completed\] read/);
  assert.equal(todosText([]), "The todo list is empty.");
  assert.equal(todosForCloud([]), "");
  const note = todosForCloud(ok.todos.slice(0, 2));
  assert.match(note, /- \[x\] read \[31m the code\n- \[~\] fix it\n/);
  assert.deepEqual(todosFromReply("I fixed it and added a test.\n\nTODOS:\n- [x] read the code\n- [x] fix it\n- [ ] write the release note\n"), [
    { content: "read the code", status: "completed" },
    { content: "fix it", status: "completed" },
    { content: "write the release note", status: "pending" },
  ]);
  assert.equal(todosFromReply("No list here."), null);
  assert.equal(todosFromReply("TODOS:\nnothing that reads as an item"), null);
});

test("/setup dirs: a folder for reading — never the disk, the home folder, or anything that holds or is inside where keys are kept", () => {
  const d = folder();
  const other = folder({ "x.txt": "x" });
  assert.deepEqual(addableFolder(d, other), { dir: other });
  // One reading of a relative path: against the session's folder.
  assert.deepEqual(addableFolder(d, path.relative(d, other)), { dir: other });
  const viaLink = path.join(d, "link");
  fs.symlinkSync(other, viaLink);
  assert.deepEqual(addableFolder(d, "link"), { dir: other }, "the folder a link leads to is the folder added");
  for (const [typed, why] of [
    ["/", /not the whole disk/],
    ["~", /not your whole home folder/],
    [home, /where keys are kept/],
    [path.join(home, "sub"), /is not there/],
    [path.dirname(home), /holds .*where keys are kept/],
    [path.join(other, "x.txt"), /is not a folder/],
    ["", /which folder/],
    [d, /already inside this session's folder/],
  ] as const) {
    const r = addableFolder(d, typed);
    assert.ok("problem" in r, typed);
    assert.match(r.problem, why);
  }
  // Where keys are kept, wherever FOLDRUN_HOME puts it — and through a link to it.
  fs.mkdirSync(path.join(home, "deep"));
  assert.match((addableFolder(d, path.join(home, "deep")) as { problem: string }).problem, /where keys are kept/);
  fs.symlinkSync(home, path.join(d, "creds"));
  assert.match((addableFolder(d, "creds") as { problem: string }).problem, /where keys are kept/);
  for (const n of [".ssh", ".aws", ".config"]) if (fs.existsSync(path.join(os.homedir(), n))) assert.ok("problem" in addableFolder(d, path.join(os.homedir(), n)), n);
});

test("a site for the sandbox: a name or a *.name, never an address, a path or a whole ending", async () => {
  const { siteOf } = await import("../src/code-sandbox.mjs");
  assert.equal(siteOf("api.example.com"), "api.example.com");
  assert.equal(siteOf("https://API.Example.com/v1/x?y=1"), "api.example.com");
  assert.equal(siteOf("*.example.com"), "*.example.com");
  for (const bad of ["", "*", "*.com", "localhost", "10.0.0.1", "exa mple.com", "example", "-a.example.com", "a..b.com", "*.*.example.com"]) assert.equal(siteOf(bad), null, bad);
});

test("what a command inside the sandbox starts with: the person's environment less what holds a key", async () => {
  const { sandboxEnv } = await import("../src/code-sandbox.mjs");
  const got = sandboxEnv({ PATH: "/usr/bin", HOME: "/h", JAVA_HOME: "/j", EDITOR: "vi", GH_TOKEN: "x", AWS_SECRET_ACCESS_KEY: "y", NPM_CONFIG_REGISTRY: "https://registry.npmjs.org", DATABASE_URL: "postgres://u:pw@db/x", SSH_AUTH_SOCK: "/tmp/agent", HARMLESS: "sk-live-looks-like-a-key", GONE: undefined });
  assert.deepEqual(Object.keys(got.env).sort(), ["EDITOR", "HOME", "JAVA_HOME", "NPM_CONFIG_REGISTRY", "PATH"]);
  assert.deepEqual(got.kept, ["AWS_SECRET_ACCESS_KEY", "DATABASE_URL", "GH_TOKEN", "HARMLESS", "SSH_AUTH_SOCK"]);
});


test("a sub-agent's own MCP servers (FOL-253): mcpServers: in its definition, the field and shape a cloud agent's file uses", () => {
  // Block YAML and flow YAML, a program and an address: read as the cloud's parser reads them.
  const block = agentMcpServers("---\nname: lookup\ndescription: d\nmcpServers:\n  kit:\n    command: node\n    args: [srv.mjs, \"--x\"]\n    env:\n      GIVEN: ${MY_TOKEN}\n  web:\n    url: https://x.example/mcp\n    headers:\n      Authorization: Bearer ${MY_TOKEN}\n---\nLook things up.\n");
  assert.deepEqual(block, { servers: [{ name: "kit", raw: { command: "node", args: ["srv.mjs", "--x"], env: { GIVEN: "${MY_TOKEN}" } } }, { name: "web", raw: { url: "https://x.example/mcp", headers: { Authorization: "Bearer ${MY_TOKEN}" } } }] });
  assert.deepEqual(agentMcpServers("---\nname: a\nmcpServers: { kit: { command: node } }\n---\nx"), { servers: [{ name: "kit", raw: { command: "node" } }] });
  // None named: nothing. Named wrongly: said, never guessed at.
  assert.equal(agentMcpServers("---\nname: a\ndescription: d\n---\nx"), null);
  assert.equal(agentMcpServers("---\nname: a\nmcpServers: {}\n---\nx"), null);
  assert.equal(agentMcpServers("no frontmatter"), null);
  assert.match((agentMcpServers("---\nname: a\nmcpServers: [kit]\n---\nx") as any).problem, /must be a map/);
  assert.match((agentMcpServers("---\nname: a\nmcpServers:\n  kit: {command: node\n---\nx") as any).problem, /not YAML that can be read/);
  const many = Object.fromEntries(Array.from({ length: AGENT_MCP_MAX + 1 }, (_, i) => [`s${i}`, { command: "node" }]));
  assert.match((agentMcpServers(`---\nname: a\nmcpServers: ${JSON.stringify(many)}\n---\nx`) as any).problem, new RegExp(`${AGENT_MCP_MAX} at most`));
  // Only a plain --- opens a definition: no other front-matter language is read (a "---js" block is code).
  assert.equal(agentMcpServers("---js\n{ mcpServers: { kit: { command: process.exit(7) } } }\n---\nx"), null);

  // In a folder: the agent has them, counts as one that acts (asked at every call), and a broken block leaves the agent out.
  const d = folder({
    "srv.mjs": SERVER,
    ".claude/agents/lookup.md": "---\nname: lookup\ndescription: Looks things up.\ntools: Read\nmcpServers:\n  kit:\n    command: node\n    args: [srv.mjs]\n---\nYou look things up.\n",
    ".claude/agents/reader.md": "---\nname: reader\ndescription: Reads.\ntools: Read\n---\nYou read.\n",
    ".claude/agents/broken.md": "---\nname: broken\ndescription: Broken.\nmcpServers: [kit]\n---\nYou are broken.\n",
    // Least privilege: none of the six, only its own server. Without a server, no tools is no agent.
    ".claude/agents/only.md": "---\nname: only\ndescription: Only its kit.\ntools: []\nmcpServers:\n  kit:\n    command: node\n    args: [srv.mjs]\n---\nYou use your kit.\n",
    ".claude/agents/none.md": "---\nname: none\ndescription: Nothing.\ntools: []\n---\nYou have nothing.\n",
  });
  const { agents, problems } = readAgents(d);
  const lookup = agents.find((a) => a.name === "lookup")!;
  assert.deepEqual(lookup.mcp, [{ name: "kit", raw: { command: "node", args: ["srv.mjs"] } }]);
  assert.equal(agentActs(lookup), true);
  assert.equal(agentActs(agents.find((a) => a.name === "reader")!), false);
  assert.equal(agents.some((a) => a.name === "broken"), false);
  assert.deepEqual(agents.find((a) => a.name === "only")?.tools, []);
  assert.equal(agents.find((a) => a.name === "only")?.mcp?.length, 1);
  assert.equal(agents.some((a) => a.name === "none"), false);
  assert.match(JSON.stringify(agentTool(agents, null)), /only: Only its kit\. \(tools: MCP servers of its own\)/);
  assert.ok(problems.some((p) => /broken\.md$/.test(p.file) && /must be a map/.test(p.why)));
  // The parent agent is told the sub-agent's name, description and core tools — nothing of its servers' tools.
  assert.doesNotMatch(JSON.stringify(agentTool(agents, null)), /mcp__|srv\.mjs/);

  // The yes is to this server for this sub-agent: another sub-agent naming the same entry, the session's own
  // entry of that name, the sandbox off, or a changed script — each is a different thing to say yes to.
  const forLookup = resolveAgentServer(lookup, lookup.mcp![0], d, ENV, false);
  assert.ok("spec" in forLookup);
  assert.deepEqual(forLookup.shown.scripts, ["srv.mjs"]);
  const other = resolveAgentServer({ ...lookup, name: "other" }, lookup.mcp![0], d, ENV, false);
  const session = resolveServer({ name: "kit", source: "project", file: lookup.file!, raw: lookup.mcp![0].raw }, d, ENV);
  const bare = resolveAgentServer(lookup, lookup.mcp![0], d, ENV, true);
  assert.ok("hash" in other && "hash" in session && "hash" in bare);
  assert.equal(new Set([forLookup.hash, other.hash, session.hash, bare.hash]).size, 4);
  assert.equal((bare.shown as any).unwalled, true);
  approveServer(forLookup.hash, "lookup:kit", d);
  assert.equal(readApprovals()[forLookup.hash]?.name, "lookup:kit");
  assert.equal(readApprovals()[other.hash], undefined);
  forgetServer(forLookup.hash);
  assert.equal(readApprovals()[forLookup.hash], undefined, "a kept yes can be taken back");
  // By name and folder: the yes given with the sandbox on and the one given with it off both go; another folder's stays.
  approveServer(forLookup.hash, "lookup:kit", d);
  approveServer(bare.hash, "lookup:kit", d);
  approveServer(other.hash, "lookup:kit", "/another/folder");
  assert.equal(forgetServersNamed("lookup:kit", d), 2);
  assert.equal(readApprovals()[forLookup.hash], undefined);
  assert.equal(readApprovals()[bare.hash], undefined);
  assert.equal(readApprovals()[other.hash]?.folder, "/another/folder");
  forgetServer(other.hash);
  // A number or a yes/no written bare in YAML is that text, as the cloud reads it.
  assert.deepEqual(agentMcpServers("---\nname: a\nmcpServers:\n  kit:\n    command: node\n    args: [--port, 8080, true]\n    env:\n      N: 5\n      ON: false\n---\nx"), { servers: [{ name: "kit", raw: { command: "node", args: ["--port", "8080", "true"], env: { N: "5", ON: "false" } } }] });
  fs.appendFileSync(path.join(d, "srv.mjs"), "\n// changed\n");
  const after = resolveAgentServer(lookup, lookup.mcp![0], d, ENV, false);
  assert.ok("hash" in after && after.hash !== forLookup.hash, "a changed script asks again");
  // The same strict reading as a session's server: a secret only by name, in env or headers.
  assert.match((resolveAgentServer(lookup, { name: "kit", raw: { command: "node", args: ["--token=${MY_TOKEN}"] } }, d, ENV, false) as any).problem, /a secret goes in "env" or "headers"/);
});

test("FOL-265: listing servers and starting none never loads the MCP engine; only a start does", async () => {
  const d = folder({ ".mcp.json": JSON.stringify({ mcpServers: { kit: { command: "node", args: ["srv.mjs"] } } }) });
  let loads = 0;
  const m = mcpManager({ dir: d, env: () => ENV, connect: (async () => { loads++; throw new Error("engine loaded"); }) as never });
  const { rows } = await m.look();
  assert.equal(rows[0]!.state, "waiting", "the server is listed without the engine");
  assert.deepEqual(await m.startReady(new AbortController().signal), [], "nothing with a yes, nothing started");
  assert.equal(loads, 0, "the engine is not touched by looking or by a turn with no server to start");
});

test("FOL-265: a session's start does not load core's MCP engine or the MCP library — only connecting a server does", () => {
  for (const f of fs.readdirSync(new URL("../src/", import.meta.url))) {
    const text = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /^import [^;]*["'](@foldrun\/core\/engine-mcp|@modelcontextprotocol\/sdk[^"']*)["']/m, `${f} loads the MCP engine at start`);
    if (f === "commands.mjs") continue;
    assert.doesNotMatch(text, /import\(["']@foldrun\/core\/engine-mcp["']\)|mcpEngine\(/, `${f} loads the MCP engine`);
  }
  const src = fs.readFileSync(new URL("../src/commands.mjs", import.meta.url), "utf8");
  const body = (name: string) => {
    const at = src.indexOf(`async function ${name}(`);
    assert.ok(at >= 0, `${name} is there`);
    return src.slice(at, src.indexOf("\n}\n", at));
  };
  // The engine is imported in one place, mcpEngine, and mcpEngine is called in one place, mcpConnect: so it loads
  // only when a server (the session's or a sub-agent's) is connected, never at a start, a /help or a turn with none.
  const imports = [...src.matchAll(/import\(["']@foldrun\/core\/engine-mcp["']\)/g)].map((m) => m.index!);
  assert.equal(imports.length, 1, "core's MCP engine is imported in one place only");
  assert.ok(body("mcpEngine").includes('import("@foldrun/core/engine-mcp")'), "that place is mcpEngine");
  const calls = [...src.matchAll(/(?<!function )mcpEngine\(\)/g)].map((m) => m.index!);
  assert.equal(calls.length, 1, "mcpEngine is called in one place only");
  const connectAt = src.indexOf("async function mcpConnect(");
  assert.ok(calls[0]! > connectAt && calls[0]! < src.indexOf("\n}\n", connectAt), "that place is mcpConnect");
});

test("a server at a web address goes through the sandbox (FOL-222): its site is allowed for the session, the walls are handed to the engine; a sandbox without a proxied fetch refuses it", async () => {
  const resolved = { spec: { type: "http", url: "https://mcp.example.com/mcp" }, hash: "h" };
  const allowed: string[] = [];
  const handed: any[] = [];
  const walls = { launch: async () => ({ line: "x", env: {} }), fetch: (async () => new Response("")) as typeof fetch };
  const o = {
    dir: os.tmpdir(),
    env: () => ({}),
    sandbox: async () => walls,
    allowSite: (h: string) => allowed.push(h),
    connect: async (_servers: any, ctx: any) => {
      handed.push(ctx.sandbox);
      return { tools: [], close: async () => {} };
    },
  };
  const got: any = await connectServer(o, "far", resolved, new AbortController().signal);
  assert.ok(!("why" in got), JSON.stringify(got));
  assert.deepEqual(allowed, ["mcp.example.com"]);
  assert.equal(handed[0], walls, "the engine gets the walls, and reaches the server through their proxy");
  // An older sandbox with no proxied fetch: refused, never connected directly.
  const older: any = await connectServer({ ...o, sandbox: async () => ({ launch: walls.launch }) }, "far", resolved, new AbortController().signal);
  assert.match(older.why, /cannot reach a server at a web address/);
  assert.equal(handed.length, 1);
  // The sandbox off (no walls): connected as the person, directly.
  const off: any = await connectServer({ ...o, sandbox: async () => null }, "far", resolved, new AbortController().signal);
  assert.ok(!("why" in off));
  assert.equal(handed[1], undefined);
});
