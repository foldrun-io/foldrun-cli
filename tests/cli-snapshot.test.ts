// `foldrun snapshot push` — a git folder packed, checked for secrets before it
// leaves, and sent to POST …/snapshots (Part B3).
//
//   node --test tests/cli-snapshot.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { serve, at, cli } from "./fake-platform.ts";

const { unpackSnapshot } = await import("@foldrun/core/snapshot-archive");

function repo(files: Record<string, string>, ignore = ""): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cli-snap-"));
  execFileSync("git", ["init", "-q", d]);
  for (const [p, t] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true });
    fs.writeFileSync(path.join(d, p), t);
  }
  if (ignore) fs.writeFileSync(path.join(d, ".gitignore"), ignore);
  return d;
}

test("what git would commit goes — ignored files and links stay out, the exec bit is kept — and nothing is sent on --dry-run", async () => {
  const d = repo({ "src/index.ts": "export const x = 1;\n", "run.sh": "#!/bin/sh\necho hi\n", "dist/out.js": "built", "node_modules/a/i.js": "dep" }, "dist/\nnode_modules/\n");
  fs.chmodSync(path.join(d, "run.sh"), 0o755);
  fs.symlinkSync("src/index.ts", path.join(d, "link.ts"));
  const out = path.join(d, "..", `${path.basename(d)}.tar.gz`);
  const s = await serve({});
  const r = await at(s.url, "snapshot", "push", d, "--to", "desk", "--dry-run", "--out", out, "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen.length, 0, "a dry run sends nothing");
  const plan = JSON.parse(r.out);
  assert.deepEqual(plan.leftOut, ["link.ts (a link)"]);
  const { entries, sha256 } = unpackSnapshot(fs.readFileSync(out));
  assert.equal(sha256, plan.snapshotId);
  assert.deepEqual(entries.map((e) => e.path), [".gitignore", "run.sh", "src/index.ts"]);
  assert.equal(entries.find((e) => e.path === "run.sh")!.mode, 0o755);
});

test("push: the archive is the body, and the platform's answer is printed", async () => {
  const d = repo({ "a.txt": "hello\n" });
  const id = "a".repeat(64);
  const s = await serve({ "POST /api/workspaces/desk/snapshots": () => ({ snapshotId: id, files: 1, bytes: 6, compressedBytes: 120, expiresAt: "2026-11-18T00:00:00.000Z", reused: false }) });
  const r = await at(s.url, "snapshot", "push", d, "--to", "desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen.length, 1);
  assert.equal(s.seen[0]!.headers["content-type"], "application/gzip");
  assert.ok(Number(s.seen[0]!.headers["content-length"]) > 0);
  assert.ok(s.seen[0]!.headers["idempotency-key"], "a write carries an Idempotency-Key");
  assert.match(r.out, new RegExp(`snapshot ${id}`));
  assert.match(r.out, /1 file, 6 bytes .*→ desk/);
});

test("a secret stops it before anything leaves the machine — named by file and line, never printed", async () => {
  const key = ["sk", "live", "abcdefghijklmnopqrstuvwxyzAB"].join("_");
  const d = repo({ "ok.txt": "fine\n", "config.ts": `// foldrun-ignore secret/hardcoded: test\nexport const k = "${key}";\n` });
  const s = await serve({});
  const r = await at(s.url, "snapshot", "push", d, "--to", "desk");
  s.close();
  assert.notEqual(r.code, 0);
  assert.equal(s.seen.length, 0, "nothing sent");
  assert.match(r.out, /config\.ts:2/);
  assert.match(r.out, /look.? like a secret/);
  assert.ok(!r.out.includes(key));
});

test("not a git folder, an unknown verb, and --help (which runs nothing)", async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cli-snap-plain-"));
  fs.writeFileSync(path.join(plain, "x.txt"), "x");
  const s = await serve({});
  const r = await at(s.url, "snapshot", "push", plain, "--to", "desk");
  assert.notEqual(r.code, 0);
  assert.match(r.out, /not in a git repository/);
  const v = await at(s.url, "snapshot", "send");
  assert.notEqual(v.code, 0);
  assert.match(v.out, /foldrun snapshot push/);
  s.close();
  const h = await cli(["snapshot", "--help"]);
  assert.equal(h.code, 0);
  assert.match(h.out, /foldrun snapshot push \[dir\]/);
  assert.equal(s.seen.length, 0);
});

test("a tracked folder replaced by a link does not carry files from outside; a binary file is named as not checked (Codex)", async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cli-snap-outside-"));
  fs.writeFileSync(path.join(outside, "private.txt"), "not yours\n");
  const d = repo({ "lib/private.txt": "tracked\n", "keep.txt": "k\n" });
  fs.writeFileSync(path.join(d, "logo.bin"), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
  execFileSync("git", ["-C", d, "add", "-A"]);
  fs.rmSync(path.join(d, "lib"), { recursive: true });
  fs.symlinkSync(outside, path.join(d, "lib"));
  const out = path.join(outside, "a.tar.gz");
  const r = await cli(["snapshot", "push", d, "--to", "desk", "--dry-run", "--out", out, "--json"]);
  assert.equal(r.code, 0, r.out);
  const plan = JSON.parse(r.out);
  assert.deepEqual(plan.leftOut, ["lib (a link)", "lib/private.txt (under a link)"]);
  assert.deepEqual(plan.unscanned, ["logo.bin"]);
  const names = unpackSnapshot(fs.readFileSync(out)).entries.map((e) => e.path);
  assert.deepEqual(names, ["keep.txt", "logo.bin"]);
  const human = await cli(["snapshot", "push", d, "--to", "desk", "--dry-run"]);
  assert.match(human.out, /not checked for secrets \(binary\): logo\.bin/);
});

test("--out never replaces a file that is there unless --force (Codex)", async () => {
  const d = repo({ "a.txt": "a\n" });
  const out = path.join(d, "..", `${path.basename(d)}-keep.txt`);
  fs.writeFileSync(out, "precious\n");
  const r = await cli(["snapshot", "push", d, "--to", "desk", "--dry-run", "--out", out]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /already exists — --force replaces it/);
  assert.equal(fs.readFileSync(out, "utf8"), "precious\n");
  const f = await cli(["snapshot", "push", d, "--to", "desk", "--dry-run", "--out", out, "--force"]);
  assert.equal(f.code, 0, f.out);
  assert.equal(unpackSnapshot(fs.readFileSync(out)).entries.length, 1);
});
