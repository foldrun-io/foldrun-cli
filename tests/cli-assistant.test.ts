// `foldrun assistant` (and `foldrun ai`): the dashboard's assistant from a
// terminal — one POST …/assistant with the message, the reply and what it
// read printed, proposals shown as diffs with what the check finds, and
// saved through PUT …/source with ifMatch only when asked (--yes; never on
// --dry-run, never on a pipe without --yes).
//
//   node --test tests/cli-assistant.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const REPLY = {
  ok: true,
  reply: "A skill is procedure an agent follows when a task matches [tools › Skills — procedure, not capability].",
  files: [{ path: "skills/house-style/SKILL.md", content: "---\nname: house-style\ndescription: How we write.\n---\n\nShort.\n", before: null, sha256: null }],
  issues: [{ where: "skills/house-style/SKILL.md", message: "a warning to show", level: "warn" }],
  sources: [{ doc: "tools", section: "Skills — procedure, not capability", url: "/dashboard/docs/tools#skills-procedure-not-capability" }],
  supply: "platform",
};

test("asks once, prints the reply, what it read and the proposal; a pipe without --yes saves nothing", async () => {
  const s = await serve({ "/api/workspaces/desk/assistant": () => REPLY });
  const r = await at(s.url, "assistant", "turn", "our", "house", "style", "into", "a", "skill", "--to", "desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  const post = s.seen.find((x) => x.url === "/api/workspaces/desk/assistant")!;
  assert.equal(post.method, "POST");
  assert.deepEqual(JSON.parse(post.body), { messages: [{ role: "user", content: "turn our house style into a skill" }], files: [] });
  assert.match(r.out, /A skill is procedure/);
  assert.match(r.out, /read: tools › Skills — procedure, not capability/);
  assert.match(r.out, /skills\/house-style\/SKILL\.md/);
  assert.match(r.out, /warn\s+skills\/house-style\/SKILL\.md\s+a warning to show/);
  assert.match(r.out, /nothing saved/);
  assert.ok(!s.seen.some((x) => x.method === "PUT"), "nothing written without --yes");
});

test("--yes saves each file through the source PUT with ifMatch", async () => {
  const s = await serve({ "/api/workspaces/desk/assistant": () => REPLY, "PUT /api/workspaces/desk/source": () => ({ ok: true }) });
  const r = await at(s.url, "ai", "make it a skill", "--to", "desk", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  const put = s.seen.find((x) => x.method === "PUT")!;
  const body = JSON.parse(put.body);
  assert.equal(body.path, "skills/house-style/SKILL.md");
  assert.equal(body.ifMatch, null, "a new file expects none there");
  assert.match(body.message, /^written with the assistant: make it a skill/);
  assert.match(r.out, /✓ skills\/house-style\/SKILL\.md/);
});

test("--dry-run never saves; a plain question with no files exits 0", async () => {
  const s = await serve({ "/api/workspaces/desk/assistant": () => REPLY });
  const dry = await at(s.url, "assistant", "make it", "--to", "desk", "--dry-run", "--yes");
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /--dry-run: nothing saved/);
  assert.ok(!s.seen.some((x) => x.method === "PUT"));
  s.close();

  const q = await serve({ "/api/workspaces/desk/assistant": () => ({ ...REPLY, files: [], issues: [] }) });
  const r = await at(q.url, "assistant", "how do skills work?", "--to", "desk");
  q.close();
  assert.equal(r.code, 0, r.out);
});

test("--json prints the platform's answer as it came", async () => {
  const s = await serve({ "/api/workspaces/desk/assistant": () => REPLY });
  const r = await at(s.url, "assistant", "x", "--to", "desk", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(r.out.slice(r.out.indexOf("{"))), REPLY);
});

test("no message and no terminal is refused before any request", async () => {
  const s = await serve({ "/api/workspaces/desk/assistant": () => REPLY });
  const r = await at(s.url, "assistant", "--to", "desk");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /needs a terminal/);
  assert.ok(!s.seen.some((x) => x.url.endsWith("/assistant")));
});

test("a refusal is the platform's sentence", async () => {
  const s = await serve({ "/api/workspaces/desk/assistant": () => ({ __status: 402, body: { error: "the wallet is empty" } }) });
  const r = await at(s.url, "assistant", "hello", "--to", "desk");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /the wallet is empty/);
});

