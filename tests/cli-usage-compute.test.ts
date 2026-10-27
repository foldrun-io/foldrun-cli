// `foldrun usage compute` — the account's pool, what its running steps hold,
// and (27 Oct 2026) the steps waiting for room, oldest first.
//
//   node --test tests/cli-usage-compute.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

test("usage compute lists the steps waiting for room, with how long and why", async () => {
  const s = await serve({
    "/api/usage/compute": () => ({
      compute: { vcpu: 8, memGiB: 16, stepVcpu: 4, stepMemGiB: 8, source: "plan" },
      inUse: { vcpu: 8, memGiB: 12, steps: 3 },
      waiting: [
        { workspace: "desk", runId: "run-old", flow: "daily", step: 1, agent: "writer", since: ago(75), why: "8 of this account's 8 vCPU is held by its running steps and this one needs 2", cpus: 2, memGiB: 4 },
        { workspace: "desk", runId: "run-new", flow: "hourly", step: 0, agent: "reader", since: ago(3), why: "an older step of this account has waited 75 minutes for room and starts first", cpus: 1, memGiB: 1 },
      ],
    }),
  });
  const r = await at(s.url, "usage", "compute");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /8 of 8 vCPU · 12 of 16 GiB/);
  assert.match(r.out, /2 waiting for room/);
  assert.match(r.out, /75 min +desk\/daily writer +2 vCPU · 4 GiB/);
  assert.match(r.out, /an older step of this account/);
  assert.ok(r.out.indexOf("run-old") < r.out.indexOf("run-new"), "oldest first, as the platform sent them");
});

test("with nothing waiting, no waiting section", async () => {
  const s = await serve({ "/api/usage/compute": () => ({ compute: { vcpu: null, memGiB: null, stepVcpu: null, stepMemGiB: null, source: null }, inUse: { vcpu: 0, memGiB: 0, steps: 0 }, waiting: [] }) });
  const r = await at(s.url, "usage", "compute");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /waiting for room/);
});

// ---- 27 Oct 2026: disk, and the four levels.

test("usage compute shows the account, each workspace and each live run, with disk", async () => {
  const s = await serve({
    "/api/usage/compute": () => ({
      compute: { vcpu: 8, memGiB: 16, diskGiB: 80, stepVcpu: 4, stepMemGiB: 8, stepDiskGiB: 20, source: "plan" },
      inUse: { vcpu: 3, memGiB: 6, diskGiB: 28, steps: 2 },
      workspaces: [
        { workspace: "desk", pool: { vcpu: 4, memGiB: null, diskGiB: 40 }, inUse: { vcpu: 3, memGiB: 6, diskGiB: 28, steps: 2 } },
        { workspace: "quiet", pool: { vcpu: null, memGiB: null, diskGiB: null }, inUse: { vcpu: 0, memGiB: 0, diskGiB: 0, steps: 0 } },
      ],
      runs: [{ workspace: "desk", runId: "run-a", flow: "daily", pool: { vcpu: 2, memGiB: null, diskGiB: null }, inUse: { vcpu: 2, memGiB: 4, diskGiB: 20, steps: 1 } }],
      waiting: [{ workspace: "desk", runId: "run-a", flow: "daily", step: 2, agent: "writer", since: ago(5), why: "2 of this run's 2 vCPU is held by its running steps and this one needs 1", cpus: 1, memGiB: 2, diskGiB: 8, level: "run" }],
    }),
  });
  const r = await at(s.url, "usage", "compute");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /3 of 8 vCPU · 6 of 16 GiB · 28 of 80 GiB disk/);
  assert.match(r.out, /one step: up to 4 vCPU · 8 GiB · 20 GiB disk/);
  assert.match(r.out, /desk +3 of 4 vCPU · 6 GiB \(no cap\) · 28 of 40 GiB disk/);
  assert.doesNotMatch(r.out, /quiet/, "a workspace with no pool and nothing held is left out");
  assert.match(r.out, /desk\/daily run-a +2 of 2 vCPU/);
  assert.match(r.out, /1 vCPU · 2 GiB · 8 GiB disk +run-a · held by its run/);
});

test("account and workspace set compute send only the figures named, disk included", async () => {
  const s = await serve({
    "PATCH /api/account": () => ({ ok: true, defaults: {} }),
    "PATCH /api/workspaces/desk": () => ({ ok: true }),
    "/api/workspaces/desk/source": () => ({ content: "---\nname: desk\n---\n" }),
    "/api/workspaces/desk": () => ({ name: "desk" }),
    "/api/jobs": () => ({ jobs: [] }),
  });
  const a = await at(s.url, "account", "set", "compute", "disk", "40");
  const w = await at(s.url, "workspace", "set", "compute", "vcpu", "2", "memory", "4", "--to", "desk");
  const bad = await at(s.url, "account", "set", "compute", "gpus", "1");
  s.close();
  assert.equal(a.code, 0, a.out);
  const patches = s.seen.filter((x) => x.method === "PATCH");
  assert.deepEqual(JSON.parse(patches[0].body), { compute: { diskGiB: 40 } }, "the platform merges; vcpu and memory are not sent, so not cleared");
  assert.equal(w.code, 0, w.out);
  assert.deepEqual(JSON.parse(patches[1].body), { compute: { vcpu: 2, memGiB: 4 } });
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /not "gpus"/);
});

