// `foldrun --version`, `foldrun version`, and the once-a-day notice that a
// newer CLI was released with the platform. Through the real binary against
// a fake platform.
//
//   node --test tests/cli-version.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, cli, at } from "./fake-platform.ts";

const ROOT = path.join(import.meta.dirname, "..");
const OURS = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version as string;
const bump = (v: string) => v.replace(/^(\d+)\./, (_, m) => `${Number(m) + 1}.`);
const NEWER = bump(OURS);

const versionBody = (cliVersion: string | null) => ({
  version: "v2026.10.01.2",
  released_at: "2026-10-01T05:00:00Z",
  build: "aaaaaaa.bbbbbbb.ccccccc.ddddddd.eeeeeee",
  api: "2026-10-01",
  components: { core: "aaaaaaa", platform: "bbbbbbb", web: "ccccccc", docs: "ddddddd", infra: "eeeeeee", cli: "fffffff" },
  packages: { core: "0.4.3", cli: cliVersion },
});

test("--version prints the package version and contacts nothing", async () => {
  // A URL that would hang or refuse if anything were asked of it.
  const r = await cli(["--version"], { env: { FOLDRUN_URL: "http://127.0.0.1:9" } });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.out.trim(), `foldrun ${OURS}`);
  const v = await cli(["-v"]);
  assert.equal(v.out.trim(), `foldrun ${OURS}`);
});

test("version: cli, core and the platform's release, api and components; no warning when current", async () => {
  const s = await serve({ "/api/version": () => versionBody(OURS) });
  const r = await cli(["version", "--url", s.url]);
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`cli\\s+foldrun ${OURS.replace(/\./g, "\\.")}`));
  assert.match(r.out, /core\s+@foldrun\/core \d+\.\d+\.\d+/);
  assert.match(r.out, /platform\s+v2026\.10\.01\.2/);
  assert.match(r.out, /api\s+2026-10-01/);
  assert.match(r.out, /web\s+ccccccc/);
  assert.match(r.out, /infra\s+eeeeeee/);
  assert.doesNotMatch(r.out, /npm i -g/);
  assert.deepEqual(s.seen.map((x) => x.url), ["/api/version"]);
});

test("version: warns when the platform was released with a newer CLI, not when older", async () => {
  const s = await serve({ "/api/version": () => versionBody(NEWER) });
  const r = await cli(["version", "--url", s.url]);
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`released with ${NEWER.replace(/\./g, "\\.")}.*npm i -g foldrun@latest`));

  const o = await serve({ "/api/version": () => versionBody("0.0.1") });
  const r2 = await cli(["version", "--url", o.url]);
  o.close();
  assert.doesNotMatch(r2.out, /npm i -g/);
});

test("version --json: {cli, core, platform}", async () => {
  const s = await serve({ "/api/version": () => versionBody(OURS) });
  const r = await cli(["version", "--json", "--url", s.url]);
  s.close();
  assert.equal(r.code, 0, r.out);
  const j = JSON.parse(r.out);
  assert.equal(j.cli, OURS);
  assert.match(j.core, /^\d+\.\d+\.\d+/);
  assert.equal(j.platform.version, "v2026.10.01.2");
  assert.equal(j.platform.components.docs, "ddddddd");
  assert.equal(j.platform.url, s.url);
});

test("version: an unreachable platform still prints the local lines and exits 0", async () => {
  const r = await cli(["version", "--url", "http://127.0.0.1:9"], { env: { FOLDRUN_TIMEOUT: "3" } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /cli\s+foldrun/);
  assert.match(r.out, /platform: unreachable \(/);
});

test("version with no platform at all says so and exits 0", async () => {
  const r = await cli(["version"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /platform: none/);
});

test("update notice: once on a platform command when the server's CLI is newer, cached for a day, never without a terminal", async () => {
  const me = { actor: { kind: "user", email: "a@acme.test" }, account: "acme", role: "owner", workspaces: null };
  const s = await serve({ "/api/me": () => me }, { headers: { "x-foldrun-version": "v2026.10.01.2", "x-foldrun-cli": NEWER } });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-version-home-"));
  const notice = new RegExp(`foldrun ${NEWER.replace(/\./g, "\\.")} is out \\(this is ${OURS.replace(/\./g, "\\.")}\\), released with platform v2026\\.10\\.01\\.2 — npm i -g foldrun@latest`);
  try {
    // No terminal: nothing, and nothing cached.
    const pipe = await cli(["whoami", "--url", s.url, "--token", "k"], { env: { FOLDRUN_HOME: home } });
    assert.equal(pipe.code, 0, pipe.out);
    assert.doesNotMatch(pipe.out, /is out/);
    assert.equal(fs.existsSync(path.join(home, "version-check.json")), false);

    const first = await cli(["whoami", "--url", s.url, "--token", "k"], { env: { FOLDRUN_HOME: home, FOLDRUN_FORCE_TTY: "1" } });
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, notice);
    assert.equal(first.out.match(/is out/g)?.length, 1);
    const cached = JSON.parse(fs.readFileSync(path.join(home, "version-check.json"), "utf8"));
    assert.equal(cached.cli, NEWER);
    assert.equal(cached.platform, "v2026.10.01.2");

    const second = await cli(["whoami", "--url", s.url, "--token", "k"], { env: { FOLDRUN_HOME: home, FOLDRUN_FORCE_TTY: "1" } });
    assert.doesNotMatch(second.out, /is out/);

    // A day later it says it again.
    fs.writeFileSync(path.join(home, "version-check.json"), JSON.stringify({ ...cached, notifiedAt: new Date(Date.now() - 25 * 3600_000).toISOString() }));
    const third = await cli(["whoami", "--url", s.url, "--token", "k"], { env: { FOLDRUN_HOME: home, FOLDRUN_FORCE_TTY: "1" } });
    assert.match(third.out, notice);

    // Switched off by the environment.
    fs.rmSync(path.join(home, "version-check.json"));
    const off = await cli(["whoami", "--url", s.url, "--token", "k"], { env: { FOLDRUN_HOME: home, FOLDRUN_FORCE_TTY: "1", FOLDRUN_NO_UPDATE_NOTICE: "1" } });
    assert.doesNotMatch(off.out, /is out/);
  } finally {
    s.close();
  }
});

test("update notice: an older or equal server CLI says nothing", async () => {
  const s = await serve({ "/api/me": () => ({ actor: { kind: "user", email: "a@b" }, account: "a", role: "owner", workspaces: null }) }, { headers: { "x-foldrun-cli": OURS } });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-version-home-"));
  const r = await at(s.url, "whoami");
  const t = await cli(["whoami", "--url", s.url, "--token", "k"], { env: { FOLDRUN_HOME: home, FOLDRUN_FORCE_TTY: "1" } });
  s.close();
  assert.doesNotMatch(r.out + t.out, /is out/);
});

test("help version names the command", async () => {
  const r = await cli(["help", "version"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /foldrun version\s+this CLI's version/);
});