const WS_REPLY = { ...REPLY, files: [], issues: [], workspace: { name: "ads-desk", purpose: "Runs the ad accounts." }, usage: { inputTokens: 12_400, outputTokens: 900, costUsd: 0.2 }, chargedUsd: 0.31 };

test("a proposed workspace is created blank on --yes, never over one that exists; tokens and the charge are shown", async () => {
  const s = await serve({
    "/api/workspaces/desk/assistant": () => WS_REPLY,
    "POST /api/workspaces": () => ({ ok: true, name: "ads-desk" }),
  });
  const r = await at(s.url, "assistant", "a separate desk for ads", "--to", "desk", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /new workspace ads-desk — Runs the ad accounts\./);
  assert.match(r.out, /12\.4k tokens in · 900 out · \$0\.31 charged/);
  const post = s.seen.find((x) => x.method === "POST" && x.url === "/api/workspaces")!;
  assert.deepEqual(JSON.parse(post.body), { name: "ads-desk", template: true, ifAbsent: true });
  assert.match(r.out, /foldrun assistant --to ads-desk/);

  // The server's 409 (ifAbsent) is the refusal: it is atomic, a list first is not.
  const exists = await serve({
    "/api/workspaces/desk/assistant": () => WS_REPLY,
    "POST /api/workspaces": () => ({ __status: 409, body: { error: "a workspace called ads-desk exists — nothing was changed" } }),
  });
  const e = await at(exists.url, "assistant", "again", "--to", "desk", "--yes");
  exists.close();
  assert.equal(e.code, 1, e.out);
  assert.match(e.out, /exists — nothing created/);
});

test("a proposed workspace on a pipe without --yes creates nothing", async () => {
  const s = await serve({ "/api/workspaces/desk/assistant": () => WS_REPLY, "POST /api/workspaces": () => ({ ok: true }) });
  const r = await at(s.url, "assistant", "a desk for ads", "--to", "desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no workspace created/);
  assert.ok(!s.seen.some((x) => x.method === "POST" && x.url === "/api/workspaces"));
});

const CONV = { id: "c_abc123def45", workspace: "desk", title: "how do flows work?", updatedAt: new Date().toISOString(), messages: 2, unsaved: 1 };

test("history lists your kept conversations, searched with --q", async () => {
  const s = await serve({ "/api/assistant/conversations": () => ({ conversations: [CONV] }) });
  const r = await at(s.url, "assistant", "history", "--q", "flows");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen[0].query.get("q"), "flows");
  assert.match(r.out, /c_abc123def45\s+desk/);
  assert.match(r.out, /how do flows work\?/);
  assert.match(r.out, /1 unsaved/);
});

test("show prints one whole; rm deletes it on --yes", async () => {
  const s = await serve({
    "GET /api/assistant/conversations/c_abc123def45": () => ({ ...CONV, messages: [{ role: "user", content: "how do flows work?" }, { role: "assistant", content: "A numbered list." }], files: [] }),
    "DELETE /api/assistant/conversations/c_abc123def45": () => ({ ok: true }),
  });
  const show = await at(s.url, "assistant", "show", "c_abc123def45");
  assert.equal(show.code, 0, show.out);
  assert.match(show.out, /A numbered list\./);
  const rm = await at(s.url, "assistant", "rm", "c_abc123def45", "--yes");
  s.close();
  assert.equal(rm.code, 0, rm.out);
  assert.ok(s.seen.some((x) => x.method === "DELETE"));
});

test("--conversation carries a kept one on: its messages go back, its id rides along", async () => {
  const s = await serve({
    "GET /api/assistant/conversations/c_abc123def45": () => ({ ...CONV, messages: [{ role: "user", content: "how do flows work?" }, { role: "assistant", content: "A numbered list." }], files: [] }),
    "/api/workspaces/desk/assistant": () => ({ ...REPLY, files: [], issues: [], conversation: "c_abc123def45" }),
  });
  const r = await at(s.url, "assistant", "and in parallel?", "--conversation", "c_abc123def45");
  s.close();
  assert.equal(r.code, 0, r.out);
  const post = JSON.parse(s.seen.find((x) => x.url === "/api/workspaces/desk/assistant")!.body);
  assert.equal(post.conversation, "c_abc123def45");
  assert.deepEqual(post.messages.map((m: { content: string }) => m.content), ["how do flows work?", "A numbered list.", "and in parallel?"]);
  assert.match(r.out, /kept as c_abc123def45/);
});
