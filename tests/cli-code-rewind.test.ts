// /rewind's journal (src/code-rewind.mjs): what one Write or Edit did to one
// file, and taking it back only when nothing else touched the file since.
// The cases are the ones the design was argued over with Codex (24 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { openJournal, capture, settle, turnsOf, plan, apply, markIntent, nextTurn, TURNS_KEPT } from "../src/code-rewind.mjs";

function folder(files: Record<string, string> = {}) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-rewind-")));
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), text);
  }
  return d;
}

let seq = 0;
/** One agent call as the session records it: the copy first, the write (or not), then the look after. */
function agent(j: ReturnType<typeof openJournal>, turn: number, tool: "Write" | "Edit", file: string, input: Record<string, unknown>, write: (() => void) | null) {
  const id = `t${++seq}`;
  capture(j, { turn, label: `turn ${turn}`, id, tool, file: path.join(j.root, file), input: { file_path: path.join(j.root, file), ...input } });
  write?.();
  return settle(j, id);
}
const read = (d: string, f: string) => fs.readFileSync(path.join(d, f), "utf8");
const put = (d: string, f: string, text: string) => fs.writeFileSync(path.join(d, f), text);

test.before(() => {
  process.env.FOLDRUN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
});

test("an edit and a new file are taken back: the bytes and the mode as they were, the created file gone", () => {
  const d = folder({ "run.sh": "echo a\n" });
  fs.chmodSync(path.join(d, "run.sh"), 0o755);
  const j = openJournal(d, "c1");
  assert.equal(agent(j, 1, "Edit", "run.sh", { old_string: "a", new_string: "b" }, () => put(d, "run.sh", "echo b\n")), "run.sh");
  assert.equal(agent(j, 1, "Write", "new/x.txt", { content: "x\n" }, () => (fs.mkdirSync(path.join(d, "new")), put(d, "new/x.txt", "x\n"))), "new/x.txt");
  assert.deepEqual(turnsOf(j), [{ turn: 1, label: "turn 1", files: [{ path: "run.sh", op: "changed" }, { path: "new/x.txt", op: "created" }] }]);
  const p = plan(j, 1);
  assert.deepEqual(p.conflicts, []);
  assert.deepEqual(apply(j, p).sort(), ["new/x.txt", "run.sh"]);
  assert.equal(read(d, "run.sh"), "echo a\n");
  assert.equal(fs.statSync(path.join(d, "run.sh")).mode & 0o777, 0o755, "still executable");
  assert.equal(fs.existsSync(path.join(d, "new/x.txt")), false);
  assert.deepEqual(turnsOf(j), [], "taken back once");
  // The journal and its copies are the person's alone.
  assert.equal(fs.statSync(path.join(j.home, "journal.json")).mode & 0o077, 0);
});

test("a call that wrote nothing leaves no record; a file something else changed while the agent's edit was refused is never called the agent's", () => {
  const d = folder({ "a.txt": "A\n" });
  const j = openJournal(d, "c2");
  // Refused as stale, no match: the file is as it was.
  assert.equal(agent(j, 1, "Edit", "a.txt", { old_string: "zzz", new_string: "y" }, null), null);
  assert.deepEqual(turnsOf(j), []);
  // The person saved C; core refused the agent's edit as stale. Not A → C by the agent.
  assert.equal(agent(j, 1, "Edit", "a.txt", { old_string: "A", new_string: "B" }, () => put(d, "a.txt", "C\n")), null);
  assert.deepEqual(turnsOf(j)[0]!.files, [{ path: "a.txt", op: "cannot be taken back" }]);
  const p = plan(j, 1);
  assert.equal(p.conflicts.length, 1);
  assert.throws(() => apply(j, p), /nothing was changed/);
  assert.equal(read(d, "a.txt"), "C\n", "the person's save is still there");
});

