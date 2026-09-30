// `foldrun flow add`, `flow show`, `agent link` / `unlink` — the dashboard
// canvas, from a terminal.
//
// What these pin: the bytes each pattern writes are core's (the canvas's)
// bytes, byte for byte; an edit `check` would call an error is refused and
// nothing is written; --dry-run writes nothing; on a platform the edit goes
// as the canvas sends it (PATCH { edit } / { list } / { set }); and `flow
// show` is plain text when it is not talking to a person.
//
//   node --test tests/cli-flow-patterns.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { applyPatternEdit, editFrontmatterList, setFrontmatterScalar } from "@foldrun/core/flow-patterns";
import { serve, at } from "./fake-platform.ts";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, FOLDRUN_HOME: "/nonexistent/foldrun-home", NO_COLOR: "1" };
const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd, env: ENV });

const FLOW = `---
name: publish
trigger: schedule
schedule: "0 9 * * 1"   # Monday
timezone: Australia/Sydney
---

Prose above the steps stays.

1. [[researcher]] — find one topic
2. [[writer]] — draft it
3. [[editor]] — tighten it

Notes below stay too.
`;
const agent = (name: string, extra = "", description = `The ${name}.`) =>
  `---\nname: ${name}\n${description ? `description: ${description}\n` : ""}model: fast\ntools: [write]\n${extra}---\n\nYou are the ${name}.\n`;

/** An account with one workspace holding the flow above and its agents. */
function desk(): { root: string; ws: string } {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-patterns-")), "acme");
  spawnSync(process.execPath, [CLI, "init", root, "--workspace", "main"], { encoding: "utf8", env: ENV });
  const ws = path.join(root, "workspaces/main");
  fs.rmSync(path.join(ws, "flows"), { recursive: true, force: true });
  fs.rmSync(path.join(ws, "agents"), { recursive: true, force: true });
  fs.rmSync(path.join(ws, "evals"), { recursive: true, force: true });
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  fs.writeFileSync(path.join(ws, "flows/publish.md"), FLOW);
  fs.writeFileSync(path.join(ws, "flows/digest.md"), "---\nname: digest\ntrigger: manual\n---\n\n1. [[writer]] — sum it up\n");
  for (const a of ["researcher", "writer", "editor", "fixer"]) {
    fs.mkdirSync(path.join(ws, "agents", a), { recursive: true });
    fs.writeFileSync(path.join(ws, "agents", a, "agent.md"), agent(a));
  }
  fs.mkdirSync(path.join(ws, "agents/bare"), { recursive: true });
  fs.writeFileSync(path.join(ws, "agents/bare/agent.md"), agent("bare", "", ""));
  return { root, ws };
}
const flowOf = (ws: string) => fs.readFileSync(path.join(ws, "flows/publish.md"), "utf8");

// Every palette block: the CLI's flags, and the edit the canvas would post.
const CASES: [string, string[], any][] = [
  ["chain", ["--agent", "fixer", "--instruction", "check it", "--after", "1"], { op: "insert", target: "fixer", instruction: "check it", at: { rail: 1 } }],
  ["step (chain's alias), last by default", ["--agent", "fixer"], { op: "insert", target: "fixer", at: { rail: 3 } }],
  ["parallel", ["--agent", "fixer", "--group", "2"], { op: "insert", target: "fixer", at: { column: 1 } }],
  ["router", ["--agent", "researcher", "--instruction", "reply BUG or DOCS", "--cases", "BUG=writer,DOCS=editor", "--else", "fixer", "--after", "3"],
    { op: "router", router: "researcher", instruction: "reply BUG or DOCS", rail: 3, cases: [{ value: "BUG", target: "writer" }, { value: "DOCS", target: "editor" }], else: "fixer" }],
  ["fan-out", ["--step", "2", "--each", "lines", "--max", "5"], { op: "options", step: 1, set: { each: "lines", max: "5" } }],
  ["loop", ["--step", "editor", "--loop", "2", "--until", "SHIP", "--judge", "cites every source"], { op: "options", step: 2, set: { loop: "2", until: "SHIP", verify: "judge: cites every source" } }],
  ["approval", ["--step", "3"], { op: "approve", step: 2, on: true }],
  ["ask", ["--step", "1", "--question", "Which topic?"], { op: "options", step: 0, set: { ask: "Which topic?" } }],
  ["wait", ["--step", "2", "--wait", "30m"], { op: "options", step: 1, set: { wait: "30m" } }],
  ["wait (event)", ["--step", "2", "--wait", "event"], { op: "options", step: 1, set: { wait: "event" } }],
  ["rescue", ["--step", "2", "--on-fail", "fixer"], { op: "options", step: 1, set: { "on-fail": "fixer" } }],
  ["subflow", ["--flow", "digest", "--after", "0"], { op: "insert", target: "digest", subflow: true, at: { rail: 0 } }],
];

