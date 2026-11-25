// The memory watchdog on this computer (FOL-240, slice 2; owner, 25 Nov 2026: macOS first, by resident memory).
// macOS has no supported hard ceiling over a process tree, so this samples: about once a second it reads every process
// foldrun started for this session (the agent's commands, sub-agents, MCP servers — everything under this process),
// adds up their resident memory (RSS), and when the total is over the limit in force it stops the largest group of
// processes (TERM, a short wait, KILL). The session itself is never stopped, and neither is what the person runs
// (`!cmd`): those are left out by their process id. It is always called "sampled": a burst between two samples is
// not caught, and RSS counts shared pages in every process that maps them.
//
// CPU (FOL-240, by priority): macOS cannot cap a tree's CPU either. When the session's processes use more cores than
// allowed for a few samples running, the busiest group is moved to the background band (taskpolicy -b, PRIO_DARWIN_BG)
// (taskpolicy -b): it is never stopped for CPU, it gives way to everything else on the computer, and it comes back to
// normal priority when the limit is removed (taskpolicy -B; no renice, which a user cannot undo). Sampled as well:
// ps's %CPU is a short decaying average.

import { execFile } from "node:child_process";

/** One `ps` row. @typedef {{ pid: number, ppid: number, pgid: number, rssKb: number, command: string, cpuPct?: number, nice?: number }} PsRow */

/** Every process, from `ps`. Never throws: [] when it cannot be read. @returns {Promise<PsRow[]>} */
export function psRows() {
  return new Promise((resolve) => {
    execFile("ps", ["-A", "-o", "pid=,ppid=,pgid=,rss=,pcpu=,nice=,comm="], { maxBuffer: 16 * 1024 * 1024, timeout: 5000 }, (err, out) => {
      if (err) return resolve([]);
      /** @type {PsRow[]} */
      const rows = [];
      for (const line of String(out).split("\n")) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.,]+)\s+(-?\d+)\s+(.*)$/.exec(line);
        if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), rssKb: Number(m[4]), cpuPct: Number(m[5].replace(",", ".")) || 0, nice: Number(m[6]), command: m[7].trim() });
      }
      resolve(rows);
    });
  });
}

/**
 * What this session's processes hold, and the group to stop when over. Pure, for the tests.
 * @param {PsRow[]} rows @param {number} root this process @param {Set<number>} spared pids whose trees are the person's
 * @returns {{ totalMi: number, totalCpu: number, groups: { pgid: number, mi: number, cpu: number, command: string, pids: number[] }[],
 *   cpuGroups: { pgid: number, cpu: number, command: string, pids: number[] }[] }}
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
  /** @type {Map<number, { pgid: number, mi: number, cpu: number, command: string, pids: number[] }>} */
  const groups = new Map();
  // A group with any member outside this session's tree (the person's, or anything else) is never a candidate:
  // a group signal would reach that member too (Codex).
  const minePids = new Set(mine.map((r) => r.pid));
  const mixed = new Set(rows.filter((r) => !minePids.has(r.pid)).map((r) => r.pgid));
  let totalKb = 0;
  let totalPct = 0;
  // CPU: priority is changed one process at a time, never by group signal, so every process of the session is a
  // candidate. A command is one child of the session and everything under it — not a process group, which two
  // stdio MCP servers can share with foldrun itself (Codex). `pgid` here is that child's pid.
  /** @type {Map<number, number>} */
  const top = new Map();
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const topOf = (/** @type {number} */ pid) => {
    if (top.has(pid)) return /** @type {number} */ (top.get(pid));
    const r = byPid.get(pid);
    const t = !r || r.ppid === root ? pid : topOf(r.ppid);
    top.set(pid, t);
    return t;
  };
  /** @type {Map<number, { pgid: number, cpu: number, command: string, pids: number[] }>} */
  const cpuGroups = new Map();
  for (const r of mine) {
    totalKb += r.rssKb;
    totalPct += r.cpuPct ?? 0;
    const t = topOf(r.pid);
    const cg = cpuGroups.get(t) ?? { pgid: t, cpu: 0, command: byPid.get(t)?.command ?? r.command, pids: /** @type {number[]} */ ([]) };
    cg.cpu += (r.cpuPct ?? 0) / 100;
    cg.pids.push(r.pid);
    cpuGroups.set(t, cg);
    // A process still in the session's own group cannot be stopped by group without the session: not a candidate.
    if (r.pgid === rootGroup || mixed.has(r.pgid)) continue;
    const g = groups.get(r.pgid) ?? { pgid: r.pgid, mi: 0, cpu: 0, command: r.command, pids: [] };
    g.mi += r.rssKb / 1024;
    g.cpu += (r.cpuPct ?? 0) / 100;
    g.pids.push(r.pid);
    if (r.pid === r.pgid) g.command = r.command;
    groups.set(r.pgid, g);
  }
  return { totalMi: totalKb / 1024, totalCpu: totalPct / 100, groups: [...groups.values()].sort((a, b) => b.mi - a.mi), cpuGroups: [...cpuGroups.values()].sort((a, b) => b.cpu - a.cpu) };
}

