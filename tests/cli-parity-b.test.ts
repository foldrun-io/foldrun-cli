// Dashboard → CLI parity, set B (4 Nov 2026 audit): what the dashboard shows
// or does in one step that the CLI dropped or needed two for.
//
//   node --test tests/cli-parity-b.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, cli } from "./fake-platform.ts";

const SECRETS = {
  secrets: [
    { name: "CRM_TOKEN", scope: "account", updatedAt: "2026-11-01", health: { last: { at: "2026-11-03T10:00:00Z", host: "api.crm.test", status: 401, outcome: "refused" }, refusals: 4, lastAccepted: "2026-10-28T09:00:00Z" } },
    { name: "MAPS_KEY", scope: "account", updatedAt: "2026-11-01", health: { last: { at: "2026-11-04T10:00:00Z", host: "maps.test", status: 200, outcome: "accepted" }, refusals: 0, lastAccepted: "2026-11-04T10:00:00Z" } },
    { name: "SLOW_API", scope: "account", updatedAt: "2026-11-01", health: { last: { at: "2026-11-02T10:00:00Z", host: "slow.test", status: 503, outcome: "error" }, refusals: 0, lastAccepted: null } },
    { name: "NEW_ONE", scope: "account", updatedAt: "2026-11-01", health: null },
  ],
};

test("secrets ls shows each secret's health as Connections does, and --json prints the document", async () => {
  const s = await serve({ "GET /api/secrets": () => SECRETS });
  const r = await at(s.url, "secrets", "ls", "--account");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /refused by api\.crm\.test on 2026-11-03 \(401\) · 4 times running · last worked 2026-10-28/);
  assert.match(r.out, /accepted by maps\.test on 2026-11-04/);
  assert.match(r.out, /slow\.test failed on 2026-11-02 \(503\) — its end, not the key/);
  assert.match(r.out, /NEW_ONE[^\n]*\n\s+not used yet/);
  const j = await at(s.url, "secrets", "ls", "--account", "--json");
  s.close();
  assert.equal(j.code, 0, j.out);
  assert.deepEqual(JSON.parse(j.out.slice(j.out.indexOf("{"))), SECRETS);
});

const CLIENTS = { clients: [{ name: "crm-token", client_id: "cid" }] };

test("secrets rm names the saved OAuth client it leaves unused, and deletes nothing more than the secret", async () => {
  const s = await serve({
    "DELETE /api/secrets": () => ({ ok: true }),
    "GET /api/oauth/clients": () => CLIENTS,
    "GET /api/oauth/connections": () => ({ connections: [] }),
  });
  const r = await at(s.url, "secrets", "rm", "CRM_TOKEN", "--account", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /CRM_TOKEN removed/);
  assert.match(r.out, /saved OAuth client crm-token is no longer used — `foldrun secrets clients rm crm-token` removes it/);
  assert.equal(s.seen.filter((x) => x.method === "DELETE").length, 1, "only the secret is deleted");
});

test("secrets rm --with-client also deletes the unused saved client; one still in use is never named", async () => {
  const s = await serve({
    "DELETE /api/secrets": () => ({ ok: true }),
    "GET /api/oauth/clients": () => CLIENTS,
    "GET /api/oauth/connections": () => ({ connections: [] }),
    "DELETE /api/oauth/clients": () => ({ ok: true }),
  });
  const r = await at(s.url, "secrets", "rm", "CRM_TOKEN", "--account", "--yes", "--with-client");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /saved OAuth client crm-token removed/);
  const del = s.seen.find((x) => x.method === "DELETE" && x.url === "/api/oauth/clients");
  assert.deepEqual(JSON.parse(del!.body), { client: "crm-token" });

  const used = await serve({
    "DELETE /api/secrets": () => ({ ok: true }),
    "GET /api/oauth/clients": () => CLIENTS,
    "GET /api/oauth/connections": () => ({ connections: [{ name: "CRM_TOKEN", workspace: "sales", client: "crm-token", status: "ok" }] }),
    "DELETE /api/oauth/clients": () => ({ ok: true }),
  });
  const kept = await at(used.url, "secrets", "rm", "CRM_TOKEN", "--account", "--yes", "--with-client");
  used.close();
  assert.equal(kept.code, 0, kept.out);
  assert.doesNotMatch(kept.out, /crm-token/);
  assert.equal(used.seen.filter((x) => x.url === "/api/oauth/clients" && x.method === "DELETE").length, 0);
});