for (const [label, args, edit] of CASES) {
  test(`flow add ${label} writes exactly what the canvas writes`, () => {
    const { root, ws } = desk();
    const pattern = label.split(" ")[0];
    const r = run(root, "flow", "add", "publish", pattern, ...args);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(flowOf(ws), applyPatternEdit(FLOW, edit));
    assert.match(r.stdout, /flows\/publish\.md/);
    assert.match(r.stdout, /^\s+\+ /m, "the diff is printed");
  });
}

test("--off takes a pattern back off, to the byte", () => {
  const { root, ws } = desk();
  run(root, "flow", "add", "publish", "ask", "--step", "1", "--question", "Which?");
  run(root, "flow", "add", "publish", "approval", "--step", "2");
  assert.equal(run(root, "flow", "add", "publish", "ask", "--step", "1", "--off").status, 0);
  assert.equal(run(root, "flow", "add", "publish", "approval", "--step", "2", "--off").status, 0);
  assert.equal(flowOf(ws), FLOW);
});

test("--dry-run prints the diff and writes nothing", () => {
  const { root, ws } = desk();
  const r = run(root, "flow", "add", "publish", "chain", "--agent", "fixer", "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\+ 4\. \[\[fixer\]\]/);
  assert.match(r.stdout, /--dry-run: nothing written/);
  assert.equal(flowOf(ws), FLOW);
});

test("an edit check would call an error is refused, and nothing is written", () => {
  const { root, ws } = desk();
  const r = run(root, "flow", "add", "publish", "chain", "--agent", "nobody");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /\[\[nobody\]\] is not an agent/);
  assert.match(r.stdout, /refused/);
  assert.equal(flowOf(ws), FLOW);
  const sub = run(root, "flow", "add", "publish", "subflow", "--flow", "nothing-here");
  assert.equal(sub.status, 1);
  assert.match(sub.stdout, /\[\[flow:nothing-here\]\] does not exist/);
  assert.equal(flowOf(ws), FLOW);
});

// An error already in the workspace — here a folder tool whose program is
// gone, whose message names a path — is not the edit's doing. Each check runs
// on a fresh temporary copy, so the path differs; it must still match.
test("an error that was there before the edit does not block it", () => {
  const { root, ws } = desk();
  fs.mkdirSync(path.join(ws, "tools/broken"), { recursive: true });
  fs.writeFileSync(path.join(ws, "tools/broken/tool.md"), "---\nname: broken\ntransport: script\nrun: run.mjs\ndescription: gone\n---\n");
  const before = run(root, "check");
  assert.match(before.stdout, /tools\/broken/, "check does report it");
  const r = run(root, "flow", "add", "publish", "approval", "--step", "3");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /refused/);
});

test("a value the grammar cannot read is refused in the parser's words", () => {
  const { root, ws } = desk();
  const r = run(root, "flow", "add", "publish", "loop", "--step", "2", "--loop", "9");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /loop: is a whole number of extra cycles, 1 to 5/);
  const each = run(root, "flow", "add", "publish", "fan-out", "--step", "2", "--each", "columns");
  assert.match(each.stderr, /lines, items, or rows/);
  assert.equal(flowOf(ws), FLOW);
});

test("usage errors name what is missing", () => {
  const { root } = desk();
  assert.match(run(root, "flow", "add", "publish").stderr, /the patterns are chain, parallel, router, fan-out, loop, approval, ask, wait, rescue, subflow/);
  assert.match(run(root, "flow", "add", "publish", "teleport").stderr, /"teleport" is not a pattern/);
  assert.match(run(root, "flow", "add", "publish", "ask", "--question", "x").stderr, /which step\? --step <n> or --step <agent> — publish has 1 researcher, 2 writer, 3 editor/);
  assert.match(run(root, "flow", "add", "publish", "parallel", "--agent", "fixer").stderr, /--group <1-3>/);
  assert.match(run(root, "flow", "add", "nope", "chain", "--agent", "fixer").stderr, /no flow "nope"/);
});

