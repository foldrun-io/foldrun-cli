// `foldrun onboarding`, `foldrun backups` (and `backups request`) and
// `foldrun restore` — against a fake platform, asserting the requests sent
// as well as what was printed; the restore sends nothing without the name
// typed back or --yes.
//
//   node --test tests/cli-backups-onboarding.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const posts = (s: { seen: { method: string; url: string; body: string }[] }) =>
  s.seen.filter((x) => x.method === "POST").map((x) => ({ url: x.url, body: x.body ? JSON.parse(x.body) : null }));

test("onboarding lists every step, marks the next, and links it", async () => {
  const s = await serve({
    "/api/me/onboarding": () => ({
      done: 1,
      total: 3,
      complete: false,
      next: { id: "agent" },
      steps: [
        { id: "workspace", title: "Create a workspace", why: "w", href: "/dashboard?create=workspace", done: true },
        { id: "agent", title: "Write or deploy an agent", why: "An agent is one role.", href: "/dashboard/desk/agents", cli: "foldrun deploy", done: false },
        { id: "cli", title: "Install the CLI", why: "Files in your editor.", href: "/dashboard/settings#api-keys", done: false },
      ],
    }),
  });
  const r = await at(s.url, "onboarding");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Getting started\s+1 of 3/);
  assert.match(r.out, /✓ Create a workspace/);
  assert.match(r.out, /→ Write or deploy an agent/);
  assert.match(r.out, /\/dashboard\/desk\/agents\s+·\s+foldrun deploy/);
});

const backups = {
  policy: { schedule: "nightly at 03:30, the server's time", keepLocal: 14, keepOffsiteDays: 15, encrypted: true, covers: [], excludes: [] },
  last: { id: "b", at: "2026-10-01T17:30:00Z", verified: true, offsite: "r2", bytes: 52428800, kinds: ["files", "database", "keys"], encrypted: true, recipient: "sha256:0123456789abcdef" },
  backups: [
    { id: "b", at: "2026-10-01T17:30:00Z", verified: true, offsite: "r2", bytes: 52428800, kinds: ["files", "database", "keys"], encrypted: true, recipient: "sha256:0123456789abcdef" },
    { id: "a", at: "2026-09-30T17:30:00Z", verified: true, offsite: "r2", bytes: 52428800, kinds: ["files", "database", "keys"] },
  ],
  requests: [],
  workspaces: [{ name: "desk", head: "abc", history: true, lastChange: { at: "2026-09-30T00:00:00Z", message: "edited 1 file" } }],
};

test("backups prints the policy, the last snapshot and the list", async () => {
  const s = await serve({ "/api/account/backups": () => backups });
  const r = await at(s.url, "backups");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /the last 14 kept on the server, 15 days off it/);
  assert.match(r.out, /verified/);
  assert.match(r.out, /50\.0MB/);
  assert.match(r.out, /server \+ r2/);
  assert.match(r.out, /encrypted before they leave the server/);
  assert.match(r.out, /last .*copied to r2\s+encrypted/);
  assert.match(r.out, /server \+ r2\s+not encrypted/);
  assert.match(r.out, /desk\s+last change/);
});

test("backups request sends what, when and where; refuses without --what or --at", async () => {
  const s = await serve({
    "POST /api/account/backups/requests": () => ({ ok: true, request: { id: "rr_1", workspace: "desk", target: "2026-09-28 14:00", notified: true } }),
  });
  const bad = await at(s.url, "backups", "request", "--at", "yesterday");
  assert.notEqual(bad.code, 0);
  const noAt = await at(s.url, "backups", "request", "--what", "runs");
  assert.notEqual(noAt.code, 0);
  const r = await at(s.url, "backups", "request", "--what", "runs", "--at", "2026-09-28 14:00", "--to", "desk", "--note", "lost a run");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(posts(s), [{ url: "/api/account/backups/requests", body: { what: "runs", target: "2026-09-28 14:00", workspace: "desk", backupId: null, note: "lost a run" } }]);
  assert.match(r.out, /asked/);
  assert.match(r.out, /emailed/);
});

const plan = {
  dryRun: true,
  to: { sha: "1111111aaaaaaa", at: "2026-09-28T04:00:00Z", by: "a@b.c", message: "v1" },
  from: "2222222bbbbbbb",
  added: ["flows/publish.md"],
  updated: ["agents/writer/agent.md"],
  removed: ["knowledge/new.md"],
  files: [
    { path: "agents/writer/agent.md", change: "updated", diff: [{ kind: "del", text: "two" }, { kind: "add", text: "one" }] },
    { path: "flows/publish.md", change: "added", diff: [{ kind: "add", text: "---" }] },
    { path: "knowledge/new.md", change: "removed", diff: [{ kind: "del", text: "# new" }] },
  ],
  blockedBy: [],
  noop: false,
};

test("restore --dry-run shows the diff and sends only the dry run", async () => {
  const s = await serve({ "POST /api/workspaces/desk/restore": () => plan });
  const r = await at(s.url, "restore", "desk", "--to", "3d", "--dry-run");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /desk → 1111111/);
  assert.match(r.out, /1 changed · 1 brought back · 1 removed/);
  assert.match(r.out, /\+ one/);
  assert.deepEqual(posts(s).map((p) => p.body), [{ to: "3d", dryRun: true }]);
});

test("restore without a terminal or --yes sends nothing but the dry run", async () => {
  const s = await serve({ "POST /api/workspaces/desk/restore": () => plan });
  const r = await at(s.url, "restore", "desk", "--to", "3d");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--yes/);
  assert.equal(posts(s).length, 1);
});

test("restore --yes restores the exact commit the dry run showed, with its removals", async () => {
  const s = await serve({
    "POST /api/workspaces/desk/restore": (body) =>
      JSON.parse(body).dryRun ? plan : { ok: true, applied: true, to: plan.to, from: plan.from, main: "3333333ccccccc" },
  });
  const r = await at(s.url, "restore", "desk", "--to", "2026-09-28", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(posts(s)[1].body, { to: "1111111aaaaaaa", confirm: "desk", expectRemoved: ["knowledge/new.md"] });
  assert.match(r.out, /restored to 1111111/);
  assert.match(r.out, /undo: foldrun restore desk --to 2222222/);
});

test("restore needs a workspace and --to", async () => {
  assert.notEqual((await at("http://127.0.0.1:9", "restore", "--to", "3d")).code, 0);
  assert.notEqual((await at("http://127.0.0.1:9", "restore", "desk")).code, 0);
});
