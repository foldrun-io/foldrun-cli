// Built-in tools gallery: listing, and assignment to account or workspace.
//
//   node --test tests/gallery.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { GALLERY, installGalleryTool } from "../packages/core/src/gallery.ts";
import { readLibraryFile } from "../packages/core/src/library.ts";
import { parseToolDef, readWorkspaceFile, saveWorkspace } from "../packages/core/src/store.ts";

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
  // Granted like every other capability, by name.
  assert.equal(browser!.snippet, "use: [browser]");
  const def = parseToolDef(matter(browser!.wrapper!.content).data as Record<string, unknown>, "browser");
  assert.equal(def!.kind, "script");
  assert.equal((def!.spec as { run: string }).run, "account/scripts/fetch-rendered.mjs");
});

test("a script's wrapper follows the code into whichever scope it lands in", () =>
  withData(() => {
    installGalleryTool("acme", "browser");
    assert.match(readLibraryFile("acme", "tools", "browser.md"), /run: account\/scripts\//);

    saveWorkspace("acme", "desk", [{ path: "AGENTS.md", content: "---\nname: desk\n---\n" }]);
    installGalleryTool("acme", "browser", "desk");
    // The wrapper is rewritten, because a workspace copy of the code is not
    // reachable at the account path — a wrapper pointing at the wrong scope
    // is a tool that resolves to nothing at run time.
    assert.match(readWorkspaceFile("acme", "desk", "tools/browser.md"), /run: workspace\/scripts\//);
  }));

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

// ------------------------------------------------------------- API tools

test("every API tool in the gallery parses into a working http tool", () => {
  for (const t of GALLERY.filter((t) => t.kind === "tools")) {
    const { data } = matter(t.content);
    const def = parseToolDef(data as Record<string, unknown>, t.name);
    assert.ok(def, `${t.name} parses`);
    assert.equal(def!.kind, "http", `${t.name} is an http tool`);
    assert.ok((def!.spec as { base: string }).base.startsWith("https://"), `${t.name} is https`);
    assert.equal(t.snippet, `use: [${t.name}]`, `${t.name} snippet is the opt-in`);
  }
});

test("stripe stays read-only however the definition is edited upstream", () => {
  const stripe = GALLERY.find((t) => t.name === "stripe")!;
  const { data } = matter(stripe.content);
  const def = parseToolDef(data as Record<string, unknown>, "stripe")!;
  assert.deepEqual((def.spec as { methods: string[] }).methods, ["GET"]);
});

test("an API tool installs onto the tools shelf, not scripts", () =>
  withData(() => {
    const rel = installGalleryTool("acme", "email");
    assert.equal(rel, "email.md");
    assert.match(readLibraryFile("acme", "tools", rel), /api\.resend\.com/);
    // And into a workspace's own tools dir when scoped there.
    saveWorkspace("acme", "desk", [{ path: "AGENTS.md", content: "---\nname: desk\n---\n" }]);
    assert.equal(installGalleryTool("acme", "slack", "desk"), "tools/slack.md");
    assert.match(readWorkspaceFile("acme", "desk", "tools/slack.md"), /chat\.postMessage/);
  }));
