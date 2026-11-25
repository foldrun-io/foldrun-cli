// The CLI keeps itself current: which releases it takes, when it looks,
// that it installs beside the running copy and hands over at the next start,
// what it says after, and the way back.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { updateKind, skipReason, announcement, checkAndUpdate, stagedUpdate, readState, activeBin, versionsDir, installDir, stateFile, CHECK_EVERY_MS, HANDED_OVER, autoUpdateSetting, setAutoUpdate } from "../src/self-update.mjs";

test("updateKind: a newer minor or patch installs, a newer major is only announced, nothing else", () => {
  assert.equal(updateKind("27.2.0", "27.1.0"), "install");
  assert.equal(updateKind("27.1.1", "27.1.0"), "install");
  assert.equal(updateKind("28.0.0", "27.9.9"), "notice");
  assert.equal(updateKind("27.1.0", "27.1.0"), null);
  assert.equal(updateKind("27.0.9", "27.1.0"), null);
  assert.equal(updateKind("27.2.0-rc.1", "27.1.0"), null, "a stable install never takes a pre-release");
  assert.equal(updateKind("27.2.0", "27.2.0-rc.1"), "install");
  for (const junk of ["", "latest", "27.2", "27.2.0\x1b[2J", "27.2.0 && rm -rf /", null]) assert.equal(updateKind(junk as any, "27.1.0"), null, String(junk));
});

const npmCopy = path.join(path.sep, "usr", "lib", "node_modules", "foldrun");

test("skipReason: off, CI, no terminal, a git checkout, already checked today; else it looks", () => {
  // A home of its own: the person's auto-update setting is read from it (FOL-335).
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-skip-"));
  const base = { env: { FOLDRUN_HOME: home } as NodeJS.ProcessEnv, tty: true, now: Date.parse("2026-11-20T10:00:00Z"), state: {}, pkgRoot: npmCopy };
  assert.equal(skipReason(base), null);
  assert.equal(skipReason({ ...base, env: { FOLDRUN_HOME: home, FOLDRUN_NO_AUTO_UPDATE: "1" } }), "turned off");
  assert.equal(skipReason({ ...base, env: { FOLDRUN_HOME: home, CI: "true" } }), "CI");
  assert.equal(skipReason({ ...base, env: { FOLDRUN_HOME: home, CI: "false" } }), null);
  // Turned off by the person (foldrun update --auto off, /update auto off): no daily check; on again, it looks.
  setAutoUpdate(false, base.env);
  assert.equal(skipReason(base), "turned off (foldrun update --auto on)");
  assert.deepEqual(autoUpdateSetting(base.env), { on: false, by: "setting" });
  assert.deepEqual(autoUpdateSetting({ ...base.env, FOLDRUN_NO_AUTO_UPDATE: "1" }), { on: false, by: "env" });
  setAutoUpdate(true, base.env);
  assert.equal(skipReason(base), null);
  assert.deepEqual(autoUpdateSetting(base.env), { on: true, by: "setting" });
  assert.equal(skipReason({ ...base, tty: false }), "no terminal");
  assert.equal(skipReason({ ...base, pkgRoot: path.join(path.sep, "src", "foldrun-cli") }), "not an npm install");
  assert.equal(skipReason({ ...base, state: { checkedAt: new Date(base.now - 60_000).toISOString() } }), "checked today");
  assert.equal(skipReason({ ...base, state: { checkedAt: new Date(base.now - CHECK_EVERY_MS - 1).toISOString() } }), null);
  assert.equal(skipReason({ ...base, state: { checkedAt: new Date(base.now + 3_600_000).toISOString() } }), null, "a clock set back does not stop it for good");
});

/** A fake npm (FOLDRUN_NPM, a Node script): `view` answers LATEST;
 *  `install --prefix DIR foldrun@V` puts a foldrun there whose --version
 *  says V (or `lie`), or fails with `installExit`. */
