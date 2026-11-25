// `sandbox: own` on this computer (FOL-244): a worker's slot, its private copy, its patch, its stop.
//
//   node --test tests/cli-code-worker.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import * as W from "../src/code-worker.mjs";
// @ts-ignore
import { readAgents } from "../src/code-agents.mjs";

const { takeSlot, reapTree, treeOf } = W;
const tmp = (p: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
const where = () => ({ copies: tmp("fw-copies-"), baselines: tmp("fw-bases-") });
const capture = (dir: string): any => W.captureFolder(dir, where());
const patchOf = (got: any) => W.workerPatch({ copy: got.copy, base: got.base, source: got.source });
/** Ended: no such process, or a zombie (in a container with no init, nothing reaps an orphan). */
const gone = (pid: number) => {
  try {
    process.kill(pid, 0);
  } catch (err: any) {
    if (err.code === "ESRCH") return true;
  }
  return /^Z/.test(spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim());
};
const SRC = path.join(import.meta.dirname, "..", "src", "code-worker.mjs");

test("three jobs start two: the third waits, and starts when a slot is given back", async () => {
  const dir = tmp("fw-slots-");
  const a: any = await takeSlot({ dir });
  const b: any = await takeSlot({ dir });
  assert.deepEqual([a.n, b.n].sort(), [0, 1]);
  let waited: number[] | null = null;
  let third: any;
  const p = takeSlot({ dir, every: 20, onWait: (h: number[]) => (waited = h) }).then((s: any) => (third = s));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(third, undefined, "no third slot while two are held");
  assert.deepEqual(waited, [process.pid, process.pid], "told who holds them");
  await a.release();
  await p;
  assert.equal(third!.n, a.n, "the freed slot");
  await b.release();
  await third!.release();
  assert.deepEqual(fs.readdirSync(dir).filter((f) => !f.startsWith("slots.lock.db")), [], "no slot left held (the lock's own file stays)");
});

test("separate processes racing for two slots: never more than two holders at once", async () => {
  const dir = tmp("fw-race-");
  const log = path.join(dir, "..", `race-${path.basename(dir)}.log`);
  const prog = `
    import("${SRC}").then(async (W) => {
      const fs = await import("node:fs");
      const s = await W.takeSlot({ dir: ${JSON.stringify(dir)}, every: 10 });
      fs.appendFileSync(${JSON.stringify(log)}, "in " + s.n + "\\n");
      await new Promise((r) => setTimeout(r, 150));
      fs.appendFileSync(${JSON.stringify(log)}, "out " + s.n + "\\n");
      await s.release();
    });`;
  const kids = Array.from({ length: 6 }, () => spawn(process.execPath, ["--input-type=module", "-e", prog], { stdio: "inherit" }));
  await Promise.all(kids.map((k) => new Promise((r) => k.on("close", r))));
  const lines = fs.readFileSync(log, "utf8").trim().split("\n");
  assert.equal(lines.length, 12, lines.join("|"));
  const held = new Set<string>();
  for (const l of lines) {
    const [what, n] = l.split(" ");
    if (what === "in") {
      assert.ok(!held.has(n), `slot ${n} taken twice: ${lines.join("|")}`);
      held.add(n);
    } else held.delete(n);
    assert.ok(held.size <= 2);
  }
});

test("a dead holder's slot is taken over; a reused process id with another start time is not alive; a held slot waits for what is left", async () => {
  const dir = tmp("fw-stale-");
  const dead = Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
  fs.writeFileSync(path.join(dir, "slot-0.json"), JSON.stringify({ pid: dead, token: "x" }));
  // This process's id, with a start time it never had: a different process given the same id.
  fs.writeFileSync(path.join(dir, "slot-1.json"), JSON.stringify({ pid: process.pid, start: "Thu Jan  1 00:00:00 1970", token: "y" }));
  const s: any = await takeSlot({ dir });
  const t: any = await takeSlot({ dir });
  assert.deepEqual([s.n, t.n].sort(), [0, 1]);
  // A slot held for a leftover process stays held after its holder is gone.
  const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
  // The session is alive (this process), but the slot was held for a leftover: it is free once the leftover is gone.
  fs.writeFileSync(path.join(dir, "slot-0.json"), JSON.stringify({ pid: process.pid, token: "z", held: true, left: [{ pid: sleeper.pid, start: W.processStart(sleeper.pid!) }] }));
  await t.release();
  const u: any = await takeSlot({ dir });
  assert.equal(u.n, 1, "slot 0 is held for the leftover process");
  const stop = new AbortController();
  const p = takeSlot({ dir, every: 20, signal: stop.signal });
  setTimeout(() => stop.abort(), 80);
  assert.equal(await p, null, "a stop while waiting starts nothing");
  sleeper.kill("SIGKILL");
  await new Promise((r) => sleeper.on("close", r));
  const v: any = await takeSlot({ dir });
  assert.equal(v.n, 0, "free once the leftover is gone, though its session lives");
  // A dead session whose worker still runs: the slot stays held.
  const w2 = spawn("sleep", ["30"], { stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "slot-0.json"), JSON.stringify({ pid: dead, token: "w", worker: [{ pid: w2.pid, start: W.processStart(w2.pid!) }] }));
  assert.equal(W.holderAlive(JSON.parse(fs.readFileSync(path.join(dir, "slot-0.json"), "utf8"))), true, "its worker lives");
  w2.kill("SIGKILL");
  await new Promise((r) => w2.on("close", r));
  assert.equal(W.holderAlive({ pid: dead, worker: [{ pid: w2.pid, start: "x" }] }), false);
  fs.writeFileSync(path.join(dir, "slot-0.json"), JSON.stringify({ pid: process.pid, token: v.token ?? "v" }));
  // Releasing a slot that is no longer ours does nothing.
  await s.release();
  assert.ok(fs.existsSync(path.join(dir, "slot-0.json")));
});

function project() {
  const dir = tmp("fw-proj-");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), "build/\n");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "run.sh"), "#!/bin/sh\necho hi\n", { mode: 0o755 });
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "start");
  fs.writeFileSync(path.join(dir, "new.txt"), "untracked\n");
  fs.mkdirSync(path.join(dir, "build"));
  fs.writeFileSync(path.join(dir, "build", "out.js"), "ignored\n");
  fs.writeFileSync(path.join(dir, ".env"), "KEY=secret\n");
  fs.writeFileSync(path.join(dir, "src", ".env.local"), "KEY=secret\n");
  fs.symlinkSync("/etc/passwd", path.join(dir, "link"));
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\nthree (not committed)\n");
  return dir;
}