test("--help on the new verbs prints help and touches nothing", () => {
  const { root, ws } = desk();
  for (const args of [["flow", "add", "publish", "chain", "--agent", "fixer", "--help"], ["agent", "link", "writer", "--can-ask", "-h"], ["help", "flow"]]) {
    const r = run(root, ...args);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /foldrun flow add <flow> <pattern>|foldrun agent link/);
  }
  assert.equal(flowOf(ws), FLOW);
  assert.doesNotMatch(fs.readFileSync(path.join(ws, "agents/writer/agent.md"), "utf8"), /ask/);
});

test("agent link / unlink edit one frontmatter list, byte for byte, and say who else uses the agent", () => {
  const { root, ws } = desk();
  const file = path.join(ws, "agents/writer/agent.md");
  const before = fs.readFileSync(file, "utf8");
  const r = run(root, "agent", "link", "writer", "--consult", "editor");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(file, "utf8"), editFrontmatterList(before, "agents", "editor", "add"));
  assert.match(r.stdout, /used by 2 flows \(digest, publish\)/);

  assert.equal(run(root, "agent", "link", "writer", "--can-ask").status, 0);
  assert.match(fs.readFileSync(file, "utf8"), /^tools: \[write, ask\]$/m);
  assert.equal(run(root, "agent", "unlink", "writer", "--can-ask").status, 0);
  assert.equal(run(root, "agent", "unlink", "writer", "--consult", "editor").status, 0);
  assert.equal(fs.readFileSync(file, "utf8"), editFrontmatterList(before, "agents", "editor", "add").replace("agents: [editor]", "agents: []"));

  const again = run(root, "agent", "unlink", "writer", "--consult", "editor");
  assert.match(again.stdout, /does not have editor as a consult — nothing to remove/);
  assert.match(run(root, "agent", "link", "writer", "--consult", "writer").stderr, /does not consult itself/);
  assert.match(run(root, "agent", "link", "writer", "--consult", "ghost").stderr, /no agent "ghost"/);
  assert.match(run(root, "agent", "link", "writer").stderr, /exactly one of them/);
});

test("a sub-agent with no description needs one: --description, or it refuses with no terminal", () => {
  const { root, ws } = desk();
  const refused = run(root, "agent", "link", "writer", "--subagent", "bare");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /bare has no description:.*--description/);
  assert.doesNotMatch(fs.readFileSync(path.join(ws, "agents/writer/agent.md"), "utf8"), /subagents/);

  const bareBefore = fs.readFileSync(path.join(ws, "agents/bare/agent.md"), "utf8");
  const r = run(root, "agent", "link", "writer", "--subagent", "bare", "--description", "Checks the draft's facts.");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(ws, "agents/bare/agent.md"), "utf8"), setFrontmatterScalar(bareBefore, "description", "Checks the draft's facts."));
  assert.match(fs.readFileSync(path.join(ws, "agents/writer/agent.md"), "utf8"), /^subagents: \[bare\]$/m);
});

