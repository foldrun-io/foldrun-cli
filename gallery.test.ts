// Built-in tools gallery: listing, and assignment to account or workspace.
//
//   node --test tests/gallery.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { GALLERY, galleryTemplate, installGalleryTool } from "../packages/core/src/gallery.ts";
import { readLibraryFile } from "../packages/core/src/library.ts";
import { parseToolDef, readWorkspaceFile, saveWorkspace, workspaceTools } from "../packages/core/src/store.ts";
import { toolStarter } from "../packages/core/src/kinds.ts";

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

test("the browser ships as a folder tool: definition and code together", () => {
  const browser = GALLERY.find((t) => t.name === "browser");
  assert.ok(browser, "browser tool exists");
  assert.equal(browser!.kind, "tools");
  assert.match(browser!.content, /chromium\.launch/);
  assert.match(browser!.content, /--no-sandbox/);
  assert.equal(browser!.snippet, "use: [browser]");
  // Both files inside one folder — the shape that makes the run path
  // relative to the tool rather than to a scope.
  assert.equal(browser!.file, "browser/run.mjs");
  assert.equal(browser!.wrapper!.file, "browser/tool.md");
  const def = parseToolDef(matter(browser!.wrapper!.content).data as Record<string, unknown>, "browser");
  assert.equal(def!.kind, "script");
  assert.equal((def!.spec as { run: string }).run, "run.mjs");
});

test("a folder tool installs unchanged at either scope", () =>
  withData(() => {
    // Account: definition and code land beside each other.
    assert.equal(installGalleryTool("acme", "browser"), "browser/run.mjs");
    assert.match(readLibraryFile("acme", "tools", "browser/run.mjs"), /chromium\.launch/);
    const accountDef = readLibraryFile("acme", "tools", "browser/tool.md");
    assert.match(accountDef, /run: run\.mjs/);

    // Workspace: byte-identical. The rewrite that used to be needed here is
    // what the folder shape exists to delete.
    saveWorkspace("acme", "desk", [{ path: "AGENTS.md", content: "---\nname: desk\n---\n" }]);
    assert.equal(installGalleryTool("acme", "browser", "desk"), "tools/browser/run.mjs");
    assert.equal(readWorkspaceFile("acme", "desk", "tools/browser/tool.md"), accountDef);
  }));

test("a folder tool resolves its code from the scope it was found in", () =>
  withData(() => {
    saveWorkspace("acme", "desk", [{ path: "AGENTS.md", content: "---\nname: desk\n---\n" }]);
    installGalleryTool("acme", "browser", "desk");
    const def = workspaceTools("acme", "desk").browser;
    assert.equal(def.kind, "script");
    // readToolDir qualifies the relative path with the scope it read it from,
    // so the runner can find it from an agent directory two levels down.
    assert.equal((def.spec as { run: string }).run, "workspace/tools/browser/run.mjs");
  }));

test("an unknown tool is refused", () =>
  withData(() => {
    assert.throws(() => installGalleryTool("acme", "nope"), /no such gallery tool/);
  }));

// ------------------------------------------------------------- API tools

test("every API tool in the gallery parses into a working http tool", () => {
  // The http ones: everything on the tools shelf that isn't a folder tool
  // carrying its own code.
  for (const t of GALLERY.filter((t) => t.kind === "tools" && !t.wrapper)) {
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

// -------------------------------------------------- start-from templates

test("starting from a gallery entry renames it everywhere the name appears", () => {
  const seed = galleryTemplate("tools", "email", "my-mailer")!;
  assert.equal(seed.file, "my-mailer.md");
  const { data } = matter(seed.content);
  assert.equal(data.name, "my-mailer");
  // The body's opt-in line would otherwise tell a reader to grant a tool
  // that does not exist under that name.
  assert.match(seed.content, /use: \[my-mailer\]/);
  assert.doesNotMatch(seed.content, /use: \[email\]/);
  // Still a working definition, not just renamed text.
  assert.equal(parseToolDef(data as Record<string, unknown>, "my-mailer")!.kind, "http");
});

test("a wrong-kind template is refused, and an unknown one too", () => {
  // browser lives on the tools shelf now, so asking the scripts shelf for it
  // returns null — which callers treat exactly like "no template chosen".
  assert.equal(galleryTemplate("scripts", "browser", "x"), null);
  assert.equal(galleryTemplate("tools", "nope", "x"), null);
});

// --------------------------------------------------- creating a new tool

test("a new script tool is one markdown file with its program in the body", () => {
  const files = toolStarter("my-thing", "script");
  assert.deepEqual(files.map((f) => f.file), ["tools/my-thing.md"]);
  const { data, content } = matter(files[0].content);
  const def = parseToolDef(data as Record<string, unknown>, "my-thing", content);
  assert.equal(def!.kind, "script");
  const spec = def!.spec as { run?: string; code?: string; codeExt?: string };
  // No run: — the fenced block IS the program, found by its language tag
  // rather than by position, so the yaml usage example above it is never
  // mistaken for code.
  assert.equal(spec.run, undefined);
  assert.match(spec.code!, /parseArgs/);
  assert.equal(spec.codeExt, ".mjs");
});

test("an API or MCP tool is still one flat file", () => {
  for (const [transport, kind] of [["http", "http"], ["mcp", "mcp"]] as const) {
    const files = toolStarter("my-thing", transport);
    assert.equal(files.length, 1, `${transport} is one file`);
    assert.equal(files[0].file, "tools/my-thing.md");
    const def = parseToolDef(matter(files[0].content).data as Record<string, unknown>, "my-thing");
    assert.equal(def!.kind, kind);
  }
});