/**
 * Watch this session's processes; stop the largest group when over the limit.
 * @param {{ limitMi: () => number | null, spared: () => Set<number>, onStop: (info: { pgid: number, command: string, totalMi: number, limitMi: number }) => void,
 *   limitCpu?: () => number | null, onSlow?: (info: { pgid: number, command: string, totalCpu: number, limitCpu: number, scope: "session" }) => void,
 *   lower?: (pid: number) => Promise<boolean>, raise?: (pid: number) => Promise<boolean>, overTicks?: number,
 *   intervalMs?: number, graceMs?: number, rows?: () => Promise<PsRow[]>, root?: number, kill?: (pid: number, sig: NodeJS.Signals) => void }} o
 * @returns {{ stop: () => void, tick: () => Promise<void> }}
 */
export function startWatchdog(o) {
  const root = o.root ?? process.pid;
  const rows = o.rows ?? psRows;
  const kill = o.kill ?? ((pid, sig) => process.kill(pid, sig));
  const lower = o.lower ?? lowerPriority;
  const raise = o.raise ?? raisePriority;
  /** Groups already being stopped: not stopped twice. */
  const stopping = new Set();
  /** Commands moved to the background band (the pid of the session's child that heads each), and the processes of
   *  each that were moved. A later process of the same command is moved too; a command that ended is forgotten. */
  /** @type {Map<number, Set<number>>} */
  const lowered = new Map();
  /** Processes the band could not be applied to: not tried every second, forgotten when they end. */
  const refused = new Set();
  let cpuBusy = false;
  let overFor = 0;
  let busy = false;
  const tick = async () => {
    const limit = o.limitMi();
    const cpuLimit = o.limitCpu?.() ?? null;
    if (cpuLimit === null) {
      overFor = 0; // three samples running means running: a gap with no limit starts it again (Codex)
      // No limit any more: what was lowered goes back to normal priority (Codex).
      if (lowered.size && !cpuBusy) {
        const back = [...lowered.values()].flatMap((x) => [...x]);
        lowered.clear();
        cpuBusy = true;
        void Promise.all(back.map((p) => raise(p))).finally(() => (cpuBusy = false));
      }
    }
    if ((limit === null && cpuLimit === null) || busy) return;
    busy = true;
    try {
      const all = await rows();
      const tree = sessionTree(all, root, o.spared());
      // CPU is weighed on its own, never holding up the memory check that follows (Codex).
      if (cpuLimit !== null && !cpuBusy) {
        cpuBusy = true;
        void slowDown(tree, cpuLimit, all).finally(() => (cpuBusy = false));
      }
      if (limit === null) return;
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
  /** CPU over the limit for a few samples running: the busiest command still at normal priority goes to the
   *  background band. The limit is this session's: the lowest of the computer's allowance, its ceiling and its
   *  agent's ask — as memory is held. One budget shared across open sessions is a later step, for both.
   *  @param {ReturnType<typeof sessionTree>} tree @param {number} cpuLimit @param {PsRow[]} all */
  const slowDown = async (tree, cpuLimit, all) => {
    const live = new Map(tree.cpuGroups.map((g) => [g.pgid, g]));
    for (const pid of refused) if (!tree.cpuGroups.some((g) => g.pids.includes(pid))) refused.delete(pid);
    // A lowered command: forgotten once it ended; its new processes moved as they appear (one started before the
    // band was set does not inherit it).
    for (const [head, done] of lowered) {
      const g = live.get(head);
      if (!g) {
        lowered.delete(head);
        continue;
      }
      for (const pid of done) if (!g.pids.includes(pid)) done.delete(pid);
      await Promise.all(g.pids.filter((p) => !done.has(p) && !refused.has(p)).map(async (p) => ((await lower(p)) ? done.add(p) : refused.add(p))));
    }
    // What still runs at normal priority: a lowered command, all of it, no longer counts.
    const normal = tree.cpuGroups.filter((g) => !lowered.has(g.pgid));
    const active = normal.reduce((n, g) => n + g.cpu, 0);
    if (active <= cpuLimit) {
      overFor = 0;
      return;
    }
    overFor += 1;
    if (overFor < (o.overTicks ?? 3)) return;
    overFor = 0;
    const g = normal.filter((x) => x.cpu > 0 && x.pids.some((p) => !refused.has(p))).sort((a, b) => b.cpu - a.cpu)[0];
    if (!g) return;
    // All of the command at once, from this sample — one quick call each, so the window for a reused pid is short.
    const done = new Set();
    await Promise.all(g.pids.filter((p) => !refused.has(p)).map(async (p) => ((await lower(p)) ? done.add(p) : refused.add(p))));
    // Told only when something really moved: a band that could not be set is not reported as done (Codex).
    if (!done.size) return;
    lowered.set(g.pgid, done);
    o.onSlow?.({ pgid: g.pgid, command: g.command, totalCpu: active, limitCpu: cpuLimit, scope: "session" });
  };
  const timer = setInterval(() => void tick(), o.intervalMs ?? 1000);
  timer.unref();
  return { stop: () => clearInterval(timer), tick };
}

/** One process to macOS's background band: true when it was set (a process gone is false). @param {number} pid
 *  @returns {Promise<boolean>} */
export function lowerPriority(pid) {
  return new Promise((resolve) => execFile("taskpolicy", ["-b", "-p", String(pid)], { timeout: 5000 }, (err) => resolve(!err)));
}

/** One process back out of the background band. @param {number} pid @returns {Promise<boolean>} */
export function raisePriority(pid) {
  return new Promise((resolve) => execFile("taskpolicy", ["-B", "-p", String(pid)], { timeout: 5000 }, (err) => resolve(!err)));
}
