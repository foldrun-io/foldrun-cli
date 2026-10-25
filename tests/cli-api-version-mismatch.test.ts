// A platform that refuses this CLI's Foldrun-Version: every command says
// which side is older and what to install, and exits 1 — never reads the
// refusal as an answer. `foldrun workspaces` once printed "no workspaces"
// for it, exit 0 (FOL-41, 18 Oct 2026).
//
//   node --test tests/cli-api-version-mismatch.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, cli, at, failing } from "./fake-platform.ts";
import { API_VERSION } from "../src/commands.mjs";

const OLDER = "2026-01-15"; // before this CLI's API version
const NEWER = "2099-01-01"; // after it

const refusal = (known: string[], withCode = true) =>
  failing(400, {
    error: `unknown API version ${API_VERSION} — this server knows ${known.join(", ")}`,
    ...(withCode ? { code: "unknown_api_version", known } : {}),
  });

test("a platform older than the CLI: says so, names the CLI released with it, exit 1", async () => {
  const s = await serve({ "/api/workspaces": () => refusal([OLDER]) }, { headers: { "x-foldrun-cli": "1.9.0" } });
  const r = await at(s.url, "workspaces");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`answers API versions up to ${OLDER}.*speaks ${API_VERSION}.*older than the CLI.*npm i -g foldrun@1\\.9\\.0`, "s"));
  assert.doesNotMatch(r.out, /no workspaces/);
});

test("a platform that retired the CLI's version: update the CLI, exit 1", async () => {
  const s = await serve({ "/api/schedule": () => refusal([NEWER]) });
  const r = await at(s.url, "schedule");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`no longer answers API ${API_VERSION}.*it answers ${NEWER}.*npm i -g foldrun@latest`, "s"));
});

test("a platform from before the refusal had a code: its sentence is read instead", async () => {
  const s = await serve({ "/api/schedule": () => refusal([OLDER], false) });
  const r = await at(s.url, "schedule");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /older than the CLI/);
});

test("any other 400 is left to the command", async () => {
  const s = await serve({ "/api/schedule": () => failing(400, { error: "something else entirely" }) });
  const r = await at(s.url, "schedule");
  s.close();
  assert.match(r.out, /something else entirely/);
  assert.doesNotMatch(r.out, /npm i -g/);
});

test("version: still shows the platform it would refuse, and warns that commands will be refused", async () => {
  const s = await serve({
    "/api/version": () => ({ version: "v2026.01.15.1", api: OLDER, packages: { cli: "1.9.0" }, components: {} }),
  });
  const r = await cli(["version", "--url", s.url]);
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /platform\s+v2026\.01\.15\.1/);
  assert.match(r.out, new RegExp(`speaks API ${API_VERSION}, newer than the platform's.*npm i -g foldrun@1\\.9\\.0`));
  assert.equal(s.seen[0].headers["foldrun-version"] ?? "", "", "asked with no opinion on the version, so it is never refused");
});
