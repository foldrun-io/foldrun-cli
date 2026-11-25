// FOL-240 slice 2: the memory watchdog, sampled, over this session's processes but the person's own.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { sessionTree, startWatchdog } from "../src/code-watchdog.mjs";

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