function fakeNpm(latest: string, opts: { installExit?: number; viewExit?: number; lie?: string; broken?: "import" | "export" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-npm-"));
  const log = path.join(dir, "calls.log");
  const npm = path.join(dir, "npm");
  fs.writeFileSync(
    npm,
    `#!${process.execPath}
const fs = require("fs"), path = require("path");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, a.join(" ") + "\\t" + process.cwd() + "\\n");
if (a[0] === "view") { if (${opts.viewExit ?? 0}) { console.error("npm ERR! network"); process.exit(${opts.viewExit ?? 0}); } console.log(${JSON.stringify(latest)}); process.exit(0); }
if (a[0] === "install") {
  if (${opts.installExit ?? 0}) { console.error("npm ERR! EACCES: permission denied"); process.exit(${opts.installExit ?? 0}); }
  const prefix = a[a.indexOf("--prefix") + 1];
  const v = a.find((x) => x.startsWith("foldrun@")).slice(8);
  const bin = path.join(prefix, "node_modules", "foldrun", "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "foldrun.mjs"), "console.log(" + JSON.stringify("foldrun " + (${JSON.stringify(opts.lie ?? "")} || v)) + ");\\n");
  const pkg = path.join(prefix, "node_modules", "foldrun");
  fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "src", "commands.mjs"), ${JSON.stringify(opts.broken === "import" ? 'import "@foldrun/core/missing-export";\n' : opts.broken === "export" ? "export function run() {}\n" : "export function run() {}\nexport function explain() {}\n")});
  const core = path.join(prefix, "node_modules", "@foldrun", "core");
  fs.mkdirSync(core, { recursive: true });
  fs.writeFileSync(path.join(core, "package.json"), JSON.stringify({ name: "@foldrun/core", type: "module", exports: { "./layout": "./layout.js" } }));
  fs.writeFileSync(path.join(core, "layout.js"), "export function detectLayout() {}\\nexport function installationDataRoot() {}\\n");
  process.exit(0);
}
`,
    { mode: 0o755 },
  );
  const home = path.join(dir, "home");
  return {
    home,
    env: { FOLDRUN_HOME: home, FOLDRUN_NPM: npm } as NodeJS.ProcessEnv,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => ({ args: l.split("\t")[0], cwd: l.split("\t")[1] })) : []),
  };
}

const unix = { skip: process.platform === "win32" ? "a script stands in for npm" : false };

test("checkAndUpdate: a newer minor is installed BESIDE this copy (no install scripts, from the home folder), checked, made active, said once", unix, () => {
  const n = fakeNpm("27.2.0");
  assert.deepEqual(checkAndUpdate({ current: "27.1.0", env: n.env, pkgRoot: npmCopy }), { did: "updated", latest: "27.2.0" });
  const install = n.calls().find((c) => c.args.startsWith("install"))!;
  assert.match(install.args, /^install --prefix \S+ --ignore-scripts --no-save --no-package-lock foldrun@27\.2\.0$/);
  assert.ok(n.calls().every((c) => fs.realpathSync(c.cwd) === fs.realpathSync(os.homedir())), "never a project's npm or .npmrc");
  const bin = activeBin("27.1.0", n.env, npmCopy);
  assert.equal(bin, path.join(versionsDir(n.env, npmCopy), "27.2.0", "node_modules", "foldrun", "bin", "foldrun.mjs"));
  assert.equal(activeBin("27.2.0", n.env, npmCopy), null, "the staged copy does not hand over to itself");
  assert.equal(activeBin("27.1.0", { ...n.env, FOLDRUN_NO_AUTO_UPDATE: "1" }, npmCopy), null, "the way back");
  assert.equal(activeBin("27.1.0", n.env, path.join(path.sep, "src", "foldrun-cli")), null, "a git checkout runs itself");
  assert.equal(activeBin("27.1.0", n.env, path.join(path.sep, "work", "app", "node_modules", "foldrun")), null, "a project's own pinned copy keeps its pin");
  assert.equal(announcement("27.1.0", n.env, npmCopy), null, "not said by the old copy");
  assert.equal(announcement("27.2.0", n.env, path.join(path.sep, "npx", "node_modules", "foldrun")), null, "not said to another copy");
  assert.equal(announcement("27.2.0", n.env, npmCopy), "foldrun updated 27.1.0 → 27.2.0");
  assert.equal(announcement("27.2.0", n.env, npmCopy), null, "once");
  assert.equal(fs.statSync(stateFile(n.env, npmCopy)).mode & 0o777, 0o600);
  // Another installation (a second Node's global foldrun) keeps its own record.
  const other = path.join(path.sep, "opt", "node20", "lib", "node_modules", "foldrun");
  assert.deepEqual(readState(n.env, other), {});
  assert.equal(activeBin("27.1.0", n.env, other), null, "nothing staged for it, nothing rolled back for this one");
  assert.ok(activeBin("27.1.0", n.env, npmCopy));
  assert.ok(path.isAbsolute(installDir({ FOLDRUN_HOME: "rel/home" }, npmCopy)), "a relative FOLDRUN_HOME is resolved once");
});