test("flow show draws the groups, the chips and each agent's team — plain text on a pipe", () => {
  const { root, ws } = desk();
  run(root, "flow", "add", "publish", "parallel", "--agent", "fixer", "--group", "2");
  run(root, "flow", "add", "publish", "loop", "--step", "editor", "--loop", "2", "--until", "SHIP");
  run(root, "flow", "add", "publish", "approval", "--step", "editor");
  run(root, "flow", "add", "publish", "rescue", "--step", "researcher", "--on-fail", "fixer");
  run(root, "flow", "add", "publish", "wait", "--step", "writer", "--wait", "4h");
  run(root, "agent", "link", "writer", "--subagent", "fixer");
  run(root, "agent", "link", "writer", "--consult", "editor");
  run(root, "agent", "link", "writer", "--can-ask");
  fs.appendFileSync(path.join(ws, "flows/publish.md"), "4. [[ghost]] — nobody\n");

  // No NO_COLOR here: not a terminal is enough to drop the escapes.
  const r = spawnSync(process.execPath, [CLI, "flow", "show", "publish"], { encoding: "utf8", cwd: root, env: { ...ENV, NO_COLOR: undefined } });
  assert.doesNotMatch(r.stdout, /\x1b\[/, "no colour when not a terminal");
  assert.match(r.stdout, /trigger\s+schedule 0 9 \* \* 1 · Australia\/Sydney/);
  assert.match(r.stdout, /1\.\s+researcher\s+\[on-fail → fixer\]/);
  assert.match(r.stdout, /2\.\s+2 in parallel/);
  assert.match(r.stdout, /├ writer\s+\[wait 4h\]/);
  assert.match(r.stdout, /└ fixer/);
  assert.match(r.stdout, /3\.\s+editor\s+\[approve\] \[loop 2 until SHIP\]/);
  assert.match(r.stdout, /↳ sub-agent fixer/);
  assert.match(r.stdout, /· consults editor/);
  assert.match(r.stdout, /may ask you/);
  assert.match(r.stdout, /4\.\s+ghost[\s\S]*✗ \[\[ghost\]\] is not an agent/, "check's error sits on its step");
  assert.equal(r.status, 1, "a flow with a check error exits 1");
});

// ---------------------------------------------------------------- on a platform

function platformDesk() {
  const files: Record<string, string> = {
    "AGENTS.md": "---\nname: blog-desk\n---\n",
    "flows/publish.md": FLOW,
    "agents/researcher/agent.md": agent("researcher"),
    "agents/writer/agent.md": agent("writer"),
    "agents/editor/agent.md": agent("editor"),
    "agents/bare/agent.md": agent("bare", "", ""),
  };
  return {
    files,
    routes: {
      "/api/workspaces/blog-desk/source": (_b: string, q: URLSearchParams) => (q.get("path") ? { path: q.get("path"), content: files[q.get("path")!] } : { files: Object.keys(files) }),
      "/api/workspaces/blog-desk": () => ({ name: "blog-desk" }),
      "PATCH /api/workspaces/blog-desk/flows/publish": () => ({ ok: true }),
      "PATCH /api/workspaces/blog-desk/agents/writer": () => ({ ok: true, changed: true }),
      "PATCH /api/workspaces/blog-desk/agents/bare": () => ({ ok: true, changed: true }),
    },
  };
}

test("--to edits the deployed copy with the canvas's own PATCH { edit }", async () => {
  const d = platformDesk();
  const s = await serve(d.routes);
  const r = await at(s.url, "flow", "add", "publish", "router", "--to", "blog-desk", "--agent", "researcher", "--cases", "BUG=writer", "--else", "editor");
  s.close();
  assert.equal(r.code, 0, r.out);
  const patch = s.seen.find((x) => x.method === "PATCH");
  assert.ok(patch, "a PATCH was sent");
  assert.deepEqual(JSON.parse(patch!.body), {
    edit: { op: "router", router: "researcher", rail: 3, cases: [{ value: "BUG", target: "writer" }], else: "editor" },
  });
  assert.match(r.out, /\+ 5\. \[\[writer\]\]/);
  assert.match(r.out, /in blog-desk — a revision on the platform/);
});

test("--to with --dry-run, or an edit check refuses, sends no PATCH", async () => {
  const d = platformDesk();
  const s = await serve(d.routes);
  const dry = await at(s.url, "flow", "add", "publish", "ask", "--to", "blog-desk", "--step", "1", "--question", "Which?", "--dry-run");
  const bad = await at(s.url, "flow", "add", "publish", "chain", "--to", "blog-desk", "--agent", "ghost");
  s.close();
  assert.equal(dry.code, 0, dry.out);
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /refused/);
  assert.equal(s.seen.filter((x) => x.method === "PATCH").length, 0);
});

test("agent link --to posts the description first, then the list edit", async () => {
  const d = platformDesk();
  const s = await serve(d.routes);
  const r = await at(s.url, "agent", "link", "writer", "--to", "blog-desk", "--subagent", "bare", "--description", "Checks facts.");
  s.close();
  assert.equal(r.code, 0, r.out);
  const patches = s.seen.filter((x) => x.method === "PATCH").map((x) => [x.url, JSON.parse(x.body)]);
  assert.deepEqual(patches, [
    ["/api/workspaces/blog-desk/agents/bare", { set: { key: "description", value: "Checks facts." } }],
    ["/api/workspaces/blog-desk/agents/writer", { list: { key: "subagents", name: "bare", action: "add" } }],
  ]);
});

test("flow show --to reads the deployed copy", async () => {
  const d = platformDesk();
  d.files["flows/publish.md"] = FLOW.replace("2. [[writer]] — draft it", "2!. [[writer]] — draft it\n   ask: Which list?");
  const s = await serve(d.routes);
  const r = await at(s.url, "flow", "show", "publish", "--to", "blog-desk");
  s.close();
  assert.match(r.out, /blog-desk on http/);
  assert.match(r.out, /2\.\s+writer\s+\[approve\] \[ask: Which list\?\]/);
});
