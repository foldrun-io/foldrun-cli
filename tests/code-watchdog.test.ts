// FOL-240 slice 2: the memory watchdog, sampled, over this session's processes but the person's own.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { psRows, sessionTree, startWatchdog } from "../src/code-watchdog.mjs";

/** A tick, then the CPU step it started (it runs beside the memory check). */
const settle = () => new Promise((r) => setTimeout(r, 5));

const row = (pid: number, ppid: number, pgid: number, mb: number, command = `p${pid}`) => ({ pid, ppid, pgid, rssKb: mb * 1024, command });

test("sessionTree: everything under the session but the person's own trees; groups by size, never the session's own group", () => {
  const rows = [row(1, 0, 1, 10), row(100, 1, 100, 50, "node"), row(200, 100, 200, 300, "npm"), row(201, 200, 200, 200, "node"), row(300, 100, 300, 100, "mcp"), row(400, 100, 400, 999, "sh"), row(401, 400, 400, 999), row(500, 100, 100, 5)];
  const t = sessionTree(rows, 100, new Set([400]));
  assert.equal(Math.round(t.totalMi), 605, "the person's tree (400, 401) is not counted; the session itself is not");
  assert.deepEqual(t.groups.map((g) => [g.pgid, Math.round(g.mi), g.command]), [[200, 500, "npm"], [300, 100, "mcp"]], "500 is in the session's group: not a candidate");
  const mixed = sessionTree([...rows, row(900, 1, 300, 1, "someone else")], 100, new Set([400]));
  assert.deepEqual(mixed.groups.map((g) => g.pgid), [200], "a group with a member outside the session is never stopped");
});

test("startWatchdog: KILL is not sent to a group that now holds a process TERM was not sent to", async () => {
  const sent: [number, string][] = [];
  let rows = [row(100, 1, 100, 10), row(200, 100, 200, 900, "npm")];
  const w = startWatchdog({ root: 100, rows: async () => rows, limitMi: () => 100, spared: () => new Set(), onStop: () => {}, kill: (p, s) => void sent.push([p, s]), intervalMs: 1e9, graceMs: 20 });
  await w.tick();
  rows = [row(100, 1, 100, 10), row(777, 1, 200, 5, "a new process")];
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(sent, [[-200, "SIGTERM"]]);
  w.stop();
});

test("startWatchdog: over the limit, the largest group gets TERM then KILL, once; under it, nothing", async () => {
  const sent: [number, string][] = [];
  const stops: any[] = [];
  let rows = [row(100, 1, 100, 10), row(200, 100, 200, 300, "npm"), row(300, 100, 300, 100, "mcp")];
  const w = startWatchdog({ root: 100, rows: async () => rows, limitMi: () => 1000, spared: () => new Set(), onStop: (i) => stops.push(i), kill: (p, s) => void sent.push([p, s]), intervalMs: 1e9, graceMs: 20 });
  await w.tick();
  assert.deepEqual(sent, [], "under the limit");
  rows = [...rows, row(201, 200, 200, 900)];
  await w.tick();
  await w.tick();
  assert.deepEqual(sent, [[-200, "SIGTERM"]], "the largest group, once while it is being stopped");
  assert.equal(stops[0].command, "npm");
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(sent.at(-1), [-200, "SIGKILL"]);
  w.stop();
});

