// `foldrun new` makes a blank workspace, and `foldrun agent import` brings an
// agent you already have in another workspace into it — not its memory.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const foldrun = (cwd: string, ...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, NO_COLOR: "1" },
  });

function account(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-import-"));
  const r = foldrun(root, "init", "acct", "--workspace", "blog");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return path.join(root, "acct");
}

test("new makes a blank workspace; --starter brings the example", () => {
  const acct = account();
  try {
    const r = foldrun(acct, "new", "fresh");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const ws = path.join(acct, "workspaces", "fresh");
    assert.deepEqual(fs.readdirSync(path.join(ws, "agents")), []);
    assert.deepEqual(fs.readdirSync(path.join(ws, "flows")), []);
    assert.ok(fs.existsSync(path.join(ws, "AGENTS.md")));
    const s = foldrun(acct, "new", "example", "--starter");
    assert.equal(s.status, 0, s.stdout + s.stderr);
    assert.ok(fs.existsSync(path.join(acct, "workspaces", "example", "agents", "researcher", "agent.md")));
  } finally {
    fs.rmSync(path.dirname(acct), { recursive: true, force: true });
  }
});

test("agent import copies the agent and its skills, not its memory, and refuses a clash", () => {
  const acct = account();
  try {
    assert.equal(foldrun(acct, "new", "fresh").status, 0);
    const blog = path.join(acct, "workspaces", "blog");
    // init's first workspace is the starter's: give its writer a skill and a memory.
    fs.mkdirSync(path.join(blog, "agents/writer/skills/house"), { recursive: true });
    fs.writeFileSync(path.join(blog, "agents/writer/skills/house/SKILL.md"), "---\nname: house\ndescription: How we write.\n---\n\nShort.\n");
    fs.mkdirSync(path.join(blog, "agents/writer/memory"), { recursive: true });
    fs.writeFileSync(path.join(blog, "agents/writer/memory/lesson.md"), "---\ntype: Fact\n---\n\nblog only\n");

    const fresh = path.join(acct, "workspaces", "fresh");
    const r = foldrun(fresh, "agent", "import", "blog/writer");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(path.join(fresh, "agents/writer/agent.md")));
    assert.ok(fs.existsSync(path.join(fresh, "agents/writer/skills/house/SKILL.md")));
    assert.equal(fs.existsSync(path.join(fresh, "agents/writer/memory")), false);

    const clash = foldrun(fresh, "agent", "import", "blog/writer");
    assert.equal(clash.status, 1);
    assert.match(clash.stdout + clash.stderr, /already has an agent called "writer"/);

    const renamed = foldrun(fresh, "agent", "import", "blog/writer", "--as", "editor");
    assert.equal(renamed.status, 0, renamed.stdout + renamed.stderr);
    assert.match(fs.readFileSync(path.join(fresh, "agents/editor/agent.md"), "utf8"), /^---\nname: editor\n/);
  } finally {
    fs.rmSync(path.dirname(acct), { recursive: true, force: true });
  }
});
