// `foldrun storage` — what a workspace PRODUCED, as opposed to what you wrote.
//
// `ls` prints when each file was written and which run wrote it because that
// is how staleness is spotted: a deliverable whose newest version is three
// weeks old, from a run nobody recognises, is the one still being read.
//
//   node --test tests/cli-storage.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { serve, cli, at } from "./fake-platform.ts";

const files = [
  { path: "target-tracker.md", sha: "a".repeat(64), size: 12742, mime: "text/markdown", updatedAt: "2026-09-15T19:09:05.917Z", by: "run:run-mu31ec8c-hn9c" },
  { path: "reports/rival-gap.md", sha: "b".repeat(64), size: 9328, mime: "text/markdown", updatedAt: "2026-09-10T02:00:00.000Z", by: "run:run-older" },
  { path: "cover.png", sha: "c".repeat(64), size: 240_000, mime: "image/png", updatedAt: "2026-09-16T01:00:00.000Z", by: "user:matt@example.test" },
];

const listing = { files, driver: "r2", used: 262_070, quotaMb: 5120, maxMb: 512 };

/** The download route: text for the markdown, bytes with a NUL for the png. */
const downloads: Record<string, Buffer> = {
  "target-tracker.md": Buffer.from("# Target tracker\n\nTwelve cases open.\n"),
  "cover.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]),
};

function storage() {
  return {
    "/api/workspaces/rank-desk/storage": () => listing,
  };
}

test("ls says what is there, how big, when, and which run wrote it", async () => {
  const s = await serve(storage());
  const r = await at(s.url, "storage", "ls", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /cover\.png/);
  assert.match(r.out, /target-tracker\.md/);
  assert.match(r.out, /12\.4KB/);
  assert.match(r.out, /run:run-mu31ec8c-hn9c/);
  assert.match(r.out, /user:matt@example\.test/);
  assert.match(r.out, /ago/);
  assert.match(r.out, /3 files · 255\.9KB of 5120MB · r2/);
  // Newest first: the file changed this morning is the one being read.
  const order = r.out.split("\n").filter((l) => /\.md|\.png/.test(l));
  assert.match(order[0], /cover\.png/);
});

test("ls with no verb at all is still ls, and a prefix narrows it", async () => {
  const s = await serve(storage());
  const bare = await at(s.url, "storage", "--to", "rank-desk");
  assert.equal(bare.code, 0, bare.out);
  assert.match(bare.out, /3 files/);

  const under = await at(s.url, "storage", "ls", "reports", "--to", "rank-desk");
  s.close();
  assert.equal(under.code, 0, under.out);
  assert.match(under.out, /rival-gap\.md/);
  assert.doesNotMatch(under.out, /cover\.png/);
});

test("an empty store says so rather than printing a header over nothing", async () => {
  const s = await serve({ "/api/workspaces/rank-desk/storage": () => ({ files: [], driver: "fs", used: 0 }) });
  const r = await at(s.url, "storage", "ls", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /nothing in rank-desk's storage/);
});

// The download route is not JSON, so it gets a server of its own rather than
// the JSON fake: a markdown file parsed as JSON reads as a broken platform.
function serveDownload(): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "", "http://x");
      if (u.pathname.endsWith("/storage")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(listing));
        return;
      }
      const rel = u.searchParams.get("path") ?? "";
      const bytes = downloads[rel];
      if (!bytes) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "no such file" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(bytes.length) });
      res.end(bytes);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => { server.closeAllConnections(); server.close(); } });
    });
  });
}

test("cat prints the file and nothing else around it", async () => {
  const s = await serveDownload();
  const r = await at(s.url, "storage", "cat", "target-tracker.md", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /# Target tracker/);
  assert.match(r.out, /Twelve cases open\./);
});

test("cat refuses a file that is not text, and says how to fetch it", async () => {
  const s = await serveDownload();
  const r = await at(s.url, "storage", "cat", "cover.png", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /is not text/);
  assert.match(r.out, /foldrun storage get cover\.png/);
});

test("get writes it beside you, refuses to clobber, and --file picks the path", async () => {
  const s = await serveDownload();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-storage-"));
  const first = await cli(["storage", "get", "target-tracker.md", "--to", "rank-desk", "--url", s.url, "--token", "k"], { cwd: dir });
  assert.equal(first.code, 0, first.out);
  assert.match(fs.readFileSync(path.join(dir, "target-tracker.md"), "utf8"), /Twelve cases open/);
  assert.match(first.out, /target-tracker\.md/);

  const again = await cli(["storage", "get", "target-tracker.md", "--to", "rank-desk", "--url", s.url, "--token", "k"], { cwd: dir });
  assert.equal(again.code, 1, again.out);
  assert.match(again.out, /already exists/);

  const elsewhere = path.join(dir, "out", "copy.md");
  const third = await cli(["storage", "get", "target-tracker.md", "--file", elsewhere, "--to", "rank-desk", "--url", s.url, "--token", "k"], { cwd: dir });
  s.close();
  assert.equal(third.code, 0, third.out);
  assert.ok(fs.existsSync(elsewhere), "the directory was made on the way");
});

test("a path that is not there says so, with the workspace", async () => {
  const s = await serveDownload();
  const r = await at(s.url, "storage", "cat", "nope.md", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /nope\.md in rank-desk: no such file/);
});

test("in a workspace folder the workspace needs no naming, and elsewhere it does", async () => {
  const s = await serve(storage());
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-storage-ws-"));
  const flat = path.join(home, "rank-desk");
  await cli(["init", flat, "--flat"]);
  const here = await cli(["storage", "ls", "--url", s.url, "--token", "k"], { cwd: flat });
  assert.equal(here.code, 0, here.out);
  assert.match(here.out, /3 files/);

  const nowhere = await cli(["storage", "ls", "--url", s.url, "--token", "k"], { cwd: os.tmpdir() });
  s.close();
  assert.equal(nowhere.code, 1, nowhere.out);
  assert.match(nowhere.out, /which workspace\?/);
});

test("an unknown verb names the three there are", async () => {
  const s = await serve(storage());
  const r = await at(s.url, "storage", "push", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /unknown storage verb "push" — ls, cat or get/);
});
