// `foldrun audit` and the key lifecycle verbs, against a fake platform: what
// each sends, and what it prints.
//
//   node --test tests/cli-audit-keys.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, at, raw, failing } from "./fake-platform.ts";

const ENTRIES = [
  { id: "9", at: "2026-10-01T02:00:00.000Z", actor: "support:boss@foldrun.io", action: "support.viewed", subject: "v1", detail: { reason: "Ticket 42: daily flow not starting", until: "2026-10-01T02:30:00.000Z" } },
  { id: "8", at: "2026-10-01T01:00:00.000Z", actor: "owner@acme.test", action: "apikey.created", subject: "k1", detail: { label: "ci", prefix: "fr_api_abcdef12", role: "editor" } },
  { id: "7", at: "2026-10-01T00:00:00.000Z", actor: "owner@acme.test", action: "secret.set", subject: "CRM_TOKEN", detail: { name: "CRM_TOKEN", kind: "value" } },
];

test("audit: one page of the log, with the filters as query parameters", async () => {
  const s = await serve({ "/v1/audit": () => ({ entries: ENTRIES, next: null, retention: "kept for the life of the account" }) });
  const r = await at(s.url, "audit", "--since", "30d", "--action", "apikey", "--actor", "owner@acme.test", "--to", "leads");
  s.close();
  assert.equal(r.code, 0, r.out);
  const q = s.seen[0].query;
  assert.equal(q.get("since"), "30d");
  assert.equal(q.get("action"), "apikey");
  assert.equal(q.get("actor"), "owner@acme.test");
  assert.equal(q.get("workspace"), "leads");
  assert.match(r.out, /support\.viewed\s+support:boss@foldrun\.io\s+support viewed your account: Ticket 42/);
  assert.match(r.out, /apikey\.created\s+owner@acme\.test\s+ci · fr_api_abcdef12… · editor/);
  assert.match(r.out, /secret\.set[\s\S]*CRM_TOKEN/);
  assert.match(r.out, /3 entries/);
});

test("audit: 7 days unless said; --all follows the cursor", async () => {
  let n = 0;
  const s = await serve({
    "/v1/audit": (_b, q) => (n++ === 0 ? { entries: ENTRIES.slice(0, 2), next: "8" } : (assert.equal(q.get("cursor"), "8"), { entries: ENTRIES.slice(2), next: null })),
  });
  const r = await at(s.url, "audit", "--all");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen.length, 2);
  assert.equal(s.seen[0].query.get("since"), "7d");
  assert.match(r.out, /3 entries/);
});

test("audit --csv writes the file the platform sends", async () => {
  const csv = "id,at,actor,action,subject,workspace,detail\n8,2026-10-01T01:00:00.000Z,owner@acme.test,apikey.created,k1,,{}\n";
  const s = await serve({ "/v1/audit": () => raw(csv, "text/csv", { "content-disposition": 'attachment; filename="audit-acme-2026-10-01.csv"' }) });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-audit-")), "audit.csv");
  const r = await at(s.url, "audit", "--csv", "--file", file);
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen[0].query.get("format"), "csv");
  assert.equal(fs.readFileSync(file, "utf8"), csv);
});

test("audit: a refusal is the platform's words", async () => {
  const s = await serve({ "/v1/audit": () => ({ __status: 403, body: { error: "your role (editor) cannot do this — it needs admin or above" } }) });
  const r = await at(s.url, "audit");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /needs admin/);
});

test("keys ls shows created, last used, expires and scope", async () => {
  const s = await serve({
    "/v1/keys": () => ({
      keys: [
        { id: "k1", prefix: "fr_api_abcdef12", label: "ci", role: "editor", workspaces: ["leads"], createdAt: "2026-09-01T00:00:00Z", createdBy: "owner@acme.test", revokedAt: null, expiresAt: "2026-12-01T00:00:00Z", lastUsedAt: "2026-09-30T10:00:00Z", lastIp: "203.0.113.0/24" },
        { id: "k2", prefix: "fr_api_00000000", label: "old", role: "admin", workspaces: null, createdAt: "2026-01-01T00:00:00Z", revokedAt: null, expiresAt: "2026-02-01T00:00:00Z", lastUsedAt: null },
      ],
    }),
  });
  const r = await at(s.url, "keys", "ls");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /live\s+k1\s+fr_api_abcdef12…\s+ci\s+editor · leads/);
  assert.match(r.out, /created 2026-09-01 · last used 2026-09-30 from 203\.0\.113\.0\/24 · expires 2026-12-01/);
  assert.match(r.out, /expired\s+k2[\s\S]*last used never · expires 2026-02-01/);
});