test("flow compute sets one run's pool through the flows route, and --clear drops it", async () => {
  const s = await serve({
    "PATCH /api/workspaces/desk/flows/daily": (body: string) => {
      const c = JSON.parse(body).compute;
      return { ok: true, flow: { name: "daily", compute: c ? { vcpu: c.vcpu, memGiB: c.memGiB, diskGiB: c.diskGiB } : null } };
    },
  });
  const set = await at(s.url, "flow", "compute", "daily", "vcpu", "2", "disk", "20", "--to", "desk");
  const clear = await at(s.url, "flow", "compute", "daily", "--clear", "--to", "desk");
  s.close();
  assert.equal(set.code, 0, set.out);
  assert.match(set.out, /each run may hold 2 vCPU · 20 GiB disk/);
  const bodies = s.seen.filter((x) => x.method === "PATCH").map((x) => JSON.parse(x.body));
  assert.deepEqual(bodies[0], { compute: { vcpu: 2, diskGiB: 20 } });
  assert.deepEqual(bodies[1], { compute: null });
  assert.match(clear.out, /no cap of its own/);
});

test("flow compute on a local folder writes the flow's compute:, merged over what it says", async () => {
  const { spawnSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const CLI = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
  const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, FOLDRUN_HOME: "/nonexistent/foldrun-home", NO_COLOR: "1" };
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-flowcompute-")), "acme");
  spawnSync(process.execPath, [CLI, "init", root, "--workspace", "main"], { encoding: "utf8", env: ENV });
  const ws = path.join(root, "workspaces/main");
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  fs.writeFileSync(path.join(ws, "flows/daily.md"), "---\nname: daily\ncompute: { memory: 4Gi }\n---\n\n1. [[writer]] — write\n");
  try {
    const r = spawnSync(process.execPath, [CLI, "flow", "compute", "daily", "vcpu", "2", "disk", "20"], { encoding: "utf8", cwd: ws, env: ENV });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const text = fs.readFileSync(path.join(ws, "flows/daily.md"), "utf8");
    assert.match(text, /compute:/);
    assert.match(text, /memory: 4Gi/, "kept");
    assert.match(text, /vcpu: 2/);
    assert.match(text, /disk: 20Gi/);
    assert.match(text, /1\. \[\[writer\]\] — write/, "the steps untouched");
    const c = spawnSync(process.execPath, [CLI, "flow", "compute", "daily", "--clear"], { encoding: "utf8", cwd: ws, env: ENV });
    assert.equal(c.status, 0, c.stdout + c.stderr);
    assert.doesNotMatch(fs.readFileSync(path.join(ws, "flows/daily.md"), "utf8"), /compute:/);
  } finally {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  }
});

// Codex review: a local edit must not write what `foldrun check` refuses.
test("compute figures below core's bounds are refused before anything is sent or written", async () => {
  const s = await serve({});
  for (const [args, said] of [
    [["vcpu", "0.3"], /vcpu is 0\.5 or more, in halves/],
    [["memory", "0"], /memory is 0\.25 GiB/],
    [["disk", "0.5"], /disk is 1 GiB or more/],
  ] as const) {
    const r = await at(s.url, "account", "set", "compute", ...args);
    assert.notEqual(r.code, 0);
    assert.match(r.out, said);
  }
  s.close();
  assert.equal(s.seen.filter((x) => x.method === "PATCH").length, 0);
});

// Codex review: --dry-run is a rehearsal — nothing sent, nothing written.
test("flow compute --dry-run sends nothing to the platform and writes nothing here", async () => {
  const s = await serve({ "PATCH /api/workspaces/desk/flows/daily": () => ({ ok: true }) });
  const r = await at(s.url, "flow", "compute", "daily", "vcpu", "2", "--dry-run", "--to", "desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /--dry-run: nothing sent/);
  assert.equal(s.seen.filter((x) => x.method === "PATCH").length, 0);

  const { spawnSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const CLI = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
  const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, FOLDRUN_HOME: "/nonexistent/foldrun-home", NO_COLOR: "1" };
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-flowdry-")), "acme");
  spawnSync(process.execPath, [CLI, "init", root, "--workspace", "main"], { encoding: "utf8", env: ENV });
  const ws = path.join(root, "workspaces/main");
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  const before = "---\nname: daily\n---\n\n1. [[writer]] — write\n";
  fs.writeFileSync(path.join(ws, "flows/daily.md"), before);
  try {
    const l = spawnSync(process.execPath, [CLI, "flow", "compute", "daily", "vcpu", "2", "--dry-run"], { encoding: "utf8", cwd: ws, env: ENV });
    assert.equal(l.status, 0, l.stdout + l.stderr);
    assert.match(l.stdout, /\+ compute:/, "the diff is shown");
    assert.match(l.stdout, /--dry-run: nothing written/);
    assert.equal(fs.readFileSync(path.join(ws, "flows/daily.md"), "utf8"), before);
  } finally {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  }
});
