// `foldrun flow rm-step` — the canvas's delete, from a terminal. Pins: the
// bytes are core's removeStep; what else changes is said first; no terminal
// needs --yes; --dry-run writes nothing; the agent's file is never touched;
// --to sends the canvas's PATCH { edit: { op: "remove" } }.
//
//   node --test tests/cli-flow-rm-step.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removeStep } from "@foldrun/core/flow-patterns";
import { serve, at } from "./fake-platform.ts";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, FOLDRUN_HOME: "/nonexistent/foldrun-home", NO_COLOR: "1" };
const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd, env: ENV });

const FLOW = `---
name: morning
trigger: manual
---

1. [[researcher]] — find the news
2. [[writer]] — draft the brief
   retry: 2
3. [[watchdog]] — stray drop

Notes below stay.
`;
const agent = (name: string) => `---\nname: ${name}\ndescription: The ${name}.\nmodel: fast\n---\n\nYou are the ${name}.\n`;

function desk(): { root: string; ws: string } {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-rmstep-")), "acme");
  spawnSync(process.execPath, [CLI, "init", root, "--workspace", "main"], { encoding: "utf8", env: ENV });
  const ws = path.join(root, "workspaces/main");
  for (const d of ["flows", "agents", "evals"]) fs.rmSync(path.join(ws, d), { recursive: true, force: true });
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  fs.writeFileSync(path.join(ws, "flows/morning.md"), FLOW);
  for (const a of ["researcher", "writer", "watchdog"]) {
    fs.mkdirSync(path.join(ws, "agents", a), { recursive: true });
    fs.writeFileSync(path.join(ws, "agents", a, "agent.md"), agent(a));
  }
  return { root, ws };
}
const flowOf = (ws: string) => fs.readFileSync(path.join(ws, "flows/morning.md"), "utf8");

test("--yes deletes the step, by agent name, with core's bytes; the agent file stays", () => {
  const { root, ws } = desk();
  const r = run(root, "flow", "rm-step", "morning", "--step", "watchdog", "--yes");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(flowOf(ws), removeStep(FLOW, 2));
  assert.match(flowOf(ws), /Notes below stay\./);
  assert.equal(fs.readFileSync(path.join(ws, "agents/watchdog/agent.md"), "utf8"), agent("watchdog"));
  assert.match(r.stdout, /delete step 3 · watchdog/);
  assert.match(r.stdout, /agents\/watchdog\/agent\.md is not touched/);
});

test("a middle step by number: its options go, the groups renumber, and it says so first", () => {
  const { root, ws } = desk();
  const r = run(root, "flow", "rm-step", "morning", "--step", "2", "--yes");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Group 3 after it renumbers to 2/);
  assert.doesNotMatch(flowOf(ws), /writer|retry: 2/);
  assert.match(flowOf(ws), /^2\. \[\[watchdog\]\] — stray drop$/m);
});

test("no terminal and no --yes: refused, nothing written; --dry-run shows the diff and writes nothing", () => {
  const { root, ws } = desk();
  const r = run(root, "flow", "rm-step", "morning", "--step", "3");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /pass --yes/);
  assert.equal(flowOf(ws), FLOW);
  const dry = run(root, "flow", "rm-step", "morning", "--step", "3", "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /- 3\. \[\[watchdog\]\]/);
  assert.match(dry.stdout, /--dry-run: nothing written/);
  assert.equal(flowOf(ws), FLOW);
});

test("usage: which step, and a step that is not there", () => {
  const { root } = desk();
  assert.match(run(root, "flow", "rm-step", "morning").stderr, /which step\? --step <n> or --step <agent>/);
  assert.match(run(root, "flow", "rm-step", "morning", "--step", "9", "--yes").stderr, /has no step 9/);
});

test("--to sends the canvas's PATCH { edit: { op: remove } }", async () => {
  const files: Record<string, string> = {
    "AGENTS.md": "---\nname: blog-desk\n---\n",
    "flows/morning.md": FLOW,
    "agents/researcher/agent.md": agent("researcher"),
    "agents/writer/agent.md": agent("writer"),
    "agents/watchdog/agent.md": agent("watchdog"),
  };
  const s = await serve({
    "/api/workspaces/blog-desk/source": (_b: string, q: URLSearchParams) => (q.get("path") ? { path: q.get("path"), content: files[q.get("path")!] } : { files: Object.keys(files) }),
    "/api/workspaces/blog-desk": () => ({ name: "blog-desk" }),
    "PATCH /api/workspaces/blog-desk/flows/morning": () => ({ ok: true }),
  });
  const r = await at(s.url, "flow", "rm-step", "morning", "--to", "blog-desk", "--step", "watchdog", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  const patch = s.seen.find((x) => x.method === "PATCH");
  assert.ok(patch, "a PATCH was sent");
  assert.deepEqual(JSON.parse(patch!.body), { edit: { op: "remove", step: 2 } });
});
