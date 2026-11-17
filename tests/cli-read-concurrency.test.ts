// Reads that do not depend on one another go out together.
//
// The API has no "every file with its text" read, so `pull`, `status` and
// `check --to` fetch a project one file per request. Those used to be asked
// one after another: a 60-file project was 60 round trips in a row (about
// 12 s against dev.foldrun.io, where one round trip is ~200 ms). `account`
// likewise waited for its defaults before asking for the pause mark.
//
// The fake platform here answers slowly and counts how many requests are in
// flight at once. A CLI that goes back to one-at-a-time sees 1.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile, spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, NO_COLOR: "1" };
const DELAY_MS = 60;

const foldrunAsync = (cwd: string, ...args: string[]) =>
  new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [CLI, ...args], { encoding: "utf8", cwd, env: ENV }, (err, stdout, stderr) =>
      resolve({ status: err && "code" in err ? Number(err.code) : 0, stdout, stderr }),
    );
  });

async function slowPlatform(files: Map<string, Map<string, string>>) {
  let inFlight = 0;
  let peak = 0;
  const server = http.createServer((req, res) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    const url = new URL(req.url!, "http://x");
    setTimeout(() => {
      inFlight--;
      res.setHeader("content-type", "application/json");
      const send = (o: unknown) => res.end(JSON.stringify(o));
      if (url.pathname === "/api/workspaces") return send({ workspaces: [...files.keys()].map((name) => ({ name })) });
      const m = /^\/api\/workspaces\/([^/]+)\/source$/.exec(url.pathname);
      if (m) {
        const own = files.get(m[1]) ?? new Map();
        const rel = url.searchParams.get("path");
        return send(rel ? { path: rel, content: own.get(rel) ?? "" } : { files: [...own.keys()] });
      }
      if (url.pathname === "/api/account") return send({ defaults: { timezone: "UTC" } });
      if (url.pathname === "/api/account/pause") return send({ paused: false, account: null, workspaces: {} });
      if (url.pathname === "/api/status") return send({ status: "operational", description: "all systems operational", incidents: [] });
      res.statusCode = 404;
      return send({ error: "not found" });
    }, DELAY_MS);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, peak: () => peak, reset: () => (peak = 0), close: () => server.close() };
}

/**
 * An account folder made by `init`. A bare temp folder is not used: the CLI
 * reads a folder with nothing in it as "wherever the nearest workspace above
 * is", and some machines keep a stray flows/ in their temp tree.
 */
function folder(): string {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-conc-")), "acme");
  const made = spawnSync(process.execPath, [CLI, "init", root], { encoding: "utf8", env: ENV });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  return root;
}

const project = (n: number, tag = "") => new Map(Array.from({ length: n }, (_, i) => [`agents/a${i}/agent.md`, `---\nname: a${i}\n---\n${tag}body ${i}\n`] as [string, string]));

test("pull reads a project's files together, and writes every one of them intact", async () => {
  const files = new Map([["desk", project(24)], ["blog", project(10, "b-")]]);
  const p = await slowPlatform(files);
  const here = folder();
  try {
    const t0 = Date.now();
    const r = await foldrunAsync(here, "pull", "--url", p.url, "--token", "k");
    const took = Date.now() - t0;
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const [ws, own] of files) for (const [rel, text] of own) assert.equal(fs.readFileSync(path.join(here, "workspaces", ws, rel), "utf8"), text, `${ws}/${rel}`);
    assert.ok(p.peak() > 1, `requests went out one at a time (peak ${p.peak()})`);
    assert.ok(p.peak() <= 16, `more than two projects' worth of readers at once (peak ${p.peak()})`);
    // 34 reads one after another would be 34 × 60 ms = 2 s before the CLI even starts.
    assert.ok(took < 34 * DELAY_MS, `pull took ${took} ms — as slow as one request per file in a row`);
  } finally {
    p.close();
  }
});

test("status reads every project at once and reports the same difference", async () => {
  const files = new Map([["desk", project(20)], ["blog", project(12)]]);
  const p = await slowPlatform(files);
  const here = folder();
  try {
    assert.equal((await foldrunAsync(here, "pull", "--url", p.url, "--token", "k")).status, 0);
    fs.writeFileSync(path.join(here, "workspaces/desk/agents/a3/agent.md"), "---\nname: a3\n---\nmine\n");
    p.reset();
    const r = await foldrunAsync(here, "status", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /~ desk\s+\+0 ~1 -0/);
    assert.match(r.stdout, /✓ blog\s+\+0 ~0 -0/);
    assert.ok(r.stdout.indexOf("✓ blog") < r.stdout.indexOf("~ desk"), "projects print in the order they always did (by name)");
    assert.ok(p.peak() > 8, `projects were read one after another (peak ${p.peak()})`);
  } finally {
    p.close();
  }
});

test("account asks for its defaults and its pause mark together", async () => {
  const p = await slowPlatform(new Map());
  const here = folder();
  try {
    const r = await foldrunAsync(here, "account", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /paused\s+no/);
    assert.equal(p.peak(), 2, `the pause mark waited for the defaults (peak ${p.peak()})`);
  } finally {
    p.close();
  }
});
