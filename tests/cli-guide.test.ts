// `foldrun guide` and the CLAUDE.md that init and pull keep current: the
// guide a coding agent reads in an account folder. It lives between two
// markers, and a person's own notes around it are never touched.
//
//   node --test tests/cli-guide.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cli } from "./fake-platform.ts";
import { GUIDE_VERSION } from "../src/guide.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-guide-"));

test("init writes CLAUDE.md with the guide, and says so", async () => {
  const dir = tmp();
  const r = await cli(["init", path.join(dir, "acct")]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /CLAUDE\.md/);
  const text = fs.readFileSync(path.join(dir, "acct", "CLAUDE.md"), "utf8");
  assert.match(text, new RegExp(`<!-- foldrun:guide v${GUIDE_VERSION} -->`));
  assert.match(text, /# Working on this foldrun account/);
  assert.match(text, /<!-- \/foldrun:guide -->/);
  // AGENTS.md is the account's own file — the guide must not be in it.
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "acct", "AGENTS.md"), "utf8"), /foldrun:guide/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("guide keeps a person's notes and replaces only an older block; --check reports it", async () => {
  const dir = tmp();
  const file = path.join(dir, "CLAUDE.md");
  fs.writeFileSync(file, "# My notes\n\nRemember the client wants British spelling.\n\n<!-- foldrun:guide v0 -->\nold guide\n<!-- /foldrun:guide -->\n\n## Below\nkept too\n");
  const check = await cli(["guide", "--check"], { cwd: dir });
  assert.equal(check.code, 1, check.out);
  assert.match(check.out, /carries v0/);
  const r = await cli(["guide"], { cwd: dir });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /updated/);
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^# My notes\n\nRemember the client wants British spelling\./);
  assert.match(text, /## Below\nkept too\n$/);
  assert.doesNotMatch(text, /old guide/);
  assert.match(text, new RegExp(`<!-- foldrun:guide v${GUIDE_VERSION} -->\\n# Working on this foldrun account`));
  const again = await cli(["guide"], { cwd: dir });
  assert.match(again.out, /already current/);
  assert.equal((await cli(["guide", "--check"], { cwd: dir })).code, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a CLAUDE.md with no guide in it gets the block appended after the person's text", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "Only my notes.\n");
  const r = await cli(["guide"], { cwd: dir });
  assert.equal(r.code, 0, r.out);
  const text = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
  assert.match(text, /^Only my notes\.\n\n<!-- foldrun:guide v/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("--print writes the guide to stdout and touches nothing", async () => {
  const dir = tmp();
  const r = await cli(["guide", "--print"], { cwd: dir });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /# Working on this foldrun account/);
  assert.ok(!fs.existsSync(path.join(dir, "CLAUDE.md")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the guide says nothing about how the platform is run", () => {
  const text = fs.readFileSync(new URL("../src/guide/CLAUDE.md", import.meta.url), "utf8");
  for (const word of ["dev.foldrun.io", "ssh ", "k3s", "kubectl", "EFS", "Postgres", "Redis", "S3", "Terraform", "/etc/foldrun", "secret-key", "FOLDRUN_SECRET_KEY", "nexmira", "Owner Inspections"]) {
    assert.ok(!text.includes(word), `the guide mentions "${word}" — that is the platform's business, not the account's`);
  }
});
