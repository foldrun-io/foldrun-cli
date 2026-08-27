// [[name]] → the path the model can actually open.
//
//   node --test tests/doclinks.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDocLinks } from "../packages/core/src/runner.ts";

function withWorkspace(body: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-links-"));
  try {
    fs.mkdirSync(path.join(root, "knowledge"), { recursive: true });
    fs.mkdirSync(path.join(root, "memory"), { recursive: true });
    fs.mkdirSync(path.join(root, "files"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "knowledge", "sources-of-conveyancers.md"),
      "---\ntype: Reference\ntitle: Sources for conveyancer leads\n---\n\ndirectories…\n",
    );
    fs.writeFileSync(
      path.join(root, "memory", "known-duds.md"),
      "---\ntype: Fact\nname: numbers that never answer\n---\n\n…\n",
    );
    fs.writeFileSync(path.join(root, "files", "leads.csv"), "email\na@b.c\n");
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("filenames, titles and files/ paths all resolve — spelling-blind", () =>
  withWorkspace((root) => {
    const out = resolveDocLinks(
      "Read [[sources-of-conveyancers]] first, honour [[Sources for conveyancer leads]], " +
        "check [[known_duds]] and write to [[files/leads.csv]].",
      root,
    );
    assert.match(out, /`\.\.\/\.\.\/knowledge\/sources-of-conveyancers\.md` first/);
    assert.match(out, /honour `\.\.\/\.\.\/knowledge\/sources-of-conveyancers\.md`/, "title matches too");
    assert.match(out, /check `\.\.\/\.\.\/memory\/known-duds\.md`/, "underscores and hyphens compare equal");
    assert.match(
      resolveDocLinks("Avoid [[numbers that never answer]].", root),
      /`\.\.\/\.\.\/memory\/known-duds\.md`/,
      "the older `name:` frontmatter matches like title",
    );
    assert.match(out, /write to `\.\.\/\.\.\/files\/leads\.csv`/);
  }));

test("what doesn't match passes through untouched — sugar, never a gate", () =>
  withWorkspace((root) => {
    const text = "Consult [[enricher]] about [[something we never wrote down]].";
    assert.equal(resolveDocLinks(text, root), text);
  }));

test("no brackets, no work", () =>
  withWorkspace((root) => {
    const text = "Plain prose with `knowledge/x.md` stays plain.";
    assert.equal(resolveDocLinks(text, root), text);
  }));
