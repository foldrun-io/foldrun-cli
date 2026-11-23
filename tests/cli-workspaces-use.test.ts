// `foldrun workspaces use <name>`: the project a signed-in profile's commands
// use when they name none. Kept on the profile (one account on one
// platform), checked on the platform before it is kept, and never over
// --to, a --token, or another platform.
//
//   node --test tests/cli-workspaces-use.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { serve } from "./fake-platform.ts";

const CLI = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");

/** A home with one signed-in profile on `url`. */
function home(url: string, extra: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-use-"));
  const profile = { url, token: "k", account: "acme", role: "admin", email: "a@example.invalid", loggedInAt: "2026-11-19T00:00:00Z", ...extra };
  fs.writeFileSync(path.join(dir, "credentials.json"), JSON.stringify({ current: "acme", profiles: { acme: profile }, platforms: {} }), { mode: 0o600 });
  return dir;
}
const saved = (h: string) => JSON.parse(fs.readFileSync(path.join(h, "credentials.json"), "utf8")).profiles.acme.workspace;

/** The CLI from an empty folder (no project here to guess from), awaited. */
function run(h: string, args: string[], env: Record<string, string> = {}): Promise<{ out: string; err: string; code: number }> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-use-cwd-"));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, FOLDRUN_HOME: h, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1", ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.stdin.end("");
    child.on("close", (code) => resolve({ out, err, code: code ?? 1 }));
  });
}

const platform = () =>
  serve({
    "/v1/workspaces/desk": () => ({ name: "desk" }),
    "/v1/workspaces/other": () => ({ name: "other" }),
    "/v1/workspaces/desk/source": () => ({ files: ["AGENTS.md"] }),
    "/v1/workspaces/other/source": () => ({ files: ["OTHER.md"] }),
  });

test("use checks the project, keeps it on the profile, and a command without --to then uses it — and says so", async (t) => {
  const s = await platform();
  t.after(() => s.close());
  const h = home(s.url);
  const set = await run(h, ["workspaces", "use", "desk"]);
  assert.equal(set.code, 0, set.out + set.err);
  assert.match(set.out, /desk.*is the project for acme/);
  assert.equal(saved(h), "desk");
  assert.ok(s.seen.some((r) => r.method === "GET" && r.url === "/v1/workspaces/desk"), "checked on the platform first");

  const ls = await run(h, ["source", "ls"]);
  assert.equal(ls.code, 0, ls.out + ls.err);
  assert.match(ls.out, /AGENTS\.md/);
  assert.match(ls.err, /project desk \(foldrun workspaces use\)/);
  assert.ok(s.seen.some((r) => r.url === "/v1/workspaces/desk/source"));

  const shown = await run(h, ["workspaces", "use", "--json"]);
  assert.deepEqual(JSON.parse(shown.out), { profile: "acme", url: s.url, workspace: "desk" });
});

test("--to still wins over the default", async (t) => {
  const s = await platform();
  t.after(() => s.close());
  const h = home(s.url, { workspace: "desk" });
  const ls = await run(h, ["source", "ls", "--to", "other"]);
  assert.equal(ls.code, 0, ls.out + ls.err);
  assert.match(ls.out, /OTHER\.md/);
  assert.doesNotMatch(ls.err, /foldrun workspaces use/);
  assert.ok(!s.seen.some((r) => r.url === "/v1/workspaces/desk/source"));
});

test("a project the platform does not have is refused and nothing is kept", async (t) => {
  const s = await platform();
  t.after(() => s.close());
  const h = home(s.url);
  const r = await run(h, ["workspaces", "use", "nope"]);
  assert.notEqual(r.code, 0);
  assert.match(r.out + r.err, /no project "nope" on .* workspaces new nope --platform/);
  assert.equal(saved(h), undefined);
});

test("never with --token or FOLDRUN_TOKEN, and never on another platform than the profile's", async (t) => {
  const s = await platform();
  const elsewhere = await platform();
  t.after(() => { s.close(); elsewhere.close(); });
  const h = home(s.url, { workspace: "desk" });
  const withToken = await run(h, ["source", "ls", "--url", s.url, "--token", "k"]);
  assert.notEqual(withToken.code, 0);
  assert.match(withToken.out + withToken.err, /which project\? pass --to/);
  const withEnv = await run(h, ["source", "ls"], { FOLDRUN_URL: s.url, FOLDRUN_TOKEN: "k" });
  assert.notEqual(withEnv.code, 0);
  const other = await run(h, ["source", "ls", "--url", elsewhere.url]);
  assert.notEqual(other.code, 0, "the default is the profile's platform's, not another's");
  assert.equal(elsewhere.seen.filter((r) => r.url.endsWith("/source")).length, 0);
  const refused = await run(h, ["workspaces", "use", "desk", "--url", s.url, "--token", "k"]);
  assert.notEqual(refused.code, 0);
  assert.match(refused.out + refused.err, /kept on a signed-in profile/);
});

test("--clear forgets it; a name that is not a project name is refused before any request", async (t) => {
  const s = await platform();
  t.after(() => s.close());
  const h = home(s.url, { workspace: "desk" });
  const cleared = await run(h, ["workspaces", "use", "--clear"]);
  assert.equal(cleared.code, 0, cleared.out + cleared.err);
  assert.equal(saved(h), undefined);
  const bad = await run(h, ["workspaces", "use", "../x"]);
  assert.notEqual(bad.code, 0);
  assert.equal(s.seen.length, 0);
});

