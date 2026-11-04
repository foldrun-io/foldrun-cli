// `foldrun team invite | role | access | remove` and `foldrun me` — the
// person's acts from this machine's `foldrun login` (owner decision,
// 4 Nov 2026). The platform decides who may; these pin what the CLI sends.
//
//   node --test tests/cli-team-me.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, failing } from "./fake-platform.ts";

const MEMBERS = {
  members: [
    { id: "u1", email: "owner@acme.test", owner: true, role: "owner", workspaces: null },
    { id: "u2", email: "Ed@acme.test", role: "editor", workspaces: ["sales"] },
  ],
};

test("team invite posts the role, workspaces and address, and prints the full link once", async () => {
  const s = await serve({
    "POST /api/team": (body) => ({ ok: true, id: "inv_1", ...JSON.parse(body), path: "/signup?invite=tok", expires: "2026-11-12T00:00:00Z", sent: null, sendError: null }),
  });
  const r = await at(s.url, "team", "invite", "new@acme.test", "--role", "viewer", "--workspaces", "sales,ops", "--no-send");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { role: "viewer", workspaces: ["sales", "ops"], email: "new@acme.test", send: false });
  assert.ok(s.seen[0].headers["idempotency-key"], "one Idempotency-Key per invite");
  assert.match(r.out, new RegExp(`${s.url.replace(/[.]/g, "\\.")}/signup\\?invite=tok`));
});

test("team invite --all opens every workspace; a role that is not one is refused before anything is sent", async () => {
  const s = await serve({ "POST /api/team": (body) => ({ ok: true, id: "i", ...JSON.parse(body), path: "/signup?invite=t", expires: "2026-11-12" }) });
  const r = await at(s.url, "team", "invite", "--all");
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { role: "editor", workspaces: null });
  const bad = await at(s.url, "team", "invite", "--role", "owner");
  s.close();
  assert.notEqual(bad.code, 0);
  assert.equal(s.seen.length, 1);
});

test("team role finds the member by address in any case and patches their role", async () => {
  const s = await serve({ "GET /api/team": () => MEMBERS, "PATCH /api/team/members/u2": (body) => ({ ok: true, ...JSON.parse(body), workspaces: ["sales"] }) });
  const r = await at(s.url, "team", "role", "ed@acme.test", "viewer");
  s.close();
  assert.equal(r.code, 0, r.out);
  const patch = s.seen.find((x) => x.method === "PATCH")!;
  assert.deepEqual(JSON.parse(patch.body), { role: "viewer" });
  assert.match(r.out, /editor → viewer/);
});

test("team access sends the list, null for --all and [] for --none", async () => {
  const s = await serve({ "GET /api/team": () => MEMBERS, "PATCH /api/team/members/u2": (body) => ({ ok: true, role: "editor", ...JSON.parse(body) }) });
  for (const [args, want] of [[["--workspaces", "ops"], ["ops"]], [["--all"], null], [["--none"], []]] as const) {
    const r = await at(s.url, "team", "access", "u2", ...args);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(s.seen.filter((x) => x.method === "PATCH").at(-1)!.body), { workspaces: want });
  }
  const none = await at(s.url, "team", "access", "u2");
  s.close();
  assert.notEqual(none.code, 0, "no scope given: refused");
});

test("team remove needs --yes with no terminal, then deletes", async () => {
  const s = await serve({ "GET /api/team": () => MEMBERS, "DELETE /api/team/members/u2": () => ({ ok: true }) });
  const asked = await at(s.url, "team", "remove", "ed@acme.test");
  assert.notEqual(asked.code, 0);
  assert.match(asked.out, /--yes/);
  assert.equal(s.seen.filter((x) => x.method === "DELETE").length, 0);
  const r = await at(s.url, "team", "remove", "ed@acme.test", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen.filter((x) => x.method === "DELETE").length, 1);
});

test("a key made by hand gets the platform's refusal, which says to use foldrun login", async () => {
  const s = await serve({ "GET /api/team": () => MEMBERS, "PATCH /api/team/members/u2": () => failing(401, { error: "this action needs a person — signed in, or their own `foldrun login` on this machine — not an API key made by hand" }) });
  const r = await at(s.url, "team", "role", "u2", "viewer");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /foldrun login/);
});

test("team transfer points at the browser and sends nothing", async () => {
  const s = await serve({});
  const r = await at(s.url, "team", "transfer", "u2");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /Settings → Team/);
  assert.equal(s.seen.length, 0);
});

test("me shows the person; me name and me timezone post to the profile routes", async () => {
  const s = await serve({
    "GET /api/me": () => ({ account: "acme", role: "admin", workspaces: null, actor: { kind: "key", origin: "cli-login" }, person: { email: "ada@acme.test", firstName: "Ada", lastName: null, timezone: null } }),
    "POST /api/auth/name": () => ({ ok: true }),
    "POST /api/auth/timezone": (body) => ({ ok: true, timezone: JSON.parse(body).timezone }),
  });
  const me = await at(s.url, "me");
  assert.equal(me.code, 0, me.out);
  assert.match(me.out, /Ada/);
  assert.match(me.out, /automatic/);
  assert.equal((await at(s.url, "me", "name", "Ada", "Lovelace", "King")).code, 0);
  assert.deepEqual(JSON.parse(s.seen.find((x) => x.url === "/api/auth/name")!.body), { firstName: "Ada", lastName: "Lovelace King" });
  assert.equal((await at(s.url, "me", "name", "--clear")).code, 0);
  assert.deepEqual(JSON.parse(s.seen.filter((x) => x.url === "/api/auth/name").at(-1)!.body), { firstName: null, lastName: null });
  assert.equal((await at(s.url, "me", "timezone", "auto")).code, 0);
  assert.deepEqual(JSON.parse(s.seen.find((x) => x.url === "/api/auth/timezone")!.body), { timezone: null });
  s.close();
});

test("me with a key made by hand says it is nobody and exits 1", async () => {
  const s = await serve({ "GET /api/me": () => ({ account: "acme", role: "admin", workspaces: null, actor: { kind: "key" }, person: null }) });
  const r = await at(s.url, "me");
  s.close();
  assert.equal(r.code, 1);
  assert.match(r.out, /foldrun login/);
});