test("keys create --expires sends it and prints when it ends", async () => {
  const s = await serve({ "POST /v1/keys": () => ({ ok: true, key: "fr_api_new", id: "k9", prefix: "fr_api_new", role: "editor", workspaces: null, expiresAt: "2026-12-30T00:00:00.000Z" }) });
  const r = await at(s.url, "keys", "create", "ci", "--expires", "90d");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { label: "ci", expires: "90d" });
  assert.match(r.out, /expires 2026-12-30/);
  assert.match(r.out, /fr_api_new/);
});

test("keys create with no --expires asks for 90 days, as the dashboard does; --forever asks for never", async () => {
  const s = await serve({ "POST /v1/keys": () => ({ ok: true, key: "fr_api_new", id: "k9", prefix: "fr_api_new", role: "editor", workspaces: null, expiresAt: null }) });
  assert.equal((await at(s.url, "keys", "create", "ci")).code, 0);
  assert.equal(JSON.parse(s.seen[0].body).expires, "90d");
  assert.equal((await at(s.url, "keys", "create", "ci", "--forever")).code, 0);
  assert.equal(JSON.parse(s.seen[1].body).expires, "never");
  const both = await at(s.url, "keys", "create", "ci", "--forever", "--expires", "30d");
  s.close();
  assert.notEqual(both.code, 0);
  assert.equal(s.seen.length, 2, "refused before anything is sent");
});

test("keys create --to <ws> sends the scope, as --workspaces does (never an all-workspaces key)", async () => {
  const s = await serve({ "POST /v1/keys": (b) => ({ ok: true, key: "fr_api_new", id: "k9", prefix: "fr_api_new", role: "editor", workspaces: JSON.parse(b).workspaces, expiresAt: null }) });
  const one = await at(s.url, "keys", "create", "ci", "--to", "leads");
  assert.equal(one.code, 0, one.out);
  assert.deepEqual(JSON.parse(s.seen[0].body).workspaces, ["leads"]);
  assert.equal((await at(s.url, "keys", "create", "ci", "--to", "leads, blog")).code, 0);
  assert.deepEqual(JSON.parse(s.seen[1].body).workspaces, ["leads", "blog"]);
  assert.equal((await at(s.url, "keys", "create", "ci", "--workspaces", "leads")).code, 0);
  assert.deepEqual(JSON.parse(s.seen[2].body).workspaces, ["leads"]);
  s.close();
});

test("keys create --to refuses, before any request, when the scope is empty, bare or doubled", async () => {
  const s = await serve({ "POST /v1/keys": () => ({ ok: true, key: "fr_api_new", id: "k9", workspaces: null }) });
  for (const args of [["--to"], ["--to", ","], ["--to", "a", "--workspaces", "b"]]) {
    const r = await at(s.url, "keys", "create", "ci", ...args);
    assert.notEqual(r.code, 0, args.join(" "));
  }
  s.close();
  assert.equal(s.seen.length, 0, "nothing was sent");
});

test("keys create --to: a platform that answers with an all-workspaces key has it revoked, and no key is printed", async () => {
  const s = await serve({
    "POST /v1/keys": () => ({ ok: true, key: "fr_api_secret_all", id: "k9", prefix: "fr_api_secr", role: "editor", workspaces: null, expiresAt: null }),
    "DELETE /v1/keys": () => ({ ok: true }),
  });
  const r = await at(s.url, "keys", "create", "ci", "--to", "leads");
  s.close();
  assert.notEqual(r.code, 0);
  assert.ok(!r.out.includes("fr_api_secret_all"), "the key is never shown");
  assert.match(r.out, /every project/);
  assert.deepEqual(JSON.parse(s.seen[1].body), { id: "k9" });
});