const filesUnder = (root: string, rel = ""): string[] =>
  fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(root, path.join(rel, e.name)) : [path.join(rel, e.name)])).sort();

test("the copy is the folder as it is now: tracked and untracked files, never ignored ones, .env files or links; the baseline is apart from it", () => {
  const dir = project();
  const got = capture(dir);
  assert.ok(!("problem" in got), JSON.stringify(got));
  assert.deepEqual(filesUnder(got.copy), [".gitignore", "a.txt", "new.txt", "src/run.sh"]);
  assert.ok(!fs.existsSync(path.join(got.copy, ".git")), "the copy is no repository: the baseline is");
  assert.equal(fs.readFileSync(path.join(got.copy, "a.txt"), "utf8"), "one\ntwo\nthree (not committed)\n", "the working copy, not the last commit");
  assert.ok(fs.statSync(path.join(got.copy, "src", "run.sh")).mode & 0o100, "executable kept");
  assert.deepEqual(got.left.sort(), [".env (a .env file)", "link (a link)", "src/.env.local (a .env file)"]);
  assert.equal(git(got.base, "status", "--porcelain").stdout, "", "the baseline is committed");
  assert.ok(!got.base.startsWith(path.dirname(got.copy)), "the baseline is not beside the copy");
});

test("a folder reached through a link on its way is not copied from", () => {
  const dir = project();
  const outside = tmp("fw-outside-");
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside\n");
  fs.rmSync(path.join(dir, "src"), { recursive: true });
  fs.symlinkSync(outside, path.join(dir, "src"));
  const got = capture(dir);
  assert.ok(!fs.existsSync(path.join(got.copy, "src", "secret.txt")));
});

test("a folder in no git repository, or one inside where copies are made, is refused before anything is copied", () => {
  const dir = tmp("fw-nogit-");
  fs.writeFileSync(path.join(dir, "a.txt"), "x");
  assert.match(capture(dir).problem, /not in a git repository/);
  const proj = project();
  assert.match((W.captureFolder(proj, { copies: path.join(proj, "copies"), baselines: tmp("b-") }) as any).problem, /one inside the other/);
});

test("the patch: changed, added, deleted and binary files, as the folder names them, and it applies there; links and .env files it made stay out", () => {
  const dir = project();
  const got = capture(dir);
  const c = got.copy;
  fs.writeFileSync(path.join(c, "a.txt"), "one\nTWO\nthree (not committed)\n");
  fs.writeFileSync(path.join(c, "src", "added.txt"), "added\n");
  fs.rmSync(path.join(c, "new.txt"));
  fs.writeFileSync(path.join(c, "img.bin"), Buffer.from([0, 1, 2, 255, 0, 7]));
  fs.symlinkSync("/etc/hosts", path.join(c, "evil-link"));
  fs.writeFileSync(path.join(c, ".env"), "STOLEN=1\n");
  const back = patchOf(got);
  assert.deepEqual(back.files.sort(), ["a.txt", "img.bin", "new.txt", "src/added.txt"]);
  assert.deepEqual(back.left.sort(), [".env (a .env file)", "evil-link (a link)"]);
  assert.ok(fs.lstatSync(path.join(c, "evil-link")).isSymbolicLink(), "nothing in the copy is deleted by the parent");
  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one\ntwo\nthree (not committed)\n", "the folder is untouched until the patch goes in");
  assert.equal(spawnSync("git", ["apply", "--check"], { cwd: dir, input: back.patch }).status, 0);
  assert.equal(spawnSync("git", ["apply"], { cwd: dir, input: back.patch }).status, 0);
  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one\nTWO\nthree (not committed)\n");
  assert.deepEqual([...fs.readFileSync(path.join(dir, "img.bin"))], [0, 1, 2, 255, 0, 7]);
  assert.ok(!fs.existsSync(path.join(dir, "new.txt")));
  assert.equal(fs.readFileSync(path.join(dir, ".env"), "utf8"), "KEY=secret\n");
});

test("a worker that commits, or stages a .env, in a repository of its own still hands back what it changed — and never the .env", () => {
  const got = capture(project());
  const c = got.copy;
  fs.writeFileSync(path.join(c, "a.txt"), "committed by the worker\n");
  fs.writeFileSync(path.join(c, ".env"), "STOLEN=1\n");
  git(c, "init", "-q");
  git(c, "add", "-A", "-f");
  git(c, "commit", "-q", "-m", "mine");
  const back = patchOf(got);
  assert.deepEqual(back.files, ["a.txt"]);
  assert.ok(!back.patch.toString().includes("STOLEN"));
});

