// `foldrun gallery` — the tools the platform ships to every account, from the
// terminal, and the copy a laptop keeps so `foldrun run` finds them.
//
// An agent granting `web_browse` ran on every deploy and had no browser under
// `foldrun run`, because the gallery was a directory only the platform had.
//
//   node --test tests/cli-gallery.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, at, cli } from "./fake-platform.ts";

const gallery = {
  tools: [
    {
      name: "web_browse", kind: "tools", title: "Headless browser", description: "a browser",
      files: [
        { kind: "tools", file: "web_browse/tool.md", content: "---\nname: web_browse\nrun: run.mjs\n---\n" },
        { kind: "tools", file: "web_browse/run.mjs", content: "console.log('page')\n" },
      ],
      installed: null,
    },
    {
      name: "sql", kind: "tools", title: "SQL over CSV and JSON files", description: "sql",
      files: [{ kind: "tools", file: "sql/tool.md", content: "---\nname: sql\n---\n" }],
      installed: "differs",
    },
  ],
};

test("gallery lists what ships, and says which copies are the account's own", async () => {
  const s = await serve({ "/api/library/gallery": () => gallery });
  const r = await at(s.url, "gallery");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /web_browse\s+Headless browser\s+from the platform/);
  assert.match(r.out, /sql .*your copy differs — `foldrun gallery upgrade sql`/);
  assert.match(r.out, /2 tools on http:\/\/127\.0\.0\.1:\d+ — grant one with `tools: \[name\]`; nothing to install/);
});

test("gallery pull lays the shelf down per platform, as <kind>/<file>", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({ "/api/library/gallery": () => gallery });
  const r = await cli(["gallery", "pull", "--url", s.url, "--token", "k"], { env: { FOLDRUN_HOME: home } });
  s.close();
  assert.equal(r.code, 0, r.out);
  const dir = path.join(home, "gallery", new URL(s.url).host);
  assert.match(r.out, /2 gallery tools, 3 files/);
  assert.equal(fs.readFileSync(path.join(dir, "tools/web_browse/run.mjs"), "utf8"), "console.log('page')\n");
  assert.ok(fs.existsSync(path.join(dir, "tools/sql/tool.md")));
  assert.ok(fs.existsSync(path.join(dir, ".fetched")));
  fs.rmSync(home, { recursive: true, force: true });
});

test("a pull is a mirror: a tool the platform stopped shipping goes", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const s = await serve({ "/api/library/gallery": () => gallery });
  const dir = path.join(home, "gallery", new URL(s.url).host);
  fs.mkdirSync(path.join(dir, "tools/old"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tools/old/tool.md"), "---\nname: old\n---\n");
  const r = await cli(["gallery", "pull", "--url", s.url, "--token", "k"], { env: { FOLDRUN_HOME: home } });
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.ok(!fs.existsSync(path.join(dir, "tools/old")), "a renamed or removed entry must not linger as a second tool");
  fs.rmSync(home, { recursive: true, force: true });
});

test("a file the platform names outside the shelf is refused", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const bad = { tools: [{ ...gallery.tools[0], files: [{ kind: "tools", file: "../../escape.md", content: "x" }] }] };
  const s = await serve({ "/api/library/gallery": () => bad });
  const r = await cli(["gallery", "pull", "--url", s.url, "--token", "k"], { env: { FOLDRUN_HOME: home } });
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /outside the shelf/);
  assert.ok(!fs.existsSync(path.join(home, "escape.md")));
  fs.rmSync(home, { recursive: true, force: true });
});

test("gallery upgrade asks the platform to replace the account's copy", async () => {
  const s = await serve({ "POST /api/library/gallery": () => ({ ok: true, path: "sql/tool.md" }) });
  const r = await at(s.url, "gallery", "upgrade", "sql");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { tool: "sql" });
  assert.match(r.out, /upgraded sql .*one revision back/);
});

test("an unknown verb is named, not treated as a list", async () => {
  const s = await serve({ "/api/library/gallery": () => gallery });
  const r = await at(s.url, "gallery", "install", "sql");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /the verbs are `pull` and `upgrade <tool>`/);
});
