// `foldrun account` — the account's own defaults, read and set.
//
// The timezone was set with a raw PATCH the day this was written. The thing
// worth pinning is the merge: the platform replaces the whole notify block,
// so setting an email without reading the current events first would drop
// them silently, which is the failure mode of every "replaces whole" key.
//
//   node --test tests/cli-account-settings.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const defaults = {
  timezone: "Australia/Sydney",
  budget: null,
  concurrency: null,
  notify: { email: "marketing@example.test", events: ["failed", "awaiting-approval"] },
};

/** A fake account whose PATCH merges the way the platform's does. */
function account(start = defaults) {
  let state: any = { ...start };
  return {
    routes: {
      "GET /api/account": () => ({ defaults: state }),
      "PATCH /api/account": (body: string) => {
        state = { ...state, ...JSON.parse(body) };
        return { ok: true, defaults: state };
      },
    },
    get state() {
      return state;
    },
  };
}

test("account with no verb prints every default, and what is unset", async () => {
  const a = account({ ...defaults, notify: null });
  const s = await serve(a.routes);
  const r = await at(s.url, "account");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /timezone\s+Australia\/Sydney/);
  assert.match(r.out, /nobody is told anything/);
  assert.match(r.out, /no cap/);
  assert.match(r.out, /the plan's number/);
});

test("set timezone patches just that key, and prints what it now is", async () => {
  const a = account();
  const s = await serve(a.routes);
  const r = await at(s.url, "account", "set", "timezone", "UTC");
  s.close();
  assert.equal(r.code, 0, r.out);
  const patch = s.seen.find((x) => x.method === "PATCH")!;
  assert.deepEqual(JSON.parse(patch.body), { timezone: "UTC" });
  assert.match(r.out, /timezone set/);
});

test("set notify email keeps the events that were already there", async () => {
  const a = account();
  const s = await serve(a.routes);
  const r = await at(s.url, "account", "set", "notify", "email", "ops@example.test");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "PATCH")!.body), {
    notify: { email: "ops@example.test", events: ["failed", "awaiting-approval"] },
  });
});

test("set notify url keeps the email beside it — the block is replaced whole", async () => {
  const a = account();
  const s = await serve(a.routes);
  const r = await at(s.url, "account", "set", "notify", "url", "https://hooks.example.test/x", "--events", "failed,completed");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "PATCH")!.body), {
    notify: { url: "https://hooks.example.test/x", email: "marketing@example.test", events: ["failed", "completed"] },
  });
});

test("an event name the platform does not know is refused before the PATCH", async () => {
  const a = account();
  const s = await serve(a.routes);
  const r = await at(s.url, "account", "set", "notify", "email", "ops@example.test", "--events", "exploded");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /--events takes failed, awaiting-approval, completed/);
  assert.equal(s.seen.filter((x) => x.method === "PATCH").length, 0);
});

test("budget and concurrency go through, and clear sends null", async () => {
  const a = account();
  const s = await serve(a.routes);
  assert.equal((await at(s.url, "account", "set", "budget", "60/day")).code, 0);
  assert.equal((await at(s.url, "account", "set", "concurrency", "4")).code, 0);
  assert.equal((await at(s.url, "account", "clear", "budget")).code, 0);
  s.close();
  const patches = s.seen.filter((x) => x.method === "PATCH").map((x) => JSON.parse(x.body));
  assert.deepEqual(patches, [{ budget: "60/day" }, { concurrency: 4 }, { budget: null }]);
});

test("the platform's own complaint is what you read, not HTTP 400", async () => {
  const s = await serve({
    "GET /api/account": () => ({ defaults }),
    "PATCH /api/account": () => ({ __status: 400, body: { error: '"Mars/Olympus" is not an IANA time zone — Australia/Sydney, UTC, America/New_York' } }),
  });
  const r = await at(s.url, "account", "set", "timezone", "Mars/Olympus");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /is not an IANA time zone/);
});

test("a setting that is not one of the four says which four", async () => {
  const s = await serve(account().routes);
  const r = await at(s.url, "account", "set", "colour", "blue");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /timezone\|notify\|budget\|concurrency/);
});