test("a folder of the copy turned into a link to the person's folder: the parent follows it nowhere, and the file outside survives", () => {
  const dir = project();
  const got = capture(dir);
  const sentinel = path.join(dir, "src", ".env.keep");
  fs.writeFileSync(sentinel, "must survive\n");
  fs.symlinkSync("/etc/hosts", path.join(dir, "src", "linked"));
  fs.rmSync(path.join(got.copy, "src"), { recursive: true });
  fs.symlinkSync(path.join(dir, "src"), path.join(got.copy, "src"));
  const back = patchOf(got);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "must survive\n");
  assert.ok(fs.lstatSync(path.join(dir, "src", "linked")).isSymbolicLink(), "a link in the person's folder is not removed");
  assert.deepEqual(back.files, [], "src/run.sh is not deleted: a link stands in its folder's place");
  assert.ok(back.left.includes("src (a link)"));
});

test("what the folder's own ignore rules leave out does not come back, even if the worker changes the rules", () => {
  const got = capture(project());
  fs.mkdirSync(path.join(got.copy, "build"), { recursive: true });
  fs.writeFileSync(path.join(got.copy, "build", "out.js"), "made by a build\n");
  fs.writeFileSync(path.join(got.copy, ".gitignore"), "");
  const back = patchOf(got);
  assert.deepEqual(back.files, [".gitignore"]);
});

test("a .GIT or .Env in another case is neither written into the baseline's repository nor handed back", () => {
  const got = capture(project());
  fs.mkdirSync(path.join(got.copy, ".GIT"), { recursive: true });
  fs.writeFileSync(path.join(got.copy, ".GIT", "config"), "[core]\n\thooksPath = /tmp/evil\n");
  fs.writeFileSync(path.join(got.copy, ".Env"), "STOLEN=1\n");
  const cfg = fs.readFileSync(path.join(got.base, ".git", "config"), "utf8");
  const back = patchOf(got);
  assert.equal(fs.readFileSync(path.join(got.base, ".git", "config"), "utf8"), cfg);
  assert.deepEqual(back.files, []);
});

test("the folder's info/exclude rules, and a parent folder's .gitignore, keep new files out — never read", () => {
  const root = project();
  fs.writeFileSync(path.join(root, ".git", "info", "exclude"), "secret-notes.txt\n");
  fs.writeFileSync(path.join(root, ".gitignore"), "build/\n*.log\n");
  git(root, "add", ".gitignore");
  git(root, "commit", "-q", "-m", "ign");
  const sub = path.join(root, "src");
  const got = capture(sub);
  fs.writeFileSync(path.join(got.copy, "secret-notes.txt"), "x");
  fs.writeFileSync(path.join(got.copy, "debug.log"), "x");
  fs.mkdirSync(path.join(got.copy, "build"));
  // Bigger than what can come back: never read, because the folder ignores it.
  fs.writeFileSync(path.join(got.copy, "build", "huge.bin"), Buffer.alloc(8));
  fs.writeFileSync(path.join(got.copy, "kept.txt"), "x");
  assert.deepEqual(patchOf(got).files, ["kept.txt"]);
});

test("a file that becomes a folder, and a folder that becomes a file: the patch applies", () => {
  const dir = project();
  const got = capture(dir);
  fs.rmSync(path.join(got.copy, "a.txt"));
  fs.mkdirSync(path.join(got.copy, "a.txt"));
  fs.writeFileSync(path.join(got.copy, "a.txt", "inner"), "now a folder\n");
  fs.rmSync(path.join(got.copy, "src"), { recursive: true });
  fs.writeFileSync(path.join(got.copy, "src"), "now a file\n");
  const back = patchOf(got);
  assert.deepEqual(back.files.sort(), ["a.txt", "a.txt/inner", "src", "src/run.sh"]);
  // git refuses to turn src/ into a file while the person's own untracked src/.env.local is in it (as it should); without it, it applies.
  fs.rmSync(path.join(dir, "src", ".env.local"));
  const r = spawnSync("git", ["apply"], { cwd: dir, input: back.patch, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, "a.txt", "inner"), "utf8"), "now a folder\n");
  assert.equal(fs.readFileSync(path.join(dir, "src"), "utf8"), "now a file\n");
});

test("nothing changed: an empty patch — after the copy is looked through for holders, as a real run does; modes kept both ways", () => {
  const got = capture(project());
  W.holdersOf(got.copy);
  assert.equal(patchOf(got).patch.length, 0, "no file gained an executable bit");
  fs.chmodSync(path.join(got.copy, "src", "run.sh"), 0o644);
  W.holdersOf(got.copy);
  const back = patchOf(got);
  assert.deepEqual(back.files, ["src/run.sh"]);
  assert.match(back.patch.toString(), /old mode 100755\nnew mode 100644/);
});

test("a stop reaps the tree: a process in a group of its own, left by a worker killed outright, is gone", async () => {
  // The worker stand-in starts a child in a new process group (as the engine's Bash does), then is killed with KILL.
  const leader = spawn(process.execPath, ["-e", `require("child_process").spawn("sh", ["-c", "trap '' TERM; sleep 60"], { detached: true, stdio: "ignore" }); setInterval(() => {}, 1000);`], { detached: true, stdio: "ignore" });
  const root = leader.pid!;
  await new Promise((r) => setTimeout(r, 400));
  const seen = treeOf(root);
  assert.ok(seen.size >= 2, "the child was seen while the worker ran");
  const groups = new Set([...seen.values()].map((v) => v.pgid));
  assert.ok(groups.size >= 2, "the child is in a group of its own");
  process.kill(root, "SIGKILL");
  await new Promise((r) => setTimeout(r, 200));
  const left = await reapTree(root, seen, { graceMs: 300 });
  assert.deepEqual(left, []);
  for (const pid of seen.keys()) assert.ok(gone(pid), "nothing of it is left");
});

