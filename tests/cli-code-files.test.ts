// Files named in a foldrun code message (FOL-268): which words are files of a
// kind foldrun reads, and what the model is told about a file read into text.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { filesIn, fileKindOf, fileTextBlock, chosenBytes, FILES_MAX } from "../src/code-files.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-files-"));
for (const f of ["note.m4a", "scan.pdf", "My Photo.png", "clip.mov", "code.ts", "empty.pdf"]) fs.writeFileSync(path.join(dir, f), f === "empty.pdf" ? "" : "x");

test("filesIn: @path, a quoted or escaped dropped path, ~/; only existing files of a kind foldrun reads", () => {
  const abs = path.join(dir, "My Photo.png");
  const got = filesIn(`look at @note.m4a and '${abs}' and ${path.join(dir, "clip.mov")} and @code.ts and @missing.pdf`, dir);
  assert.deepEqual(got.map((f) => [path.basename(f.file), f.kind]), [["note.m4a", "audio"], ["My Photo.png", "image"], ["clip.mov", "video"]]);
  assert.equal(filesIn(`${abs.replace(/ /g, "\\ ")}`, dir)[0]?.kind, "image", "a path with escaped spaces, as a terminal drops it");
  assert.equal(filesIn(`@"My Photo.png"`, dir)[0]?.kind, "image");
  assert.deepEqual(filesIn("scan.pdf is in prose, not a path", dir), [], "a bare word that is not a path is prose");
  assert.equal(filesIn("@scan.pdf @scan.pdf", dir).length, 1, "each file once");
  assert.equal(filesIn("@empty.pdf", dir)[0]?.bytes, 0, "an empty file is found, so it can be said so");
  const many = Array.from({ length: 8 }, (_, i) => { const f = path.join(dir, `p${i}.pdf`); fs.writeFileSync(f, "x"); return `@${f}`; }).join(" ");
  assert.equal(filesIn(many, dir).length, FILES_MAX);
  if (fs.existsSync(os.homedir())) assert.deepEqual(filesIn("~/surely-not-here-268.pdf", dir), []);
});

test("fileKindOf and fileTextBlock: the model is told it has the text, not the file, and where it ends", () => {
  assert.equal(fileKindOf("A.JPG"), "image");
  assert.equal(fileKindOf("x.docx"), "document");
  assert.equal(fileKindOf("x.txt"), null);
  const b = fileTextBlock("note.m4a", "audio", "hello there\n", { truncated: true });
  assert.match(b, /^\[The audio note\.m4a, transcribed on foldrun's servers — you are given its text, not the file; the text was cut at the platform's limit:\]\nhello there\n\[end of note\.m4a\]$/);
  assert.match(fileTextBlock("s.png", "image", " "), /read by OCR[\s\S]*\(no text was found in it\)/);
});

test("filesIn: a link is followed to where its bytes are, and a kept choice answers only for an @path inside the folder (Codex)", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-outside-"));
  fs.writeFileSync(path.join(outside, "secret.pdf"), "s");
  fs.symlinkSync(path.join(outside, "secret.pdf"), path.join(dir, "report.pdf"));
  const [link] = filesIn("@report.pdf", dir);
  assert.equal(fs.realpathSync(link!.real), fs.realpathSync(path.join(outside, "secret.pdf")), "the target is what would be sent");
  assert.equal(link!.typed, false, "a link out of the folder is always asked about");
  assert.equal(filesIn("@scan.pdf", dir)[0]!.typed, true);
  assert.equal(filesIn(path.join(dir, "scan.pdf"), dir)[0]!.typed, false, "a pasted path is always asked about");
  assert.equal(filesIn(`@${path.join(outside, "secret.pdf")}`, dir)[0]!.typed, false, "an @path outside the folder too");
});

test("a hidden file is always asked about; the bytes read are the file chosen, a swap refused (Codex)", () => {
  fs.writeFileSync(path.join(dir, ".env.pdf"), "k");
  fs.mkdirSync(path.join(dir, ".secrets"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".secrets", "a.pdf"), "k");
  assert.equal(filesIn("@.env.pdf", dir)[0]!.typed, false);
  assert.equal(filesIn("@.secrets/a.pdf", dir)[0]!.typed, false);
  const swap = path.join(dir, "swap.pdf");
  fs.writeFileSync(swap, "first");
  const [f] = filesIn("@swap.pdf", dir);
  assert.equal(chosenBytes(f!).toString(), "first");
  // Replaced by a rename while the old file is still held, as an editor saves.
  fs.writeFileSync(`${swap}.new`, "second");
  fs.renameSync(`${swap}.new`, swap);
  assert.throws(() => chosenBytes(f!), /changed after you chose/);
  // Rewritten in place, its inode the same: changed too.
  const [g] = filesIn("@swap.pdf", dir);
  fs.writeFileSync(swap, "third!");
  assert.throws(() => chosenBytes(g!), /changed after you chose/);
  fs.rmSync(swap);
  fs.symlinkSync(path.join(dir, "scan.pdf"), swap);
  assert.throws(() => chosenBytes(f!), /ELOOP|changed after you chose/, "a link put in its place is not followed");
});
