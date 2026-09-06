// `foldrun check` must see the library a signed-in developer's workspace
// resolves against — the one on the platform — not only the laptop's.
//
// It reported `tools: [site_repo]` missing for a tool that ran fine on every
// deploy, so the first check on a working desk was red. Pinned here with a
// fake platform serving /api/library/tools, offline, through the real binary.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync, execFile } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const foldrun = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, NO_COLOR: "1" },
  });

// The fake platform answers from this process, so the CLI must run without
// blocking the event loop while it is being asked.
const foldrunAsync = (...args: string[]) =>
  new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { encoding: "utf8", cwd: ROOT, env: { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, NO_COLOR: "1" } },
      (err, stdout, stderr) => resolve({ status: err && "code" in err ? Number(err.code) : 0, stdout, stderr }),
    );
  });

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-check-"));
  const ws = path.join(root, "desk");
  fs.mkdirSync(path.join(ws, "agents/planner"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "agents/planner/agent.md"),
    "---\nname: planner\ndescription: uses a library tool\ntools: [read, site_repo]\n---\n\nPlan.\n",
  );
  return ws;
}

function fakePlatform(): Promise<{ url: string; close: () => void; seen: string[] }> {
  const seen: string[] = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      seen.push(`${req.headers.authorization ?? "-"} ${req.url}`);
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/library/tools") {
        res.end(JSON.stringify({ kind: "tools", entries: [{ name: "site_repo", path: "site-repo.md" }] }));
      } else if (req.url === "/api/library/skills") {
        res.end(JSON.stringify({ kind: "skills", entries: [] }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close(), seen });
    });
  });
}

test("a tool that lives only in the platform's library passes check when the platform is named", async () => {
  const ws = workspace();
  const platform = await fakePlatform();
  try {
    const r = await foldrunAsync("check", ws, "--url", platform.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /site_repo.*from the library on/);
    assert.ok(platform.seen.some((l) => l.startsWith("Bearer k /api/library/tools")), "asked the platform, with the token");
  } finally {
    platform.close();
    fs.rmSync(path.dirname(ws), { recursive: true, force: true });
  }
});

test("without a platform the error says where else the tool could be", () => {
  const ws = workspace();
  try {
    const r = foldrun("check", ws, "--local");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /tools: \[site_repo\]/);
    assert.match(r.stdout, /foldrun login/);
  } finally {
    fs.rmSync(path.dirname(ws), { recursive: true, force: true });
  }
});

test("an unreachable platform is a warning, and the tool is still reported missing", () => {
  const ws = workspace();
  try {
    const r = foldrun("check", ws, "--url", "http://127.0.0.1:9", "--token", "k");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /could not read the library on http:\/\/127\.0\.0\.1:9/);
    assert.match(r.stdout, /tools: \[site_repo\]/);
  } finally {
    fs.rmSync(path.dirname(ws), { recursive: true, force: true });
  }
});
