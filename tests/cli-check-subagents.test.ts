// `foldrun check` and `subagents:` — every delegation that would silently do
// less than it says is named offline: a name that is nothing, a sub-agent the
// model cannot pick (no description), one left with none of its tools.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const foldrun = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, NO_COLOR: "1" },
  });

function desk(agents: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-sub-"));
  const ws = path.join(root, "desk");
  for (const [name, front] of Object.entries(agents)) {
    fs.mkdirSync(path.join(ws, "agents", name), { recursive: true });
    fs.writeFileSync(path.join(ws, "agents", name, "agent.md"), `---\nname: ${name}\n${front}---\n\nWork.\n`);
  }
  return ws;
}

test("check names every sub-agent that would do less than it says", () => {
  const ws = desk({
    lead: "description: leads\ntools: [read]\nsubagents: [researcher, ghost, mute, shell]\n",
    researcher: "description: reads sources\ntools: [read]\n",
    mute: "tools: [read]\n",
    shell: "description: runs commands\ntools: [code]\n",
  });
  try {
    const r = foldrun("check", ws, "--local");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /subagents: \[ghost\] — no such agent/);
    assert.match(r.stdout, /agents\/mute.*no description/);
    assert.match(r.stdout, /subagents: \[shell\] — none of shell's tools are in lead's/);
    assert.doesNotMatch(r.stdout, /subagents: \[researcher\]/, "a good delegation says nothing");
  } finally {
    fs.rmSync(path.dirname(ws), { recursive: true, force: true });
  }
});

test("a clean delegation passes check", () => {
  const ws = desk({
    lead: "description: leads\ntools: [read, write]\nsubagents: [researcher]\n",
    researcher: "description: reads sources\ntools: [read]\n",
  });
  try {
    const r = foldrun("check", ws, "--local");
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    fs.rmSync(path.dirname(ws), { recursive: true, force: true });
  }
});
