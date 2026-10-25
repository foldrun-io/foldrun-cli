// `foldrun hook ls / add / test / rm`, and what `foldrun check` says about
// hooks: a folder that is not a hook, a `hooks:` name that resolves to
// nothing (an error — a run refuses that step), and a tool.call hook on an
// agent whose web search the model provider runs (a warning — those calls
// never reach the hook). Local verbs through the real binary in a temp
// account; `hook test --to` against a fake platform.
//
//   node --test tests/cli-hooks.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, at, cli } from "./fake-platform.ts";

/** An account folder with one workspace, `main`, and one agent in it. */
function account(agent = "---\nname: a\ndescription: Does a thing.\n---\n\nYou do it.\n"): { root: string; ws: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-hooks-"));
  const ws = path.join(root, "workspaces/main");
  fs.mkdirSync(path.join(ws, "agents/a"), { recursive: true });
  fs.mkdirSync(path.join(root, "library"), { recursive: true });
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# acct\n\nThe account.\n");
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "# main\n\nOne workspace.\n");
  fs.writeFileSync(path.join(ws, "agents/a/agent.md"), agent);
  return { root, ws };
}
const run = (root: string, ...args: string[]) => cli(args, { cwd: root, env: { FOLDRUN_DATA: path.join(root, ".foldrun") } });

test("hook add scaffolds hook.md + run.mjs; ls lists workspace and library hooks; test runs the template and it allows", async () => {
  const { root, ws } = account();
  const add = await run(root, "hook", "add", "guard", "--on", "tool.call", "--tool", "Write|Edit");
  assert.equal(add.code, 0, add.out);
  assert.match(fs.readFileSync(path.join(ws, "hooks/guard/hook.md"), "utf8"), /^---\non: tool\.call\ntool: "Write\|Edit"\n/);
  const code = fs.readFileSync(path.join(ws, "hooks/guard/run.mjs"), "utf8");
  assert.match(code, /exit 2 denies/i);
  assert.match(code, /decision: "allow"/);
  const lib = await run(root, "hook", "add", "audit", "--on", "step.end", "--library");
  assert.equal(lib.code, 0, lib.out);
  assert.ok(fs.existsSync(path.join(root, "library/hooks/audit/run.mjs")));

  const ls = await run(root, "hook", "ls");
  assert.equal(ls.code, 0, ls.out);
  assert.match(ls.out, /guard\s+workspace\s+tool\.call\s+Write\|Edit/);
  assert.match(ls.out, /audit\s+library\s+step\.end/);
  const json = JSON.parse((await run(root, "hook", "ls", "--json")).out);
  assert.deepEqual(json.map((h: { name: string; scope: string; on: string }) => [h.name, h.scope, h.on]), [["guard", "workspace", "tool.call"], ["audit", "account", "step.end"]]);

  const t = await run(root, "hook", "test", "guard", "--event", '{"tool":{"name":"Write","input":{"file_path":"x"}}}');
  assert.equal(t.code, 0, t.out);
  assert.match(t.out, /✓ guard\s+tool\.call · main · \d+ms/);
  assert.match(t.out, /decision\s+allow/);
  const w = await run(root, "hook", "test", "audit");
  assert.equal(w.code, 0, w.out);
  assert.match(w.out, /no --event, so a sample step\.end event/);
  assert.match(w.out, /audit\s+step\.end · library/);

  // Wrong --on, --tool on a step event, an existing name: refused, nothing written.
  assert.match((await run(root, "hook", "add", "x", "--on", "run.end")).out, /--on takes tool\.call, tool\.result, step\.start, step\.end — not "run\.end"/);
  assert.match((await run(root, "hook", "add", "x", "--on", "step.start", "--tool", "Bash")).out, /--tool only means something on tool\.call and tool\.result/);
  assert.match((await run(root, "hook", "add", "guard", "--on", "tool.call")).out, /refusing to overwrite/);
  assert.ok(!fs.existsSync(path.join(ws, "hooks/x")));
  fs.rmSync(root, { recursive: true, force: true });
});

