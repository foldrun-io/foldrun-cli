// FOL-54 step 4: `foldrun report` shows what a run recorded of itself — the
// revision it ran, its queue time, each model call (--calls), and one tool
// call's input and output (`report <run> call <id>`).
//
//   node --test tests/cli-capture.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const run = {
  id: "run-cap", flow: "daily", status: "completed", startedAt: "2026-10-19T00:00:00.000Z", finishedAt: "2026-10-19T00:02:00.000Z",
  drivenAt: "2026-10-19T00:00:12.000Z", revision: "abc1234def",
  steps: [{
    agent: "writer", group: 1, status: "completed", events: [
      { t: "2026-10-19T00:00:20.000Z", type: "tool", text: "Read", call: "toolu_1", captured: true },
      { t: "2026-10-19T00:00:21.000Z", type: "tool", text: "Read", call: "toolu_1", ms: 900, captured: true },
    ],
    calls: [
      { id: "msg_1", n: 1, at: "2026-10-19T00:00:19.000Z", ms: 4000, model: "claude-x", stop: "tool_use", tokens: { input: 12000, output: 300, cacheRead: 9000, cacheWrite: 0 }, tools: 1 },
      { id: "msg_2", n: 2, at: "2026-10-19T00:00:30.000Z", ms: 2000, model: "claude-x", stop: "end_turn", tokens: { input: 12500, output: 200, cacheRead: 12000, cacheWrite: 0 }, tools: 0 },
    ],
  }],
};

test("report: revision and queue time; one model-call line; --calls lists each call and the recorded tool calls", async () => {
  const s = await serve({ "/api/workspaces/blog-desk/runs/run-cap": () => run });
  const plain = await at(s.url, "report", "run-cap", "--to", "blog-desk");
  const full = await at(s.url, "report", "run-cap", "--to", "blog-desk", "--calls");
  s.close();
  assert.equal(plain.code, 0, plain.out);
  assert.match(plain.out, /ran on abc1234 · queued 12s/);
  assert.match(plain.out, /2 model calls · slowest 4s · largest 12,500 in/);
  assert.doesNotMatch(plain.out, /end_turn/);
  assert.match(full.out, /1\. claude-x · 4s · 12,000 in \(75% cached\) · 300 out · tool_use · 1 tool/);
  assert.match(full.out, /→ Read {2}toolu_1/);
});

test("report <run> call <id> prints its input and output, saying when it was cut", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/runs/run-cap/calls/toolu_1": () => ({ call: { id: "toolu_1", tool: "Read", input: '{"file_path":"a.txt"}', inputChars: 21, output: "hello", outputChars: 90000, truncated: true, outputCut: true } }),
  });
  const r = await at(s.url, "report", "run-cap", "call", "toolu_1", "--to", "blog-desk");
  const json = await at(s.url, "report", "run-cap", "call", "toolu_1", "--to", "blog-desk", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /input\n {4}\{"file_path":"a\.txt"\}/);
  assert.match(r.out, /output \(the first 5 of 90,000 characters\)\n {4}hello/);
  assert.match(json.out, /"outputChars": 90000/);
});

test("report --tree prints the run as one tree and marks what went wrong (FOL-72 step 5)", async () => {
  const tree = {
    id: "run", kind: "run", label: "daily", start: 0, end: 9000, status: "error", children: [
      { id: "s0", kind: "step", label: "writer", start: 0, end: 9000, status: "error", step: 0, children: [
        { id: "s0/m1", kind: "model", label: "haiku", start: 0, end: 3000, status: "ok", stop: "tool_use", tokens: { input: 12000, output: 140, cacheRead: 9000, cacheWrite: 0 }, children: [
          { id: "s0/t:toolu_1", kind: "tool", label: "Bash", start: 1000, end: 2500, status: "error", call: "toolu_1", captured: true, children: [] },
        ] },
        { id: "s0/e3", kind: "error", label: "error", start: 2600, end: 2600, status: "error", text: "Bash: exit 1", children: [] },
      ] },
    ],
  };
  const s = await serve({ "/api/workspaces/blog-desk/runs/run-cap/trace": () => ({ tree, failure: ["run", "s0", "s0/m1", "s0/t:toolu_1"] }) });
  const r = await at(s.url, "report", "run-cap", "--to", "blog-desk", "--tree");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /▣ daily/);
  assert.match(r.out, /├ ✦ haiku {2}12\.0k in · 140 out · tool_use/);
  assert.equal(r.out.match(/what went wrong/g)?.length, 1, "only the deepest failure is pointed at");
  assert.match(r.out, /→ Bash {2}toolu_1 {2}1(\.5)?s {2}← what went wrong/);
  assert.match(r.out, /✗ Bash: exit 1/);
});

test("report --compare shows what differs from the last good run; rerun --instruction sends it (FOL-72 step 6)", async () => {
  const comparison = {
    base: { id: "run-good", status: "completed", startedAt: "", revision: "r1" },
    run: { id: "run-cap", status: "failed", startedAt: "", revision: "r2" },
    revisionChanged: true,
    changedFiles: ["agents/writer/agent.md"],
    steps: [
      { step: 1, agent: "researcher", base: {}, run: {}, changes: [] },
      { step: 2, agent: "writer", base: {}, run: {}, changes: ["status: completed → failed", "tools: +web ×3"] },
    ],
  };
  const s = await serve({
    "/api/workspaces/blog-desk/runs/run-cap/compare": (_b, q) => ({ comparison, chosen: q.get("with") ? "named" : "last good" }),
    "POST /api/workspaces/blog-desk/runs/run-cap/rerun": () => ({ ok: true, runId: "run-new", from: "run-cap", steps: 2 }),
  });
  const r = await at(s.url, "report", "run-cap", "--to", "blog-desk", "--compare");
  const named = await at(s.url, "report", "run-cap", "--compare", "run-good", "--to", "blog-desk");
  const re = await at(s.url, "rerun", "run-cap", "--from", "2", "--instruction", "cite two sources", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /run-cap \(failed\) beside run-good \(last good, completed\)/);
  assert.match(r.out, /files changed between them: agents\/writer\/agent\.md/);
  assert.match(r.out, /step 2 · writer\n {4}• status: completed → failed\n {4}• tools: \+web ×3/);
  assert.doesNotMatch(r.out, /step 1 · researcher/, "an unchanged step is not listed");
  assert.match(named.out, /\(named, completed\)/);
  assert.equal(s.seen.find((x) => x.method === "GET" && x.query.get("with"))?.query.get("with"), "run-good");
  assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "POST")!.body), { step: 2, instruction: "cite two sources" });
  assert.match(re.out, /with your instruction for that step/);
});
