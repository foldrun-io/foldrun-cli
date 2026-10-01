// Local `flow rm-step` / `flow add` / `flow dup-step` write a text computed
// from the file as it was read. If the file changed after that — someone
// edited it while rm-step waited at y/N, or an editor saved mid-check — the
// write would silently put back the old text with the edit on top. Each
// re-reads the file just before writing and refuses, writing nothing, when
// it no longer reads what the edit was made from. (--to has the same guard
// on the platform: `expect`, refused 409.)
//
//   node --test tests/cli-flow-write-stale.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { removeStep } from "@foldrun/core/flow-patterns";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, FOLDRUN_HOME: "/nonexistent/foldrun-home", NO_COLOR: "1" };

const FLOW = `---
name: morning
trigger: manual
---

1. [[researcher]] — find the news
2. [[writer]] — draft the brief
3. [[watchdog]] — stray drop
`;
// What someone else saved meanwhile: a new step 1, so "step 3" is now writer.
const MOVED = FLOW.replace("1. [[researcher]] — find the news\n", "1. [[intake]] — read the inbox\n2. [[researcher]] — find the news\n")
  .replace("2. [[writer]]", "3. [[writer]]")
  .replace("3. [[watchdog]]", "4. [[watchdog]]");
const agent = (name: string) => `---\nname: ${name}\ndescription: The ${name}.\nmodel: fast\n---\n\nYou are the ${name}.\n`;

function desk(): { root: string; ws: string; file: string } {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-stale-")), "acme");
  spawnSync(process.execPath, [CLI, "init", root, "--workspace", "main"], { encoding: "utf8", env: ENV });
  const ws = path.join(root, "workspaces/main");
  for (const d of ["flows", "agents", "evals"]) fs.rmSync(path.join(ws, d), { recursive: true, force: true });
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  fs.writeFileSync(path.join(ws, "flows/morning.md"), FLOW);
  for (const a of ["intake", "researcher", "writer", "watchdog"]) {
    fs.mkdirSync(path.join(ws, "agents", a), { recursive: true });
    fs.writeFileSync(path.join(ws, "agents", a, "agent.md"), agent(a));
  }
  return { root, ws, file: path.join(ws, "flows/morning.md") };
}

/** Run the CLI as if at a terminal (stdin.isTTY), answering the y/N prompt
 *  with `answer` — after `meanwhile()` has run. */
function atPrompt(cwd: string, args: string[], meanwhile: () => void, answer = "y\n"): Promise<{ code: number | null; out: string }> {
  const preload = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-tty-")), "tty.mjs");
  fs.writeFileSync(preload, "Object.defineProperty(process.stdin, 'isTTY', { value: true });\n");
  const child = spawn(process.execPath, ["--import", preload, CLI, ...args], { cwd, env: ENV });
  let out = "";
  let answered = false;
  const onData = (d: Buffer) => {
    out += d.toString();
    if (!answered && /\[y\/N\]/.test(out)) {
      answered = true;
      meanwhile();
      child.stdin.write(answer);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  return new Promise((resolve) => child.on("close", (code) => resolve({ code, out })));
}

test("rm-step: the file changed while it waited at y/N — refused, the other edit kept", async () => {
  const { root, file } = desk();
  const r = await atPrompt(root, ["flow", "rm-step", "morning", "--step", "3"], () => fs.writeFileSync(file, MOVED));
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /flows\/morning\.md changed since it was read/);
  assert.equal(fs.readFileSync(file, "utf8"), MOVED);
});

test("rm-step: unchanged at y/N — written as before", async () => {
  const { root, file } = desk();
  const r = await atPrompt(root, ["flow", "rm-step", "morning", "--step", "3"], () => {});
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(file, "utf8"), removeStep(FLOW, 2));
});

/** A preload that saves MOVED over the flow file right after the CLI first
 *  reads it — an editor saving while the command is checking its edit. */
function editedAfterRead(file: string) {
  const preload = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-race-")), "race.mjs");
  fs.writeFileSync(
    preload,
    `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const read = fs.readFileSync;
let done = false;
fs.readFileSync = function (p, ...rest) {
  const out = read.call(this, p, ...rest);
  if (!done && typeof p === "string" && p.endsWith("flows/morning.md") && fs.realpathSync(p) === ${JSON.stringify(fs.realpathSync(file))}) { done = true; fs.writeFileSync(p, ${JSON.stringify(MOVED)}); }
  return out;
};
syncBuiltinESMExports();
`,
  );
  return preload;
}

for (const args of [
  ["flow", "add", "morning", "approval", "--step", "3"],
  ["flow", "dup-step", "morning", "--step", "3"],
]) {
  test(`${args[1]}: the file changed after it was read — refused, the other edit kept`, () => {
    const { root, file } = desk();
    const r = spawnSync(process.execPath, ["--import", editedAfterRead(file), CLI, ...args], { encoding: "utf8", cwd: root, env: ENV });
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /flows\/morning\.md changed since it was read/);
    assert.equal(fs.readFileSync(file, "utf8"), MOVED);
  });
}
