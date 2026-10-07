// `foldrun export` and `foldrun import` — a workspace, flow or agent as a .zip.
//
//   node --test tests/cli-export-import.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, at, raw } from "./fake-platform.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cli-pkg-"));
const ZIP = Buffer.from("PK\u0003\u0004fake zip bytes");

const plan = (over: Record<string, unknown> = {}) => ({
  dryRun: true,
  kind: "flow",
  name: "publish",
  from: "blog",
  workspace: "fresh",
  creates: false,
  added: ["agents/writer/agent.md", "flows/publish.md"],
  overwritten: [],
  unchanged: [],
  needs: { secrets: ["CMS_TOKEN"], tools: [], skills: [], scripts: [], agents: [], flows: [] },
  ...over,
});

test("export a flow: asks the platform for that flow and writes the zip under the served name", async () => {
  const s = await serve({
    "GET /api/workspaces/blog/export": () => raw(ZIP, "application/zip", { "content-disposition": 'attachment; filename="blog-flow-publish.zip"' }),
  });
  const out = path.join(tmp, "out.zip");
  const r = await at(s.url, "export", "blog", "--flow", "publish", "--file", out);
  s.close();
  assert.equal(r.code, 0, r.out);
  const get = s.seen.find((x) => x.method === "GET")!;
  assert.equal(get.query.get("kind"), "flow");
  assert.equal(get.query.get("name"), "publish");
  assert.deepEqual(fs.readFileSync(out), ZIP);
});

test("export refuses --flow and --agent together, before asking", async () => {
  const s = await serve({});
  const r = await at(s.url, "export", "blog", "--flow", "a", "--agent", "b");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /one at a time/);
  assert.equal(s.seen.length, 0);
});

test("import --dry-run previews and writes nothing", async () => {
  const file = path.join(tmp, "p.zip");
  fs.writeFileSync(file, ZIP);
  const s = await serve({ "POST /api/workspaces/fresh/import": () => plan() });
  const r = await at(s.url, "import", file, "--to", "fresh", "--dry-run");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen.length, 1);
  assert.equal(s.seen[0]!.query.get("dryRun"), "1");
  assert.equal(s.seen[0]!.headers["content-type"], "application/zip");
  assert.ok(s.seen[0]!.body.startsWith("PK"), "the zip is the body");
  assert.match(r.out, /flow publish from blog → fresh/);
  assert.match(r.out, /secrets to set: CMS_TOKEN/);
  assert.match(r.out, /nothing written/);
});

test("import --yes previews then applies", async () => {
  const file = path.join(tmp, "p.zip");
  fs.writeFileSync(file, ZIP);
  const s = await serve({
    "POST /api/workspaces/fresh/import": (_b, q) => (q.get("dryRun") ? plan() : { ...plan(), ok: true, written: ["agents/writer/agent.md", "flows/publish.md"], revision: "r-1" }),
  });
  const r = await at(s.url, "import", file, "--to", "fresh", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen.length, 2);
  assert.equal(s.seen[1]!.query.get("dryRun"), null);
  assert.ok(s.seen[1]!.headers["idempotency-key"], "an Idempotency-Key on the write");
  assert.match(r.out, /2 files written to fresh/);
});

test("import stops before replacing files unless --overwrite", async () => {
  const file = path.join(tmp, "p.zip");
  fs.writeFileSync(file, ZIP);
  const clash = plan({ overwritten: ["agents/writer/agent.md"], added: ["flows/publish.md"] });
  const s = await serve({ "POST /api/workspaces/fresh/import": (_b, q) => (q.get("dryRun") ? clash : { ...clash, ok: true, written: ["agents/writer/agent.md", "flows/publish.md"] }) });
  const refused = await at(s.url, "import", file, "--to", "fresh", "--yes");
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /--overwrite/);
  assert.equal(s.seen.length, 1, "only the preview was sent");
  const ok = await at(s.url, "import", file, "--to", "fresh", "--yes", "--overwrite");
  s.close();
  assert.equal(ok.code, 0, ok.out);
  assert.equal(s.seen.at(-1)!.query.get("overwrite"), "1");
});

test("import with no terminal and no --yes is refused after the preview", async () => {
  const file = path.join(tmp, "p.zip");
  fs.writeFileSync(file, ZIP);
  const s = await serve({ "POST /api/workspaces/fresh/import": () => plan() });
  const r = await at(s.url, "import", file, "--to", "fresh");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--yes/);
  assert.equal(s.seen.length, 1);
});

test("workspaces --json is JSON on stdout, nothing else — what a loop over workspaces reads", async () => {
  const { WORKSPACES } = await import("./fake-platform.ts");
  const s = await serve({ "GET /api/workspaces": () => WORKSPACES });
  const r = await at(s.url, "workspaces", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  const body = JSON.parse(r.out.slice(r.out.indexOf("{")));
  assert.deepEqual(body.workspaces.map((w: { name: string }) => w.name), ["blog-desk", "rank-desk"]);
  assert.equal(body.workspaces[0].platform, true);
  assert.equal(body.workspaces.some((w: { name: string }) => w.name === "is"), false);
});

test("workspaces --json says when the platform could not be read, and exits 1", async () => {
  const s = await serve({});
  const url = s.url;
  s.close();
  const r = await at(url, "workspaces", "--json");
  assert.equal(r.code, 1, r.out);
  const body = JSON.parse(r.out.slice(r.out.indexOf("{")));
  assert.ok(body.error, "an error field");
});
