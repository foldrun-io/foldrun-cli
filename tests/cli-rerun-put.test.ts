// The verbs the 2026-09-25 audit found missing from the terminal: rerun a
// run from a step, put and remove a produced file, scope a minted key,
// and start a flow once.
//
//   node --test tests/cli-rerun-put.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, at, WORKSPACES } from "./fake-platform.ts";

const failed = { id: "run-old", flow: "publish", status: "failed", startedAt: "2026-09-25T00:00:00.000Z", finishedAt: "2026-09-25T00:05:00.000Z", steps: [{ agent: "writer", status: "completed" }, { agent: "publisher", status: "failed" }] };

test("rerun posts the step or the agent, names the new run, and refuses without either", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/rank-desk/runs/run-old": () => failed,
    "POST /api/workspaces/rank-desk/runs/run-old/rerun": () => ({ ok: true, runId: "run-new", from: "run-old", steps: 2 }),
  });
  const byStep = await at(s.url, "rerun", "run-old", "--from", "2", "--to", "rank-desk");
  assert.equal(byStep.code, 0, byStep.out);
  assert.match(byStep.out, /run-new/);
  assert.match(byStep.out, /again from step 2 of run-old/);
  assert.deepEqual(JSON.parse(s.seen.at(-1)!.body), { step: 2 });
  const byAgent = await at(s.url, "rerun", "run-old", "--agent", "publisher", "--to", "rank-desk");
  assert.equal(byAgent.code, 0, byAgent.out);
  assert.deepEqual(JSON.parse(s.seen.at(-1)!.body), { agent: "publisher" });
  const neither = await at(s.url, "rerun", "run-old", "--to", "rank-desk");
  s.close();
  assert.notEqual(neither.code, 0);
  assert.match(neither.out, /--from <step>.*--agent <name>/);
});

test("storage put uploads the bytes under the file's name or --as, and rm removes by path", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-put-"));
  const local = path.join(dir, "brief.md");
  fs.writeFileSync(local, "# brief\n");
  const s = await serve({
    "PUT /api/workspaces/rank-desk/storage": (body) => ({ file: { path: "brief.md", size: body.length } }),
    "DELETE /api/workspaces/rank-desk/storage": () => ({ ok: true }),
  });
  const put = await at(s.url, "storage", "put", local, "--to", "rank-desk");
  assert.equal(put.code, 0, put.out);
  assert.match(put.out, /rank-desk\/storage\/brief\.md/);
  assert.equal(s.seen[0].query.get("path"), "brief.md");
  assert.equal(s.seen[0].body, "# brief\n");
  const renamed = await at(s.url, "storage", "put", local, "--as", "reports/brief.md", "--to", "rank-desk");
  assert.equal(renamed.code, 0, renamed.out);
  assert.equal(s.seen[1].query.get("path"), "reports/brief.md");
  const rm = await at(s.url, "storage", "rm", "reports/brief.md", "--to", "rank-desk");
  s.close();
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(rm.code, 0, rm.out);
  assert.equal(s.seen[2].method, "DELETE");
  assert.equal(s.seen[2].query.get("path"), "reports/brief.md");
});

test("keys create --workspaces narrows the key, and 'all' asks for every workspace", async () => {
  const s = await serve({ "POST /api/keys": () => ({ ok: true, key: "mda_x", id: "k1", prefix: "mda_x", role: "editor", workspaces: ["rank-desk"] }) });
  const narrow = await at(s.url, "keys", "create", "ci", "--workspaces", "rank-desk,blog-desk");
  assert.equal(narrow.code, 0, narrow.out);
  assert.deepEqual(JSON.parse(s.seen[0].body).workspaces, ["rank-desk", "blog-desk"]);
  const all = await at(s.url, "keys", "create", "ci", "--workspaces", "all");
  s.close();
  assert.equal(all.code, 0, all.out);
  assert.equal(JSON.parse(s.seen[1].body).workspaces, null);
});

test("invoke --once sends the idempotency key", async () => {
  const s = await serve({ "POST /api/workspaces/rank-desk/flows/publish/run": () => ({ ok: true, runId: "run-1", steps: 3, test: false }) });
  const r = await at(s.url, "invoke", "publish", "--to", "rank-desk", "--once", "ci-1234");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(s.seen[0].body).idempotencyKey, "ci-1234");
});
