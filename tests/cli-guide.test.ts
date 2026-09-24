// The coding-agent rules, as Next.js writes them: a managed block in
// AGENTS.md pointing at the docs this CLI ships, and CLAUDE.md importing it.
//
//   node --test tests/cli-guide.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { cli } from "./fake-platform.ts";
import { AGENT_RULES_START, AGENT_RULES_END, agentRulesBlock, writeAgentFiles } from "../src/guide.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-guide-"));
const CLI = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");

test("init writes the block into the account AGENTS.md after its frontmatter, and CLAUDE.md as @AGENTS.md", async () => {
  const dir = tmp();
  const r = await cli(["init", path.join(dir, "acct")]);
  assert.equal(r.code, 0, r.out);
  const agents = fs.readFileSync(path.join(dir, "acct", "AGENTS.md"), "utf8");
  assert.ok(agents.startsWith("---\n"), "the frontmatter stays first, so the account's settings still parse");
  assert.ok(agents.includes(agentRulesBlock()));
  assert.equal(fs.readFileSync(path.join(dir, "acct", "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
  // Idempotent: again changes nothing.
  assert.deepEqual(writeAgentFiles(path.join(dir, "acct")), { agentsMd: "unchanged", claudeMd: "unchanged" });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an old block is replaced in place; the person's text around it is kept byte for byte", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "AGENTS.md"), `---\ntimezone: Australia/Sydney\n---\n\nWrite plainly.\n\n${AGENT_RULES_START}\nold wording\n${AGENT_RULES_END}\n\nNever quote prices.\n`);
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "My own Claude notes.\n");
  const r = writeAgentFiles(dir);
  assert.deepEqual(r, { agentsMd: "updated", claudeMd: "updated" });
  const agents = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.ok(agents.startsWith("---\ntimezone: Australia/Sydney\n---\n\nWrite plainly.\n\n"));
  assert.ok(agents.endsWith(`${AGENT_RULES_END}\n\nNever quote prices.\n`));
  assert.doesNotMatch(agents, /old wording/);
  assert.equal(agents.split(AGENT_RULES_START).length, 2, "one block, never two");
  assert.equal(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8"), "My own Claude notes.\n\n@AGENTS.md\n");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("with neither file, both are created; a CLAUDE.md-only folder gets the block in CLAUDE.md", () => {
  const a = tmp();
  assert.deepEqual(writeAgentFiles(a), { agentsMd: "created", claudeMd: "created" });
  const b = tmp();
  fs.writeFileSync(path.join(b, "CLAUDE.md"), "notes\n");
  const r = writeAgentFiles(b);
  assert.equal(r.claudeMd, "updated");
  assert.ok(!fs.existsSync(path.join(b, "AGENTS.md")));
  assert.ok(fs.readFileSync(path.join(b, "CLAUDE.md"), "utf8").includes(agentRulesBlock()));
  for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true });
});

test("the earlier CLAUDE.md guide block is removed on upgrade", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "---\nname: x\n---\n");
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "<!-- foldrun:guide v1 -->\n# old long guide\n<!-- /foldrun:guide -->\n");
  writeAgentFiles(dir);
  const claude = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
  assert.doesNotMatch(claude, /foldrun:guide/);
  assert.match(claude, /@AGENTS\.md/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("guide --check fails without the block and passes after `foldrun guide`", async () => {
  const dir = tmp();
  await cli(["init", path.join(dir, "acct")]);
  fs.writeFileSync(path.join(dir, "acct", "AGENTS.md"), "---\nname: acct\n---\n\nhand-edited, block gone\n");
  const before = await cli(["guide", "--check"], { cwd: path.join(dir, "acct") });
  assert.equal(before.code, 1, before.out);
  const write = await cli(["guide"], { cwd: path.join(dir, "acct") });
  assert.equal(write.code, 0, write.out);
  assert.equal((await cli(["guide", "--check"], { cwd: path.join(dir, "acct") })).code, 0);
  assert.match(fs.readFileSync(path.join(dir, "acct", "AGENTS.md"), "utf8"), /hand-edited, block gone/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("`foldrun check` re-adds the block when a coding agent runs it, as `next dev` does", async () => {
  const dir = tmp();
  await cli(["init", path.join(dir, "acct")]);
  fs.writeFileSync(path.join(dir, "acct", "AGENTS.md"), "---\nname: acct\n---\n");
  const out = await new Promise<string>((resolve) => {
    const child = spawn(process.execPath, [CLI, "check"], { cwd: path.join(dir, "acct"), env: { ...process.env, CLAUDECODE: "1", FOLDRUN_HOME: "/nonexistent", FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1" } });
    let o = "";
    child.stdout.on("data", (d) => (o += d));
    child.stderr.on("data", (d) => (o += d));
    child.on("close", () => resolve(o));
  });
  assert.match(out, /coding-agent rules written for claude-code/);
  assert.ok(fs.readFileSync(path.join(dir, "acct", "AGENTS.md"), "utf8").includes(AGENT_RULES_START));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("`foldrun docs` lists the bundled pages and prints one; an unknown page suggests a near one", async () => {
  const list = await cli(["docs"]);
  assert.equal(list.code, 0, list.out);
  assert.match(list.out, /coding-agents\s+Working with a coding agent/);
  assert.match(list.out, /flows\s+Flows/);
  const page = await cli(["docs", "coding-agents"]);
  assert.equal(page.code, 0, page.out);
  assert.match(page.out, /^# Working with a coding agent/);
  const miss = await cli(["docs", "flow"]);
  assert.notEqual(miss.code, 0);
  assert.match(miss.out, /did you mean .*flows/);
});

test("the bundled docs are the customer's: no design records, no operator routes, nothing internal", () => {
  const dir = path.join(import.meta.dirname, "..", "docs");
  const names = fs.readdirSync(dir);
  assert.ok(names.includes("coding-agents.md") && names.includes("flows.md") && names.includes("api.md"));
  for (const n of names) assert.ok(!n.endsWith("-adr.md") && n !== "environment.md" && n !== "README.md", `${n} should not ship`);
  const api = fs.readFileSync(path.join(dir, "api.md"), "utf8");
  assert.doesNotMatch(api, /^## Super admin/m);
  assert.doesNotMatch(api, /^## Operations/m);
  const all = names.map((n) => fs.readFileSync(path.join(dir, n), "utf8")).join("\n");
  for (const word of ["dev.foldrun.io", "192.168.", "/etc/foldrun", "ownerinspections", "nexmira", "box-tunnel"]) {
    assert.ok(!all.includes(word), `the bundled docs mention "${word}"`);
  }
});

test("the bundled docs match ../foldrun-docs when it is beside this checkout", async () => {
  if (!fs.existsSync(path.join(import.meta.dirname, "..", "..", "foldrun-docs"))) return;
  const out = await new Promise<{ code: number; o: string }>((resolve) => {
    const child = spawn(process.execPath, [path.join(import.meta.dirname, "..", "scripts/sync-docs.mjs"), "--check"]);
    let o = "";
    child.stdout.on("data", (d) => (o += d));
    child.stderr.on("data", (d) => (o += d));
    child.on("close", (code) => resolve({ code: code ?? 1, o }));
  });
  assert.equal(out.code, 0, out.o);
});
