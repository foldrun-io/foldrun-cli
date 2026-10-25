// `agent link <agent> --subagent <worker> --isolated` writes `sandbox: own`
// on the worker — its jobs run in a sandbox of their own — with the parent's
// `subagents:` edit, one write per file, the description first when missing.
//
//   node --test tests/cli-agent-link-isolated.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, FOLDRUN_HOME: "/nonexistent/foldrun-home", NO_COLOR: "1" };

const LEAD = `---\nname: lead\ndescription: The lead.\nmodel: fast\ntools: [read]\n---\n\nYou are the lead.\n`;
const READER = `---\nname: reader\nmodel: fast\ntools: [code]\n---\n\nYou read.\n`;

function desk() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-link-iso-")), "acme");
  spawnSync(process.execPath, [CLI, "init", root, "--workspace", "main"], { encoding: "utf8", env: ENV });
  const ws = path.join(root, "workspaces/main");
  for (const d of ["flows", "agents", "evals"]) fs.rmSync(path.join(ws, d), { recursive: true, force: true });
  const file = (a: string) => path.join(ws, "agents", a, "agent.md");
  for (const [a, text] of [["lead", LEAD], ["reader", READER]]) {
    fs.mkdirSync(path.dirname(file(a)), { recursive: true });
    fs.writeFileSync(file(a), text);
  }
  return { root, file };
}

const cli = (cwd: string, args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: ENV });

test("--isolated links the worker and writes sandbox: own on it, description first", () => {
  const { root, file } = desk();
  const r = cli(root, ["agent", "link", "lead", "--subagent", "reader", "--isolated", "--description", "Reads pages."]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(file("lead"), "utf8"), /subagents: \[reader\]/);
  const reader = fs.readFileSync(file("reader"), "utf8");
  assert.match(reader, /^description: Reads pages\.$/m);
  assert.match(reader, /^sandbox: own$/m);
  assert.match(reader, /\n\nYou read\.\n$/, "the prose is untouched");
  assert.match(r.stdout, /in its own sandbox/);

  // Again: nothing left to do.
  const again = cli(root, ["agent", "link", "lead", "--subagent", "reader", "--isolated"]);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /already has reader as a sub-agent in its own sandbox/);
});

test("--isolated on a worker already linked writes only sandbox: own", () => {
  const { root, file } = desk();
  fs.writeFileSync(file("lead"), LEAD.replace("tools: [read]", "tools: [read]\nsubagents: [reader]"));
  fs.writeFileSync(file("reader"), READER.replace("model: fast", "description: Reads.\nmodel: fast"));
  const before = fs.readFileSync(file("lead"), "utf8");
  const r = cli(root, ["agent", "link", "lead", "--subagent", "reader", "--isolated"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(file("lead"), "utf8"), before);
  assert.match(fs.readFileSync(file("reader"), "utf8"), /^sandbox: own$/m);
});

test("--isolated goes only with link --subagent", () => {
  const { root } = desk();
  const r = cli(root, ["agent", "link", "lead", "--can-ask", "--isolated"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /--isolated goes with/);
});

test("--isolated reads the setting as a run does: a guardrail block counts, a description's text does not", () => {
  const { root, file } = desk();
  fs.writeFileSync(file("lead"), LEAD.replace("tools: [read]", "tools: [read]\nsubagents: [reader]"));
  fs.writeFileSync(file("reader"), "---\nname: reader\ndescription: |\n  Reads. Example:\n  sandbox: own\nmodel: fast\n---\n\nYou read.\n");
  const r = cli(root, ["agent", "link", "--isolated", "lead", "--subagent", "reader"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(file("reader"), "utf8"), /^sandbox: own$/m, "written: the description's line is not a setting");
  fs.writeFileSync(file("reader"), "---\nname: reader\ndescription: Reads.\nguardrail:\n  sandbox: own\n---\n\nYou read.\n");
  const before = fs.readFileSync(file("reader"), "utf8");
  const again = cli(root, ["agent", "link", "lead", "--subagent", "reader", "--isolated"]);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(fs.readFileSync(file("reader"), "utf8"), before, "already own, in its block: nothing written");
});
