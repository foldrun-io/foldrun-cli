// `foldrun runtimes`, and the same report at the end of `foldrun deploy`:
// which environments a workspace's agents need and whether each is built.
//
// A package that will not install used to be found by the first scheduled
// step, as a failed run. The platform now builds a workspace's environments
// as it is deployed, and the CLI says how that went.
//
//   node --test tests/cli-runtimes.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, at, cli } from "./fake-platform.ts";

const ready = {
  fingerprint: "822141117b5c1ac5",
  agents: ["compiler"],
  python: null,
  packages: ["openpyxl"],
  npm: [],
  rejected: [],
  state: "ready",
  error: null,
};
const failed = {
  fingerprint: "aa11bb22cc33dd44",
  agents: ["researcher", "finder"],
  python: "3.12",
  packages: ["no-such-dist"],
  npm: ["sharp"],
  rejected: ["--index-url"],
  state: "failed",
  error: "uv pip install failed: No solution found when resolving dependencies:\n  Because no-such-dist was not found in the package registry",
};

test("runtimes lists each environment, who needs it and whether it is built", async () => {
  const s = await serve({ "/api/workspaces/strata-desk/runtimes": () => ({ workspace: "strata-desk", runtimes: [ready, failed] }) });
  const r = await at(s.url, "runtimes", "--to", "strata-desk");
  s.close();
  assert.equal(r.code, 1, "a failed environment is a failing exit");
  assert.match(r.out, /✓ runtime 82214111 openpyxl \(compiler\)/);
  assert.match(r.out, /✗ runtime aa11bb22 python 3\.12, no-such-dist, npm:sharp \(researcher, finder\)/);
  assert.match(r.out, /no-such-dist was not found in the package registry/);
  assert.match(r.out, /not a requirement, ignored: --index-url/);
});

test("a workspace whose agents declare nothing says so, and exits clean", async () => {
  const s = await serve({ "/api/workspaces/quiet/runtimes": () => ({ workspace: "quiet", runtimes: [] }) });
  const r = await at(s.url, "runtimes", "--to", "quiet");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no agent here declares a runtime/);
});

test("deploy waits for the environments it just caused to be built, and reports them", async () => {
  let asked = 0;
  const s = await serve({
    "POST /api/workspaces/desk/deploy": () => ({ ok: true, applied: true, added: ["agents/a/agent.md"], updated: [], removed: [], preserved: 0, commit: null }),
    "/api/workspaces/desk/runtimes": () => {
      asked++;
      return { workspace: "desk", runtimes: [asked < 2 ? { ...ready, state: "building" } : ready] };
    },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-deploy-rt-"));
  try {
    fs.mkdirSync(path.join(dir, "desk/agents/a"), { recursive: true });
    fs.writeFileSync(path.join(dir, "desk/agents/a/agent.md"), "---\nname: a\n---\nx\n");
    const r = await cli(["deploy", "desk", "--url", s.url, "--token", "k"], { cwd: dir });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /deployed/);
    assert.match(r.out, /✓ runtime 82214111 openpyxl/);
    assert.ok(asked >= 2, "it polled while the build was running");
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a platform without the endpoint deploys exactly as before", async () => {
  const s = await serve({
    "POST /api/workspaces/desk/deploy": () => ({ ok: true, applied: true, added: [], updated: [], removed: [], preserved: 0, commit: null }),
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-deploy-rt-"));
  try {
    fs.mkdirSync(path.join(dir, "desk/agents/a"), { recursive: true });
    fs.writeFileSync(path.join(dir, "desk/agents/a/agent.md"), "---\nname: a\n---\nx\n");
    const r = await cli(["deploy", "desk", "--url", s.url, "--token", "k"], { cwd: dir });
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /runtime/);
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