test("A → B by the agent, B → C by the person, C → D by the agent: taking back the range refuses, and D stays", () => {
  const d = folder({ "a.txt": "A\n", "b.txt": "one\n" });
  const j = openJournal(d, "c3");
  agent(j, 1, "Write", "a.txt", { content: "B\n" }, () => put(d, "a.txt", "B\n"));
  agent(j, 1, "Write", "b.txt", { content: "two\n" }, () => put(d, "b.txt", "two\n"));
  put(d, "a.txt", "C\n");
  agent(j, 2, "Write", "a.txt", { content: "D\n" }, () => put(d, "a.txt", "D\n"));
  const p = plan(j, 1);
  assert.deepEqual(p.conflicts.map((x) => x.path), ["a.txt"]);
  assert.match(p.conflicts[0]!.why, /something else changed it between the agent's writes in turn 1 and turn 2/);
  assert.throws(() => apply(j, p));
  assert.equal(read(d, "a.txt"), "D\n");
  assert.equal(read(d, "b.txt"), "two\n", "every file or none: b.txt was not put back either");
  // The last turn alone has no gap inside it, and goes back to what the person had saved.
  const last = plan(j, 2);
  assert.deepEqual(last.conflicts, []);
  apply(j, last);
  assert.equal(read(d, "a.txt"), "C\n");
});

test("what a command or the person changed after the agent's write is never written over: content, or the mode alone", () => {
  const d = folder({ "a.txt": "A\n", "m.txt": "M\n" });
  const j = openJournal(d, "c4");
  agent(j, 1, "Write", "a.txt", { content: "B\n" }, () => put(d, "a.txt", "B\n"));
  agent(j, 1, "Write", "m.txt", { content: "N\n" }, () => put(d, "m.txt", "N\n"));
  // The same reply then ran a command that changed a.txt — after the Write's record was settled.
  put(d, "a.txt", "from a command\n");
  fs.chmodSync(path.join(d, "m.txt"), 0o600);
  const p = plan(j, 1);
  assert.deepEqual(p.conflicts.map((x) => x.path), ["a.txt", "m.txt"]);
  assert.match(p.conflicts[0]!.why, /changed since the agent last wrote it/);
  assert.equal(read(d, "a.txt"), "from a command\n");
});

test("a link, a file with a second name, a folder that leads outside: recorded as not to be taken back, never followed", () => {
  const d = folder({ "real.txt": "R\n", "twin.txt": "T\n" });
  const out = folder({ "o.txt": "O\n" });
  fs.symlinkSync(path.join(out, "o.txt"), path.join(d, "link.txt"));
  fs.linkSync(path.join(d, "twin.txt"), path.join(d, "twin2.txt"));
  fs.symlinkSync(out, path.join(d, "away"));
  const j = openJournal(d, "c5");
  agent(j, 1, "Write", "link.txt", { content: "x" }, null);
  agent(j, 1, "Write", "twin.txt", { content: "x" }, null);
  agent(j, 1, "Write", "away/o.txt", { content: "x" }, () => put(out, "o.txt", "x"));
  const files = turnsOf(j)[0]!.files;
  assert.deepEqual(files, [{ path: "link.txt", op: "cannot be taken back" }, { path: "twin.txt", op: "cannot be taken back" }], "the path through a folder link is outside: not recorded at all");
  assert.equal(plan(j, 1).conflicts.length, 2);
  assert.equal(read(out, "o.txt"), "x", "and nothing outside is ever put back");
});

test("a record left by a process that died between the write and the look is settled from the disk at the next start", () => {
  const d = folder({ "a.txt": "A\n", "b.txt": "A\n", "c.txt": "A\n" });
  const j = openJournal(d, "c6");
  for (const f of ["a.txt", "b.txt", "c.txt"]) capture(j, { turn: 1, label: "t", id: `p-${f}`, tool: "Write", file: path.join(d, f), input: { file_path: path.join(d, f), content: "B\n" } });
  put(d, "a.txt", "B\n"); // the write landed
  put(d, "c.txt", "Z\n"); // something else landed; b.txt untouched
  // A record seconds old may be a live terminal's, mid-write: left alone.
  assert.deepEqual(turnsOf(openJournal(d, "c6")), []);
  // Old enough that no write is still under way.
  const file = path.join(j.home, "journal.json");
  const kept = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const e of kept.entries) e.at = new Date(Date.now() - 120_000).toISOString();
  fs.writeFileSync(file, JSON.stringify(kept));
  const again = openJournal(d, "c6");
  assert.deepEqual(turnsOf(again)[0]!.files, [{ path: "a.txt", op: "changed" }, { path: "c.txt", op: "cannot be taken back" }]);
});

test("a rewind cut short is finished by the same rewind; a file put back by hand without one is a conflict", () => {
  const d = folder({ "a.txt": "A\n", "b.txt": "A\n" });
  const j = openJournal(d, "c7");
  agent(j, 1, "Write", "a.txt", { content: "B\n" }, () => put(d, "a.txt", "B\n"));
  agent(j, 1, "Write", "b.txt", { content: "B\n" }, () => put(d, "b.txt", "B\n"));
  // By hand, no rewind under way: not a state the journal recorded.
  put(d, "a.txt", "A\n");
  assert.deepEqual(plan(j, 1).conflicts.map((x) => x.path), ["a.txt"]);
  // The same state after a rewind of turn 1 that died after its first file.
  markIntent(j, 1);
  const p = plan(j, 1);
  assert.deepEqual(p.conflicts, []);
  assert.deepEqual(p.changes.map((x) => [x.path, x.done]), [["a.txt", true], ["b.txt", false]]);
  assert.deepEqual(apply(j, p), ["b.txt"]);
  assert.equal(read(d, "b.txt"), "A\n");
  assert.equal(openJournal(d, "c7").intent, null);
});

test("the oldest turns go when there are too many; another conversation of the folder has its own journal", () => {
  const d = folder({ "a.txt": "0\n" });
  const j = openJournal(d, "c8");
  for (let turn = 1; turn <= TURNS_KEPT + 3; turn++) agent(j, turn, "Write", "a.txt", { content: `${turn}\n` }, () => put(d, "a.txt", `${turn}\n`));
  const turns = turnsOf(j).map((t) => t.turn);
  assert.equal(turns.length, TURNS_KEPT);
  assert.equal(turns[0], 4);
  assert.deepEqual(turnsOf(openJournal(d, "another")), []);
});