test("stagedUpdate: a long session hears of a staged minor (for /restart) and of a major (announced only); not the version it runs, nor with updates off (FOL-261)", unix, () => {
  const n = fakeNpm("27.2.0");
  assert.equal(stagedUpdate("27.1.0", n.env, npmCopy), null, "nothing staged yet");
  checkAndUpdate({ current: "27.1.0", env: n.env, pkgRoot: npmCopy });
  assert.deepEqual(stagedUpdate("27.1.0", n.env, npmCopy), { version: "27.2.0", ready: true });
  assert.equal(stagedUpdate("27.2.0", n.env, npmCopy), null, "the session already runs it");
  assert.equal(stagedUpdate("27.1.0", { ...n.env, FOLDRUN_NO_AUTO_UPDATE: "1" }, npmCopy), null, "off is off");
  assert.equal(stagedUpdate("27.1.0", n.env, path.join(path.sep, "src", "foldrun-cli")), null, "a git checkout");
  const m = fakeNpm("28.0.0");
  checkAndUpdate({ current: "27.1.0", env: m.env, pkgRoot: npmCopy });
  assert.deepEqual(stagedUpdate("27.1.0", m.env, npmCopy), { version: "28.0.0", ready: false }, "a major: told, never taken");
  assert.equal(activeBin("27.1.0", m.env, npmCopy), null);
  // foldrun update in another terminal takes the major: now it is ready for /restart (Codex).
  checkAndUpdate({ current: "27.1.0", major: true, env: m.env, pkgRoot: npmCopy });
  assert.deepEqual(stagedUpdate("27.1.0", m.env, npmCopy), { version: "28.0.0", ready: true });
});

test("checkAndUpdate: a new major is announced, not installed; foldrun update (major: true) takes it; --check (install: false) changes nothing", unix, () => {
  const n = fakeNpm("28.0.0");
  assert.deepEqual(checkAndUpdate({ current: "27.1.0", env: n.env, pkgRoot: npmCopy, install: false }), { did: "available", latest: "28.0.0", major: true });
  assert.deepEqual(readState(n.env, npmCopy), {}, "asking writes nothing, so the daily look still runs");
  assert.equal(checkAndUpdate({ current: "27.1.0", env: n.env, pkgRoot: npmCopy }).did, "major");
  assert.ok(!n.calls().some((c) => c.args.startsWith("install")), "nothing installed");
  assert.equal(activeBin("27.1.0", n.env, npmCopy), null);
  assert.match(announcement("27.1.0", n.env, npmCopy) ?? "", /foldrun 28\.0\.0 is out — a major version/);
  assert.equal(announcement("27.1.0", n.env, npmCopy), null);
  checkAndUpdate({ current: "27.1.0", env: n.env, pkgRoot: npmCopy });
  assert.equal(announcement("27.1.0", n.env, npmCopy), null, "the same major is not said again");
  assert.equal(checkAndUpdate({ current: "27.1.0", env: n.env, pkgRoot: npmCopy, major: true }).did, "updated");
  assert.ok(activeBin("27.1.0", n.env, npmCopy));
});