test("startWatchdog on this computer: a real command holding 200 MB under a 100 MiB limit is stopped", { skip: process.platform === "win32" ? "no ps" : false }, async () => {
  const child = spawn(process.execPath, ["-e", "globalThis.k = Buffer.alloc(200 * 1024 * 1024, 1); setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  const gone = new Promise<string | null>((r) => child.on("exit", (_c, sig) => r(sig)));
  await new Promise((r) => setTimeout(r, 800));
  const stops: any[] = [];
  const w = startWatchdog({ limitMi: () => 100, spared: () => new Set(), onStop: (i) => stops.push(i), intervalMs: 200, graceMs: 500 });
  try {
    const sig = await Promise.race([gone, new Promise((r) => setTimeout(() => r("still running"), 10_000))]);
    assert.ok(sig === "SIGTERM" || sig === "SIGKILL", `stopped (${String(sig)})`);
    assert.ok(stops[0].totalMi > 100);
  } finally {
    w.stop();
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      /* gone */
    }
  }
});

// FOL-240, CPU by priority: over the CPU allowed for a few samples running, the busiest group is lowered, never stopped.
const cpuRow = (pid: number, ppid: number, pgid: number, pct: number, command = `p${pid}`) => ({ pid, ppid, pgid, rssKb: 1024, cpuPct: pct, command });

test("startWatchdog CPU: lowered only after three samples over; the busiest group, once; a new member of it lowered too; never a signal", async () => {
  const lowered: number[] = [];
  const slow: any[] = [];
  const sent: any[] = [];
  let rows = [cpuRow(100, 1, 100, 5), cpuRow(200, 100, 200, 150, "make"), cpuRow(300, 100, 300, 90, "node")];
  const w = startWatchdog({ root: 100, rows: async () => rows, limitMi: () => null, limitCpu: () => 2, onStop: () => {}, onSlow: (i) => slow.push(i), lower: async (p) => (lowered.push(p), true), kill: (p, s) => void sent.push([p, s]), spared: () => new Set(), intervalMs: 1e9 });
  await w.tick(); await settle();
  await w.tick(); await settle();
  assert.deepEqual(lowered, [], "two samples over: nothing yet (a burst is not a reason)");
  await w.tick(); await settle();
  assert.deepEqual(lowered, [200], "the third: the busiest group (make, 1.5 CPUs)");
  assert.equal(slow[0].command, "make");
  assert.equal(Math.round(slow[0].totalCpu * 10), 24);
  rows = [...rows, cpuRow(201, 200, 200, 50, "cc")];
  await w.tick(); await settle();
  assert.deepEqual(lowered, [200, 201], "a process that joined the lowered command is moved too");
  for (let i = 0; i < 3; i++) { await w.tick(); await settle(); }
  assert.deepEqual(lowered, [200, 201], "node at 0.9 alone is under 2: nothing more");
  assert.deepEqual(sent, [], "CPU never stops anything");
  w.stop();
});

test("startWatchdog CPU: under the limit, or dipping under between samples, nothing is lowered; the person's tree is not counted", async () => {
  const lowered: number[] = [];
  let pct = 300;
  const rows = async () => [cpuRow(100, 1, 100, 0), cpuRow(200, 100, 200, pct), cpuRow(400, 100, 400, 800, "person")];
  const w = startWatchdog({ root: 100, rows, limitMi: () => null, limitCpu: () => 4, onStop: () => {}, lower: async (p) => (lowered.push(p), true), spared: () => new Set([400]), intervalMs: 1e9 });
  for (let i = 0; i < 5; i++) { await w.tick(); await settle(); }
  assert.deepEqual(lowered, [], "3 CPUs of 4: under (the person's 8 are theirs)");
  pct = 500;
  await w.tick(); await settle();
  await w.tick(); await settle();
  pct = 100;
  await w.tick(); await settle();
  pct = 500;
  await w.tick(); await settle();
  await w.tick(); await settle();
  assert.deepEqual(lowered, [], "the count starts again after a sample under");
  await w.tick(); await settle();
  assert.deepEqual(lowered, [200]);
  w.stop();
});

test("startWatchdog CPU: a band that cannot be set is not reported, nor tried every second; a lowered command's later workers move with it; no limit puts them back", async () => {
  const tried: number[] = [];
  const told: any[] = [];
  const w2 = startWatchdog({ root: 100, rows: async () => [cpuRow(100, 1, 100, 0), cpuRow(200, 100, 200, 300)], limitMi: () => null, limitCpu: () => 1, onStop: () => {}, onSlow: (i) => told.push(i), lower: async (p) => (tried.push(p), false), spared: () => new Set(), intervalMs: 1e9 });
  for (let i = 0; i < 6; i++) { await w2.tick(); await settle(); }
  assert.deepEqual(told, [], "nothing moved: nothing said");
  assert.deepEqual(tried, [200], "and not tried again every second");
  w2.stop();
  // A lowered command's later worker is moved too and not counted; the limit removed puts them all back.
  const lowered: number[] = [];
  const raised: number[] = [];
  let limit: number | null = 1;
  let rows = [cpuRow(100, 1, 100, 0), cpuRow(300, 100, 300, 200, "make")];
  const w = startWatchdog({ root: 100, rows: async () => rows, limitMi: () => null, limitCpu: () => limit, onStop: () => {}, lower: async (p) => (lowered.push(p), true), raise: async (p) => (raised.push(p), true), spared: () => new Set(), intervalMs: 1e9 });
  for (let i = 0; i < 3; i++) { await w.tick(); await settle(); }
  rows = [...rows, cpuRow(301, 300, 300, 100, "cc"), cpuRow(400, 100, 400, 80, "node")];
  for (let i = 0; i < 4; i++) { await w.tick(); await settle(); }
  assert.deepEqual(lowered, [300, 301], "make's later worker moved with it; node at 0.8 alone is under 1 — not moved (Codex)");
  limit = null;
  await w.tick(); await settle();
  assert.deepEqual(raised.sort(), [300, 301], "no limit any more: back to normal priority (Codex)");
  w.stop();
});

test("startWatchdog CPU: two commands that share a process group are weighed apart; the count starts again after a gap with no limit", async () => {
  const lowered: number[] = [];
  let limit: number | null = 1;
  const rows = async () => [cpuRow(100, 1, 100, 0), cpuRow(150, 100, 100, 250, "busy-mcp"), cpuRow(160, 100, 100, 0, "idle-mcp")];
  const w = startWatchdog({ root: 100, rows, limitMi: () => null, limitCpu: () => limit, onStop: () => {}, lower: async (p) => (lowered.push(p), true), spared: () => new Set(), intervalMs: 1e9 });
  for (let i = 0; i < 2; i++) { await w.tick(); await settle(); }
  limit = null;
  await w.tick(); await settle();
  limit = 1;
  await w.tick(); await settle();
  assert.deepEqual(lowered, [], "two over, a gap, one over: not three running");
  for (let i = 0; i < 2; i++) { await w.tick(); await settle(); }
  assert.deepEqual(lowered, [150], "the busy server alone, not the idle one in the same group (Codex)");
  w.stop();
});

test("startWatchdog CPU: a busy child in foldrun's own process group is a candidate (a stdio MCP server); a gone group's record is dropped", async () => {
  const lowered: number[] = [];
  let rows = [cpuRow(100, 1, 100, 0), cpuRow(150, 100, 100, 250, "mcp-server"), cpuRow(200, 100, 200, 20, "node")];
  const w = startWatchdog({ root: 100, rows: async () => rows, limitMi: () => null, limitCpu: () => 1, onStop: () => {}, lower: async (p) => (lowered.push(p), true), spared: () => new Set(), intervalMs: 1e9 });
  for (let i = 0; i < 3; i++) { await w.tick(); await settle(); }
  assert.deepEqual(lowered, [150], "the MCP server in the session's group, lowered by its own pid");
  rows = [cpuRow(100, 1, 100, 0), cpuRow(150, 100, 100, 0), cpuRow(160, 100, 100, 250, "new")];
  for (let i = 0; i < 2; i++) { await w.tick(); await settle(); }
  assert.deepEqual(lowered, [150], "a new process in foldrun's own group is not lowered just for being there (Codex)");
  await w.tick(); await settle();
  assert.deepEqual(lowered, [150, 160], "it is lowered after three samples over, like any other");
  w.stop();
});

test("startWatchdog: a slow CPU change never holds up the memory check (Codex)", async () => {
  const sent: any[] = [];
  const rows = async () => [cpuRow(100, 1, 100, 0), { ...cpuRow(200, 100, 200, 400, "build"), rssKb: 900 * 1024 }];
  const w = startWatchdog({ root: 100, rows, limitMi: () => null, limitCpu: () => 1, overTicks: 1, onStop: () => {}, lower: () => new Promise<boolean>(() => {}), spared: () => new Set(), kill: (p, s) => void sent.push([p, s]), intervalMs: 1e9, graceMs: 1e6 });
  await w.tick();
  await settle();
  const w2 = startWatchdog({ root: 100, rows, limitMi: () => 100, limitCpu: () => 1, overTicks: 1, onStop: () => {}, lower: () => new Promise<boolean>(() => {}), spared: () => new Set(), kill: (p, s) => void sent.push([p, s]), intervalMs: 1e9, graceMs: 1e6 });
  await w2.tick();
  await w2.tick();
  assert.deepEqual(sent, [[-200, "SIGTERM"]], "memory acted while the CPU change hangs");
  w.stop();
  w2.stop();
});

test("psRows reads the process table even when PATH holds no ps: a turn replaces PATH with a private folder (FOL-240)", async () => {
  const was = process.env.PATH;
  process.env.PATH = "/nonexistent-foldrun-bin";
  try {
    const rows = await psRows();
    assert.ok(rows.some((r) => r.pid === process.pid), "this process is in the table");
  } finally {
    process.env.PATH = was;
  }
});
