// `foldrun answer`, `foldrun message`, and questions in `foldrun approvals`:
// a person in the loop of a running step, from the terminal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const QUESTIONS = {
  approvals: [],
  questions: [
    { kind: "question", id: "q_1", workspace: "blog-desk", runId: "run-9", flow: "publish", agent: "writer", question: "Publish at 9 or 10?", options: ["9 am", "10 am"], askedAt: new Date().toISOString() },
  ],
};

test("approvals lists a question an agent is asking, with its choices", async () => {
  const s = await serve({ "/api/approvals": () => QUESTIONS });
  const r = await at(s.url, "approvals");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /writer asks/);
  assert.match(r.out, /Publish at 9 or 10\?/);
  assert.match(r.out, /2\. 10 am/);
  assert.match(r.out, /foldrun answer/);
});

test("answer --option sends the chosen option to that run's question", async () => {
  const s = await serve({
    "/api/approvals": () => QUESTIONS,
    "POST /api/workspaces/blog-desk/runs/run-9/answer": (b) => ({ ok: true, question: "q_1", answer: JSON.parse(b).answer }),
  });
  const r = await at(s.url, "answer", "run-9", "--option", "2");
  s.close();
  assert.equal(r.code, 0, r.out);
  const post = s.seen.find((x) => x.method === "POST")!;
  assert.deepEqual(JSON.parse(post.body), { question: "q_1", answer: "10 am" });
  assert.match(r.out, /answered writer/);
});

test("answer in words; a run that is not asking says so", async () => {
  const s = await serve({
    "/api/approvals": () => QUESTIONS,
    "POST /api/workspaces/blog-desk/runs/run-9/answer": (b) => ({ ok: true, question: "q_1", answer: JSON.parse(b).answer }),
  });
  const words = await at(s.url, "answer", "run-9", "ten,", "after", "the", "report");
  const none = await at(s.url, "answer", "run-1", "yes");
  s.close();
  assert.equal(words.code, 0, words.out);
  assert.equal(JSON.parse(s.seen.find((x) => x.method === "POST")!.body).answer, "ten, after the report");
  assert.notEqual(none.code, 0);
  assert.match(none.out, /not asking anything/);
});

test("message posts to the running run in the workspace it lives in", async () => {
  const s = await serve({
    "POST /api/workspaces/blog-desk/runs/run-9/message": (b) => ({ ok: true, message: { text: JSON.parse(b).text } }),
  });
  const r = await at(s.url, "message", "run-9", "use", "the", "2025", "figures", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "POST")!.body), { text: "use the 2025 figures" });
  assert.match(r.out, /after its next tool call/);
});
