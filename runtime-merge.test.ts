// A tool's dependencies travel with the tool.
//
//   node --test tests/runtime-merge.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRuntimes, parseRuntime, fingerprint } from "../packages/core/src/runtime.ts";

test("nothing declared anywhere is no runtime", () => {
  assert.equal(mergeRuntimes(null, undefined, null), null);
});

test("one declaration passes through untouched", () => {
  const only = parseRuntime({ packages: ["requests"] })!;
  assert.equal(mergeRuntimes(null, only), only);
});

test("an agent's runtime and its tools' runtimes become one environment", () => {
  const agent = parseRuntime({ python: "3.12", packages: ["pandas"] });
  const scraper = parseRuntime({ packages: ["requests", "beautifulsoup4"] });
  const linker = parseRuntime({ node: true, npm: ["cheerio"] });
  const merged = mergeRuntimes(agent, scraper, linker)!;

  assert.equal(merged.python, "3.12", "a pin beats a bare true");
  assert.deepEqual(merged.packages, ["pandas", "requests", "beautifulsoup4"]);
  assert.equal(merged.node, true);
  assert.deepEqual(merged.npm, ["cheerio"]);
});

test("the same package from two tools is installed once", () => {
  const a = parseRuntime({ packages: ["requests"] });
  const b = parseRuntime({ packages: ["requests", "pyyaml"] });
  assert.deepEqual(mergeRuntimes(a, b)!.packages, ["requests", "pyyaml"]);
});

test("conflicting pins are kept for pip to refuse, not silently resolved", () => {
  const a = parseRuntime({ packages: ["requests==2.31"] });
  const b = parseRuntime({ packages: ["requests==2.32"] });
  assert.deepEqual(mergeRuntimes(a, b)!.packages, ["requests==2.31", "requests==2.32"]);
});

test("merging is deterministic, so the environment is cached across runs", () => {
  const a = parseRuntime({ packages: ["b", "a"] });
  const b = parseRuntime({ npm: ["y", "x"] });
  assert.equal(fingerprint(mergeRuntimes(a, b)!), fingerprint(mergeRuntimes(a, b)!));
});

test("a rejected requirement from any tool is still reported", () => {
  const bad = parseRuntime({ packages: ["--index-url", "requests"] });
  const merged = mergeRuntimes(parseRuntime({ packages: ["pandas"] }), bad)!;
  assert.deepEqual(merged.rejected, ["--index-url"]);
});