test("secrets rm of a workspace secret leaves the account's saved clients alone, as the dashboard does", async () => {
  const s = await serve({ "DELETE /api/secrets": () => ({ ok: true }), "GET /api/oauth/clients": () => CLIENTS, "GET /api/oauth/connections": () => ({ connections: [] }) });
  const r = await at(s.url, "secrets", "rm", "CRM_TOKEN", "--to", "sales", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen.filter((x) => x.url.startsWith("/api/oauth")).length, 0);
});

const TRIGGERS = {
  days: 7,
  flows: [{ flow: "on-lead", trigger: "webhook", fired: 3, started: 1, dropped: [{ outcome: "throttled", count: 2, detail: "throttle: 900s" }], lastStartedAt: "2026-11-04T02:00:00.000Z" }],
  events: [
    { t: "2026-11-04T03:00:00.000Z", flow: "on-lead", outcome: "throttled", detail: "throttle: 900s — the last run started 120s ago" },
    { t: "2026-11-04T02:30:00.000Z", flow: "on-lead", outcome: "throttled", detail: "throttle: 900s" },
    { t: "2026-11-04T02:00:00.000Z", flow: "on-lead", outcome: "started", detail: "" },
  ],
  deliveries: [
    { t: "2026-11-04T03:10:00.000Z", flow: "on-lead", outcome: "bad-token", detail: "token did not match" },
    { t: "2026-11-04T03:00:00.000Z", flow: "on-lead", outcome: "accepted", detail: "", count: 3 },
  ],
};

test("triggers prints the newest decisions and the deliveries; --limit cuts both; --json is the document", async () => {
  const s = await serve({ "/api/workspaces/sales/triggers": () => TRIGGERS });
  const r = await at(s.url, "triggers", "--to", "sales");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /every decision, newest first/);
  assert.match(r.out, /2026-11-04 03:00:00Z\s+on-lead\s+inside the window \(throttle:\)/);
  assert.match(r.out, /started a run/);
  assert.match(r.out, /deliveries at the hook and inbox URLs · 1 refused before any flow rule applied/);
  assert.match(r.out, /bad-token\s+token did not match/);
  assert.match(r.out, /accepted ×3/);
  const short = await at(s.url, "triggers", "--to", "sales", "--limit", "1");
  assert.match(short.out, /1 of 3 — --limit <n> for more/);
  assert.doesNotMatch(short.out, /started a run/);
  const j = await at(s.url, "triggers", "--to", "sales", "--json");
  s.close();
  assert.equal(j.code, 0, j.out);
  assert.deepEqual(JSON.parse(j.out.slice(j.out.indexOf("{"))), TRIGGERS);
});

test("triggers with no flow fired still shows a refused delivery — it never becomes a trigger event", async () => {
  const s = await serve({ "/api/workspaces/sales/triggers": () => ({ days: 7, flows: [], events: [], deliveries: [TRIGGERS.deliveries[0]] }) });
  const r = await at(s.url, "triggers", "--to", "sales");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no trigger fired in sales/);
  assert.match(r.out, /1 refused before any flow rule applied/);
});

