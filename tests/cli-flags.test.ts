// `foldrun flags`: the account's feature flags, read-only.
//
//   node --test tests/cli-flags.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, failing, cli } from "./fake-platform.ts";

const flags = [
  { name: "example-flag", description: "The registered example.", owner: "platform", default: false, on: false, source: "default", rollout: null },
  { name: "new-editor", description: "The new editor.", owner: "web", default: false, on: true, source: "rollout", rollout: 25 },
  { name: "fast-lane", description: "Queue lane.", owner: "platform", default: false, on: true, source: "account", rollout: null },
];

test("lists each flag on or off, and why — the rollout with its percentage", async () => {
  const s = await serve({ "/v1/account/flags": () => ({ flags }) });
  const r = await at(s.url, "flags");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen[0].method, "GET");
  assert.match(r.out, /example-flag\s+off\s+default\s+The registered example\./);
  assert.match(r.out, /new-editor\s+on\s+staged rollout 25%\s+The new editor\./);
  assert.match(r.out, /fast-lane\s+on\s+set for this account/);
  assert.match(r.out, /read-only/);
});

test("--json is the API's answer as it came", async () => {
  const s = await serve({ "/v1/account/flags": () => ({ flags }) });
  const r = await at(s.url, "flags", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(r.out.slice(r.out.indexOf("{"))), { flags }, "the document, whole (after the acting-as line on stderr)");
});

test("there is no write verb: an argument is refused before any request", async () => {
  const s = await serve({ "/v1/account/flags": () => ({ flags }) });
  const r = await at(s.url, "flags", "set", "example-flag", "on");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /platform's operator/);
  assert.doesNotMatch(r.out, /super admin/i);
  assert.equal(s.seen.length, 0);
});

test("a refusal from the platform is said, with a failing exit", async () => {
  const s = await serve({ "/v1/account/flags": () => failing(401, { error: "sign in first" }) });
  const r = await at(s.url, "flags");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /sign in first/);
});

test("--help names the verb and never calls the platform", async () => {
  const s = await serve({});
  const r = await at(s.url, "flags", "--help");
  s.close();
  assert.equal(r.code, 0);
  assert.match(r.out, /foldrun flags\s+the feature flags for this account/);
  assert.match(r.out, /--json/);
  assert.equal(s.seen.length, 0);
});

test("update --help and -h answer with the help line and never update (customer bench, 20 Nov 2026)", async () => {
  // `update` is handled before the other commands; --help used to run it.
  for (const h of ["--help", "-h"]) {
    const r = await cli(["update", h]);
    assert.equal(r.code, 0, h);
    assert.match(r.out, /foldrun update \[--check\]\s+take the latest foldrun now/, h);
    assert.doesNotMatch(r.out, /is the latest|is out|foldrun updated|could not be asked/, h);
  }
});
