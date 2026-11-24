// /search and `foldrun sessions search` (FOL-250): the list of the
// conversations kept on this computer, and the search over their full text.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listConversation, listedConversations, conversationPieces, searchWords, searchConversations } from "../src/code-search.mjs";

const CONVERSATION = [
  { role: "user", content: "run the build please" },
  { role: "assistant", content: [{ type: "thinking", thinking: "SECRET-THOUGHT", signature: "s" }, { type: "text", text: "Running it." }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "npm run build", timeout: 5 } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "> build\nerror TS2304: Cannot find name 'frobnicate'.\nexit 2" }] },
  { role: "assistant", content: [{ type: "text", text: "The build fails: a name is missing." }] },
  { role: "user", content: [{ type: "text", text: "fix it" }] },
  { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "src/a.ts" } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "const x = frobnicate();" }, { type: "image", source: {} }] }] },
];

test("a conversation reads as pieces by who and turn; a tool's result is not a new turn, and thinking is never among them", () => {
  const p = conversationPieces(CONVERSATION);
  assert.deepEqual(p.map((x) => [x.turn, x.who]), [[1, "you"], [1, "agent"], [1, "tool call"], [1, "tool output"], [1, "agent"], [2, "you"], [2, "tool call"], [2, "tool output"]]);
  // A tool call: its name, a string argument as it is, another as JSON.
  assert.equal(p[2].text, "Bash\nnpm run build\ntimeout: 5");
  assert.equal(p.some((x) => x.text.includes("SECRET-THOUGHT")), false);
  // A message sent in while a tool ran is beside its result: the same turn.
  assert.deepEqual(conversationPieces([{ role: "user", content: "go" }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "out" }, { type: "text", text: "also this" }] }, { role: "user", content: "next" }]).map((x) => x.turn), [1, 1, 1, 2]);
  assert.deepEqual(conversationPieces("nope"), []);
  assert.deepEqual(conversationPieces([null, { role: "user" }, { role: "user", content: 7 }]), []);
});

test("the words: lower-cased, a quoted phrase is one, at most eight", () => {
  assert.deepEqual(searchWords('TS2304 "Cannot find" ts2304'), ["ts2304", "cannot find"]);
  assert.deepEqual(searchWords("  "), []);
  assert.equal(searchWords("a b c d e f g h i j").length, 10, "every word: none is dropped");
});

test("a search finds a line that appeared only in tool output, says its conversation and turn, and keeps to the conversations asked for", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-search-"));
  const was = process.env.FOLDRUN_HOME;
  process.env.FOLDRUN_HOME = home;
  try {
    const dir = path.join(home, "code-engine");
    fs.mkdirSync(dir, { recursive: true });
    const a = `${"a".repeat(64)}.json`;
    const b = `${"b".repeat(64)}.json`;
    fs.writeFileSync(path.join(dir, a), JSON.stringify(CONVERSATION));
    fs.writeFileSync(path.join(dir, b), JSON.stringify([{ role: "user", content: "nothing about it here\u001b[31m frobnicate \u0007later" }]));
    await listConversation(path.join(dir, a), { context: "code-a", ws: "desk", dir: "/work/one", url: "https://p", account: "acme", agent: "coder", localOnly: true, name: "the build" });
    await listConversation(b, { context: "code-b", ws: "desk", dir: "/work/two", url: "https://p" });
    // Not a conversation file's name: never listed. A listed one whose file is gone: not offered.
    await listConversation("../../etc/passwd", { context: "x", ws: "w", dir: "/", url: "u" });
    await listConversation(`${"c".repeat(64)}.json`, { context: "gone", ws: "desk", dir: "/work/three", url: "https://p" });
    assert.deepEqual(listedConversations().map((x) => x.context).sort(), ["code-a", "code-b"]);
    assert.equal(fs.statSync(path.join(home, "code-conversations.json")).mode & 0o077, 0);

    const hit = searchConversations(searchWords("ts2304 FROBNICATE"));
    assert.deepEqual(hit.hits.map((h) => [h.conversation.context, h.conversation.name, h.turn, h.who, h.line]), [["code-a", "the build", 1, "tool output", "error TS2304: Cannot find name 'frobnicate'."]]);
    assert.equal(hit.searched, 2);
    // One word: three places in one conversation, one in the other — whose line comes back without its control characters.
    const all = searchConversations(searchWords("frobnicate"));
    assert.equal(all.hits.filter((h) => h.conversation.context === "code-a").length, 2);
    assert.equal(all.hits.find((h) => h.conversation.context === "code-b")!.line, "nothing about it here[31m frobnicate later");
    assert.deepEqual(searchConversations(searchWords("frobnicate"), { only: (x) => x.dir === "/work/two" }).hits.map((h) => h.conversation.context), ["code-b"]);
    assert.equal(searchConversations(searchWords("frobnicate"), { perConversation: 1 }).more, true);
    assert.deepEqual(searchConversations([]).hits, []);
    assert.deepEqual(searchConversations(searchWords("secret-thought")).hits, []);
    // The name given later is kept when the file is written again without one.
    await listConversation(a, { context: "code-a", ws: "desk", dir: "/work/one", url: "https://p" });
    const again = listedConversations().find((x) => x.context === "code-a")!;
    assert.deepEqual([again.name, again.account, again.agent, again.localOnly], ["the build", "acme", "coder", true]);
    // A long line is cut around the word.
    fs.writeFileSync(path.join(dir, b), JSON.stringify([{ role: "user", content: `${"x".repeat(400)} needle ${"y".repeat(400)}` }]));
    const cut = searchConversations(searchWords("needle")).hits[0].line;
    assert.ok(cut.length <= 162 && cut.includes("needle") && cut.startsWith("…") && cut.endsWith("…"));
  } finally {
    if (was === undefined) delete process.env.FOLDRUN_HOME;
    else process.env.FOLDRUN_HOME = was;
  }
});