test("the whole rewind is checked again after the yes: a file saved while the question was open stops it before the first file", () => {
  const d = folder({ "a.txt": "A\n", "b.txt": "A\n" });
  const j = openJournal(d, "c9");
  agent(j, 1, "Write", "a.txt", { content: "B\n" }, () => put(d, "a.txt", "B\n"));
  agent(j, 1, "Write", "b.txt", { content: "B\n" }, () => put(d, "b.txt", "B\n"));
  const p = plan(j, 1);
  assert.deepEqual(p.conflicts, []);
  put(d, "b.txt", "saved meanwhile\n");
  assert.throws(() => apply(j, p), /nothing was changed: b\.txt/);
  assert.equal(read(d, "a.txt"), "B\n", "a.txt, first in the plan, was not put back");
});

test("two terminals in one conversation keep each other's records; a damaged copy is never put back; a pipe where the file was does not hang", () => {
  const d = folder({ "a.txt": "A\n", "b.txt": "A\n" });
  const one = openJournal(d, "c10");
  const two = openJournal(d, "c10");
  agent(one, 1, "Write", "a.txt", { content: "B\n" }, () => put(d, "a.txt", "B\n"));
  agent(two, 2, "Write", "b.txt", { content: "B\n" }, () => put(d, "b.txt", "B\n"));
  assert.deepEqual(turnsOf(one).map((t) => t.files[0]!.path), ["a.txt", "b.txt"], "the second terminal's write did not replace the first's record");
  // The kept copy of a.txt is damaged on disk.
  const blobs = path.join(one.home, "blobs");
  for (const f of fs.readdirSync(blobs)) fs.writeFileSync(path.join(blobs, f), "garbage");
  assert.match(plan(one, 1).conflicts[0]!.why, /no longer kept, or is damaged/);
  assert.equal(read(d, "a.txt"), "B\n");
  // A pipe with nobody writing, where the file was.
  fs.rmSync(path.join(d, "b.txt"));
  spawnSync("mkfifo", [path.join(d, "b.txt")]);
  const started = Date.now();
  assert.ok(plan(one, 2).conflicts.some((x) => x.path === "b.txt"));
  assert.ok(Date.now() - started < 2000);
});

test("an edit of a file whose mode the umask narrows is still the agent's: 0664 written under 022 is 0644, and goes back to 0664", () => {
  const d = folder({ "a.txt": "A\n" });
  fs.chmodSync(path.join(d, "a.txt"), 0o664);
  const old = process.umask(0o022);
  try {
    const j = openJournal(d, "c11");
    assert.equal(agent(j, 1, "Edit", "a.txt", { old_string: "A", new_string: "B" }, () => {
      // As core writes: a new file made with the old mode, moved into place.
      fs.rmSync(path.join(d, "a.txt"));
      fs.writeFileSync(path.join(d, "a.txt"), "B\n", { mode: 0o664 });
    }), "a.txt");
    apply(j, plan(j, 1));
    assert.equal(fs.statSync(path.join(d, "a.txt")).mode & 0o777, 0o664);
  } finally {
    process.umask(old);
  }
});

test("a write not settled yet blocks the rewind; a folder swapped for a link is not followed; turn numbers are never shared", () => {
  const d = folder({ "a.txt": "A\n", "other/index": "made\n" });
  const j = openJournal(d, "c12");
  const two = openJournal(d, "c12");
  assert.deepEqual([nextTurn(j), nextTurn(two), nextTurn(j)], [1, 2, 3], "two terminals, one conversation");
  agent(j, 1, "Write", "a.txt", { content: "B\n" }, () => put(d, "a.txt", "B\n"));
  // The CLI died after its second write, before the look after it.
  capture(j, { turn: 1, label: "t", id: "dead", tool: "Write", file: path.join(d, "late.txt"), input: { file_path: path.join(d, "late.txt"), content: "x" } });
  put(d, "late.txt", "x");
  const p = plan(j, 1);
  assert.deepEqual(p.conflicts.map((x) => x.path), ["late.txt"]);
  assert.match(p.conflicts[0]!.why, /not settled yet/);
  assert.throws(() => apply(j, p));
  assert.equal(read(d, "a.txt"), "B\n", "and its checkpoint is not thrown away with a partial rewind");
  // The agent made build/index; the folder is later replaced by a link to another folder holding the same bytes.
  const k = openJournal(d, "c13");
  agent(k, 1, "Write", "build/index", { content: "made\n" }, () => (fs.mkdirSync(path.join(d, "build")), put(d, "build/index", "made\n")));
  fs.rmSync(path.join(d, "build"), { recursive: true });
  fs.symlinkSync(path.join(d, "other"), path.join(d, "build"));
  const q = plan(k, 1);
  assert.match(q.conflicts[0]!.why, /a folder on its path is now a link/);
  assert.equal(read(d, "other/index"), "made\n", "the other folder's file is not removed");
});
