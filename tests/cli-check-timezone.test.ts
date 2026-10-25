// `foldrun check` and the deploy must agree about a `timezone:` nobody can
// read. The deploy already refused one; check said nothing, so the first
// anyone heard of `Sydney/Australia` was a push that bounced — the opposite
// of what check is for, which is finding it offline before a schedule fires.

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

function workspace(timezone: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-tz-"));
  const ws = path.join(root, "desk");
  fs.mkdirSync(path.join(ws, "agents/planner"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "agents/planner/agent.md"),
    `---\nname: planner\ndescription: plans the week\ntimezone: ${timezone}\n---\n\nPlan the week.\n`,
  );
  return ws;
}

test("check refuses a timezone nobody can read, and names it and the agent", () => {
  const ws = workspace("Sydney/Australia");
  try {
    const r = foldrun("check", ws, "--local");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /agents\/planner/);
    assert.match(r.stdout, /Sydney\/Australia/);
    assert.match(r.stdout, /IANA name/);
  } finally {
    fs.rmSync(path.dirname(ws), { recursive: true, force: true });
  }
});

test("a fixed offset and an IANA name both pass", () => {
  for (const zone of ["Australia/Sydney", "UTC+10"]) {
    const ws = workspace(zone);
    try {
      const r = foldrun("check", ws, "--local");
      assert.equal(r.status, 0, `${zone}: ${r.stdout}${r.stderr}`);
      assert.doesNotMatch(r.stdout, /not a zone/);
    } finally {
      fs.rmSync(path.dirname(ws), { recursive: true, force: true });
    }
  }
});
