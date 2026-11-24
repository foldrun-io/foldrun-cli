// Waiting for the plan's allowance to reset, in the open session (FOL-252).
//
// A turn that stops because the plan's allowance is used can be sent again
// when it resets. It is this process that waits — a timer in the open
// session, nothing scheduled with the system, no background job: closing
// the terminal ends the wait and nothing is left running.

/** How long is left, in the two largest units: "2d 3h", "2h 14m", "3m 20s", "12s". */
export function waitLeft(/** @type {number} */ ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/**
 * The answer to "wait and carry on at <time>?": a yes, alone or with the
 * most the turn sent after the reset may come to (`y 2`, `y $2.50`);
 * anything else is a no. A ceiling that is not a sum above zero is not a
 * yes either — the person meant a limit, and none would be kept.
 * @returns {{ ceilingUsd?: number } | null}
 */
export function waitAnswer(/** @type {string} */ typed) {
  const m = /^y(?:es)?(?:\s+\$?(\S+))?$/i.exec(String(typed ?? "").trim());
  if (!m) return null;
  if (m[1] === undefined) return {};
  if (!/^\d+(\.\d+)?$/.test(m[1])) return null;
  const usd = Number(m[1]);
  return usd > 0 && usd <= 10_000 ? { ceilingUsd: usd } : null;
}

/**
 * Wait until a moment, by the clock (a computer that slept wakes to the
 * right answer), saying how long is left as it goes.
 * @param {number} at the moment, in ms
 * @param {{ tick?: (leftMs: number) => void, now?: () => number }} [o]
 * @returns {{ done: Promise<"reached" | "stopped">, stop: () => void }}
 */
export function waitUntil(at, o = {}) {
  const now = o.now ?? Date.now;
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  /** @type {(v: "reached" | "stopped") => void} */
  let settle = () => {};
  let over = false;
  const done = new Promise((/** @type {(v: "reached" | "stopped") => void} */ resolve) => {
    settle = (v) => {
      if (over) return;
      over = true;
      if (timer) clearTimeout(timer);
      resolve(v);
    };
  });
  const step = () => {
    if (over) return;
    const left = at - now();
    if (left <= 0) return settle("reached");
    o.tick?.(left);
    // Each second in the last minute, else twice a minute; never one long timer, which a sleep would stretch.
    timer = setTimeout(step, left <= 60_000 ? Math.min(left, 1000) : Math.min(left - 60_000, 30_000) || 1000);
  };
  step();
  return { done, stop: () => settle("stopped") };
}

/** What the agent is sent when the turn that stopped had already begun. */
export const RESUME_PROMPT = "Your last turn stopped part-way: the plan's allowance had run out. It has reset now. Look at what you had already done (the conversation above, and the folder), and carry on from there — do not start the task again from the beginning, and do not repeat a step that is already done.";
