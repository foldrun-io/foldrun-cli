// `foldrun flow dup-step` — the canvas's Duplicate, from a terminal. Pins:
// the bytes are core's duplicateStep (copy under the original, same group,
// marker and options kept); additive, so no --yes; --dry-run writes
// nothing; --to sends the canvas's PATCH { edit: { op: "duplicate" } }.
//
//   node --test tests/cli-flow-dup-step.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { duplicateStep } from "@foldrun/core/flow-patterns";
import { serve, at } from "./fake-platform.ts";
import { createHash } from "node:crypto";
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, FOLDRUN_HOME: "/nonexistent/foldrun-home", NO_COLOR: "1" };
const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd, env: ENV });

const FLOW = `---
name: morning
trigger: manual
---

1. [[researcher]] — find the news
2!. [[writer]] — draft the brief
   retry: 2
3. [[watchdog]] — stray drop

Notes below stay.
`;
const agent = (name: string) => `---\nname: ${name}\ndescription: The ${name}.\nmodel: fast\n---\n\nYou are the ${name}.\n`;

function desk(): { root: string; ws: string } {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-dupstep-")), "acme");
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

test("by agent name: core's bytes, the copy beside the original with its marker and options; no --yes needed", () => {
  const { root, ws } = desk();
  const r = run(root, "flow", "dup-step", "morning", "--step", "writer");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(flowOf(ws), duplicateStep(FLOW, 1));
  assert.match(flowOf(ws), /(2!\. \[\[writer\]\] — draft the brief\n   retry: 2\n){2}3\./);
  assert.match(flowOf(ws), /Notes below stay\.\n$/);
  assert.match(r.stdout, /duplicate step 2 · writer/);
});

test("--dry-run shows the diff and writes nothing", () => {
  const { root, ws } = desk();
  const dry = run(root, "flow", "dup-step", "morning", "--step", "3", "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /\+ 3\. \[\[watchdog\]\]/);
  assert.match(dry.stdout, /--dry-run: nothing written/);
  assert.equal(flowOf(ws), FLOW);
});

test("usage: which step, and a step that is not there", () => {
  const { root } = desk();
  assert.match(run(root, "flow", "dup-step", "morning").stderr, /which step\? --step <n> or --step <agent>/);
  assert.match(run(root, "flow", "dup-step", "morning", "--step", "9").stderr, /has no step 9/);
});

test("--to sends the canvas's PATCH { edit: { op: duplicate } }", async () => {
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
  const r = await at(s.url, "flow", "dup-step", "morning", "--to", "blog-desk", "--step", "watchdog");
  s.close();
  assert.equal(r.code, 0, r.out);
  const patch = s.seen.find((x) => x.method === "PATCH");
  assert.ok(patch, "a PATCH was sent");
  assert.deepEqual(JSON.parse(patch!.body), { edit: { op: "duplicate", step: 2 }, expect: sha(FLOW) });
});