test("hook test: exit 2 is a deny with stderr as the reason; a hook that crashes is a failure and exits 1", async () => {
  const { root, ws } = account();
  await run(root, "hook", "add", "no-rm", "--on", "tool.call", "--tool", "Bash");
  fs.writeFileSync(path.join(ws, "hooks/no-rm/run.mjs"), 'process.stderr.write("not rm -rf"); process.exit(2);\n');
  const deny = await run(root, "hook", "test", "no-rm", "--event", '{"tool":{"name":"Bash","input":{"command":"rm -rf /"}}}');
  assert.equal(deny.code, 0, deny.out);
  assert.match(deny.out, /decision\s+deny/);
  assert.match(deny.out, /reason\s+not rm -rf/);
  fs.writeFileSync(path.join(ws, "hooks/no-rm/run.mjs"), 'throw new Error("boom");\n');
  const crash = await run(root, "hook", "test", "no-rm");
  assert.equal(crash.code, 1, crash.out);
  assert.match(crash.out, /✗ no-rm[\s\S]*failed\s+exited 1/);
  assert.match((await run(root, "hook", "test", "ghost")).out, /no hook named ghost in hooks\/ or the library/);
  assert.match((await run(root, "hook", "test", "no-rm", "--event", "{nope")).out, /--event is not JSON/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("hook rm names the agents that still turn it on, needs --yes without a terminal, and deletes the folder", async () => {
  const { root, ws } = account("---\nname: a\ndescription: Does a thing.\nhooks: [guard]\n---\n\nYou do it.\n");
  await run(root, "hook", "add", "guard", "--on", "tool.call");
  const pipe = await run(root, "hook", "rm", "guard");
  assert.equal(pipe.code, 1);
  assert.match(pipe.out, /pass --yes/);
  assert.ok(fs.existsSync(path.join(ws, "hooks/guard")));
  const rm = await run(root, "hook", "rm", "guard", "--yes");
  assert.equal(rm.code, 0, rm.out);
  assert.match(rm.out, /removed hooks\/guard — take it out of: main\/agents\/a/);
  assert.ok(!fs.existsSync(path.join(ws, "hooks/guard")));
  assert.match((await run(root, "hook", "rm", "guard", "--yes")).out, /no hooks\/guard in main/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("check: a bad hook.md and a hook folder with no run.mjs are errors; a library hook is checked once, as library/", async () => {
  const { root, ws } = account();
  fs.mkdirSync(path.join(ws, "hooks/bad"), { recursive: true });
  fs.writeFileSync(path.join(ws, "hooks/bad/hook.md"), "---\non: step.start\ntool: Bash\ntimeout: 500\n---\n");
  fs.writeFileSync(path.join(ws, "hooks/bad/run.mjs"), 'console.log("{}");\n');
  fs.mkdirSync(path.join(ws, "hooks/half"), { recursive: true });
  fs.writeFileSync(path.join(ws, "hooks/half/hook.md"), "---\non: tool.call\n---\n");
  fs.mkdirSync(path.join(root, "library/hooks/late"), { recursive: true });
  fs.writeFileSync(path.join(root, "library/hooks/late/hook.md"), "---\non: step.end\ntimeout: 0\n---\n");
  fs.writeFileSync(path.join(root, "library/hooks/late/run.mjs"), "\n");
  const r = await run(root, "check");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /error\s+hooks\/bad\/hook\.md\s+tool: only means something on tool\.call and tool\.result/);
  assert.match(r.out, /error\s+hooks\/half\s+no run\.mjs beside hook\.md/);
  assert.match(r.out, /library\/hooks\/late\/hook\.md\s+timeout: is seconds, 1 to 120/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("check: a hooks: name in an agent or AGENTS.md that is in neither hooks/ nor the library is an error", async () => {
  const { root, ws } = account("---\nname: a\ndescription: Does a thing.\nhooks: [guard, ghost]\n---\n\nYou do it.\n");
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nhooks: [phantom]\n---\n# main\n");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "---\nhooks: [shared]\n---\n# acct\n");
  await run(root, "hook", "add", "guard", "--on", "tool.call");
  await run(root, "hook", "add", "shared", "--on", "step.start", "--library");
  const r = await run(root, "check");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /error\s+agents\/a\s+hooks: \[ghost\] — no hooks\/ghost\/hook\.md in this workspace or the account library/);
  assert.match(r.out, /error\s+AGENTS\.md\s+hooks: \[phantom\]/);
  assert.doesNotMatch(r.out, /hooks: \[guard\]|hooks: \[shared\]/, "a workspace hook and a library hook both resolve");
  fs.rmSync(root, { recursive: true, force: true });
});

test("check: a tool.call hook on an agent whose web search runs at the model provider is a warning; a search API is not", async () => {
  const agent = (search: string) => `---\nname: a\ndescription: Does a thing.\ntools: [web]\nhooks: [guard]\nweb:\n  search: ${search}\n---\n\nYou do it.\n`;
  const { root, ws } = account(agent("anthropic"));
  await run(root, "hook", "add", "guard", "--on", "tool.call");
  const r = await run(root, "check");
  assert.match(r.out, /warn\s+agents\/a\s+web\.search: anthropic runs on the model provider's servers, so tool\.call hook guard never sees those calls/);
  fs.writeFileSync(path.join(ws, "agents/a/agent.md"), agent("brave"));
  const ok = await run(root, "check");
  assert.doesNotMatch(ok.out, /never sees/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("hook test --to posts { event } to the deployed workspace's hooks/<name>/test and prints the answer", async () => {
  const s = await serve({
    "POST /api/workspaces/blog-desk/hooks/guard/test": () => ({ on: "tool.call", ok: true, decision: "deny", reason: "no pushes", ms: 12 }),
  });
  const r = await at(s.url, "hook", "test", "guard", "--to", "blog-desk", "--event", '{"tool":{"name":"Bash","input":{"command":"git push"}}}');
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /guard\s+tool\.call · blog-desk · 12ms/);
  assert.match(r.out, /decision\s+deny/);
  assert.match(r.out, /reason\s+no pushes/);
  const post = s.seen.find((x) => x.method === "POST")!;
  assert.equal(post.url, "/api/workspaces/blog-desk/hooks/guard/test");
  assert.deepEqual(JSON.parse(post.body), { event: { tool: { name: "Bash", input: { command: "git push" } } } });
});

test("hook --help names every verb and touches nothing", async () => {
  const s = await serve({});
  const r = await at(s.url, "hook", "test", "x", "--to", "blog-desk", "--help");
  s.close();
  assert.equal(r.code, 0, r.out);
  for (const v of [/foldrun hook ls/, /foldrun hook add <name> --on <event>/, /foldrun hook test <name>/, /foldrun hook rm <name>/, /--on <event>\s+hook add:/, /--event <json\|@file>\s+hook test:/, /--library\s+hook add, hook rm:/]) {
    assert.match(r.out, v);
  }
  assert.equal(s.seen.length, 0);
});

test("hook ls --to <ws> reads the DEPLOYED workspace's hooks: who turns each on, and what they did lately", async () => {
  const doc = {
    hooks: [
      { name: "no-rm-rf", scope: "workspace", path: "hooks/no-rm-rf", onFor: ["writer"], on: "tool.call", tool: "Bash", timeoutSec: 10, description: "refuses rm -rf" },
      { name: "audit", scope: "account", path: "hooks/audit", onFor: [], error: "run.mjs is missing" },
    ],
    recent: [{ runId: "run-1", flow: "publish", agent: "writer", step: 2, t: "2026-10-13T01:02:03Z", record: { hook: "no-rm-rf", event: "tool.call", did: "deny", tool: "Bash", reason: "rm -rf is refused", ms: 4 } }],
  };
  const s = await serve({ "/api/workspaces/blog-desk/hooks": (_b: unknown, q: URLSearchParams) => ({ ...doc, q: q.toString() }) });
  const r = await at(s.url, "hook", "ls", "--to", "blog-desk", "--runs", "200", "--all");
  const j = await at(s.url, "hook", "ls", "--to", "blog-desk", "--json");
  s.close();
  assert.equal(s.seen[0].method, "GET");
  assert.equal(s.seen[0].url, "/api/workspaces/blog-desk/hooks");
  assert.equal(s.seen[0].query.get("runs"), "200");
  assert.equal(s.seen[0].query.get("all"), "1");
  assert.equal(r.code, 1, "an invalid hook fails the listing, as locally");
  assert.match(r.out, /✓ no-rm-rf\s+workspace\s+tool\.call\s+Bash\s+on for writer — refuses rm -rf/);
  assert.match(r.out, /✗ audit\s+library\s+run\.mjs is missing/);
  assert.match(r.out, /2026-10-13 01:02\s+no-rm-rf deny tool\.call Bash\s+run-1 step 2 writer — rm -rf is refused/);
  assert.deepEqual(JSON.parse(j.out.slice(j.out.indexOf("{"))).hooks, doc.hooks);
});
