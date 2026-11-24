// Token hints (FOL-262): which line each kind says, when it says nothing, once a session, and off.
import test from "node:test";
import assert from "node:assert/strict";
import { hintLine, giveHint, HINT_MIN_TOKENS, PASTE_TOKENS, BIG_TOKENS } from "../src/code-hints.mjs";

const price = { inputPerMTok: 3 };

test("hintLine: each kind names the size and its cost at the listed price, and the cheaper way; too small to matter says nothing", () => {
  assert.match(hintLine("break", { tokens: 40_000, price, minutes: 75 })!, /^back after 75 min: the cache has expired[\s\S]*about 40\.0k tokens \(~\$0\.12\)[\s\S]*\/compact[\s\S]*\/clear/);
  assert.match(hintLine("model", { tokens: 40_000, price })!, /another model[\s\S]*about 40\.0k tokens \(~\$0\.12\)/);
  assert.match(hintLine("tools", { tokens: 40_000, price, what: "/thinking on" })!, /^\/thinking on changes what the model is sent/);
  assert.match(hintLine("model", { tokens: 40_000 })!, /about 40\.0k tokens\. /, "no price, no cost");
  assert.match(hintLine("place", {})!, /keeps its own conversation/);
  assert.match(hintLine("big", { tokens: 150_000, side: "cloud" })!, /\/clear starts a new conversation$/, "no /compact in the cloud");
  assert.doesNotMatch(hintLine("break", { tokens: 40_000, side: "cloud", minutes: 70 })!, /\/compact/);
  assert.match(hintLine("big", { tokens: 150_000, price })!, /^the conversation is about 150\.0k tokens \(~\$0\.45\)[\s\S]*\/compact/);
  assert.match(hintLine("paste", { tokens: 30_000, price })!, /this message is about 30\.0k tokens \(~\$0\.09\) by itself/);
  for (const kind of ["break", "model", "tools"] as const) assert.equal(hintLine(kind, { tokens: HINT_MIN_TOKENS - 1, price }), null, kind);
  assert.equal(hintLine("big", { tokens: BIG_TOKENS - 1 }), null);
  assert.equal(hintLine("paste", { tokens: PASTE_TOKENS - 1 }), null);
  assert.match(hintLine("model", { tokens: 6_000, price: { inputPerMTok: 0.5 } })!, /under \$0\.01/);
});

test("giveHint: once a session for each kind, kept for /cost explain; nothing when off", () => {
  const s: any = {};
  const said: string[] = [];
  const io = { off: false, print: (l: string) => said.push(l), now: Date.parse("2026-11-24T10:00:00Z") };
  assert.ok(giveHint(s, "model", { tokens: 40_000, price }, io));
  assert.equal(giveHint(s, "model", { tokens: 90_000, price }, io), null, "once");
  assert.equal(giveHint(s, "tools", { tokens: 10 }, io), null, "too small: not said, and still free to say later");
  assert.ok(giveHint(s, "tools", { tokens: 40_000 }, io));
  assert.equal(said.length, 2);
  assert.deepEqual(s.hints.map((h: any) => h.kind), ["model", "tools"]);
  assert.equal(giveHint({}, "model", { tokens: 40_000 }, { ...io, off: true }), null);
});
