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
import { fencedCode } from "../packages/core/src/store.ts";

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

test("the browser ships as one markdown file with its code in the body", () => {
  const browser = GALLERY.find((t) => t.name === "browser");
  assert.ok(browser, "browser tool exists");
  assert.equal(browser!.kind, "tools");
  assert.equal(browser!.file, "browser.md");
  assert.equal(browser!.wrapper, undefined, "nothing beside it — it is one file");
  assert.equal(browser!.snippet, "use: [browser]");

  const { data, content } = matter(browser!.content);
  const def = parseToolDef(data as Record<string, unknown>, "browser", content);
  assert.equal(def!.kind, "script");
  const spec = def!.spec as { run?: string; code?: string };
  assert.equal(spec.run, undefined);
  assert.match(spec.code!, /chromium\.launch/);
  // The body opens with a ```yaml usage example; the program is found by
  // language tag, so documentation is never mistaken for code.
  assert.doesNotMatch(spec.code!, /use: \[browser\]/);
});

test("installing the browser writes one file at either scope", () =>
  withData(() => {
    assert.equal(installGalleryTool("acme", "browser"), "browser.md");
    assert.match(readLibraryFile("acme", "tools", "browser.md"), /chromium\.launch/);

    saveWorkspace("acme", "desk", [{ path: "AGENTS.md", content: "---\nname: desk\n---\n" }]);
    assert.equal(installGalleryTool("acme", "browser", "desk"), "tools/browser.md");
    // Byte-identical: nothing to rewrite, because nothing names a scope.
    assert.equal(
      readWorkspaceFile("acme", "desk", "tools/browser.md"),
      readLibraryFile("acme", "tools", "browser.md"),
    );
  }));

test("a single-file script tool resolves with no path at all", () =>
  withData(() => {
    saveWorkspace("acme", "desk", [{ path: "AGENTS.md", content: "---\nname: desk\n---\n" }]);
    installGalleryTool("acme", "browser", "desk");
    const def = workspaceTools("acme", "desk").browser;
    assert.equal(def.kind, "script");
    const spec = def.spec as { run?: string; code?: string };
    assert.equal(spec.run, undefined, "no run path to point at the wrong scope");
    assert.ok(spec.code, "the program travels with the definition");
  }));

test("an unknown tool is refused", () =>
  withData(() => {
    assert.throws(() => installGalleryTool("acme", "nope"), /no such gallery tool/);
  }));

// ------------------------------------------------------------- API tools

test("every API tool in the gallery parses into a working http tool", () => {
  // The http ones: everything on the tools shelf that isn't a folder tool
  // carrying its own code.
  // The http ones: a tool whose body carries a program is a script tool.
  for (const t of GALLERY.filter((t) => t.kind === "tools" && !fencedCode(t.content))) {
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

test("a new script tool is a folder: the definition, and the program beside it", () => {
  const files = toolStarter("my-thing", "script");
  assert.deepEqual(files.map((f) => f.file), [
    "tools/my-thing/tool.md",
    "tools/my-thing/run.mjs",
  ]);

  const { data, content } = matter(files[0].content);
  const def = parseToolDef(data as Record<string, unknown>, "my-thing", content);
  assert.equal(def!.kind, "script");
  const spec = def!.spec as { run?: string; code?: string };
  // The program is a file, so the definition points at it and carries no code.
  assert.equal(spec.run, "run.mjs");
  assert.equal(spec.code, undefined);

  // And it is a real program, not a snippet: it validates its own argument,
  // because every declared arg is optional at the call site.
  assert.match(files[1].content, /parseArgs/);
  assert.match(files[1].content, /process\.exit\(1\)/);
});

// The failure this guards: a body that opens with a usage example in a fence
// whose language tag happens to be executable. `run:` wins — the parser never
// looks at the body — but the starter should not be the file that teaches the
// habit, so its examples are tagged with something no interpreter claims.
test("the starter's own examples cannot be mistaken for the program", () => {
  const [manifest] = toolStarter("my-thing", "script");
  const { content } = matter(manifest.content);
  const fence = fencedCode(content);
  assert.equal(fence, null, `a fenced block in the starter parsed as code: ${fence?.ext}`);
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
