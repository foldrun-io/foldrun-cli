// `foldrun agent new`, `flow new`, `tool new` — one document inside a
// workspace, with the frontmatter its format requires.
//
// The templates come from core, shared with the dashboard's New button and
// checked by the same validator. What these tests pin is that the files land
// in the RIGHT workspace in every folder shape, and that `foldrun check`
// passes on what was written — a scaffold the validator then rejects is
// worse than no scaffold.
//
//   node --test tests/cli-scaffold.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, NO_COLOR: "1" };

const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd, env: ENV });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-scaffold-"));
const read = (...p: string[]) => fs.readFileSync(path.join(...p), "utf8");
const exists = (...p: string[]) => fs.existsSync(path.join(...p));

/** An account with one workspace, and one with two. */
function account(...workspaces: string[]): string {
  const root = path.join(tmp(), "acme");
  spawnSync(process.execPath, [CLI, "init", root, "--workspace", workspaces[0]], { encoding: "utf8", env: ENV });
  for (const w of workspaces.slice(1)) run(root, "new", w);
  return root;
}

test("agent new writes the agent, names every key, and check passes on it", () => {
  const root = account("main");
  const r = run(root, "agent", "new", "checker");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const file = path.join(root, "workspaces/main/agents/checker/agent.md");
  assert.ok(fs.existsSync(file));
  assert.match(read(file), /^name: checker$/m);
  assert.match(r.stdout, /created agent checker/);
  // Every frontmatter key the template wrote is explained beside it.
  for (const key of ["name", "description", "model", "effort", "tools"]) {
    assert.match(r.stdout, new RegExp(`^\\s+${key}\\s`, "m"), `${key} is explained`);
  }
  assert.match(r.stdout, /foldrun check/);
  assert.equal(run(root, "check").status, 0, "the scaffold validates");
});

test("flow new names an agent that actually exists here", () => {
  const root = account("main");
  run(root, "agent", "new", "checker");
  const r = run(root, "flow", "new", "nightly");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const flow = read(root, "workspaces/main/flows/nightly.md");
  assert.match(flow, /^trigger: manual$/m);
  assert.match(flow, /\[\[(checker|researcher|writer)\]\]/, "a real agent, not a placeholder");
  assert.equal(run(root, "check").status, 0);
});

test("tool new makes a folder with the program beside the definition", () => {
  const root = account("main");
  const r = run(root, "tool", "new", "uuid-service");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(exists(root, "workspaces/main/tools/uuid-service/tool.md"));
  assert.ok(exists(root, "workspaces/main/tools/uuid-service/run.mjs"), "the code is a file, not a fenced block");
  assert.match(read(root, "workspaces/main/tools/uuid-service/tool.md"), /^transport: script$/m);
  assert.equal(run(root, "check").status, 0);
});

test("--language picks the program's language, and --transport its kind", () => {
  const root = account("main");
  assert.equal(run(root, "tool", "new", "py-thing", "--language", "python").status, 0);
  assert.ok(exists(root, "workspaces/main/tools/py-thing/run.py"));

  assert.equal(run(root, "tool", "new", "remote-api", "--transport", "http").status, 0);
  assert.match(read(root, "workspaces/main/tools/remote-api.md"), /^transport: http$/m);

  const bad = run(root, "tool", "new", "nope", "--transport", "carrier-pigeon");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--transport takes script, http or mcp/);
  assert.ok(!exists(root, "workspaces/main/tools/nope.md"), "nothing was written");
});

test("in an account with two workspaces it asks which, and --to answers", () => {
  const root = account("blog-desk", "ads-desk");
  const asked = run(root, "agent", "new", "checker");
  assert.equal(asked.status, 1);
  assert.match(asked.stderr, /which workspace\? --to <name> — this account has ads-desk, blog-desk/);

  const r = run(root, "agent", "new", "checker", "--to", "ads-desk");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(exists(root, "workspaces/ads-desk/agents/checker/agent.md"));
  assert.ok(!exists(root, "workspaces/blog-desk/agents/checker/agent.md"));

  const wrong = run(root, "agent", "new", "other", "--to", "nowhere-desk");
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /no workspace called "nowhere-desk" here/);
});

test("standing inside a workspace of an account needs no --to", () => {
  const root = account("blog-desk", "ads-desk");
  const inside = path.join(root, "workspaces", "ads-desk");
  const r = run(inside, "flow", "new", "nightly");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(exists(inside, "flows/nightly.md"));
});

test("a flat workspace works the same, with no account around it", () => {
  const dir = path.join(tmp(), "my-desk");
  spawnSync(process.execPath, [CLI, "init", dir, "--flat"], { encoding: "utf8", env: ENV });
  const r = run(dir, "agent", "new", "checker");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(exists(dir, "agents/checker/agent.md"));
  assert.equal(run(dir, "check").status, 0);
});

test("a folder that is not a workspace is told what it is", () => {
  const dir = tmp();
  const r = run(dir, "agent", "new", "checker");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /not a workspace/);
});

test("it refuses to overwrite one that exists, and the name must be kebab-case", () => {
  const root = account("main");
  assert.equal(run(root, "agent", "new", "checker").status, 0);
  const twice = run(root, "agent", "new", "checker");
  assert.equal(twice.status, 1);
  assert.match(twice.stderr, /already has agents\/checker\/agent\.md — refusing to overwrite/);

  const shouty = run(root, "agent", "new", "Checker One");
  assert.equal(shouty.status, 1);
  assert.match(shouty.stderr, /kebab-case only/);
});

test("new is the only verb, and a missing name says what to type", () => {
  const root = account("main");
  const verb = run(root, "agent", "edit", "checker");
  assert.equal(verb.status, 1);
  assert.match(verb.stderr, /new, run are the verbs, not "edit"/);

  const nameless = run(root, "flow", "new");
  assert.equal(nameless.status, 1);
  assert.match(nameless.stderr, /which flow\? `foldrun flow new <name>`/);
});
