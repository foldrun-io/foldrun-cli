// The memory watchdog on this computer (FOL-240, slice 2; owner, 25 Nov 2026: macOS first, by resident memory).
// macOS has no supported hard ceiling over a process tree, so this samples: about once a second it reads every process
// foldrun started for this session (the agent's commands, sub-agents, MCP servers — everything under this process),
// adds up their resident memory (RSS), and when the total is over the limit in force it stops the largest group of
// processes (TERM, a short wait, KILL). The session itself is never stopped, and neither is what the person runs
// (`!cmd`): those are left out by their process id. It is always called "sampled": a burst between two samples is
// not caught, and RSS counts shared pages in every process that maps them.

import { execFile } from "node:child_process";

/** One `ps` row. @typedef {{ pid: number, ppid: number, pgid: number, rssKb: number, command: string }} PsRow */

/** Every process, from `ps`. Never throws: [] when it cannot be read. @returns {Promise<PsRow[]>} */
export function psRows() {
  return new Promise((resolve) => {
    execFile("ps", ["-A", "-o", "pid=,ppid=,pgid=,rss=,comm="], { maxBuffer: 16 * 1024 * 1024, timeout: 5000 }, (err, out) => {
      if (err) return resolve([]);
      /** @type {PsRow[]} */
      const rows = [];
      for (const line of String(out).split("\n")) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), rssKb: Number(m[4]), command: m[5].trim() });
      }
      resolve(rows);
    });
  });
}

/**
 * What this session's processes hold, and the group to stop when over. Pure, for the tests.
 * @param {PsRow[]} rows @param {number} root this process @param {Set<number>} spared pids whose trees are the person's
 * @returns {{ totalMi: number, groups: { pgid: number, mi: number, command: string, pids: number[] }[] }}
 */
export function sessionTree(rows, root, spared) {
  /** @type {Map<number, PsRow[]>} */
  const kids = new Map();
  for (const r of rows) {
    if (!kids.has(r.ppid)) kids.set(r.ppid, []);
    /** @type {PsRow[]} */ (kids.get(r.ppid)).push(r);
  }
  const rootGroup = rows.find((r) => r.pid === root)?.pgid ?? root;
  /** @type {PsRow[]} */
  const mine = [];
  const walk = (/** @type {number} */ pid) => {
    for (const k of kids.get(pid) ?? []) {
      if (spared.has(k.pid)) continue;
      mine.push(k);
      walk(k.pid);
    }
  };
  walk(root);
  /** @type {Map<number, { pgid: number, mi: number, command: string, pids: number[] }>} */
  const groups = new Map();
  // A group with any member outside this session's tree (the person's, or anything else) is never a candidate:
  // a group signal would reach that member too (Codex).
  const minePids = new Set(mine.map((r) => r.pid));
  const mixed = new Set(rows.filter((r) => !minePids.has(r.pid)).map((r) => r.pgid));
  let totalKb = 0;
  for (const r of mine) {
    totalKb += r.rssKb;
    // A process still in the session's own group cannot be stopped by group without the session: not a candidate.
    if (r.pgid === rootGroup || mixed.has(r.pgid)) continue;
    const g = groups.get(r.pgid) ?? { pgid: r.pgid, mi: 0, command: r.command, pids: [] };
    g.mi += r.rssKb / 1024;
    g.pids.push(r.pid);
    if (r.pid === r.pgid) g.command = r.command;
    groups.set(r.pgid, g);
  }
  return { totalMi: totalKb / 1024, groups: [...groups.values()].sort((a, b) => b.mi - a.mi) };
}

/**
 * Watch this session's processes; stop the largest group when over the limit.
 * @param {{ limitMi: () => number | null, spared: () => Set<number>, onStop: (info: { pgid: number, command: string, totalMi: number, limitMi: number }) => void,
 *   intervalMs?: number, graceMs?: number, rows?: () => Promise<PsRow[]>, root?: number, kill?: (pid: number, sig: NodeJS.Signals) => void }} o
 * @returns {{ stop: () => void, tick: () => Promise<void> }}
 */
export function startWatchdog(o) {
  const root = o.root ?? process.pid;
  const rows = o.rows ?? psRows;
  const kill = o.kill ?? ((pid, sig) => process.kill(pid, sig));
  /** Groups already being stopped: not stopped twice. */
  const stopping = new Set();
  let busy = false;
  const tick = async () => {
    const limit = o.limitMi();
    if (limit === null || busy) return;
    busy = true;
    try {
      const tree = sessionTree(await rows(), root, o.spared());
      // A group already being stopped is on its way out: its memory is not a reason to stop another (it would be
      // stopped twice over in the grace before KILL).
      const dying = tree.groups.filter((x) => stopping.has(x.pgid)).reduce((n, x) => n + x.mi, 0);
      if (tree.totalMi - dying <= limit) return;
      const g = tree.groups.find((x) => !stopping.has(x.pgid));
      if (!g) return;
      stopping.add(g.pgid);
      try {
        kill(-g.pgid, "SIGTERM");
      } catch {
        /* gone */
      }
      // KILL only a group that still holds nothing but what TERM was sent to (orphans of it included): a number taken
      // by another group in the meantime is left alone (Codex).
      const sentTo = new Set(g.pids);
      setTimeout(async () => {
        try {
          const now = (await rows()).filter((r) => r.pgid === g.pgid);
          if (now.length && now.every((r) => sentTo.has(r.pid))) kill(-g.pgid, "SIGKILL");
        } catch {
          /* gone */
        }
        stopping.delete(g.pgid);
      }, o.graceMs ?? 2000).unref();
      o.onStop({ pgid: g.pgid, command: g.command, totalMi: tree.totalMi, limitMi: limit });
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), o.intervalMs ?? 1000);
  timer.unref();
  return { stop: () => clearInterval(timer), tick };
}
