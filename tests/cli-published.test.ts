import test from "node:test";
import assert from "node:assert/strict";
import { published } from "../src/commands.mjs";

const URL = "https://foldrun.io/p/abc";
const one = (summary: string) => published({ summary })[0];

test("published() strips markdown and punctuation wrapped around a URL", () => {
  assert.equal(one(`**${URL}**`), URL);
  assert.equal(one(`\`${URL}\``), URL);
  assert.equal(one(`see ${URL}.`), URL);
  assert.equal(one(`(${URL})`), URL);
  assert.equal(one(`[docs](${URL})`), URL);
  assert.equal(one(`_${URL}_`), URL);
  assert.equal(one(`<${URL}>`), URL);
});

test("published() keeps query strings and balanced parens intact", () => {
  const q = "https://foldrun.io/p?x=1&y=2";
  assert.equal(one(q), q);
  const wiki = "https://en.wikipedia.org/wiki/Foo_(bar)";
  assert.equal(one(wiki), wiki);
});

test("published() unwraps markdown links and trailing sentence punctuation", () => {
  assert.deepEqual(published({ summary: "[https://x.com/a](https://x.com/a)" }), ["https://x.com/a"]);
  assert.equal(one("**[label](https://x.com/b)**"), "https://x.com/b");
  assert.equal(one("(see https://x.com/c)."), "https://x.com/c");
});
