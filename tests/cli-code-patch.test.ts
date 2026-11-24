// A cloud patch taken file by file (FOL-251): the patch cut into its files' pieces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { patchSections, joinSections, partNote, patchText, patchBytes } from "../src/code-patch.mjs";

const A = "diff --git a/a.txt b/a.txt\nindex 7898192..422c2b7 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n a\n+diff --git a/x b/x\n";
const B = "diff --git a/new file.txt b/new file.txt\nnew file mode 100644\nindex 0000000..d00491f\n--- /dev/null\n+++ b/new file.txt\n@@ -0,0 +1 @@\n+1\n";
const C = "diff --git a/c.bin b/c.bin\nnew file mode 100644\nindex 0000000..e69de29\nGIT binary patch\nliteral 3\nKcmZQzU|?VY0RRC2\n\nliteral 0\nHcmV?d00001\n\n";

test("a patch is cut at its files' headers — a line of a file that reads like one stays in its hunk — and joins back to the same bytes", () => {
  const whole = A + B + C;
  const pieces = patchSections(whole);
  assert.deepEqual(pieces, [A, B, C]);
  assert.equal(joinSections(pieces), whole);
  assert.equal(joinSections([pieces[0], pieces[2]]), A + C);
  // A preamble belongs to no file; a last line without its newline gets one; nothing is nothing.
  assert.deepEqual(patchSections(`From: someone\nSubject: x\n\n${A}${B.slice(0, -1)}`), [A, B]);
  assert.deepEqual(patchSections(""), []);
  assert.deepEqual(patchSections("not a patch\n"), []);
});

test("cutting and joining keeps every byte: a file that is not UTF-8 goes in as it came", () => {
  const latin = Buffer.concat([Buffer.from("diff --git a/l.txt b/l.txt\nnew file mode 100644\n--- /dev/null\n+++ b/l.txt\n@@ -0,0 +1 @@\n+caf"), Buffer.from([0xe9, 0x0a]), Buffer.from(B)]);
  const pieces = patchSections(patchText(latin));
  assert.equal(pieces.length, 2);
  assert.ok(patchBytes(joinSections(pieces)).equals(latin));
  assert.ok(patchBytes(pieces[0]).includes(Buffer.from([0x66, 0xe9, 0x0a])), "the byte is the byte, not a replacement character");
  assert.ok(patchBytes(patchText("naïve ✓")).equals(Buffer.from("naïve ✓", "utf8")));
});

test("the agent is told which files are in the folder and which were refused", () => {
  const note = partNote(["a.txt", "c.txt"], ["b.txt"]);
  // Whose changes went in and whose were declined — not which files exist (a deletion taken leaves none).
  assert.match(note, /Changes applied, to: a\.txt, c\.txt\. Changes declined by the person, to: b\.txt — for these the folder is as it was before/);
  assert.match(partNote(Array.from({ length: 45 }, (_, i) => `f${i}`), ["x"]), /f39 and 5 more\./);
});
