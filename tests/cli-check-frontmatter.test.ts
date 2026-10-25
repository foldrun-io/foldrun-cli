// An agent.md whose frontmatter lost its opening `---` is read as prose: no
// tools, the default model, and a model told to call a tool it was never
// given writes the call out as text. seo-digest's editor did that every
// Sunday from 20 Sep to 5 Oct 2026, and check said nothing.

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

function workspace(agentMd: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-fm-"));
  const ws = path.join(root, "desk");
  fs.mkdirSync(path.join(ws, "agents/editor"), { recursive: true });
  fs.writeFileSync(path.join(ws, "agents/editor/agent.md"), agentMd);
  return ws;
}

test("check refuses frontmatter with no opening ---", () => {
  const ws = workspace("name: editor\ndescription: writes the digest\ntools: [write]\n---\n\nWrite the digest.\n");
  try {
    const r = foldrun("check", ws, "--local");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /agents\/editor\/agent\.md:1/);
    assert.match(r.stdout, /no opening `---`/);
  } finally {
    fs.rmSync(path.dirname(ws), { recursive: true, force: true });
  }
});

test("opened frontmatter passes", () => {
  const ws = workspace("---\nname: editor\ndescription: writes the digest\ntools: [write]\n---\n\nWrite the digest.\n");
  try {
    const r = foldrun("check", ws, "--local");
    assert.doesNotMatch(r.stdout, /no opening/);
  } finally {
    fs.rmSync(path.dirname(ws), { recursive: true, force: true });
  }
});
