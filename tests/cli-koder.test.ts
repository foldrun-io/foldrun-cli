// `koder`, the short name for `foldrun code` (FOL-266): the bin hands over to
// foldrun's own entry point with "code" in front, says it is foldrun's when
// asked its version, and the checks name another `koder` that comes first
// on PATH.
//
//   node --test tests/cli-koder.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { koderOnPath, koderLine, OWN_KODER } from "../src/koder-path.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const run = (bin: string, args: string[]) =>
  spawnSync(process.execPath, [path.join(ROOT, "bin", bin), ...args], {
    encoding: "utf8",
    env: { ...process.env, FOLDRUN_NO_AUTO_UPDATE: "1", NO_COLOR: "1" },
  });

test("package.json installs koder beside foldrun", () => {
  assert.equal(pkg.bin.foldrun, "bin/foldrun.mjs");
  assert.equal(pkg.bin.koder, "bin/koder.mjs");
  assert.ok(fs.statSync(path.join(ROOT, "bin/koder.mjs")).mode & 0o111, "koder.mjs is executable");
});

test("koder --version names foldrun code and the version", () => {
  const r = run("koder.mjs", ["--version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), `koder (foldrun code) ${pkg.version}`);
});

test("koder --help is foldrun code --help", () => {
  const a = run("koder.mjs", ["--help"]);
  const b = run("foldrun.mjs", ["code", "--help"]);
  assert.equal(a.status, b.status);
  assert.equal(a.stdout, b.stdout);
  assert.match(a.stdout, /foldrun code/);
});

test("koder on a missing folder fails as foldrun code does", () => {
  const a = run("koder.mjs", ["/no/such/folder/for/koder"]);
  const b = run("foldrun.mjs", ["code", "/no/such/folder/for/koder"]);
  assert.notEqual(a.status, 0);
  assert.equal(a.status, b.status);
  assert.equal(a.stderr.replace(/\s+/g, " "), b.stderr.replace(/\s+/g, " "));
});

test("the check: none, ours, or another program first on PATH", (t) => {
  if (process.platform === "win32") return t.skip("POSIX links");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "koder-path-"));
  const ours = path.join(d, "ours");
  const other = path.join(d, "other");
  fs.mkdirSync(ours);
  fs.mkdirSync(other);
  fs.symlinkSync(OWN_KODER, path.join(ours, "koder"));
  fs.writeFileSync(path.join(other, "koder"), "#!/bin/sh\necho python koder\n", { mode: 0o755 });

  assert.deepEqual(koderOnPath({ PATH: path.join(d, "empty") }), { found: null });
  assert.equal(koderLine({ PATH: path.join(d, "empty") }).ok, true);

  const mine = koderOnPath({ PATH: [ours, other].join(path.delimiter) });
  assert.equal(mine.found, path.join(ours, "koder"));
  assert.equal((mine as { ours: boolean }).ours, true);
  assert.equal(koderLine({ PATH: [ours, other].join(path.delimiter) }).ok, true);

  const theirs = koderLine({ PATH: [other, ours].join(path.delimiter) });
  assert.equal(theirs.ok, false);
  assert.match(theirs.text, /another program called koder/);
  assert.ok(theirs.text.includes(path.join(other, "koder")));

  // foldrun's koder from another install (a global one beside a checkout) is still foldrun's.
  const pkg = path.join(d, "lib", "node_modules", "foldrun");
  fs.mkdirSync(path.join(pkg, "bin"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "foldrun" }));
  fs.writeFileSync(path.join(pkg, "bin", "koder.mjs"), "#!/usr/bin/env node\n", { mode: 0o755 });
  const glob = path.join(d, "global");
  fs.mkdirSync(glob);
  fs.symlinkSync(path.join(pkg, "bin", "koder.mjs"), path.join(glob, "koder"));
  assert.equal(koderLine({ PATH: glob }).ok, true);
  // The same layout under another package's name is not.
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "koder" }));
  assert.equal(koderLine({ PATH: glob }).ok, false);
  fs.rmSync(d, { recursive: true, force: true });
});

test("a koder on PATH that cannot be run is skipped, as the shell skips it (Codex)", { skip: process.platform === "win32" }, () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "koder-a-"));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), "koder-b-"));
  try {
    fs.writeFileSync(path.join(a, "koder"), "not a program\n", { mode: 0o644 });
    fs.writeFileSync(path.join(b, "koder"), "#!/bin/sh\n", { mode: 0o755 });
    const got = koderOnPath({ PATH: [a, b].join(path.delimiter) }, process.platform, path.join(b, "koder"));
    assert.deepEqual(got, { found: path.join(b, "koder"), ours: true });
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});
