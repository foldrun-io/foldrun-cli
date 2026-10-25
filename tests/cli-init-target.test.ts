// `foldrun init <dir>` scaffolds in <dir>, whatever its parents hold.
//
//   node --test tests/cli-init-target.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cli } from "./fake-platform.ts";

test("init under a folder that holds an unrelated agents/ makes the account where it was asked", async () => {
  // The shape of a home directory with ~/agents (a git repo of that name):
  // the parent passes core's workspace test, and init used to write into it.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-init-"));
  fs.mkdirSync(path.join(home, "agents", "leads"), { recursive: true });
  fs.writeFileSync(path.join(home, "agents", "README.md"), "not foldrun\n");
  const target = path.join(home, "projects", "acct");
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const r = await cli(["init", target]);
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(target, "AGENTS.md")), "the account root is the directory given");
  assert.ok(fs.existsSync(path.join(target, "workspaces", "main")), "with its first workspace inside it");
  assert.ok(!fs.existsSync(path.join(home, "workspaces")), "nothing is scaffolded into the folder above");
  assert.ok(!fs.existsSync(path.join(home, "AGENTS.md")));
  assert.ok(!fs.existsSync(path.join(home, "projects", "AGENTS.md")));
  fs.rmSync(home, { recursive: true, force: true });
});

test("init with the default directory (.) uses the current directory, not a parent workspace", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-init-"));
  fs.mkdirSync(path.join(home, "agents"), { recursive: true });
  const here = path.join(home, "new-acct");
  fs.mkdirSync(here);
  const r = await cli(["init"], { cwd: here });
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(here, "AGENTS.md")));
  assert.ok(!fs.existsSync(path.join(home, "workspaces")));
  fs.rmSync(home, { recursive: true, force: true });
});
