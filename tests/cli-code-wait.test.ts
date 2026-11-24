// Waiting for the allowance to reset, in the open session (FOL-252): the helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { waitLeft, waitAnswer, waitUntil } from "../src/code-wait.mjs";

test("how long is left, in the two largest units", () => {
  assert.equal(waitLeft(0), "0s");
  assert.equal(waitLeft(11_200), "12s");
  assert.equal(waitLeft(200_000), "3m 20s");
  assert.equal(waitLeft(2 * 3600_000 + 14 * 60_000), "2h 14m");
  assert.equal(waitLeft(2 * 86_400_000 + 3 * 3600_000 + 5000), "2d 3h");
  assert.equal(waitLeft(-5), "0s");
});

test("the answer to the wait: a yes, alone or with a ceiling in dollars; anything else is a no", () => {
  assert.deepEqual(waitAnswer("y"), {});
  assert.deepEqual(waitAnswer(" Yes "), {});
  assert.deepEqual(waitAnswer("y 2"), { ceilingUsd: 2 });
  assert.deepEqual(waitAnswer("y $2.50"), { ceilingUsd: 2.5 });
  for (const no of ["", "n", "no", "2", "y 0", "y -1", "y two", "y 1e3", "y 99999", "yy"]) assert.equal(waitAnswer(no), null, no);
});

test("the wait ends at the moment, by the clock, or when it is stopped — once", async () => {
  const ticks: number[] = [];
  const w = waitUntil(Date.now() + 1200, { tick: (left) => ticks.push(left) });
  assert.equal(await w.done, "reached");
  assert.ok(ticks.length >= 2 && ticks[0] > ticks.at(-1)!, "it says how long is left as it goes");
  w.stop(); // after the end: nothing
  const s = waitUntil(Date.now() + 60_000);
  setTimeout(() => s.stop(), 20);
  assert.equal(await s.done, "stopped");
  assert.equal(await waitUntil(Date.now() - 5).done, "reached");
  // A clock that jumped (the computer slept): the next look sees the moment has passed.
  let now = 1000;
  const j = waitUntil(1500, { now: () => now });
  now = 9000;
  assert.equal(await j.done, "reached");
});
