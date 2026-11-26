// Cloud jobs (FOL-382, owner 26 Nov 2026): the agent on this computer starts
// work on the foldrun platform, each job in its own cloud sandbox, and goes on
// working while they run — "it should be dynamic as cloud can handle multiple
// pods". A call starts its jobs and answers at once with their run ids; each
// one's result reaches the agent as it finishes (between its tool calls, the
// way a message the person sends into the turn does), or when it asks with
// `wait: true`. The pure parts live here, so they are tested without a turn.

/**
 * The most jobs one call starts. Not the platform's limit — its room is: a run
 * past the account's compute pool waits for room and starts in turn, never
 * refused (pod-room.ts, FOL-100). This only stops a model that loops from
 * starting hundreds in one call; another call starts more.
 */
export const CLOUD_JOBS_CEILING = 16;
/** One task's longest text. */
export const CLOUD_TASK_CHARS = 20_000;
/** How long `wait: true` holds the turn before it answers "still running", so the person's messages are read. */
export const CLOUD_WAIT_MS = 5 * 60_000;
/** What one delivery of results may hold: the engine keeps 20,000 characters of a block, so this stays under it. */
const NEWS_CHARS = 18_000;

/** The tasks a cloud_jobs call names, or why they cannot be run. */
export function cloudTasks(/** @type {unknown} */ input) {
  const raw = /** @type {{ tasks?: unknown }} */ (input ?? {}).tasks;
  const tasks = Array.isArray(raw) ? raw.map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean) : [];
  if (!tasks.length || (Array.isArray(raw) && tasks.length !== raw.length)) return { error: "cloud_jobs needs tasks: a list of instructions, none empty" };
  if (tasks.length > CLOUD_JOBS_CEILING) return { error: `one cloud_jobs call starts at most ${CLOUD_JOBS_CEILING} jobs (a guard against a runaway loop, not the platform's limit): start these ${CLOUD_JOBS_CEILING} now and the rest with another call` };
  if (tasks.some((t) => t.length > CLOUD_TASK_CHARS)) return { error: `each task must be under ${CLOUD_TASK_CHARS} characters` };
  return { tasks };
}

/**
 * A cloud_jobs call, read strictly: a batch to start (with the folder, or as
 * one of the project's agents without it), or a wait for the ones running.
 * @param {unknown} input
 * @param {{ agents: string[], own: string } | null} cloud the project's agents, for a job without the folder
 * @returns {{ problem: string } | { wait: true } | { folder: boolean, tasks: string[], agent: string | null, description: string }}
 */
