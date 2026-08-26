// The container boundary's pure parts: what may come back from a run, and
// what the driver's stdout lines mean. The docker-shaped rest lives in
// tests/container-e2e.test.ts, opt-in.
//
//   node --test tests/run-container.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  allowedBack,
  applyContainerChanges,
  parseDriverLine,
} from "../packages/core/src/run-container.ts";

test("what the spec says agents own comes back; what they must not touch does not", () => {
  assert.ok(allowedBack("agents/writer/outputs/report.md"));
  assert.ok(allowedBack("agents/writer/memory/learned.md"));
  assert.ok(allowedBack("memory/fact.md"));
  assert.ok(allowedBack("state/cursor.json"));
  assert.ok(allowedBack("outputs/digest.md"));

  assert.ok(!allowedBack("knowledge/policy.md"), "knowledge is read-only, physically");
  assert.ok(!allowedBack("agents/writer/knowledge/prices.md"));
  assert.ok(!allowedBack("secrets.json"));
  assert.ok(!allowedBack("hooks.json"), "webhook rotation state is the platform's");
  assert.ok(!allowedBack("hook-deliveries.jsonl"));
  assert.ok(!allowedBack("runs/run-1.json"));
  assert.ok(!allowedBack(".git/config"));
  assert.ok(!allowedBack("../outside.md"), "no escaping the workspace");
});

test("apply copies allowed changes, skips denied ones, deletes nothing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-apply-"));
  try {
    const host = path.join(root, "host");
    const out = path.join(root, "out");
    // The host workspace before the run.
    fs.mkdirSync(path.join(host, "knowledge"), { recursive: true });
    fs.mkdirSync(path.join(host, "agents/writer/outputs"), { recursive: true });
    fs.writeFileSync(path.join(host, "knowledge/policy.md"), "authored truth");
    fs.writeFileSync(path.join(host, "agents/writer/outputs/old.md"), "from before");
    // What came out of the container.
    fs.mkdirSync(path.join(out, "knowledge"), { recursive: true });
    fs.mkdirSync(path.join(out, "agents/writer/outputs"), { recursive: true });
    fs.mkdirSync(path.join(out, "memory"), { recursive: true });
    fs.writeFileSync(path.join(out, "knowledge/policy.md"), "the model edited this");
    fs.writeFileSync(path.join(out, "agents/writer/outputs/report.md"), "new work");
    fs.writeFileSync(path.join(out, "memory/fact.md"), "learned");
    // old.md absent in the container copy — it must survive on the host.

    const applied = applyContainerChanges(host, out).sort();
    assert.deepEqual(applied, ["agents/writer/outputs/report.md", "memory/fact.md"]);
    assert.equal(
      fs.readFileSync(path.join(host, "knowledge/policy.md"), "utf8"),
      "authored truth",
      "a knowledge edit inside the container dies with the container",
    );
    assert.equal(fs.readFileSync(path.join(host, "agents/writer/outputs/old.md"), "utf8"), "from before");
    assert.equal(fs.readFileSync(path.join(host, "memory/fact.md"), "utf8"), "learned");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("driver lines: events and the done marker parse, noise does not", () => {
  assert.deepEqual(parseDriverLine('{"e":"event","type":"text","text":"hi"}'), {
    e: "event",
    type: "text",
    text: "hi",
  });
  const done = parseDriverLine('{"e":"done","status":"completed","result":"out","costUsd":0.01}');
  assert.deepEqual(done, { e: "done", status: "completed", result: "out", costUsd: 0.01, usage: null });
  // Token counts survive the boundary when the driver sends them — they are
  // what lets the host reprice a routed model from the gateway's catalogue.
  const withUsage = parseDriverLine(
    '{"e":"done","status":"completed","result":"out","costUsd":0.01,"usage":{"inputTokens":100,"outputTokens":20}}',
  );
  assert.deepEqual(
    withUsage && "usage" in withUsage ? withUsage.usage : null,
    { inputTokens: 100, outputTokens: 20 },
  );

  assert.equal(parseDriverLine("npm warn deprecated something"), null);
  assert.equal(parseDriverLine('{"unrelated":"json"}'), null);
  assert.equal(parseDriverLine('{broken'), null);
  const junkStatus = parseDriverLine('{"e":"done","status":"nonsense"}');
  assert.equal(junkStatus && "status" in junkStatus ? junkStatus.status : null, "failed");
});