test("keys rotate --grace 1h posts to the rotate route and prints the new key once", async () => {
  const s = await serve({
    "POST /v1/keys/k1/rotate": () => ({ ok: true, key: "fr_api_fresh", id: "k2", prefix: "fr_api_fresh", expiresAt: null, replaced: { id: "k1", endsAt: "2026-10-01T03:00:00.000Z" } }),
  });
  const r = await at(s.url, "keys", "rotate", "k1", "--grace", "1h");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { grace: "1h" });
  assert.match(r.out, /rotated k1 → k2/);
  assert.match(r.out, /fr_api_fresh/);
  assert.match(r.out, /keeps working until 2026-10-01 03:00 UTC/);
});

test("keys rotate with no grace revokes now, so it asks — and on a pipe without --yes sends nothing", async () => {
  const s = await serve({ "POST /v1/keys/k1/rotate": () => ({ ok: true, key: "x", id: "k2", replaced: { id: "k1", endsAt: "" } }) });
  const refused = await at(s.url, "keys", "rotate", "k1");
  assert.notEqual(refused.code, 0);
  assert.equal(s.seen.length, 0, "nothing sent");
  const ok = await at(s.url, "keys", "rotate", "k1", "--yes");
  s.close();
  assert.equal(ok.code, 0, ok.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { grace: "0" });
  assert.match(ok.out, /old key is revoked/);
});

test("keys rotate on a key already rotated: the refusal, and the command for the key that replaced it", async () => {
  const s = await serve({
    "POST /v1/keys/k1/rotate": () => failing(409, { error: 'this key was already rotated to fr_api_fresh… ("ci"); rotate that one — if you lost its secret, rotating fr_api_fresh… mints another and ends it' }),
    "/v1/keys": () => ({ keys: [
      { id: "k1", prefix: "fr_api_old", label: "ci", createdAt: "2026-09-01T00:00:00.000Z", revokedAt: null, replacedBy: "k2", expiresAt: "2026-10-02T00:00:00.000Z" },
      { id: "k2", prefix: "fr_api_fresh", label: "ci", createdAt: "2026-10-01T00:00:00.000Z", revokedAt: null },
    ] }),
  });
  const r = await at(s.url, "keys", "rotate", "k1", "--grace", "1h");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /already rotated to fr_api_fresh/);
  assert.match(r.out, /foldrun keys rotate k2/, "names the command for the new key");
  assert.doesNotMatch(r.out, /✓/);
});

test("keys ls shows a rotated key as rotated, and to which", async () => {
  const s = await serve({
    "/v1/keys": () => ({ keys: [
      { id: "k1", prefix: "fr_api_old", label: "ci", createdAt: "2026-09-01T00:00:00.000Z", revokedAt: null, replacedBy: "k2", expiresAt: "2099-10-02T00:00:00.000Z" },
      { id: "k2", prefix: "fr_api_fresh", label: "ci", createdAt: "2026-10-01T00:00:00.000Z", revokedAt: null },
    ] }),
  });
  const r = await at(s.url, "keys", "ls");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /rotated → k2 \(fr_api_fresh…\)/);
});

test("help: audit and the key verbs are documented, and --help runs nothing", async () => {
  const s = await serve({});
  const r = await at(s.url, "audit", "--help");
  s.close();
  assert.equal(s.seen.length, 0);
  assert.match(r.out, /foldrun audit/);
  assert.match(r.out, /--csv\s+audit:/);
  const k = await at("http://127.0.0.1:1", "keys", "--help");
  assert.match(k.out, /rotate <id> \[--grace 1h\]/);
  assert.match(k.out, /--expires <span>/);
});

test("keys delete asks first, then sends DELETE /v1/keys/<id> and says whether it ended a live key", async () => {
  const s = await serve({ "DELETE /v1/keys/k1": () => ({ ok: true, id: "k1", revoked: true }) });
  const refused = await at(s.url, "keys", "delete", "k1");
  assert.notEqual(refused.code, 0);
  assert.equal(s.seen.length, 0, "nothing sent without --yes on a pipe");
  const ok = await at(s.url, "keys", "delete", "k1", "--yes");
  s.close();
  assert.equal(ok.code, 0, ok.out);
  assert.equal(s.seen[0].method, "DELETE");
  assert.match(ok.out, /deleted k1 \(it was live: revoked now\)/);
});