test("a member of a group seen earlier, vouched for by no live process, is held and never signalled", async () => {
  const mark = path.join(tmp("fw-sig-"), "got");
  // It writes down any TERM it gets (and stays): a signal sent to it would show.
  const victim = spawn("/bin/sh", ["-c", `trap 'echo TERM >> ${mark}' TERM; while :; do /bin/sleep 0.1; done`], { detached: true, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 200));
  const g = victim.pid!;
  // The worker once had a process in this group, long gone (not the same start).
  const seen = new Map([[999_998, { pgid: g, start: "Thu Jan  1 00:00:00 1970" }]]);
  const left = await reapTree(999_999, seen, { graceMs: 200, waitMs: 300 });
  assert.ok(left.some((l) => l.pid === g && l.start === W.processStart(g)), "returned as left, as it is now: the slot stays held, no patch");
  assert.ok(!fs.existsSync(mark), "never signalled");
  process.kill(-g, "SIGKILL");
});

test("a group vouched for by a live recorded member is reaped whole, an unsampled peer too, with the worker gone", async () => {
  // A group of its own: its leader (recorded) and a peer (never sampled), both ignoring TERM; the root is long gone.
  const lead = spawn("/bin/sh", ["-c", "trap '' TERM; /bin/sleep 68 & /bin/sleep 69; wait"], { detached: true, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 300));
  const seen = new Map([[lead.pid!, { pgid: lead.pid!, start: W.processStart(lead.pid!)! }]]);
  assert.deepEqual(await reapTree(999_999, seen, { graceMs: 200 }), []);
  assert.equal(spawnSync("/bin/ps", ["-axo", "command="], { encoding: "utf8" }).stdout.split("\n").filter((l) => /^\/bin\/sleep 6[89]$/.test(l)).length, 0);
});

test("a group moved out of is still searched: what was left in it is held", async () => {
  const lead = spawn("/bin/sh", ["-c", "while :; do /bin/sleep 0.1; done"], { detached: true, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 200));
  // Recorded now under another group, but seen in this one before.
  const seen = new Map([[999_997, { pgid: 999_996, start: "x" }]]);
  const left = await reapTree(999_999, seen, { groups: new Set([lead.pid!]), graceMs: 100, waitMs: 100 });
  assert.ok(left.some((l) => l.pid === lead.pid));
  process.kill(-lead.pid!, "SIGKILL");
});

test("on Linux without lsof, /proc: a holder by cwd, fd or mapping is found; this person's process that will not show its mappings is no answer", () => {
  const copy = tmp("fw-proc-copy-");
  const proc = tmp("fw-proc-");
  fs.mkdirSync(path.join(proc, "self", "fd"), { recursive: true });
  const child = spawn("sleep", ["30"], { stdio: "ignore" });
  const pid = child.pid!;
  const at = path.join(proc, String(pid));
  fs.mkdirSync(path.join(at, "fd"), { recursive: true });
  fs.writeFileSync(path.join(at, "status"), `Name:\tsleep\nUid:\t${process.getuid!()}\t0\t0\t0\n`);
  fs.symlinkSync("/", path.join(at, "cwd"));
  fs.symlinkSync("/", path.join(at, "root"));
  fs.writeFileSync(path.join(at, "maps"), `7f00-7f01 r--p 0 00:00 0 ${copy}/lib.so\n`);
  try {
    assert.ok(W.holdersOf(copy, { lsof: null, proc }).has(pid), "a closed but mapped file holds it");
    fs.writeFileSync(path.join(at, "maps"), "");
    assert.equal(W.holdersOf(copy, { lsof: null, proc }).size, 0);
    fs.rmSync(path.join(at, "cwd"));
    fs.symlinkSync(copy, path.join(at, "cwd"));
    assert.ok(W.holdersOf(copy, { lsof: null, proc }).has(pid), "its folder is in the copy");
    fs.rmSync(path.join(at, "cwd"));
    fs.symlinkSync("/", path.join(at, "cwd"));
    fs.chmodSync(path.join(at, "maps"), 0o000);
    assert.throws(() => W.holdersOf(copy, { lsof: null, proc }), /could not be checked/);
    // A status with no readable Uid is no answer either.
    fs.chmodSync(path.join(at, "maps"), 0o644);
    fs.writeFileSync(path.join(at, "status"), "Name:\tsleep\n");
    assert.throws(() => W.holdersOf(copy, { lsof: null, proc }), /EBADUID/);
    fs.chmodSync(path.join(at, "maps"), 0o000);
    // Another person's process, same denial: skipped.
    fs.writeFileSync(path.join(at, "status"), `Name:\tsleep\nUid:\t${process.getuid!() + 1}\t0\t0\t0\n`);
    assert.equal(W.holdersOf(copy, { lsof: null, proc }).size, 0);
  } finally {
    child.kill("SIGKILL");
  }
});

test("a process id given again to another process is not walked from or signalled", async () => {
  const other = spawn("sleep", ["30"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 100));
  // The worker "was" this id, started at another time: nothing is walked, nothing is hit.
  assert.equal(treeOf(other.pid!, undefined, "Thu Jan  1 00:00:00 1970").size, 0);
  const seen = new Map();
  assert.deepEqual(await reapTree(other.pid!, seen, { rootStart: "Thu Jan  1 00:00:00 1970", graceMs: 100 }), []);
  assert.doesNotThrow(() => process.kill(other.pid!, 0), "still alive");
  // A recorded id whose start no longer matches is not signalled either.
  const seen2 = new Map([[other.pid!, { pgid: other.pid!, start: "Thu Jan  1 00:00:00 1970" }]]);
  assert.deepEqual(await reapTree(999_999, seen2, { graceMs: 100 }), []);
  assert.doesNotThrow(() => process.kill(other.pid!, 0), "still alive");
  other.kill("SIGKILL");
});

