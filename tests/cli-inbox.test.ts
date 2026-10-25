// `foldrun inbox` — what waits on you — against a fake platform: the buckets
// it asks for, what it prints, and that marks only change your view.
//
//   node --test tests/cli-inbox.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const items = [
  { id: "gate:desk/run-1/2", kind: "approval", bucket: "mine", why: "you are an approver", workspace: "desk", title: "publish — publisher waits for approval", detail: "Publish this draft?", at: "2026-10-24T01:00:00.000Z", href: "/x", read: false, dismissed: false },
  { id: "run:desk/run-2", kind: "run", bucket: "started", why: "you started it", workspace: "desk", title: "digest — failed", detail: "boom", at: "2026-10-24T00:00:00.000Z", href: "/y", read: true, dismissed: false },
];

test("inbox prints yours by default, asks for a bucket when told, and exits 1 on unread", async () => {
  const fake = await serve({
    "GET /api/me/inbox": (_b, q) => ({ person: "ana@acme.test", items: q.get("bucket") === "team" ? [] : items, counts: { mine: 1, started: 1, team: 3, unread: 1 } }),
  });
  try {
    const r = await at(fake.url, "inbox");
    assert.equal(r.code, 1, "something assigned to you is unread");
    assert.match(r.out, /inbox of ana@acme.test · for you 1 · started by you 1 · team 3 · 1 unread/);
    assert.match(r.out, /• publish — publisher waits for approval · approval · for you · desk/);
    assert.match(r.out, /gate:desk\/run-1\/2 — you are an approver/);
    assert.equal(fake.seen[0].query.get("bucket"), null, "the default: yours");
    const team = await at(fake.url, "inbox", "--team");
    assert.match(team.out, /nothing waiting/);
    assert.equal(fake.seen.at(-1)?.query.get("bucket"), "team");
    const unread = await at(fake.url, "inbox", "--unread", "--kind", "approval");
    assert.doesNotMatch(unread.out, /digest — failed/);
    assert.equal(fake.seen.at(-1)?.query.get("kind"), "approval");
  } finally {
    fake.close();
  }
});

test("inbox read / dismiss / restore send the ids and the action", async () => {
  const fake = await serve({ "POST /api/me/inbox": () => ({ ok: true, read: 1, dismissed: 1 }) });
  try {
    const r = await at(fake.url, "inbox", "dismiss", "gate:desk/run-1/2", "run:desk/run-2");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /set aside 2 items/);
    assert.deepEqual(JSON.parse(fake.seen[0].body), { ids: ["gate:desk/run-1/2", "run:desk/run-2"], action: "dismiss" });
    const bad = await at(fake.url, "inbox", "approve", "x");
    assert.notEqual(bad.code, 0);
    assert.match(bad.out, /verbs are read, unread, dismiss and restore/);
    const none = await at(fake.url, "inbox", "read");
    assert.notEqual(none.code, 0);
  } finally {
    fake.close();
  }
});
