// `foldrun check` and tools: [debate, review] / second_model: (FOL-418): the
// warnings the deploy gives, said offline first.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");

test("check warns on a second opinion with no second_model:, one of the same provider (an alias too), and second_model: with neither tool", () => {
  const ws = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-second-")), "desk");
  const agent = (name: string, front: string) => {
    fs.mkdirSync(path.join(ws, "agents", name), { recursive: true });
    fs.writeFileSync(path.join(ws, "agents", name, "agent.md"), `---\nname: ${name}\ndescription: ${name}\n${front}---\n\nWork.\n`);
  };
  agent("asks", "tools: [read, review]\n");
  agent("same", "model: moonshot/kimi-k1\ntools: [read, debate]\nsecond_model: kimi/kimi-k2\n");
  agent("idle", "tools: [read]\nsecond_model: openai/gpt-x\n");
  agent("fine", "model: anthropic/claude-x\ntools: [read, review]\nsecond_model: openai/gpt-x\n");
  const r = spawnSync(process.execPath, [CLI, "check", ws, "--local"], { encoding: "utf8", env: { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, NO_COLOR: "1" } });
  assert.match(r.stdout, /warn\s+agents\/asks\s+tools: \[review\] needs second_model:/, r.stdout + r.stderr);
  assert.match(r.stdout, /warn\s+agents\/same\s+second_model: kimi\/kimi-k2 is the same provider as model:/);
  assert.match(r.stdout, /warn\s+agents\/idle\s+second_model: is set but tools: has neither debate nor review/);
  assert.doesNotMatch(r.stdout, /agents\/fine\s+(tools|second_model)/);
});