test("a holder behind a folder the worker made unreadable is still found; an unchecked hold stays while it holds the copy", async () => {
  const copy = tmp("fw-hide-");
  fs.mkdirSync(path.join(copy, "a", "b"), { recursive: true });
  const child = spawn("/bin/sleep", ["30"], { cwd: path.join(copy, "a", "b"), stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 300));
  fs.chmodSync(path.join(copy, "a"), 0o000);
  assert.ok(W.holdersOf(copy).has(child.pid!), "the copy is made readable before it is looked through");
  const dead = Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
  const rec = { pid: dead, held: true, left: [], unchecked: true, copy };
  assert.equal(W.holderAlive(rec), true, "held while something holds the copy");
  child.kill("SIGKILL");
  await new Promise((r) => child.on("close", r));
  assert.equal(W.holderAlive(rec), false, "free once nothing does");
});

test("the sweep removes a crashed session's read-only copy, and one that will not go blocks no other", () => {
  const w = where();
  const dead = Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
  for (const id of ["0123456789abcdef", "fedcba9876543210"]) {
    fs.mkdirSync(path.join(w.copies, id, "ro"), { recursive: true });
    fs.writeFileSync(path.join(w.copies, id, "ro", "f"), "x");
    fs.chmodSync(path.join(w.copies, id, "ro"), 0o500);
    fs.mkdirSync(path.join(w.baselines, id));
    fs.writeFileSync(path.join(w.baselines, `${id}.owner`), JSON.stringify({ pid: dead }));
  }
  // macOS: one file that cannot be removed on the first pass (user-immutable).
  const stuck = path.join(w.copies, "0123456789abcdef", "ro", "f");
  const flagged = process.platform === "darwin" && spawnSync("chflags", ["uchg", stuck]).status === 0;
  W.sweepLeftovers(w.copies, w.baselines);
  if (flagged) {
    assert.deepEqual(fs.readdirSync(w.copies), ["0123456789abcdef"], "the other one went");
    assert.ok(fs.existsSync(path.join(w.baselines, "0123456789abcdef.owner")), "its note is kept, so it is retried");
    spawnSync("chflags", ["nouchg", stuck]);
    W.sweepLeftovers(w.copies, w.baselines);
  }
  assert.deepEqual(fs.readdirSync(w.copies), []);
  assert.deepEqual(fs.readdirSync(w.baselines), []);
});

test("a copy whose removal failed while its session lives is retried by the next sweep", () => {
  const w = where();
  const id = "00112233445566aa";
  fs.mkdirSync(path.join(w.copies, id));
  fs.mkdirSync(path.join(w.baselines, id));
  // This live session, its worker reaped: only files are left.
  fs.writeFileSync(path.join(w.baselines, `${id}.owner`), JSON.stringify({ pid: process.pid, start: W.processStart(process.pid), cleanup: true }));
  W.sweepLeftovers(w.copies, w.baselines);
  assert.deepEqual(fs.readdirSync(w.copies), []);
  assert.deepEqual(fs.readdirSync(w.baselines), []);
});

test("a worker that cannot be recorded is not given its job, and nothing of it is left", async () => {
  const copy = tmp("fw-norec-");
  const got = await W.runWorker({
    job: { copy, prompt: "must not be sent" },
    env: W.workerEnv(process.env),
    copy,
    signal: new AbortController().signal,
    onSpawn: () => {
      throw new Error("disk full");
    },
    onMessage: () => assert.fail("no message"),
  });
  assert.match(String(got.error), /not given the job: disk full/);
  assert.equal(got.result, null);
  assert.deepEqual(got.left, []);
});