test("storage ls --all lists every workspace's files, busiest first, and names the empty ones", async () => {
  const s = await serve({
    "GET /api/workspaces": () => ({ workspaces: [{ name: "empty-desk" }, { name: "small-desk" }, { name: "big-desk" }] }),
    "GET /api/workspaces/empty-desk/storage": () => ({ files: [], used: 0 }),
    "GET /api/workspaces/small-desk/storage": () => ({ files: [{ path: "notes.md", size: 10, updatedAt: "2026-11-04T01:00:00Z", by: "user:a@b.test" }], used: 10 }),
    "GET /api/workspaces/big-desk/storage": () => ({ files: [{ path: "report.pdf", size: 5000, updatedAt: "2026-11-03T01:00:00Z", by: "run:r1" }, { path: "draft/a.md", size: 50, updatedAt: "2026-11-04T01:00:00Z", by: "run:r2" }], used: 5050, quotaMb: 5120 }),
  });
  const r = await at(s.url, "storage", "ls", "--all");
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.indexOf("big-desk") < r.out.indexOf("small-desk"), "the busiest first");
  assert.match(r.out, /big-desk\s+2 files/);
  assert.match(r.out, /report\.pdf/);
  assert.match(r.out, /nothing in empty-desk/);
  assert.match(r.out, /3 files in 2 workspaces/);
  const j = await at(s.url, "storage", "ls", "--all", "--json", "draft/");
  assert.equal(j.code, 0, j.out);
  const doc = JSON.parse(j.out.slice(j.out.indexOf("{")));
  assert.equal(doc.workspaces.length, 3);
  assert.equal(doc.workspaces[0].workspace, "big-desk", "the prefix narrows each workspace's files");
  assert.deepEqual(doc.workspaces[0].files.map((f: { path: string }) => f.path), ["draft/a.md"]);
  const both = await at(s.url, "storage", "ls", "--all", "--to", "big-desk");
  s.close();
  assert.notEqual(both.code, 0);
});

test("account model set --use sends source own with the key, in the one request", async () => {
  const s = await serve({ "PUT /api/account/model": (body) => ({ ...JSON.parse(body), runsOn: "account", set: true, keyHint: "…9876" }) });
  const r = await at(s.url, "account", "model", "set", "openrouter", "--key", "fake-9876", "--use");
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen.length, 1);
  assert.deepEqual(JSON.parse(s.seen[0].body), { provider: "openrouter", apiKey: "fake-9876", source: "own" });
  await at(s.url, "account", "model", "set", "openrouter", "--key", "fake-9876");
  s.close();
  assert.equal(JSON.parse(s.seen[1].body).source, undefined, "without --use the choice is left as it is");
});

test("keys ls tags a key foldrun login minted as a CLI sign-in", async () => {
  const s = await serve({
    "GET /api/keys": () => ({
      keys: [
        { id: "k1", prefix: "fr_ab", label: "laptop", role: "admin", workspaces: null, createdAt: "2026-11-01", origin: "cli-login" },
        { id: "k2", prefix: "fr_cd", label: "ci", role: "editor", workspaces: null, createdAt: "2026-11-01" },
      ],
    }),
  });
  const r = await at(s.url, "keys", "ls");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /laptop[^\n]*CLI sign-in · renews itself/);
  assert.doesNotMatch(r.out, /ci[^\n]*CLI sign-in/);
});

test("help names what the audit found missing", async () => {
  const want: [string, RegExp][] = [
    ["a2a", /--return-immediately/],
    ["mcp", /foldrun mcp clients add <name>/],
    ["storage", /unshare <token\|id>/],
    ["storage", /--ttl <days>/],
    ["storage", /--into <folder\/>/],
    ["storage", /storage ls --all/],
    ["secrets", /token-exchange \(RFC 8693: --token-url, --client-id, --subject-secret <NAME>/],
    ["secrets", /--requested-token-type/],
    ["secrets", /--oauth2 /],
    ["secrets", /--with-client/],
    ["connect", /--device /],
    ["connect", /--dpop /],
    ["connect", /--revoke-url /],
    ["connect", /--token-auth /],
    ["backups", /--backup <id>/],
    ["agent", /--isolated /],
    ["account", /--use /],
    ["triggers", /--limit/],
  ];
  for (const [cmd, re] of want) {
    const r = await cli([cmd, "--help"]);
    assert.match(r.out, re, `${cmd} --help`);
  }
});
