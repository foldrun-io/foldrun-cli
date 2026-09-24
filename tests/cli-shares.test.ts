// `foldrun storage share|shares|unshare` — public links to produced files.
//
// A share is the one thing reachable without a credential, so the terminal
// prints the URL, how long it lives, and how to take it down.
//
//   node --test tests/cli-shares.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const minted = { ok: true, url: "https://app.example.test/s/tok_abc", token: "tok_abc", path: "storage/reports/rival-gap.md", contentType: "text/markdown; charset=utf-8", expiresAt: "2026-10-01T00:00:00.000Z" };
const listing = {
  ok: true,
  shares: [
    { token: "tok_live", path: "storage/cover.png", contentType: "image/png", createdAt: "2026-09-20T00:00:00.000Z", createdBy: "matt@example.test", expiresAt: null, revokedAt: null },
    { token: "tok_gone", path: "storage/old.md", contentType: "text/markdown", createdAt: "2026-08-01T00:00:00.000Z", createdBy: null, expiresAt: "2026-08-08T00:00:00.000Z", revokedAt: null },
    { token: "tok_rev", path: "storage/x.md", contentType: "text/markdown", createdAt: "2026-09-01T00:00:00.000Z", createdBy: "storage/public", expiresAt: null, revokedAt: "2026-09-02T00:00:00.000Z" },
  ],
};

test("share mints a link, prints it, and sends the storage/ path with the ttl asked for", async () => {
  const s = await serve({ "POST /api/workspaces/rank-desk/shares": () => minted });
  const r = await at(s.url, "storage", "share", "reports/rival-gap.md", "--ttl", "30", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /https:\/\/app\.example\.test\/s\/tok_abc/);
  assert.match(r.out, /until /);
  assert.match(r.out, /unshare tok_abc/);
  assert.deepEqual(JSON.parse(s.seen[0].body), { path: "storage/reports/rival-gap.md", ttlDays: 30 });
});

test("--forever asks for no expiry, and --ttl with --forever is refused", async () => {
  const s = await serve({ "POST /api/workspaces/rank-desk/shares": () => ({ ...minted, expiresAt: null }) });
  const r = await at(s.url, "storage", "share", "storage/cover.png", "--forever", "--to", "rank-desk");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /never expires/);
  assert.deepEqual(JSON.parse(s.seen[0].body), { path: "storage/cover.png", ttlDays: null });
  const both = await at(s.url, "storage", "share", "storage/cover.png", "--forever", "--ttl", "3", "--to", "rank-desk");
  s.close();
  assert.notEqual(both.code, 0);
  assert.match(both.out, /not both/);
});

test("shares lists live links by default, and --all shows the expired and revoked ones", async () => {
  const s = await serve({ "/api/workspaces/rank-desk/shares": () => listing });
  const live = await at(s.url, "storage", "shares", "--to", "rank-desk");
  assert.equal(live.code, 0, live.out);
  assert.match(live.out, /tok_live/);
  assert.match(live.out, /never expires/);
  assert.doesNotMatch(live.out, /tok_gone/);
  assert.match(live.out, /1 link/);
  const all = await at(s.url, "storage", "shares", "--all", "--to", "rank-desk");
  s.close();
  assert.equal(all.code, 0, all.out);
  assert.match(all.out, /tok_gone.*expired/);
  assert.match(all.out, /tok_rev.*revoked/);
  assert.match(all.out, /3 links/);
});

test("unshare revokes by token, and says so when there was nothing to revoke", async () => {
  const s = await serve({ "DELETE /api/workspaces/rank-desk/shares": (_b, q) => ({ ok: true, revoked: q.get("token") === "tok_live" }) });
  const yes = await at(s.url, "storage", "unshare", "tok_live", "--to", "rank-desk");
  assert.equal(yes.code, 0, yes.out);
  assert.match(yes.out, /revoked/);
  const no = await at(s.url, "storage", "unshare", "tok_nope", "--to", "rank-desk");
  s.close();
  assert.equal(no.code, 1);
  assert.match(no.out, /nothing revoked/);
});
