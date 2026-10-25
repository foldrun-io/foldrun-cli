// `foldrun invoke <flow> --inputs <set>` starts the flow with a saved input
// set — the same file the dashboard's "Run with…" reads and writes — and
// `foldrun check` accepts that file (an `inputs: true` eval with no
// assertions) without a word.
//
//   node --test tests/cli-invoke-inputs.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { serve, at } from "./fake-platform.ts";

const EVALS = {
  evals: [
    { name: "publish-quality", file: "publish-quality.md", flow: "publish", inputs: false, cases: [{ name: "rain gauges", task: "from the eval", expect: [] }] },
    { name: "publish-inputs", file: "publish-inputs.md", flow: "publish", inputs: true, cases: [{ name: "rain gauges", task: "Write about cleaning a rain gauge.", expect: [] }, { name: "Weekly", task: "the weekly one", expect: [] }] },
    { name: "other-inputs", file: "other-inputs.md", flow: "other", inputs: true, cases: [{ name: "x", task: "not this flow", expect: [] }] },
  ],
};

const platform = () =>
  serve({
    "/api/workspaces/blog-desk/evals": () => EVALS,
    "POST /api/workspaces/blog-desk/flows/publish/run": () => ({ ok: true, runId: "run-9", steps: 2, test: true }),
  });

test("--inputs sends the saved set's task; the inputs file wins a name an eval also has", async () => {
  const s = await platform();
  const r = await at(s.url, "invoke", "publish", "--to", "blog-desk", "--inputs", "rain gauges", "--test");
  s.close();
  assert.equal(r.code, 0, r.out);
  const sent = JSON.parse(s.seen.find((x) => x.method === "POST")!.body);
  assert.equal(sent.task, "Write about cleaning a rain gauge.");
  assert.equal(sent.test, true);
  assert.match(r.out, /inputs: rain gauges \(evals\/publish-inputs\.md\)/);
});

test("a set name matches without case; an unknown one lists what there is and starts nothing", async () => {
  const s = await platform();
  const ok = await at(s.url, "invoke", "publish", "--to", "blog-desk", "--inputs", "weekly");
  assert.equal(ok.code, 0, ok.out);
  assert.equal(JSON.parse(s.seen.find((x) => x.method === "POST")!.body).task, "the weekly one");
  const before = s.seen.length;
  const bad = await at(s.url, "invoke", "publish", "--to", "blog-desk", "--inputs", "nope");
  s.close();
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /no input set "nope" for publish/);
  assert.match(bad.out, /"rain gauges", "Weekly"/);
  assert.equal(s.seen.slice(before).filter((x) => x.method === "POST").length, 0);
});

test("--inputs with --task is refused before anything starts", async () => {
  const s = await platform();
  const r = await at(s.url, "invoke", "publish", "--to", "blog-desk", "--inputs", "Weekly", "--task", "hi");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /pick one/);
  assert.equal(s.seen.filter((x) => x.method === "POST").length, 0);
});

test("foldrun check accepts an inputs file: no assertions, no warning about it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-inputs-"));
  const ws = path.join(root, "desk");
  try {
    fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
    fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
    fs.mkdirSync(path.join(ws, "evals"), { recursive: true });
    fs.writeFileSync(path.join(ws, "agents/writer/agent.md"), "---\nname: writer\ndescription: writes\n---\n\nWrite.\n");
    fs.writeFileSync(path.join(ws, "flows/publish.md"), "---\nname: publish\ntrigger: manual\n---\n\n1. [[writer]] — Write it.\n");
    fs.writeFileSync(
      path.join(ws, "evals/publish-inputs.md"),
      "---\nname: publish-inputs\nflow: publish\ninputs: true\ntrigger: manual\n---\n\n## rain gauges\ntask: Write about cleaning a rain gauge.\n",
    );
    const r = spawnSync(process.execPath, [path.join(import.meta.dirname, "../bin/foldrun.mjs"), "check", ws, "--local"], {
      encoding: "utf8",
      env: { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, NO_COLOR: "1" },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /publish-inputs/);
    // A typo in the flow it names is still caught.
    fs.writeFileSync(path.join(ws, "evals/publish-inputs.md"), "---\nflow: pubish\ninputs: true\n---\n\n## a\ntask: b\n");
    const bad = spawnSync(process.execPath, [path.join(import.meta.dirname, "../bin/foldrun.mjs"), "check", ws, "--local"], {
      encoding: "utf8",
      env: { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, NO_COLOR: "1" },
    });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /flow "pubish" does not exist/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
