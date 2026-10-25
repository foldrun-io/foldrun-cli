// src/terminal.mjs: a platform's text never writes escape sequences to a
// person's terminal. Only this CLI's own colours get through, on a terminal
// or a pipe; content asked for byte for byte (writeExact) is exact into a
// pipe or a file, and filtered on a terminal.
//
//   node --test tests/cli-terminal.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { terminalSafe, guardStream, writeExact } from "../src/terminal.mjs";

const ESC = "\u001b";

test("this CLI's colours survive", () => {
  for (const s of [`${ESC}[1mbold${ESC}[0m`, `${ESC}[2m${ESC}[33mdim amber${ESC}[0m`, `${ESC}[31mred${ESC}[0m ${ESC}[32mgreen${ESC}[0m`, `${ESC}[mreset`]) {
    assert.equal(terminalSafe(s), s);
  }
  assert.equal(terminalSafe("plain ünïcode — and emoji 🙂\ttab\n"), "plain ünïcode — and emoji 🙂\ttab\n");
});

test("what a hostile platform could send is removed", () => {
  const cases: [string, string, string][] = [
    [`a${ESC}]52;c;cGF3bmVk\u0007b`, "ab", "OSC 52: write the clipboard"],
    [`a${ESC}]8;;https://evil.example${ESC}\\docs${ESC}]8;;${ESC}\\b`, "adocsb", "OSC 8: a link that goes somewhere else"],
    [`a${ESC}]0;sudo password:\u0007b`, "ab", "OSC 0: retitle the window"],
    [`x${ESC}[2J${ESC}[1;1Hy`, "xy", "clear the screen, move the cursor"],
    [`ok${ESC}[1A${ESC}[2Kfaked`, "okfaked", "go up a line and overwrite it"],
    [`x${ESC}[8mhidden${ESC}[0m`, `xhidden${ESC}[0m`, "conceal"],
    [`x${ESC}[1;7my`, "xy", "a colour mixed with reverse video"],
    [`${ESC}[?1049h`, "", "the alternate screen"],
    [`${ESC}Pq#0;2;0;0;0${ESC}\\done`, "done", "DCS (sixel)"],
    [`a\u009b31mb`, "a31mb", "a one-character C1 CSI"],
    [`next\rover`, "nextover", "a bare carriage return overwriting the line"],
    [`bell\u0007 bs\u0008 del\u007f`, "bell bs del", "other control characters"],
    [`split${ESC}`, "split", "a lone ESC at the end of a write — the rest arriving in the next one is then only text"],
  ];
  for (const [input, want, why] of cases) assert.equal(terminalSafe(input), want, why);
  assert.equal(terminalSafe("a\r\nb"), "a\nb");
});

/** A stream that looks like a terminal, recording what reaches it. */
function fakeStream(isTTY: boolean) {
  const got: string[] = [];
  const s = {
    isTTY,
    write(chunk: unknown, enc?: unknown, cb?: () => void) {
      got.push(Buffer.isBuffer(chunk) ? `<buffer>${chunk.toString("utf8")}` : String(chunk));
      (typeof enc === "function" ? enc : cb)?.();
      return true;
    },
  };
  return { s, got };
}

test("a terminal stream is guarded: strings and buffers alike, callbacks kept, once", () => {
  const { s, got } = fakeStream(true);
  assert.equal(guardStream(s as never), true);
  assert.equal(guardStream(s as never), false, "a second guard is a no-op");
  let called = 0;
  s.write(`hi${ESC}]52;c;eA==\u0007\n`, () => called++);
  s.write(Buffer.from(`bytes${ESC}[2J\n`), "utf8" as never, () => called++);
  assert.deepEqual(got, ["hi\n", "bytes\n"]);
  assert.equal(called, 2);
});

test("a pipe is guarded too — `foldrun logs | cat` still ends on a screen", () => {
  const { s, got } = fakeStream(false);
  assert.equal(guardStream(s as never), true);
  s.write(`log line${ESC}]52;c;eA==\u0007\n`);
  assert.deepEqual(got, ["log line\n"]);
});

test("writeExact: byte for byte into a pipe or a file, filtered on a terminal", () => {
  const raw = Buffer.from(`exact${ESC}[2J\r\n`);
  const pipe = fakeStream(false);
  guardStream(pipe.s as never);
  writeExact(raw, pipe.s as never);
  assert.deepEqual(pipe.got, [`<buffer>exact${ESC}[2J\r\n`], "`source cat x > x` stays exact");
  const tty = fakeStream(true);
  guardStream(tty.s as never);
  writeExact(raw, tty.s as never);
  assert.deepEqual(tty.got, ["exact\n"]);
});

test("--json survives the guard unchanged: JSON.stringify escapes control characters", () => {
  const doc = { subject: `evil${ESC}]52;c;eA==\u0007`, tab: "a\tb" };
  const text = JSON.stringify(doc, null, 2);
  assert.equal(terminalSafe(text), text);
  assert.deepEqual(JSON.parse(terminalSafe(text)), doc);
});

test("the content commands write through writeExact, nothing else writes raw platform text", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "commands.mjs"), "utf8");
  assert.ok((src.match(/writeExact\(/g) ?? []).length >= 8, "source cat, storage cat, library cat, downloads, CSVs, api spec, previews");
});

test("the CLI guards its terminal before anything else runs", () => {
  const bin = fs.readFileSync(path.join(import.meta.dirname, "..", "bin", "foldrun.mjs"), "utf8");
  const guard = bin.indexOf("guardTerminal();");
  assert.ok(guard > 0, "bin/foldrun.mjs calls guardTerminal()");
  assert.ok(guard < bin.indexOf("console."), "before the first print");
  assert.ok(guard < bin.indexOf("await import"), "before any command module loads");
});
