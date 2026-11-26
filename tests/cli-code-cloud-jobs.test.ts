// Cloud jobs (FOL-382, owner 26 Nov 2026: "it should be dynamic as cloud can
// handle multiple pods, and though the cap is 4 it ran only 1"): one call takes
// a list on both paths, the platform's room is the limit, the call answers at
// once and the results come back summary first. The turn itself is in
// cli-code-session.test.ts; these are the parts that need no terminal.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CLOUD_JOBS_CEILING, cloudTasks, cloudJobsInput, cloudRoomText, cloudEstimate, cloudAskLine, cloudStartedText, cloudNewsBlock, cloudNewsText, cloudStillRunningText,
} from "../src/code-cloud-jobs.mjs";

const cloud = { agents: ["coder", "researcher"], own: "coder" };
const many = (n: number) => Array.from({ length: n }, (_, i) => `task ${i + 1}`);

test("cloudTasks: a list of many tasks, up to the runaway guard; an empty or too long one is refused", () => {
  assert.equal(CLOUD_JOBS_CEILING, 16, "a guard, well above the old 4");
  assert.deepEqual(cloudTasks({ tasks: many(10) }).tasks, many(10));
  assert.equal(cloudTasks({ tasks: many(16) }).tasks?.length, 16);
  assert.match(String(cloudTasks({ tasks: many(17) }).error), /at most 16 jobs \(a guard against a runaway loop, not the platform's limit\)[\s\S]*another call/);
  assert.match(String(cloudTasks({ tasks: [] }).error), /needs tasks/);
  assert.match(String(cloudTasks({ tasks: ["a", " "] }).error), /none empty/);
  assert.match(String(cloudTasks({ tasks: ["x".repeat(20_001)] }).error), /under 20000/);
});

test("cloudJobsInput: folder: false takes a list too, as one of the project's agents; wait goes alone", () => {
  const off = cloudJobsInput({ folder: false, tasks: many(5), agent: "researcher", description: "load\ttest" }, cloud);
  assert.deepEqual(off, { folder: false, tasks: many(5), agent: "researcher", description: "load test" });
  assert.equal((cloudJobsInput({ folder: false, tasks: many(3) }, cloud) as any).agent, "coder", "the session's agent by default");
  assert.match((cloudJobsInput({ folder: false, tasks: ["a"], agent: "nobody" }, cloud) as any).problem, /agent: one of coder, researcher/);
  assert.match((cloudJobsInput({ folder: false, tasks: ["a"] }, null) as any).problem, /project has none/);
  assert.match((cloudJobsInput({ folder: false, tasks: ["a\u0007"] }, cloud) as any).problem, /plain text/);
  assert.deepEqual(cloudJobsInput({ tasks: many(8) }, cloud), { folder: true, tasks: many(8), agent: null, description: "" });
  assert.match((cloudJobsInput({ folder: "no", tasks: ["a"] }, cloud) as any).problem, /folder must be true or false/);
  assert.deepEqual(cloudJobsInput({ wait: true }, cloud), { wait: true });
  assert.match((cloudJobsInput({ wait: true, tasks: ["a"] }, cloud) as any).problem, /goes alone/);
  assert.match((cloudJobsInput({ wait: false }, cloud) as any).problem, /wait is true/);
});

test("the tool the model is offered: many tasks on both paths, a wait, and words that say to split work for parallel asks", async () => {
  const { cloudJobsTool } = await import("../src/commands.mjs");
  const tool = cloudJobsTool({ agents: ["coder"], own: "coder", project: "desk" });
  const props = (tool.schema as any).properties;
  assert.equal(props.tasks.maxItems, 16);
  assert.equal(props.wait.type, "boolean");
  assert.equal((tool.schema as any).required, undefined, "a wait names no tasks");
  assert.doesNotMatch(tool.description, /one task per call|Up to 4|make small changes yourself/);
  assert.match(tool.description, /answers at once/);
  assert.match(tool.description, /parallel, for many agents, or to see how the cloud acts under load, split the work into independent, self-contained tasks and start them together in one call/);
  assert.match(tool.description, /Without the folder \(folder: false\): each task runs/);
  assert.match(tool.description, /They start without asking the person\./);
  assert.match(cloudJobsTool(null, true).description, /asked to be asked before cloud jobs start/);
});

test("cloudRoomText: the account's room from GET /v1/account/usage/compute; a job past it waits, never refused", () => {
  const said = cloudRoomText({ compute: { vcpu: 16, stepVcpu: 2 }, inUse: { vcpu: 6, steps: 3 }, waiting: [{}, {}], runsWaiting: { waiting: 0, limit: 50 } });
  assert.match(said, /3 steps running on the account, holding 6 of its 16 vCPU; room for about 5 more steps of the largest size to start now; 2 waiting for room\./);
  assert.match(said, /waits its turn and starts when there is room \(up to 50 runs may wait/);
  assert.match(cloudRoomText({ inUse: { steps: 1 } }), /^The platform now: 1 step running on the account\. A job past the room waits its turn/);
  assert.equal(cloudRoomText(null), "");
});

test("the batch question: how many, where, and the credits as a guess from this session's jobs — never a made-up number", () => {
  assert.match(cloudEstimate([], 5), /known only as it runs/);
  assert.match(cloudEstimate([0.1, 0.3], 5), /about \$1\.00 if they cost what this session's 2 earlier cloud jobs did on average \(\$0\.20 each\); a guess/);
  assert.equal(
    cloudAskLine({ n: 3, folder: false, ws: "desk", host: "api.foldrun.dev", agent: "researcher", estimate: "E" }),
    "3 cloud jobs, side by side in desk on api.foldrun.dev as its agent researcher, with that agent's own tools — only the text below is sent, no file of this folder — E",
  );
  assert.match(cloudAskLine({ n: 1, folder: true, ws: "desk", host: "h", agent: "coder", estimate: "E" }), /^1 cloud job: sends a copy of this folder to desk on h and runs coder there — E$/);
});

test("cloudStartedText: the run ids at once, what was not started and why, and how the results come", () => {
  const text = cloudStartedText({
    started: [{ n: 1, id: "run-1", task: "one" }, { n: 2, id: "run-2", task: "two" }],
    refused: [{ n: 3, task: "three", why: "the account's waiting line is full" }],
    unsure: false, room: "The platform now: 1 step running.", folder: false, running: 2, ws: "desk",
  });
  assert.match(text, /^Started 2 cloud jobs; they run on the platform while you go on:\n#1 run run-1 — one\n#2 run run-2 — two\nNot started \(1\):\n#3 — three: the account's waiting line is full/);
  assert.match(text, /The platform now: 1 step running\./);
  assert.match(text, /result comes to you here as it finishes[\s\S]*wait: true/);
  assert.doesNotMatch(text, /into the folder/, "no folder: nothing comes back into it");
});

test("cloud results: sixteen long reports come in bounded blocks, summary first; what became of each patch is never cut, and none is dropped", () => {
  const done = Array.from({ length: 16 }, (_, i) => ({ n: i + 1, id: `run-${i + 1}`, task: `task ${i + 1}`, status: "completed", cost: 0.05, reply: `report ${i + 1} `.repeat(2_000), outcome: i % 2 ? "put into the folder" : "not put in: the person said no", changes: `It changed a.txt. ${i % 2 ? "Put into the folder" : "Not put into the folder: the person said no"} — decision ${i + 1}.` }));
  const first = cloudNewsBlock(done, { running: 4, ws: "desk" });
  assert.equal(first.used, 10);
  assert.ok(first.text.length <= 18_000, `under the engine's 20,000 cut: ${first.text.length}`);
  const lines = first.text.split("\n");
  assert.equal(lines[0], "[cloud jobs: 10 finished (6 more finished, in the next message), 4 still running]");
  for (let i = 1; i <= 10; i++) assert.equal(lines[i], `#${i} run run-${i}: completed, $0.05 — ${i % 2 ? "not put in: the person said no" : "put into the folder"}`);
  for (let i = 1; i <= 10; i++) assert.match(first.text, new RegExp(`decision ${i}\\.`), `#${i}'s decision is whole`);
  assert.match(first.text, /\[report cut — foldrun report run-1 --to desk has all of it\]/);
  const rest = cloudNewsBlock(done.slice(first.used), { running: 4, ws: "desk" });
  assert.equal(rest.used, 6);
  assert.match(rest.text, /^\[cloud jobs: 6 finished, 4 still running\]/);
  const all = cloudNewsText(done, { running: 0, ws: "desk" });
  for (let i = 1; i <= 16; i++) assert.equal(all.split(`--- #${i} (run run-${i})`).length, 2, `#${i} once`);
  assert.deepEqual(cloudNewsBlock([], { running: 0, ws: "desk" }), { text: "", used: 0 });
  // A long file list is cut in its middle; the decision and the kept patch's path stay.
  const long = cloudNewsBlock([{ n: 1, id: "run-1", task: "t", status: "completed", cost: 0.01, reply: "r", outcome: "partly put into the folder (1 of 300 files)", changes: `It changed ${Array.from({ length: 300 }, (_, i) => `f${i}.ts`).join(", ")}. Put in: f0.ts. Refused: the rest. The whole patch is kept at /tmp/p-run-1.patch.` }], { running: 0, ws: "desk" });
  assert.match(long.text, /It changed f0\.ts, [^\n]* … [^\n]*The whole patch is kept at \/tmp\/p-run-1\.patch\./);
  assert.match(cloudStillRunningText(3), /3 still running[\s\S]*wait: true/);
});

test("the choice to be asked first is kept with the person's code prefs, and nothing else is changed", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  const was = process.env.FOLDRUN_HOME;
  process.env.FOLDRUN_HOME = home;
  try {
    const { readCodePrefs, writeCodePrefs } = await import("../src/code-session.mjs");
    assert.equal(readCodePrefs().cloudAsk, undefined, "unasked by default");
    assert.ok(writeCodePrefs({ jobs: false, cloudAsk: true }));
    assert.deepEqual(readCodePrefs(), { jobs: false, cloudAsk: true });
    fs.writeFileSync(path.join(home, "code-prefs.json"), JSON.stringify({ cloudAsk: "yes" }));
    assert.equal(readCodePrefs().cloudAsk, undefined, "only true is read");
  } finally {
    if (was === undefined) delete process.env.FOLDRUN_HOME;
    else process.env.FOLDRUN_HOME = was;
  }
});