test("checkAndUpdate: a failed install or a copy that is not the version asked for is never made active; said once", unix, () => {
  const f = fakeNpm("27.2.0", { installExit: 1 });
  assert.equal(checkAndUpdate({ current: "27.1.0", env: f.env, pkgRoot: npmCopy }).did, "failed");
  assert.equal(activeBin("27.1.0", f.env, npmCopy), null);
  assert.match(announcement("27.1.0", f.env, npmCopy) ?? "", /updating to it failed \(npm ERR! EACCES: permission denied\)/);
  assert.equal(announcement("27.1.0", f.env, npmCopy), null);

  const l = fakeNpm("27.2.0", { lie: "27.0.0" });
  const r = checkAndUpdate({ current: "27.1.0", env: l.env, pkgRoot: npmCopy });
  assert.equal(r.did, "failed");
  assert.match(String(r.error), /does not answer as foldrun 27\.2\.0/);
  assert.equal(activeBin("27.1.0", l.env, npmCopy), null);
  assert.deepEqual(fs.readdirSync(versionsDir(l.env, npmCopy)), [], "the temporary folder is gone");

  for (const broken of ["import", "export"] as const) {
    const b = fakeNpm("27.2.0", { broken });
    assert.equal(checkAndUpdate({ current: "27.1.0", env: b.env, pkgRoot: npmCopy }).did, "failed", `a release whose commands do not load (${broken}) is never made active`);
    assert.equal(activeBin("27.1.0", b.env, npmCopy), null);
  }

  const u = fakeNpm("27.2.0", { viewExit: 1 });
  assert.equal(checkAndUpdate({ current: "27.1.0", env: u.env, pkgRoot: npmCopy }).did, "unreachable");
  assert.equal(readState(u.env, npmCopy).state, undefined);
  assert.ok(readState(u.env, npmCopy).checkedAt, "it does not ask again until tomorrow");
});

test("stage: the active version, the one before and any retired less than a week ago stay; older ones go", unix, () => {
  const n = fakeNpm("27.2.0");
  const stageAs = (v: string) => assert.equal(checkAndUpdate({ current: "27.1.0", env: { ...fakeNpm(v).env, FOLDRUN_HOME: n.home }, pkgRoot: npmCopy }).did, "updated");
  for (const v of ["27.2.0", "27.3.0", "27.4.0"]) stageAs(v);
  const list = () => fs.readdirSync(versionsDir(n.env, npmCopy)).filter((d) => /^\d/.test(d)).sort();
  assert.deepEqual(list(), ["27.2.0", "27.3.0", "27.4.0"], "a session may still run on 27.2.0");
  const file = path.join(versionsDir(n.env, npmCopy), "active.json");
  const a = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(a.before, "27.3.0");
  a.retired["27.2.0"] = new Date(Date.now() - 8 * 24 * 3600_000).toISOString();
  fs.writeFileSync(file, JSON.stringify(a));
  stageAs("27.5.0");
  assert.deepEqual(list(), ["27.3.0", "27.4.0", "27.5.0"]);
});

test("checkAndUpdate: an npm answer that moved back, or an older caller, never rolls the active version back", unix, () => {
  const n = fakeNpm("27.3.0");
  assert.equal(checkAndUpdate({ current: "27.1.0", env: n.env, pkgRoot: npmCopy }).did, "updated");
  const back = { ...fakeNpm("27.2.0").env, FOLDRUN_HOME: n.home };
  assert.deepEqual(checkAndUpdate({ current: "27.1.0", env: back, pkgRoot: npmCopy, major: true }), { did: "current", latest: "27.2.0", running: "27.3.0" });
  assert.match(String(activeBin("27.1.0", n.env, npmCopy)), /27\.3\.0/);
});

