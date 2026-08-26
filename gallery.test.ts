// Built-in tools gallery: listing, and assignment to account or workspace.
//
//   node --test tests/gallery.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GALLERY, installGalleryTool } from "../packages/core/src/gallery.ts";
import { readLibraryFile } from "../packages/core/src/library.ts";
import { readWorkspaceFile, saveWorkspace } from "../packages/core/src/store.ts";

function withData(body: () => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-gallery-"));
  const prev = process.env.FOLDRUN_DATA;
  process.env.FOLDRUN_DATA = root;
  try {
    body();
  } finally {
    if (prev === undefined) delete process.env.FOLDRUN_DATA;
    else process.env.FOLDRUN_DATA = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the gallery ships the browser tool with a usable snippet", () => {
  const browser = GALLERY.find((t) => t.name === "browser");
  assert.ok(browser, "browser tool exists");
  assert.match(browser!.content, /chromium\.launch/);
  assert.match(browser!.content, /--no-sandbox/);
  assert.match(browser!.snippet, /fetch_rendered/);
  assert.match(browser!.snippet, /account\/scripts\/fetch-rendered\.mjs/);
});

test("install copies to the account library by default", () =>
  withData(() => {
    const rel = installGalleryTool("acme", "browser");
    assert.equal(rel, "fetch-rendered.mjs");
    assert.match(readLibraryFile("acme", "scripts", rel), /chromium\.launch/);
  }));

test("install with a workspace copies into that workspace's scripts", () =>
  withData(() => {
    saveWorkspace("acme", "desk", [{ path: "AGENTS.md", content: "---\nname: desk\n---\n" }]);
    const rel = installGalleryTool("acme", "browser", "desk");
    assert.equal(rel, "scripts/fetch-rendered.mjs");
    assert.match(readWorkspaceFile("acme", "desk", rel), /chromium\.launch/);
  }));

test("an unknown tool is refused", () =>
  withData(() => {
    assert.throws(() => installGalleryTool("acme", "nope"), /no such gallery tool/);
  }));
