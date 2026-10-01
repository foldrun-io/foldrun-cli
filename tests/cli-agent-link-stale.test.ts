// Local `agent link` / `agent unlink` write texts computed from the agent
// files as they were read. `link --subagent` may first stop to ask for the
// worker's missing description, and both run check before writing; a file
// saved meanwhile — the linked agent's or the worker's — would be put back
// as it was. Each write re-reads its file first and the command refuses,
// writing nothing to either file, when one no longer reads what the edit
// was made from (the flow verbs' guard, tests/cli-flow-write-stale.test.ts).
//
//   node --test tests/cli-agent-link-stale.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, FOLDRUN_HOME: "/nonexistent/foldrun-home", NO_COLOR: "1" };

const LEAD = `---\nname: lead\ndescription: The lead.\nmodel: fast\nagents: [helper]\n---\n\nYou are the lead.\n`;
const WORKER = `---\nname: worker\nmodel: fast\n---\n\nYou are the worker.\n`;
const HELPER = `---\nname: helper\ndescription: The helper.\nmodel: fast\n---\n\nYou are the helper.\n`;
const edited = (text: string) => text.replace(/\n\nYou are/, "\n\nEdited meanwhile. You are");

function desk() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-link-stale-")), "acme");
  spawnSync(process.execPath, [CLI, "init", root, "--workspace", "main"], { encoding: "utf8", env: ENV });
  const ws = path.join(root, "workspaces/main");
  for (const d of ["flows", "agents", "evals"]) fs.rmSync(path.join(ws, d), { recursive: true, force: true });
  const file = (a: string) => path.join(ws, "agents", a, "agent.md");
  for (const [a, text] of [["lead", LEAD], ["worker", WORKER], ["helper", HELPER]]) {
    fs.mkdirSync(path.dirname(file(a)), { recursive: true });
    fs.writeFileSync(file(a), text);
  }
  return { root, file };
}

/** Run the CLI as if at a terminal, answering the description prompt with
 *  `answer` after `meanwhile()` has run. */
function atPrompt(cwd: string, args: string[], meanwhile: () => void, answer = "does the work\n"): Promise<{ code: number | null; out: string }> {
  const preload = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-tty-")), "tty.mjs");
  fs.writeFileSync(preload, "Object.defineProperty(process.stdin, 'isTTY', { value: true });\n");
  const child = spawn(process.execPath, ["--import", preload, CLI, ...args], { cwd, env: ENV });
  let out = "";
  let answered = false;
  const onData = (d: Buffer) => {
    out += d.toString();
    if (!answered && /What is worker for\?/.test(out)) {
      answered = true;
      meanwhile();
      child.stdin.write(answer);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  return new Promise((resolve) => child.on("close", (code) => resolve({ code, out })));
}

for (const who of ["worker", "lead"]) {
  test(`link --subagent: ${who}'s file changed at the description prompt — refused, nothing written`, async () => {
    const { root, file } = desk();
    const before = { lead: LEAD, worker: WORKER } as Record<string, string>;
    const r = await atPrompt(root, ["agent", "link", "lead", "--subagent", "worker"], () => fs.writeFileSync(file(who), edited(before[who])));
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`agents/${who}/agent\\.md changed since it was read`));
    assert.equal(fs.readFileSync(file(who), "utf8"), edited(before[who]));
    const other = who === "lead" ? "worker" : "lead";
    assert.equal(fs.readFileSync(file(other), "utf8"), before[other], `${other} must not be half-written`);
  });
}

test("link --subagent: unchanged at the prompt — both files written", async () => {
  const { root, file } = desk();
  const r = await atPrompt(root, ["agent", "link", "lead", "--subagent", "worker"], () => {});
  assert.equal(r.code, 0, r.out);
  assert.match(fs.readFileSync(file("worker"), "utf8"), /^description: does the work$/m);
  assert.match(fs.readFileSync(file("lead"), "utf8"), /^subagents: \[worker\]$/m);
});

/** A preload that saves an edit over `target` right after the CLI first
 *  reads it — an editor saving while the command checks its edit. */
function editedAfterRead(target: string) {
  const preload = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-race-")), "race.mjs");
  const real = fs.realpathSync(target);
  fs.writeFileSync(
    preload,
    `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const read = fs.readFileSync;
let done = false;
fs.readFileSync = function (p, ...rest) {
  const out = read.call(this, p, ...rest);
  if (!done && typeof p === "string" && p.endsWith("agent.md") && fs.realpathSync(p) === ${JSON.stringify(real)}) { done = true; fs.writeFileSync(p, ${JSON.stringify(edited(fs.readFileSync(target, "utf8")))}); }
  return out;
};
syncBuiltinESMExports();
`,
  );
  return preload;
}

for (const args of [
  ["agent", "unlink", "lead", "--consult", "helper"],
  ["agent", "link", "lead", "--can-ask"],
]) {
  test(`${args.slice(1).join(" ")}: the file changed after it was read — refused, the other edit kept`, () => {
    const { root, file } = desk();
    const r = spawnSync(process.execPath, ["--import", editedAfterRead(file("lead")), CLI, ...args], { encoding: "utf8", cwd: root, env: ENV });
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /agents\/lead\/agent\.md changed since it was read/);
    assert.equal(fs.readFileSync(file("lead"), "utf8"), edited(LEAD));
  });
}