export function cloudJobsInput(input, cloud) {
  const i = /** @type {any} */ (input && typeof input === "object" ? input : {});
  if (i.wait !== undefined) {
    if (i.wait !== true) return { problem: "wait is true or left out" };
    if (i.tasks !== undefined) return { problem: "wait: true goes alone — it collects the jobs already started; start new ones in a call of their own" };
    return { wait: true };
  }
  if (i.folder !== undefined && typeof i.folder !== "boolean") return { problem: "folder must be true or false (true: a copy of the folder goes; false: only the task)" };
  const t = cloudTasks(i);
  if (!t.tasks) return { problem: t.error ?? "no tasks" };
  const description = String(i.description ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (i.folder !== false) return { folder: true, tasks: t.tasks, agent: null, description };
  if (!cloud) return { problem: "folder: false runs the job as one of the project's agents, and the project has none yet" };
  // Shown whole before it leaves, so plain text only (Codex, FOL-258).
  if (t.tasks.some((x) => /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(x))) return { problem: "each task is plain text only (one holds a control character)" };
  const agent = i.agent === undefined ? cloud.own : i.agent;
  if (typeof agent !== "string" || !cloud.agents.includes(agent)) return { problem: `agent: one of ${cloud.agents.join(", ")}` };
  return { folder: false, tasks: t.tasks, agent, description };
}

/**
 * The account's room on the platform as GET /v1/account/usage/compute
 * answers it, in a line for the agent: what is held and by how many steps,
 * what waits, and that more wait their turn rather than fail. "" when it
 * could not be read.
 * @param {any} d
 */
export function cloudRoomText(d) {
  if (!d || typeof d !== "object") return "";
  const pool = d.compute ?? {};
  const used = d.inUse ?? {};
  const steps = Number(used.steps) || 0;
  const vcpu = Number(used.vcpu) || 0;
  const cap = typeof pool.vcpu === "number" && pool.vcpu > 0 ? pool.vcpu : null;
  const waiting = Array.isArray(d.waiting) ? d.waiting.length : 0;
  const parts = [`${steps} step${steps === 1 ? "" : "s"} running on the account${cap !== null ? `, holding ${vcpu} of its ${cap} vCPU` : ""}`];
  if (cap !== null && typeof pool.stepVcpu === "number" && pool.stepVcpu > 0) {
    const free = Math.max(0, Math.floor((cap - vcpu) / pool.stepVcpu));
    parts.push(`room for about ${free} more step${free === 1 ? "" : "s"} of the largest size to start now`);
  }
  if (waiting) parts.push(`${waiting} waiting for room`);
  const rw = d.runsWaiting;
  const line = rw && typeof rw.limit === "number" ? ` A job past the room waits its turn and starts when there is room (up to ${rw.limit} runs may wait; past that a start is refused).` : " A job past the room waits its turn and starts when there is room.";
  return `The platform now: ${parts.join("; ")}.${line}`;
}

/**
 * What the batch may cost, from what this session's finished cloud jobs
 * cost: an average, said as one, or that nothing is known yet. Never a
 * number made up (lessons, 24 Nov 2026).
 * @param {number[]} costs each finished job's cost in USD, this session
 * @param {number} n jobs in the batch
 */
export function cloudEstimate(costs, n) {
  const known = costs.filter((x) => Number.isFinite(x) && x >= 0);
  if (!known.length) return "costs foldrun credits — what each uses is known only as it runs (no cloud job has finished in this session to go by)";
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  return `costs foldrun credits — about $${(avg * n).toFixed(2)} if they cost what this session's ${known.length} earlier cloud job${known.length === 1 ? "" : "s"} did on average ($${avg.toFixed(2)} each); a guess, not a quote`;
}

/**
 * The question's head line: how many jobs, where, what goes, what it costs.
 * @param {{ n: number, folder: boolean, ws: string, host: string, agent: string, estimate: string }} o
 */
export function cloudAskLine(o) {
  const many = o.n === 1 ? "1 cloud job" : `${o.n} cloud jobs, side by side`;
  return o.folder
    ? `${many}: sends a copy of this folder to ${o.ws} on ${o.host} and runs ${o.agent} there — ${o.estimate}`
    : `${many} in ${o.ws} on ${o.host} as its agent ${o.agent}, with that agent's own tools — only the text below is sent, no file of this folder — ${o.estimate}`;
}

/**
 * What the agent hears when a call has started its jobs.
 * @param {{ started: Array<{ n: number, id: string, task: string }>, refused: Array<{ n: number, task: string, why: string }>, unsure: boolean, room: string, folder: boolean, running: number, ws: string }} o
 */
export function cloudStartedText(o) {
  const clip = (/** @type {string} */ t) => (t.length > 120 ? `${t.slice(0, 120)}…` : t).replace(/\s+/g, " ");
  const lines = [];
  if (o.started.length) {
    lines.push(`Started ${o.started.length} cloud job${o.started.length === 1 ? "" : "s"}${o.folder ? " on a copy of this folder" : ""}; they run on the platform while you go on:`);
    for (const j of o.started) lines.push(`#${j.n} run ${j.id} — ${clip(j.task)}`);
  }
  if (o.refused.length) {
    lines.push(`Not started (${o.refused.length}):`);
    for (const j of o.refused) lines.push(`#${j.n} — ${clip(j.task)}: ${j.why}`);
  }
  if (o.unsure) lines.push(`One start went unanswered and may be running anyway: foldrun runs --to ${o.ws} shows it.`);
  if (o.room) lines.push(o.room);
  if (o.started.length) {
    lines.push(`Each job's result comes to you here as it finishes, between your tool calls (${o.running} running in this turn now). Go on with other work meanwhile; do not do the same work yourself.${o.folder ? " A job's changes go into the folder only after the person says yes, so read changed files again before you edit them." : ""} Before you end your reply, call cloud_jobs with wait: true to collect the rest — a job still running when your reply ends is waited for, and its result goes with the person's next message.`);
  }
  return lines.join("\n");
}

/**
 * One finished job, for the agent. `outcome`: what became of a folder job's patch in a few words (the summary
 * line); `changes`: the same in full; `note`: anything else, in its part only.
 * @typedef {{ n: number, id: string, task: string, status: string, cost: number, reply: string, outcome?: string, changes?: string, note?: string }} CloudResult
 */

/** @param {number} v */
const usd = (v) => (Number.isFinite(v) ? `$${v.toFixed(v < 0.01 && v > 0 ? 4 : 2)}` : "cost not known");

/** At most this many results in one block; the rest wait for the next (none is dropped). */
const NEWS_JOBS = 10;
/** The longest a part's text about the changes may be. */
const CHANGES_CHARS = 700;

/**
 * Finished jobs as one block, summary first — a line per job with its status,
 * cost and what became of its changes, then each job's report, cut so the block
 * stays under the engine's limit however many came at once (owner: 10+ jobs must
 * not flood the conversation). Takes at most NEWS_JOBS results; `used` says how
 * many, and the caller keeps the rest for the next block. What became of a
 * patch is never cut: only the report is, and the whole report is a command away.
 * @param {CloudResult[]} done
 * @param {{ running: number, ws: string }} o
 * @returns {{ text: string, used: number }}
 */
export function cloudNewsBlock(done, o) {
  if (!done.length) return { text: "", used: 0 };
  for (let k = Math.min(done.length, NEWS_JOBS); k >= 1; k--) {
    const some = done.slice(0, k);
    const later = done.length - k;
    const head = [`[cloud jobs: ${k} finished${later ? ` (${later} more finished, in the next message)` : ""}${o.running ? `, ${o.running} still running` : ", none still running"}]`];
    for (const r of some) head.push(`#${r.n} run ${r.id}: ${r.status}, ${usd(r.cost)}${r.outcome ? ` — ${r.outcome}` : ""}`);
    const summary = head.join("\n");
    const fixed = some.map((r) => {
      const task = r.task.length > 200 ? `${r.task.slice(0, 200)}…` : r.task;
      // A long file list is cut in its middle: what was decided and where a kept patch is come last, and stay (Codex).
      const changes = r.changes ? (r.changes.length > CHANGES_CHARS ? `${r.changes.slice(0, 250)} … ${r.changes.slice(-(CHANGES_CHARS - 250))}` : r.changes) : "";
      return { head: `--- #${r.n} (run ${r.id}): ${r.status}\nTask: ${task}`, tail: [changes, r.note ?? ""].filter(Boolean).join("\n") };
    });
    const overhead = summary.length + fixed.reduce((a, f) => a + f.head.length + f.tail.length + 120, 0);
    const each = Math.min(6_000, Math.floor((NEWS_CHARS - overhead) / k));
    if (each < 300 && k > 1) continue;
    const parts = some.map((r, i) => {
      const reply = r.reply.trim();
      const room = Math.max(300, each);
      const cut = reply.length > room ? `${reply.slice(0, room)}\n[report cut — foldrun report ${r.id} --to ${o.ws} has all of it]` : reply || "(no report)";
      const f = /** @type {{ head: string, tail: string }} */ (fixed[i]);
      return [f.head, `Report:\n${cut}`, f.tail].filter(Boolean).join("\n");
    });
    return { text: `${summary}\n\n${parts.join("\n\n")}`, used: k };
  }
  return { text: "", used: 0 };
}

/** The whole of `done` as text, block after block — for a test, and for a caller that wants all at once. */
export function cloudNewsText(/** @type {CloudResult[]} */ done, /** @type {{ running: number, ws: string }} */ o) {
  const out = [];
  for (let at = 0; at < done.length; ) {
    const b = cloudNewsBlock(done.slice(at), o);
    if (!b.used) break;
    out.push(b.text);
    at += b.used;
  }
  return out.join("\n\n");
}

/** The nudge given once when the agent ends its reply with jobs still running. */
export function cloudStillRunningText(/** @type {number} */ running) {
  return `[cloud jobs: ${running} still running. Their results have not reached you. Call cloud_jobs with wait: true to collect them before you finish, unless the person asked you not to wait; if you end the reply now, they are waited for and their results go with the person's next message.]`;
}