test("what holds a copy is found by lsof (a process with it as its folder)", async () => {
  const copy = tmp("fw-hold-");
  const child = spawn("/bin/sleep", ["30"], { cwd: copy, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(W.holdersOf(copy).has(child.pid!));
  child.kill("SIGKILL");
  await new Promise((r) => child.on("close", r));
  assert.equal(W.holdersOf(copy).size, 0);
});

test("the reap works with PATH narrowed as the session's walls narrow it (no ps on it)", () => {
  const prog = `
    import("${SRC}").then(async (W) => {
      const { spawn } = await import("node:child_process");
      const leader = spawn(process.execPath, ["-e", "require('child_process').spawn('/bin/sh', ['-c', '/bin/sleep 63'], { detached: true, stdio: 'ignore' }); setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
      await new Promise((r) => setTimeout(r, 400));
      const seen = W.treeOf(leader.pid);
      const left = await W.reapTree(leader.pid, seen, { graceMs: 300 });
      process.stdout.write(JSON.stringify({ seen: seen.size, left }));
    });`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", prog], { encoding: "utf8", env: { ...process.env, PATH: "/nonexistent" } });
  const got = JSON.parse(r.stdout || "{}");
  assert.ok(got.seen >= 2, r.stderr);
  assert.deepEqual(got.left, []);
});

test("a slot held for a leftover is not given out when the leftover is gone but another process still holds the copy", async () => {
  const copy = tmp("fw-two-");
  const leftover = spawn("sleep", ["30"], { stdio: "ignore" });
  const other = spawn("/bin/sleep", ["30"], { cwd: copy, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 300));
  const rec = { pid: process.pid, start: W.processStart(process.pid), held: true, left: [{ pid: leftover.pid!, start: W.processStart(leftover.pid!)! }], copy };
  assert.equal(W.holderAlive(rec), true);
  leftover.kill("SIGKILL");
  await new Promise((r) => leftover.on("close", r));
  assert.equal(W.holderAlive(rec), true, "the other still holds the copy");
  other.kill("SIGKILL");
  await new Promise((r) => other.on("close", r));
  assert.equal(W.holderAlive(rec), false);
});

test("a session that died between holding its slot and its note: the sweep keeps the copy, and the slot stays held, while anything holds it", async () => {
  const w = where();
  const slots = tmp("fw-gap-");
  const id = "a1b2c3d4e5f60718";
  const copy = path.join(w.copies, id);
  fs.mkdirSync(copy);
  fs.mkdirSync(path.join(w.baselines, id));
  const dead = Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
  const other = spawn("/bin/sleep", ["30"], { cwd: copy, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 300));
  // The slot was written (held, with the copy); the note still names only the dead session.
  fs.writeFileSync(path.join(slots, "slot-0.json"), JSON.stringify({ pid: dead, token: "t", held: true, left: [], copy }));
  fs.writeFileSync(path.join(w.baselines, `${id}.owner`), JSON.stringify({ pid: dead }));
  W.sweepLeftovers(w.copies, w.baselines);
  assert.ok(fs.existsSync(copy), "kept: something holds it");
  const s: any = await takeSlot({ dir: slots, slots: 1, every: 20, signal: AbortSignal.timeout(300) });
  assert.equal(s, null, "the slot is not given out");
  other.kill("SIGKILL");
  await new Promise((r) => other.on("close", r));
  W.sweepLeftovers(w.copies, w.baselines);
  assert.ok(!fs.existsSync(copy), "removed once nothing holds it");
  const t: any = await takeSlot({ dir: slots, slots: 1 });
  assert.equal(t.n, 0);
  await t.release();
});

test("a session that died before it could record a hold: its slot (as slot.worker wrote it) is not given out while anything holds the copy", async () => {
  const slots = tmp("fw-early-");
  const copy = tmp("fw-early-copy-");
  const s0: any = await takeSlot({ dir: slots, slots: 1 });
  const w = spawn("sleep", ["30"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 100));
  await s0.worker({ pid: w.pid!, start: W.processStart(w.pid!) }, copy);
  const other = spawn("/bin/sleep", ["30"], { cwd: copy, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 300));
  // The session and its worker are gone; only the record slot.worker made is left.
  const rec = JSON.parse(fs.readFileSync(path.join(slots, "slot-0.json"), "utf8"));
  const dead = Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
  fs.writeFileSync(path.join(slots, "slot-0.json"), JSON.stringify({ ...rec, pid: dead, start: "gone" }));
  w.kill("SIGKILL");
  await new Promise((r) => w.on("close", r));
  assert.equal(await takeSlot({ dir: slots, slots: 1, every: 20, signal: AbortSignal.timeout(300) }), null, "held: the copy is held");
  other.kill("SIGKILL");
  await new Promise((r) => other.on("close", r));
  const t: any = await takeSlot({ dir: slots, slots: 1 });
  assert.equal(t.n, 0, "free once nothing holds it");
  await t.release();
});

test("a slot's record is replaced whole: an update cut off before its rename leaves the previous record holding the slot", async () => {
  const slots = tmp("fw-atomic-");
  const s0: any = await takeSlot({ dir: slots, slots: 1 });
  const file = path.join(slots, "slot-0.json");
  const ino = fs.statSync(file).ino;
  await s0.worker({ pid: process.pid, start: W.processStart(process.pid) }, "/nonexistent");
  assert.notEqual(fs.statSync(file).ino, ino, "replaced by a rename, not written over in place");
  // A crash mid-update: the temp file is left half-written, the record itself untouched.
  fs.writeFileSync(`${file}.1.dead.tmp`, '{"held":');
  assert.equal(await takeSlot({ dir: slots, slots: 1, every: 20, signal: AbortSignal.timeout(200) }), null, "still held by the intact record");
  await s0.release();
  const t: any = await takeSlot({ dir: slots, slots: 1 });
  assert.equal(t.n, 0);
  await t.release();
});

test("the slots' lock is the operating system's: a paused holder keeps it however long, a killed one lets go at once; a slot taken over refuses its worker", async () => {
  const slots = tmp("fw-mutex-");
  // A holder that takes the lock and then stops (SIGSTOP: paused, not dead).
  const holder = spawn(process.execPath, ["--input-type=module", "-e", `
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(path.join(slots, "slots.lock.db"))});
    db.exec("BEGIN EXCLUSIVE");
    process.stdout.write("held");
    setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "ignore"] });
  await new Promise((r) => holder.stdout.once("data", r));
  process.kill(holder.pid!, "SIGSTOP");
  const helper = `import("${SRC}").then(async (W) => { const s = await W.takeSlot({ dir: ${JSON.stringify(slots)}, slots: 1 }); process.stdout.write(String(s.n)); await s.release(); })`;
  const waiting = spawn(process.execPath, ["--input-type=module", "-e", helper], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  waiting.stdout.on("data", (d) => (out += d));
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(out, "", "the paused holder keeps it");
  process.kill(holder.pid!, "SIGKILL");
  await new Promise((r) => waiting.on("close", r));
  assert.equal(out, "0", "the killed holder's lock is let go");
  // A slot whose record was taken over: its worker is refused.
  const s0: any = await takeSlot({ dir: slots, slots: 1 });
  fs.writeFileSync(path.join(slots, "slot-0.json"), JSON.stringify({ pid: process.pid, token: "someone-else" }));
  await assert.rejects(s0.worker({ pid: process.pid, start: null }, "/x"), /taken over/);
});

test("while a paused process holds the slots' lock: a stop ends the wait at once, and a slot given back is free once the lock is", async () => {
  const slots = tmp("fw-pause-");
  const s0: any = await takeSlot({ dir: slots, slots: 1 });
  const holder = spawn(process.execPath, ["--input-type=module", "-e", `
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(path.join(slots, "slots.lock.db"))});
    db.exec("BEGIN EXCLUSIVE");
    process.stdout.write("held");
    setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "ignore"] });
  await new Promise((r) => holder.stdout.once("data", r));
  process.kill(holder.pid!, "SIGSTOP");
  try {
    // Given back while the lock is held elsewhere: it returns, and the slot counts as free (this session lives on).
    const t0 = Date.now();
    await s0.release();
    assert.ok(Date.now() - t0 < 5000);
    // A stop while waiting for the lock: over at once, the timers of this process still running meanwhile.
    const stop = new AbortController();
    let ticks = 0;
    const tick = setInterval(() => ticks++, 10);
    const p = takeSlot({ dir: slots, slots: 1, signal: stop.signal });
    setTimeout(() => stop.abort(), 200);
    const s1 = Date.now();
    assert.equal(await p, null);
    clearInterval(tick);
    assert.ok(Date.now() - s1 < 1000, "the stop is heard while it waits");
    assert.ok(ticks > 5, "this process is not blocked while it waits");
  } finally {
    process.kill(holder.pid!, "SIGKILL");
  }
  const t: any = await takeSlot({ dir: slots, slots: 1 });
  assert.equal(t.n, 0, "the slot given back is free, though its session is alive");
  assert.deepEqual(fs.readdirSync(slots).filter((f) => f.includes(".done-")), [], "the marker is cleared with the old record");
  await t.release();
});

