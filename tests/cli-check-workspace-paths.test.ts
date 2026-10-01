// `workspace/storage/…` is the documented spelling; `../../storage/…` still
// works. `foldrun check` mentions the old one as info — never an error, and
// not a warning either: the path resolves, so nothing is wrong.

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

function workspace(csv: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-wspaths-"));
  const ws = path.join(root, "desk");
  for (const name of ["scan", "writer"]) {
    fs.mkdirSync(path.join(ws, "agents", name), { recursive: true });
    fs.writeFileSync(path.join(ws, `agents/${name}/agent.md`), `---\nname: ${name}\ndescription: ${name}s\n---\n\nDo it.\n`);
  }
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "flows/weekly.md"),
    `---\ntrigger: manual\n---\n\n1. [[scan]] — write the queue\n   verify: file: ${csv}\n2. [[writer]] — answer one\n   each: rows of ${csv}\n`,
  );
  return ws;
}

test("check: ../../storage is an info hint and passes; workspace/storage is silent", () => {
  const old = workspace("../../storage/queue.csv");
  const fresh = workspace("workspace/storage/queue.csv");
  try {
    const a = foldrun("check", old, "--local");
    assert.equal(a.status, 0, a.stdout + a.stderr);
    assert.match(a.stdout, /info .*\.\.\/\.\.\/storage/);
    const b = foldrun("check", fresh, "--local");
    assert.equal(b.status, 0, b.stdout + b.stderr);
    assert.doesNotMatch(b.stdout, /\.\.\/\.\.\/storage/);
  } finally {
    fs.rmSync(path.dirname(old), { recursive: true, force: true });
    fs.rmSync(path.dirname(fresh), { recursive: true, force: true });
  }
});