test("commands that guess from the folder take the default from a folder that is no project (storage, history, agent run)", async (t) => {
  const s = await serve({});
  t.after(() => s.close());
  const h = home(s.url, { workspace: "desk" });
  for (const args of [["storage", "ls"], ["history"], ["agent", "run", "a", "--task", "x"]]) {
    const r = await run(h, args);
    assert.match(r.err, /project desk \(foldrun workspaces use\)/, args.join(" "));
  }
  const urls = s.seen.map((r) => `${r.method} ${r.url}`);
  assert.ok(urls.includes("GET /v1/workspaces/desk/storage"), urls.join(" | "));
  assert.ok(urls.includes("GET /v1/workspaces/desk/history"), urls.join(" | "));
  assert.ok(urls.includes("POST /v1/workspaces/desk/agents/a/run"), urls.join(" | "));
});

/** The CLI from a given folder. */
function runIn(cwd: string, h: string, args: string[]): Promise<{ out: string; err: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, FOLDRUN_HOME: h, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1" } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.stdin.end("");
    child.on("close", (code) => resolve({ out, err, code: code ?? 1 }));
  });
}

test("inside a project folder, source and invoke still need --to: the saved project is never written from another project's folder (Codex)", async (t) => {
  const s = await platform();
  t.after(() => s.close());
  const h = home(s.url, { workspace: "desk" });
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-use-proj-"));
  fs.mkdirSync(path.join(proj, "agents"));
  fs.writeFileSync(path.join(proj, "x.md"), "hi\n");
  const put = await runIn(proj, h, ["source", "put", "x.md", "--yes"]);
  assert.notEqual(put.code, 0);
  assert.match(put.out + put.err, /which project\? pass --to/);
  const inv = await runIn(proj, h, ["invoke", "daily"]);
  assert.notEqual(inv.code, 0);
  assert.match(inv.out + inv.err, /which project is it in\?/);
  assert.equal(s.seen.filter((r) => r.url.startsWith("/v1/workspaces/desk")).length, 0);
});

test("a delete never takes the default: source rm and storage rm name their project (Codex)", async (t) => {
  const s = await platform();
  t.after(() => s.close());
  const h = home(s.url, { workspace: "desk" });
  const rm = await run(h, ["source", "rm", "AGENTS.md", "--yes"]);
  assert.notEqual(rm.code, 0);
  assert.match(rm.out + rm.err, /which project\? pass --to/);
  const srm = await run(h, ["storage", "rm", "a.csv", "--yes"]);
  assert.notEqual(srm.code, 0);
  assert.match(srm.out + srm.err, /which project\?/);
  assert.equal(s.seen.filter((r) => r.method === "DELETE").length, 0);
});

test("the notice is said even with --json (on stderr; stdout stays JSON), and --clear --json answers JSON (Codex)", async (t) => {
  const s = await platform();
  t.after(() => s.close());
  const h = home(s.url, { workspace: "desk" });
  const s2 = await serve({ "/v1/workspaces/desk/vocabulary": () => ({ terms: [] }) });
  t.after(() => s2.close());
  const h2 = home(s2.url, { workspace: "desk" });
  const ls = await run(h2, ["workspace", "vocabulary", "--json"]);
  assert.equal(ls.code, 0, ls.out + ls.err);
  JSON.parse(ls.out);
  assert.match(ls.err, /project desk \(foldrun workspaces use\)/);
  const cleared = await run(h, ["workspaces", "use", "--clear", "--json"]);
  assert.deepEqual(JSON.parse(cleared.out), { profile: "acme", url: s.url, workspace: null });
});

test("a re-login or a key renewal keeps the saved project; another account under the name does not get it (Codex)", async () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-use-cred-"));
  const prev = process.env.FOLDRUN_HOME;
  process.env.FOLDRUN_HOME = h;
  try {
    const { saveCredential, setProfileWorkspace, profileByName } = await import("../src/credentials.mjs");
    const name = saveCredential("https://x.example", { token: "a", account: "acme", role: "admin" });
    const snapshot = profileByName(name);
    assert.ok(setProfileWorkspace(name, "desk", { url: "https://x.example", account: "acme" }));
    // A renewal writes back the snapshot taken before `use`: the project stays.
    saveCredential("https://x.example", { ...snapshot, token: "b" }, { name, makeDefault: false });
    assert.equal(profileByName(name).workspace, "desk");
    // `--clear`, then a renewal carrying the old value: it stays cleared.
    setProfileWorkspace(name, null);
    saveCredential("https://x.example", { ...snapshot, workspace: "desk", token: "c" }, { name, makeDefault: false });
    assert.equal(profileByName(name).workspace, undefined);
    // Set again; a re-login to the same account keeps it.
    setProfileWorkspace(name, "desk");
    saveCredential("https://x.example", { token: "d", account: "acme", role: "admin" });
    assert.equal(profileByName(name).workspace, "desk");
    // Another account signed in under the same name: not carried over, and a
    // save checked against the old account is refused.
    saveCredential("https://x.example", { token: "e", account: "other", role: "admin" }, { name });
    assert.equal(profileByName(name).workspace, undefined);
    assert.equal(setProfileWorkspace(name, "desk", { url: "https://x.example", account: "acme" }), null);
  } finally {
    if (prev === undefined) delete process.env.FOLDRUN_HOME;
    else process.env.FOLDRUN_HOME = prev;
  }
});