test("a hold is written even while a paused process holds the lock, and frees the slot when the leftover is gone though the session lives; no listener is left behind", async () => {
  const slots = tmp("fw-hold-");
  const copy = tmp("fw-hold-copy-");
  const s0: any = await takeSlot({ dir: slots, slots: 1 });
  const holder = spawn(process.execPath, ["--input-type=module", "-e", `
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(path.join(slots, "slots.lock.db"))});
    db.exec("BEGIN EXCLUSIVE");
    process.stdout.write("held");
    setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "ignore"] });
  await new Promise((r) => holder.stdout.once("data", r));
  process.kill(holder.pid!, "SIGSTOP");
  const leftover = spawn("sleep", ["30"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 100));
  try {
    const t0 = Date.now();
    await s0.hold([{ pid: leftover.pid!, start: W.processStart(leftover.pid!)! }], copy);
    assert.ok(Date.now() - t0 < 1000, "written without waiting for the lock");
  } finally {
    process.kill(holder.pid!, "SIGKILL");
  }
  // Listeners: a contended wait that ends in the lock leaves none behind.
  const stop = new AbortController();
  const p = takeSlot({ dir: slots, slots: 1, every: 20, signal: stop.signal });
  await new Promise((r) => setTimeout(r, 300));
  stop.abort();
  assert.equal(await p, null, "held for the leftover, this session alive");
  leftover.kill("SIGKILL");
  await new Promise((r) => leftover.on("close", r));
  const t: any = await takeSlot({ dir: slots, slots: 1 });
  assert.equal(t.n, 0, "free once the leftover is gone, though the session that held it lives");
  await t.release();
});

test("waiting for the lock leaves no abort listener behind", async () => {
  const slots = tmp("fw-listen-");
  const holder = spawn(process.execPath, ["--input-type=module", "-e", `
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(path.join(slots, "slots.lock.db"))});
    db.exec("BEGIN EXCLUSIVE");
    process.stdout.write("held");
    setTimeout(() => process.exit(0), 600);`], { stdio: ["ignore", "pipe", "ignore"] });
  await new Promise((r) => holder.stdout.once("data", r));
  const stop = new AbortController();
  let added = 0;
  let removed = 0;
  const add = stop.signal.addEventListener.bind(stop.signal);
  const rm = stop.signal.removeEventListener.bind(stop.signal);
  stop.signal.addEventListener = ((...a: any[]) => (added++, (add as any)(...a))) as any;
  stop.signal.removeEventListener = ((...a: any[]) => (removed++, (rm as any)(...a))) as any;
  const s0: any = await takeSlot({ dir: slots, slots: 1, signal: stop.signal });
  assert.equal(s0.n, 0);
  assert.ok(added > 5, "it waited, more than a few tries");
  assert.equal(added, removed, "every listener it added was removed");
  await s0.release();
});

test("waiting for a busy slot leaves no abort listener behind; a temp file of a live writer is kept, a dead one's goes", async () => {
  const slots = tmp("fw-listen2-");
  const a0: any = await takeSlot({ dir: slots, slots: 1 });
  const stop = new AbortController();
  let added = 0;
  let removed = 0;
  const add = stop.signal.addEventListener.bind(stop.signal);
  const rm = stop.signal.removeEventListener.bind(stop.signal);
  stop.signal.addEventListener = ((...x: any[]) => (added++, (add as any)(...x))) as any;
  stop.signal.removeEventListener = ((...x: any[]) => (removed++, (rm as any)(...x))) as any;
  const dead = Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
  fs.writeFileSync(path.join(slots, `slot-0.json.held-ab.${process.pid}.0123abcd.tmp`), "{");
  fs.writeFileSync(path.join(slots, `slot-0.json.held-cd.${dead}.0123abcd.tmp`), "{");
  const p = takeSlot({ dir: slots, slots: 1, every: 20, signal: stop.signal });
  setTimeout(() => void a0.release(), 300);
  const b0: any = await p;
  assert.equal(b0.n, 0);
  assert.ok(added > 5, "it polled several times");
  assert.equal(added, removed, "every listener it added was removed");
  const temps = fs.readdirSync(slots).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(temps, [`slot-0.json.held-ab.${process.pid}.0123abcd.tmp`], "the live writer's is kept");
  await b0.release();
});

test("a crashed session's copy and baseline are swept by the next capture; a live one's are kept", () => {
  const w = where();
  const proj = project();
  const live: any = W.captureFolder(proj, w);
  const dead = Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
  const old = "0123456789abcdef";
  fs.mkdirSync(path.join(w.copies, old));
  fs.mkdirSync(path.join(w.baselines, old));
  fs.writeFileSync(path.join(w.baselines, `${old}.owner`), JSON.stringify({ pid: dead }));
  const next: any = W.captureFolder(proj, w);
  assert.ok(!fs.existsSync(path.join(w.copies, old)) && !fs.existsSync(path.join(w.baselines, old)));
  assert.ok(fs.existsSync(live.copy) && fs.existsSync(live.base) && fs.existsSync(next.copy));
});

test("the worker starts with plain variables only", () => {
  const env = W.workerEnv({ PATH: "/bin", HOME: "/h", GH_TOKEN: "x", NODE_OPTIONS: "--require evil", LD_PRELOAD: "x", ANTHROPIC_API_KEY: "k", LANG: "C", XDG_CONFIG_HOME: "/c" });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH", "XDG_CONFIG_HOME"]);
});

test("a definition's sandbox: own, at the top, quoted or in guardrail:, marks it; a wrong value leaves it out", () => {
  const dir = tmp("fw-defs-");
  const agents = path.join(dir, ".claude", "agents");
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(agents, "fixer.md"), "---\nname: fixer\ndescription: fixes\ntools: Read, Edit, Bash\nsandbox: own\n---\n\nFix it.\n");
  fs.writeFileSync(path.join(agents, "quoted.md"), "---\nname: quoted\ndescription: fixes\ntools: Read\n\"sandbox\": own\n---\n\nFix it.\n");
  fs.writeFileSync(path.join(agents, "guarded.md"), "---\nname: guarded\ndescription: fixes\ntools: Read, Edit\nguardrail:\n  sandbox: own\n---\n\nFix it.\n");
  fs.writeFileSync(path.join(agents, "shared.md"), "---\nname: shared\ndescription: fixes\ntools: Read\nsandbox: parent\n---\n\nRead it.\n");
  fs.writeFileSync(path.join(agents, "odd.md"), "---\nname: odd\ndescription: fixes\ntools: Read\nsandbox: maybe\n---\n\nRead it.\n");
  const { agents: got, problems } = readAgents(dir);
  const by = Object.fromEntries(got.map((a: any) => [a.name, a]));
  assert.equal(by.fixer.own, true);
  assert.equal(by.quoted.own, true);
  assert.equal(by.guarded.own, true);
  assert.equal(by.shared.own, undefined);
  assert.equal(by.odd, undefined);
  assert.ok(problems.some((p: any) => /sandbox: is own or parent/.test(p.why)));
});

test("lsof's warning about a mount elsewhere (Docker's netns) is no doubt about the copy; one in or above it, or any other, still is", () => {
  const docker = "lsof: WARNING: can't stat() nsfs file system /run/docker/netns/default\n      Output information may be incomplete.\n";
  const copy = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "copy-")));
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "via-")), "copy");
  fs.symlinkSync(copy, link);
  assert.equal(W.lsofWarnings(docker, copy), "", "the dev CI runner, 25 Nov 2026: Docker running, the slot never came back");
  assert.equal(W.lsofWarnings("", copy), "");
  assert.equal(W.lsofWarnings("lsof: WARNING: can't stat() smbfs file system /Volumes/Team Share\n", copy), "", "a mount elsewhere with a space in its name (Codex)");
  assert.match(W.lsofWarnings(`lsof: WARNING: can't stat() fuse file system ${copy}/a b\n`, copy), /fuse/, "one inside it, with a space");
  assert.match(W.lsofWarnings(`lsof: WARNING: can't stat() fuse file system ${copy}/mnt\n`, link), /fuse/, "inside it by its real path, the folder named through a link (Codex)");
  assert.match(W.lsofWarnings(docker, path.join(copy, "gone")), /nsfs/, "a folder that cannot be resolved keeps every warning");
  assert.match(W.lsofWarnings(`lsof: WARNING: can't stat() fuse file system ${copy}/mnt\n      Output information may be incomplete.\n`, copy), /fuse file system/, "a mount inside the copy");
  assert.match(W.lsofWarnings(`lsof: WARNING: can't stat() nfs file system ${path.dirname(copy)}\n`, copy), /nfs/, "a mount above it");
  assert.match(W.lsofWarnings(docker + `lsof: WARNING: can't open ${copy}/x: Permission denied\n`, copy), /Permission denied/, "another warning stays");
  assert.match(W.lsofWarnings(`lsof: WARNING: can't stat() nsfs file system /run/docker/netns/x\nlsof: status error on ${copy}/y\n      Output information may be incomplete.\n`, copy), /status error[\s\S]*may be incomplete/, "the incomplete line stays with another doubt");
});
