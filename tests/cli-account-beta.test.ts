// `foldrun account beta [on|off]`: the account's beta (13 Nov 2026).
//
//   node --test tests/cli-account-beta.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, failing } from "./fake-platform.ts";

const flags = [{ name: "example-beta", description: "The registered example of a beta flag.", on: true, source: "beta" }];

test("bare: where the beta stands and the beta flags, one GET", async () => {
  const s = await serve({ "/api/account/beta": () => ({ beta: true, flags }) });
  const r = await at(s.url, "account", "beta");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(s.seen.map((x) => x.method), ["GET"]);
  assert.match(r.out, /beta features\s+on — this account gets them first/);
  assert.match(r.out, /example-beta\s+on\s+The registered example of a beta flag\./);
  assert.match(r.out, /foldrun account beta off/);
});

test("on and off are a PUT of { beta }; unchanged is said", async () => {
  for (const [word, want] of [["on", true], ["off", false]] as const) {
    const s = await serve({ "/api/account/beta": () => ({ beta: want, flags: [], changed: false }) });
    const r = await at(s.url, "account", "beta", word);
    s.close();
    assert.equal(r.code, 0, r.out);
    assert.equal(s.seen[0].method, "PUT");
    assert.deepEqual(JSON.parse(s.seen[0].body), { beta: want });
    assert.match(r.out, /\(unchanged\)/);
  }
});

test("anything but on or off is refused before any request", async () => {
  const s = await serve({});
  const r = await at(s.url, "account", "beta", "maybe");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /foldrun account beta on/);
  assert.equal(s.seen.length, 0);
});

test("a refusal from the platform (not an admin of every workspace) is said, with a failing exit", async () => {
  const s = await serve({ "/api/account/beta": () => failing(403, { error: "joining the beta changes the whole account — it needs access to every workspace" }) });
  const r = await at(s.url, "account", "beta", "on");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /needs access to every workspace/);
});
