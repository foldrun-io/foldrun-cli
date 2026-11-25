// Session messages from the CLI (19 Nov 2026): `foldrun sessions send` and
// `foldrun sessions messages`, and `foldrun code` showing what waits for
// its conversation and including it in a turn only when asked.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { serve, at, raw } from "./fake-platform.ts";

const WS = "/v1/workspaces/desk";
const ID = "c".repeat(64);
const RUN_ID = "run-sm-1";
const MSG = `${WS}/sessions/code-me/messages`;

const waitingNote = {
  id: "sm-abc123",
  workspace: "desk",
  context: "code-me",
  from: "ana@example.com",
  sender: "user:u1",
  fromContext: "code-api",
  text: "the API now answers on /v2 — \u001b[31mred\u001b[0m \u202Eevil",
  at: "2026-11-19T01:00:00.000Z",
};

function repo(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cli-sm-"));
  const git = (...a: string[]) => execFileSync("git", ["-C", d, "-c", "user.email=t@t", "-c", "user.name=t", ...a]);
  git("init", "-q");
  fs.writeFileSync(path.join(d, "a.txt"), "a\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  return d;
}

function platform(waiting: unknown[]) {
  return serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 2, compressedBytes: 90, expiresAt: "x", reused: true }),
    [`POST ${WS}/agents/coder/run`]: (body) => ({ ok: true, runId: RUN_ID, snapshot: ID, context: "code-me", ...(JSON.parse(body).messages ? { messages: ["sm-abc123"], left: ["sm-x"] } : {}) }),
    [`GET ${WS}/runs/${RUN_ID}`]: () => ({
      id: RUN_ID,
      flow: "adhoc:coder",
      status: "completed",
      snapshot: { id: ID },
      startedAt: "2026-11-19T01:00:00.000Z",
      finishedAt: "2026-11-19T01:00:05.000Z",
      steps: [{ agent: "coder", group: 1, status: "completed", attempts: 1, costUsd: 0.01, events: [{ type: "text", text: "Done." }], result: "Done." }],
    }),
    [`GET ${WS}/runs/${RUN_ID}/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "unchanged" }), "application/json") : raw("", "text/x-diff")),
    [`GET ${MSG}`]: (_b, q) => ({ context: "code-me", messages: q.get("waiting") === "1" ? waiting : [...waiting, { ...waitingNote, id: "sm-old", run: "run-0" }] }),
    [`POST ${WS}/sessions/code-other/messages`]: (body) => ({ ok: true, message: { ...waitingNote, id: "sm-new", context: "code-other", text: JSON.parse(body).text } }),
  });
}

test("sessions send: posts the text (and --from) to the conversation; says it waits", async () => {
  const s = await platform([]);
  const r = await at(s.url, "sessions", "send", "code-other", "the", "build", "is", "green", "--from", "code-me", "--to", "desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  const post = s.seen.find((x) => x.method === "POST" && x.url === `${WS}/sessions/code-other/messages`)!;
  assert.deepEqual(JSON.parse(post.body), { text: "the build is green", from: "code-me" });
  assert.match(r.out, /sent to code-other/);
  assert.match(r.out, /waits until that conversation's person includes it/);
});

test("sessions messages: lists who sent what, waiting or used; --waiting asks for waiting only; no terminal control from a sender", async () => {
  const s = await platform([waitingNote]);
  const all = await at(s.url, "sessions", "messages", "code-me", "--to", "desk");
  const waiting = await at(s.url, "sessions", "messages", "code-me", "--waiting", "--to", "desk");
  s.close();
  assert.equal(all.code, 0, all.out);
  assert.match(all.out, /ana@example\.com/);
  assert.match(all.out, /in run-0/);
  assert.match(all.out, /waiting/);
  assert.doesNotMatch(all.out, /\u001b\[31m/, "a sender's escape codes are not passed to the terminal");
  assert.doesNotMatch(all.out, /\u202E/, "nor direction controls that would make the preview read differently");
  const reads = s.seen.filter((x) => x.method === "GET" && x.url === MSG);
  assert.equal(reads[0]!.query.get("waiting"), null);
  assert.equal(reads[1]!.query.get("waiting"), "1");
  assert.doesNotMatch(waiting.out, /run-0/);
});

test("sessions messages --with: the thread with another conversation, both ways, oldest first; --sent: what it sent (FOL-307)", async () => {
  const thread = [
    { id: "sm-1", workspace: "desk", context: "code-api", from: "ana", sender: "user:u1", fromContext: "code-me", text: "what changed in the API?", at: "2026-11-25T01:00:00.000Z", usedLocally: true, direction: "out" },
    { id: "sm-2", workspace: "desk", context: "code-me", from: "bo", sender: "user:u2", fromContext: "code-api", text: "the routes moved to /v2.\n\nTests are green. \u001b[31mred\u001b[0m", at: "2026-11-25T01:05:00.000Z", direction: "in" },
  ];
  const s = await serve({
    [MSG]: (_b, q) => (q.get("with") === "code-api" ? { context: "code-me", with: "code-api", messages: thread } : q.get("sent") === "1" ? { context: "code-me", messages: [{ ...thread[0], direction: undefined }] } : { context: "code-me", messages: [] }),
  });
  const r = await at(s.url, "sessions", "messages", "code-me", "--with", "code-api", "--to", "desk");
  const sent = await at(s.url, "sessions", "messages", "code-me", "--sent", "--to", "desk");
  const none = await at(s.url, "sessions", "messages", "code-me", "--with", "code-x", "--to", "desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /code-me and code-api · 2 messages, oldest first/);
  assert.match(r.out, /→ you to code-api · 01:00 · code-api read it in a turn\n\s+what changed in the API\?/);
  assert.match(r.out, /← code-api \(bo\) · 01:05 · waiting for you\n\s+the routes moved to \/v2\.\n\n\s+Tests are green\./);
  assert.ok(r.out.indexOf("what changed") < r.out.indexOf("routes moved"), "oldest first");
  assert.doesNotMatch(r.out, /\u001b\[31m/);
  assert.match(sent.out, /→ you to code-api/);
  assert.match(none.out, /nothing between code-me and code-x yet/);
  const q = s.seen.filter((x) => x.url === MSG).map((x) => x.query.toString());
  assert.deepEqual(q, ["with=code-api", "sent=1", "with=code-x"]);
});

test("sessions: a wrong call says how to use it", async () => {
  const s = await platform([]);
  const r = await at(s.url, "sessions", "send", "--to", "desk");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /foldrun sessions send <conversation>/);
});

test("code --task: waiting messages are shown and NOT included unless --include-messages (--yes is not consent to read them)", async () => {
  const d = repo();
  const s = await platform([waitingNote]);
  const r = await at(s.url, "code", d, "--to", "desk", "--context", "code-me", "--task", "go on", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 message from other sessions/);
  assert.match(r.out, /--include-messages includes them/);
  const run = s.seen.find((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run"))!;
  assert.equal(JSON.parse(run.body).messages, undefined);
});

test("code --task --include-messages: the waiting ones go in the turn by id", async () => {
  const d = repo();
  const s = await platform([waitingNote]);
  const r = await at(s.url, "code", d, "--to", "desk", "--context", "code-me", "--task", "go on", "--yes", "--include-messages");
  s.close();
  assert.equal(r.code, 0, r.out);
  const run = s.seen.find((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run"))!;
  assert.deepEqual(JSON.parse(run.body).messages, ["sm-abc123"]);
  assert.equal(JSON.parse(run.body).context, "code-me");
  assert.match(r.out, /1 message did not fit in this turn — it waits for the next/);
});

test("code --task: nothing waiting, nothing said, no messages field", async () => {
  const d = repo();
  const s = await platform([]);
  const r = await at(s.url, "code", d, "--to", "desk", "--context", "code-me", "--task", "go on", "--yes", "--include-messages");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /from other sessions/);
  const run = s.seen.find((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run"))!;
  assert.equal(JSON.parse(run.body).messages, undefined);
});


test("sessions with no verb: the project's conversations, newest first; --json; nothing from a summary reaches the terminal as control (FOL-236)", async () => {
  const list = [
    { context: "code-b", turns: 3, agent: "coder", lastAt: "2026-11-24T10:00:00.000Z", lastStatus: "completed", lastRun: "r3", startedBy: "user:u1", lastSummary: "fixed \u001b[31mthe\u001b[0m test" },
    { context: "code-a", turns: 1, agent: "coder", lastAt: "2026-11-23T10:00:00.000Z", lastStatus: "failed", lastRun: "r1", startedBy: null, lastSummary: null },
  ];
  const s = await serve({ [`GET ${WS}/sessions`]: () => ({ sessions: list }) });
  const r = await at(s.url, "sessions", "--to", "desk", "--limit", "5");
  const j = await at(s.url, "sessions", "--to", "desk", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.indexOf("code-b") < r.out.indexOf("code-a"));
  assert.match(r.out, /3 turns · coder · completed · 2026-11-24 10:00/);
  assert.match(r.out, /foldrun code --context <id>/);
  assert.doesNotMatch(r.out, /\u001b\[31m/);
  assert.equal(s.seen.find((x) => x.url === `${WS}/sessions`)!.query.get("limit"), "5");
  assert.deepEqual(JSON.parse(j.out.slice(j.out.indexOf("["))).map((x: any) => x.context), ["code-b", "code-a"]);
});

test("a message a turn on a computer used reads so in the list, not as waiting (FOL-236)", async () => {
  const s = await platform([]);
  s.close();
  const s2 = await serve({ [`GET ${MSG}`]: () => ({ context: "code-me", messages: [{ ...waitingNote, id: "sm-l", usedLocally: true, usedAt: "2026-11-24T00:00:00.000Z" }] }) });
  const r = await at(s2.url, "sessions", "messages", "code-me", "--to", "desk");
  s2.close();
  assert.match(r.out, /used in a turn on a computer/);
  assert.doesNotMatch(r.out, /waiting/);
});
