// Command-line switches: a flag the CLI reads as on/off must be listed as
// one, or the argument parser takes the next word as its value.
//
//   node --test tests/cli-switches.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

test("every switch the CLI reads as `flags.x === true` is in BOOLEAN_FLAGS, so it never swallows the next word", () => {
  // `check --online desk` once read "desk" as --online's value: the switch
  // was off and the workspace name lost, with no error.
  const bin = fs.readFileSync(path.join(ROOT, "bin/foldrun.mjs"), "utf8");
  const list = /const BOOLEAN_FLAGS = new Set\(\[(.*?)\]\)/.exec(bin)?.[1];
  assert.ok(list, "BOOLEAN_FLAGS is where this test reads it");
  const switches = new Set(JSON.parse(`[${list}]`));
  // These take an optional value, or `=== true` only catches a missing one.
  const takesValue = new Set(["stale", "path", "payload"]);
  const src = fs.readFileSync(path.join(ROOT, "src/commands.mjs"), "utf8") + bin;
  const read = new Set([...src.matchAll(/flags(?:\.([a-zA-Z]+)|\["([a-z-]+)"\])\s*===\s*true/g)].map((m) => (m[1] ?? m[2]).replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)));
  const missing = [...read].filter((n) => !switches.has(n) && !takesValue.has(n));
  assert.deepEqual(missing, [], "add these to BOOLEAN_FLAGS in bin/foldrun.mjs");
});