test("checkAndUpdate: one at a time", unix, () => {
  const n = fakeNpm("27.2.0");
  fs.mkdirSync(installDir(n.env, npmCopy), { recursive: true });
  fs.writeFileSync(path.join(installDir(n.env, npmCopy), "lock"), "someone");
  assert.equal(checkAndUpdate({ current: "27.1.0", env: n.env, pkgRoot: npmCopy }).did, "busy");
  assert.deepEqual(n.calls(), []);
});

test("the CLI: the global copy hands over to the version staged for it, in the same process; FOLDRUN_NO_AUTO_UPDATE=1, a git checkout and a project's pinned copy do not", () => {
  const repo = path.join(import.meta.dirname, "..");
  const own = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
  // An installed copy: the CLI's files under a node_modules folder.
  const installed = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "global-")), "node_modules", "foldrun");
  fs.mkdirSync(installed, { recursive: true });
  for (const f of ["bin", "src", "package.json"]) fs.cpSync(path.join(repo, f), path.join(installed, f), { recursive: true });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const vdir = versionsDir({ FOLDRUN_HOME: home }, installed);
  const staged = path.join(vdir, "99.0.0", "node_modules", "foldrun", "bin");
  fs.mkdirSync(staged, { recursive: true });
  fs.writeFileSync(path.join(staged, "foldrun.mjs"), `console.log("staged 99.0.0 ran: " + process.argv.slice(2).join(" ")); process.exit(0);\n`);
  fs.writeFileSync(path.join(vdir, "active.json"), JSON.stringify({ version: "99.0.0", for: fs.realpathSync(installed) }));
  const run = (bin: string, extra: Record<string, string> = {}) => spawnSync(process.execPath, [bin, "--version"], { encoding: "utf8", env: { ...process.env, FOLDRUN_HOME: home, CI: "1", ...extra } }).stdout.trim();
  assert.equal(run(path.join(installed, "bin", "foldrun.mjs")), "staged 99.0.0 ran: --version");
  // A staged copy that is the real CLI's code acts as the global copy (so it
  // updates itself later), and the identity never reaches what it runs.
  fs.cpSync(path.join(repo, "src"), path.join(staged, "..", "src"), { recursive: true });
  fs.writeFileSync(path.join(staged, "foldrun.mjs"), `const m = await import("../src/self-update.mjs"); console.log(m.actingFor() + "|" + (process.env[${JSON.stringify(HANDED_OVER)}] ?? "gone")); process.exitCode = 3;\n`);
  const r = spawnSync(process.execPath, [path.join(installed, "bin", "foldrun.mjs"), "--version"], { encoding: "utf8", env: { ...process.env, FOLDRUN_HOME: home, CI: "1" } });
  assert.equal(r.stdout.trim(), `${fs.realpathSync(installed)}|gone`);
  assert.equal(r.status, 3, "the staged command's exit code is the process's");
  assert.equal(run(path.join(installed, "bin", "foldrun.mjs"), { FOLDRUN_NO_AUTO_UPDATE: "1" }), `foldrun ${own}`);
  assert.equal(run(path.join(repo, "bin", "foldrun.mjs")), `foldrun ${own}`, "a git checkout runs itself");
  const pinned = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "project-")), "node_modules", "foldrun");
  fs.mkdirSync(pinned, { recursive: true });
  for (const f of ["bin", "src", "package.json"]) fs.cpSync(path.join(repo, f), path.join(pinned, f), { recursive: true });
  assert.equal(run(path.join(pinned, "bin", "foldrun.mjs")), `foldrun ${own}`, "a project's pinned copy keeps its pin");
});

test("the CLI: a command in a git checkout starts no background update", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const cli = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
  spawnSync(process.execPath, [cli, "accounts"], { encoding: "utf8", env: { ...process.env, FOLDRUN_HOME: home, FOLDRUN_FORCE_TTY: "1" } });
  assert.equal(fs.existsSync(path.join(home, "updates")), false, "nothing checked, nothing written");
});
