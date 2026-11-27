// A menu choice's follow-up question in a terminal leaves on Esc (FOL-318, owner, 25 Nov 2026: "in such mode
// escape button should make it exit this mode"): before, it read in cooked mode and Esc was typed in as "^[".
// Keys, not reads (Codex): a sequence may be cut across reads, and Esc alone is Esc only when nothing follows.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readLineRaw } from "../src/commands.mjs";

function fakeTty() {
  const e = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const modes: boolean[] = [];
  Object.assign(e, {
    isRaw: false,
    setRawMode(on: boolean) { modes.push(on); (e as unknown as { isRaw: boolean }).isRaw = on; },
    resume() {}, pause() {}, setEncoding() {},
  });
  return { stdin: e as never as NodeJS.ReadStream, emit: (s: string) => (e as EventEmitter).emit("data", Buffer.from(s)), raw: e as EventEmitter, modes };
}
const screen = () => {
  const out: string[] = [];
  const controls: string[] = [];
  return { out, controls, w: { write: (s: string) => out.push(s) }, ctl: (s: string) => controls.push(s) };
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The answer without why it ended (FOL-434 added \`why\`; the tests that name it say so). */
const answer = (r: { text: string, escaped: boolean }) => ({ text: r.text, escaped: r.escaped });

test("Esc leaves: no answer, escaped, the terminal put back as it was", async () => {
  const t = fakeTty();
  const sc = screen();
  const p = readLineRaw("the task: ", t.stdin, sc.w, sc.ctl);
  t.emit("fix the");
  t.emit("\u001b");
  assert.deepEqual(answer(await p), { text: "", escaped: true });
  assert.deepEqual(t.modes, [true, false]);
});

test("text and Esc in one read still leave (the Esc is not lost in the read)", async () => {
  const t = fakeTty();
  const p = readLineRaw("q: ", t.stdin, screen().w);
  t.emit("abc\u001b");
  assert.deepEqual(answer(await p), { text: "", escaped: true });
});

test("Esc pressed twice before it was read alone still leaves", async () => {
  const t = fakeTty();
  const p = readLineRaw("q: ", t.stdin, screen().w);
  t.emit("\u001b\u001b");
  assert.deepEqual(answer(await p), { text: "", escaped: true });
});

test("an arrow cut across two reads is neither Esc nor text; Alt+key is not text", async () => {
  const t = fakeTty();
  const p = readLineRaw("q: ", t.stdin, screen().w);
  t.emit("ab\u001b");
  t.emit("[A");
  t.emit("\u001b[");
  t.emit("B\u001bfc\u001bOD");
  await wait(60);
  t.emit("\r");
  assert.deepEqual(answer(await p), { text: "abc", escaped: false });
});

test("Backspace and Ctrl-U redraw the line through the CLI's own controls, so what is shown is what is sent", async () => {
  const t = fakeTty();
  const sc = screen();
  const p = readLineRaw("q: ", t.stdin, sc.w, sc.ctl);
  t.emit("ab\u007fc");
  t.emit("zz\u0015ok 👍");
  t.emit("\r");
  assert.deepEqual(answer(await p), { text: "ok 👍", escaped: false });
  assert.deepEqual(sc.controls, ["\r\u001b[J", "\r\u001b[J"]);
  assert.ok(sc.out.includes("q: a"), "redrawn as it is after Backspace");
  assert.ok(sc.out.join("").includes("👍"), "an emoji echoed whole");
});

test("Ctrl-C leaves; Ctrl-D on an empty line ends; a closed input ends; a paste is taken to its line end", async () => {
  for (const key of ["\u0003", "\u0004"]) {
    const t = fakeTty();
    const p = readLineRaw("q: ", t.stdin, screen().w);
    t.emit(key);
    assert.deepEqual(answer(await p), { text: "", escaped: true });
  }
  const closed = fakeTty();
  const pc = readLineRaw("q: ", closed.stdin, screen().w);
  closed.raw.emit("close");
  assert.deepEqual(answer(await pc), { text: "", escaped: true });
  const t = fakeTty();
  const p = readLineRaw("q: ", t.stdin, screen().w);
  t.emit("pasted words\r\nand more");
  assert.deepEqual(answer(await p), { text: "pasted words", escaped: false });
});

test("a long paste is read quickly, and a redraw of a wrapped answer clears every row it took", async () => {
  const t = fakeTty();
  const sc = screen();
  const w = { write: sc.w.write, columns: 20 };
  const p = readLineRaw("q: ", t.stdin, w, sc.ctl);
  const started = performance.now();
  t.emit("x".repeat(64 * 1024));
  const took = performance.now() - started;
  assert.ok(took < 250, `64 KiB took ${took.toFixed(0)} ms`);
  t.emit("\u007f");
  assert.equal(sc.controls.at(-1), "\r\u001b[99A\u001b[J", "up over the wrapped rows (capped), then clear");
  t.emit("\u0015abc\u007f");
  assert.equal(sc.controls.at(-1), "\r\u001b[J", "one row again: nothing to go up over");
  t.emit("\u001b\u{1F600}d\r");
  assert.deepEqual(answer(await p), { text: "abd", escaped: false }, "Alt and an emoji is skipped whole");
});

test("a bracketed paste never answers (FOL-434): its line breaks are spaces, Enter typed after it does; why it ended is said; a withdrawn question ends; Ctrl-C calls onInt after it ends", async () => {
  const t = fakeTty();
  const p = readLineRaw("q: ", t.stdin, screen().w);
  t.emit("\u001b[200~y\r\nno\u001b[201~");
  await wait(60);
  t.emit("\r");
  assert.deepEqual(await p, { text: "y no", escaped: false, why: "enter" });
  const ac = new AbortController();
  const gone = readLineRaw("q: ", fakeTty().stdin, screen().w, undefined, { signal: ac.signal });
  ac.abort();
  assert.deepEqual(await gone, { text: "", escaped: true, why: "abort" });
  let interrupted = 0;
  const ti = fakeTty();
  const pi = readLineRaw("q: ", ti.stdin, screen().w, undefined, { onInt: () => interrupted++ });
  ti.emit("\u0003");
  assert.equal((await pi).why, "int");
  assert.equal(interrupted, 1);
});
