// `npm test` names its files one by one; on 24 Nov 2026 eight test files
// were found that it never ran, one of them failing since a wording change.
// Every tests/*.test.ts is in the script, or this fails — but e2e, which
// costs money and has its own script (npm run e2e).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("every test file is run by npm test", () => {
  const root = path.join(import.meta.dirname, "..");
  const script: string = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts.test;
  const missing = fs.readdirSync(path.join(root, "tests")).filter((f) => f.endsWith(".test.ts") && f !== "e2e.test.ts" && !script.includes(`tests/${f}`));
  assert.deepEqual(missing, [], `add to "test" in package.json: ${missing.join(", ")}`);
});
