// A script tool's file may list the secrets its program reads, but only the
// agent's own `secrets:` reach the sandbox. check holds every agent that
// grants the tool to that list (strata-desk's reporter, 1 Oct 2026:
// "RESEND_API_KEY is not set").
//
//   node --test tests/cli-tool-secrets.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, FOLDRUN_HOME: "/nonexistent/foldrun-home", NO_COLOR: "1" };
const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd, env: ENV });

function desk(agentSecrets: string) {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-tool-secrets-")), "acme");
  spawnSync(process.execPath, [CLI, "init", root, "--workspace", "main"], { encoding: "utf8", env: ENV });
  const ws = path.join(root, "workspaces/main");
  fs.mkdirSync(path.join(ws, "tools/mailer-tool"), { recursive: true });
  fs.writeFileSync(path.join(ws, "tools/mailer-tool/tool.md"), "---\nname: mailer_tool\ntransport: script\nrun: send.mjs\ndescription: sends one email\nsecrets: [RESEND_API_KEY, EMAIL_FROM]\n---\n");
  fs.writeFileSync(path.join(ws, "tools/mailer-tool/send.mjs"), "console.log('sent')\n");
  fs.mkdirSync(path.join(ws, "agents/reporter"), { recursive: true });
  fs.writeFileSync(path.join(ws, "agents/reporter/agent.md"), `---\nname: reporter\ndescription: reports\ntools: [mailer_tool]\n${agentSecrets}---\n\nSend it.\n`);
  return root;
}

test("an agent granting a tool without the secrets its file lists is an error, naming the line to write", () => {
  const r = run(desk(""), "check");
  assert.match(r.stdout, /agents\/reporter.*tools: \[mailer_tool\] reads RESEND_API_KEY, EMAIL_FROM, which this agent does not declare/);
  assert.match(r.stdout, /secrets: \(RESEND_API_KEY, EMAIL_FROM\)/);
  assert.equal(r.status, 1);
});

test("one missing is named alone; all declared is clean", () => {
  const partial = run(desk("secrets: [RESEND_API_KEY]\n"), "check");
  assert.match(partial.stdout, /reads EMAIL_FROM, which this agent does not declare/);
  const full = run(desk("secrets: [RESEND_API_KEY, EMAIL_FROM]\n"), "check");
  assert.doesNotMatch(full.stdout, /does not declare/);
});
