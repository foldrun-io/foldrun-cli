// Dashboard → CLI parity, set C (4 Nov audit): what the dashboard could do
// and the CLI could not — an agent run with no task, flow input sets, a
// checked or empty source save, deleting several steps at once, a per-setting
// agent in eval compare, "Move to shared", the edit guards, and the rescan
// line on `check --to`. Each test pins the request the dashboard makes.
//
//   node --test tests/cli-parity-c.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { removeStep } from "@foldrun/core/flow-patterns";
import { serve, at, failing, cli, WORKSPACES } from "./fake-platform.ts";

const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, FOLDRUN_HOME: "/nonexistent/foldrun-home", NO_COLOR: "1" };
const local = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd, env: ENV });
const tmpFile = (name: string, content: string) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-parity-c-")), name);
  fs.writeFileSync(f, content);
  return f;
};

const FLOW = `---
name: morning
trigger: manual
---

1. [[researcher]] — find the news
2. [[writer]] — draft the brief
   retry: 2
3. [[watchdog]] — stray drop
4. [[editor]] — tighten it
`;
const agent = (name: string) => `---\nname: ${name}\ndescription: The ${name}.\nmodel: fast\n---\n\nYou are the ${name}.\n`;
const AGENTS = ["researcher", "writer", "watchdog", "editor"];

function desk(): { root: string; ws: string } {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-parity-c-")), "acme");
  spawnSync(process.execPath, [CLI, "init", root, "--workspace", "main"], { encoding: "utf8", env: ENV });
  const ws = path.join(root, "workspaces/main");
  for (const d of ["flows", "agents", "evals"]) fs.rmSync(path.join(ws, d), { recursive: true, force: true });
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  fs.writeFileSync(path.join(ws, "flows/morning.md"), FLOW);
  for (const a of AGENTS) {
    fs.mkdirSync(path.join(ws, "agents", a), { recursive: true });
    fs.writeFileSync(path.join(ws, "agents", a, "agent.md"), agent(a));
  }
  return { root, ws };
}

// ---- 11: agent run with no task

const RUN = "/api/workspaces/rank-desk/agents/tracker/run";

test("agent run --no-task starts it with an empty body, as the dashboard's Run does", async () => {
  const s = await serve({ [`POST ${RUN}`]: () => ({ ok: true, runId: "run-adhoc-1", test: false }) });
  const r = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--no-task");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /queued run-adhoc-1/);
  assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "POST")!.body), {});
});

test("agent run: no --task and no --no-task is still refused, and both together are", async () => {
  const s = await serve({ [`POST ${RUN}`]: () => ({ ok: true, runId: "x" }) });
  const none = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk");
  const both = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "go", "--no-task");
  s.close();
  assert.equal(none.code, 1);
  assert.match(none.out, /what should tracker do\?.*--no-task/);
  assert.equal(both.code, 1);
  assert.match(both.out, /either --task or --no-task/);
  assert.equal(s.seen.filter((x) => x.method === "POST").length, 0);
});

// ---- 12: flow input sets

const INPUTS = `---
name: morning-inputs
flow: morning
inputs: true
trigger: manual
---

Saved inputs.

## monday
task: the Monday brief
`;

test("flow inputs --to lists the sets: the inputs file first, then eval cases, a name once", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/evals": () => ({
      evals: [
        { name: "morning-quality", file: "morning-quality.md", flow: "morning", inputs: false, cases: [{ name: "monday", task: "an eval's monday" }, { name: "launch", task: "launch day" }] },
        { name: "morning-inputs", file: "morning-inputs.md", flow: "morning", inputs: true, cases: [{ name: "monday", task: "the Monday brief" }] },
        { name: "other", file: "other.md", flow: "other", inputs: true, cases: [{ name: "x", task: "y" }] },
      ],
    }),
  });
  const r = await at(s.url, "flow", "inputs", "morning", "--to", "blog-desk");
  const j = await at(s.url, "flow", "inputs", "morning", "--to", "blog-desk", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /monday\s+evals\/morning-inputs\.md\n\s+the Monday brief/);
  assert.match(r.out, /launch\s+evals\/morning-quality\.md · an eval case/);
  assert.doesNotMatch(r.out, /an eval's monday/);
  // stdout and stderr come together here; the document starts at its brace.
  const sets = JSON.parse(j.out.slice(j.out.indexOf("{"))).sets;
  assert.deepEqual(sets.map((x: { name: string }) => x.name), ["monday", "launch"]);
});

test("flow inputs save --to: reads the file, upserts the set, PUTs with ifMatch", async () => {
  const s = await serve({
    "GET /api/workspaces/blog-desk/source": () => ({ path: "evals/morning-inputs.md", content: INPUTS, sha256: sha(INPUTS) }),
    "PUT /api/workspaces/blog-desk/source": () => ({ ok: true }),
  });
  const r = await at(s.url, "flow", "inputs", "save", "morning", "monday", "--task", "a new Monday", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  const put = JSON.parse(s.seen.find((x) => x.method === "PUT")!.body);
  assert.equal(put.path, "evals/morning-inputs.md");
  assert.equal(put.ifMatch, sha(INPUTS));
  assert.match(put.message, /input set "monday" saved for morning/);
  assert.match(put.content, /## monday\ntask: a new Monday\n/);
  assert.doesNotMatch(put.content, /the Monday brief/);
  assert.match(put.content, /^Saved inputs\.$/m, "the rest of the file is kept");
});

test("flow inputs save --to with no file yet: a new inputs file, ifMatch null; a 409 says so", async () => {
  const s = await serve({
    "GET /api/workspaces/blog-desk/source": () => failing(404, { error: "not found: evals/morning-inputs.md" }),
    "PUT /api/workspaces/blog-desk/source": () => ({ ok: true }),
  });
  const r = await at(s.url, "flow", "inputs", "save", "morning", "launch", "--task", "line one\n- a bullet", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  const put = JSON.parse(s.seen.find((x) => x.method === "PUT")!.body);
  assert.equal(put.ifMatch, null);
  assert.match(put.content, /^---\nname: morning-inputs\nflow: morning\ninputs: true\ntrigger: manual\n---/);
  assert.match(put.content, /## launch\ntask: \|\n  line one\n  \* a bullet\n/);

  const busy = await serve({
    "GET /api/workspaces/blog-desk/source": () => ({ content: INPUTS, sha256: sha(INPUTS) }),
    "PUT /api/workspaces/blog-desk/source": () => failing(409, { error: "changed" }),
  });
  const c = await at(busy.url, "flow", "inputs", "save", "morning", "monday", "--task", "x", "--to", "blog-desk");
  busy.close();
  assert.equal(c.code, 1);
  assert.match(c.out, /changed while saving — nothing was written/);
});

test("flow inputs in this folder: save writes evals/<flow>-inputs.md, the list reads it back", () => {
  const { root, ws } = desk();
  const saved = local(root, "flow", "inputs", "save", "morning", "monday", "--task", "the Monday brief");
  assert.equal(saved.status, 0, saved.stdout + saved.stderr);
  const file = fs.readFileSync(path.join(ws, "evals/morning-inputs.md"), "utf8");
  assert.match(file, /inputs: true/);
  assert.match(file, /## monday\ntask: the Monday brief\n/);
  const listed = local(root, "flow", "inputs", "morning");
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /monday\s+evals\/morning-inputs\.md/);
  const check = local(root, "check");
  assert.doesNotMatch(check.stdout + check.stderr, /morning-inputs/, "the saved file checks out");
  const nope = local(root, "flow", "inputs", "save", "nightly", "x", "--task", "y");
  assert.notEqual(nope.status, 0);
  assert.match(nope.stderr, /no flow "nightly"/);
  const noTask = local(root, "flow", "inputs", "save", "morning", "x");
  assert.match(noTask.stderr, /what is the task\?/);
});

// ---- 13 + 27: checked and empty saves

test("source put --check sends check: true; a 422 prints the issues and exits 1", async () => {
  const issues = [{ level: "error", rule: "config/unknown-field", where: "flows/x.md:2", message: "unknown field wibble" }];
  const s = await serve({ "PUT /api/workspaces/blog-desk/source": () => failing(422, { error: "flows/x.md did not check out", issues }) });
  const file = tmpFile("x.md", "---\nwibble: 1\n---\n");
  const r = await at(s.url, "source", "put", "flows/x.md", "--file", file, "--check", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.equal(JSON.parse(s.seen[0].body).check, true);
  assert.match(r.out, /did not check out — nothing was saved/);
  assert.match(r.out, /error\s+flows\/x\.md:2\s+unknown field wibble\s+\[config\/unknown-field\]/);
});

test("source put --check that passes prints its warnings; without --check nothing new is sent", async () => {
  const s = await serve({ "PUT /api/workspaces/blog-desk/source": () => ({ ok: true, issues: [{ level: "warn", rule: "content/x", where: "knowledge/a.md", message: "a warning" }] }) });
  const file = tmpFile("a.md", "# a\n");
  const r = await at(s.url, "source", "put", "knowledge/a.md", "--file", file, "--check", "--to", "blog-desk");
  const plain = await at(s.url, "source", "put", "knowledge/a.md", "--file", file, "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /warn\s+knowledge\/a\.md\s+a warning/);
  assert.equal(plain.code, 0, plain.out);
  assert.equal(JSON.parse(s.seen[1].body).check, undefined);
  assert.doesNotMatch(plain.out, /a warning/);
});

test("source put --empty writes an empty file; an empty input without it is still refused", async () => {
  const s = await serve({ "PUT /api/workspaces/blog-desk/source": () => ({ ok: true }) });
  const empty = tmpFile("e.txt", "");
  const refused = await at(s.url, "source", "put", "tools/x/notes.txt", "--file", empty, "--to", "blog-desk");
  const r = await at(s.url, "source", "put", "tools/x/notes.txt", "--empty", "--to", "blog-desk");
  const both = await at(s.url, "source", "put", "tools/x/notes.txt", "--empty", "--file", empty, "--to", "blog-desk");
  s.close();
  assert.equal(refused.code, 1);
  assert.match(refused.out, /refusing to write an empty file.*--empty/);
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen.length, 1);
  assert.deepEqual(JSON.parse(s.seen[0].body), { path: "tools/x/notes.txt", content: "" });
  assert.match(both.out, /either --empty or --file/);
});

// ---- 14: several steps at once

test("flow rm-step --step 2,4 deletes both in one write, with core's bytes", () => {
  const { root, ws } = desk();
  const r = local(root, "flow", "rm-step", "morning", "--step", "editor,2", "--yes");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(ws, "flows/morning.md"), "utf8"), removeStep(removeStep(FLOW, 3), 1));
  assert.match(r.stdout, /delete 2 steps/);
  for (const a of AGENTS) assert.equal(fs.readFileSync(path.join(ws, "agents", a, "agent.md"), "utf8"), agent(a));
});

test("flow rm-step --step 2,4 --to sends one PATCH { edits } highest first", async () => {
  const files: Record<string, string> = { "AGENTS.md": "---\nname: blog-desk\n---\n", "flows/morning.md": FLOW };
  for (const a of AGENTS) files[`agents/${a}/agent.md`] = agent(a);
  const s = await serve({
    "/api/workspaces/blog-desk/source": (_b: string, q: URLSearchParams) => (q.get("path") ? { path: q.get("path"), content: files[q.get("path")!] } : { files: Object.keys(files) }),
    "/api/workspaces/blog-desk": () => ({ name: "blog-desk" }),
    "PATCH /api/workspaces/blog-desk/flows/morning": () => ({ ok: true }),
  });
  const r = await at(s.url, "flow", "rm-step", "morning", "--to", "blog-desk", "--step", "2,4", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  const patches = s.seen.filter((x) => x.method === "PATCH");
  assert.equal(patches.length, 1);
  assert.deepEqual(JSON.parse(patches[0].body), { edits: [{ op: "remove", step: 3 }, { op: "remove", step: 1 }], expect: sha(FLOW) });
});

// ---- 18: an agent per compare setting

test("eval compare: an item's @agent is that setting's alone; --agent fills the rest", async () => {
  const base = "/api/workspaces/blog-desk/evals/morning-quality/compare";
  const result = { eval: "morning-quality", target: { flow: "morning", agent: null }, judge: { model: "fast", effort: null }, repeat: 1, maxUsd: 5, spentUsd: 0, stopped: null, configs: [], cases: [] };
  const fake = await serve({
    "/api/workspaces": () => WORKSPACES,
    [`POST ${base}`]: () => ({ started: true, runId: "c".repeat(24), trials: 2, maxUsd: 5 }),
    [`GET ${base}`]: () => ({ state: "done", result }),
  });
  try {
    const r = await cli(["eval", "compare", "morning-quality", "--models", "fast:low@writer,max@editor:high,default,vertex-model@20240620", "--agent", "researcher", "--to", "blog-desk", "--url", fake.url, "--token", "k"], { env: { FOLDRUN_EVAL_POLL_MS: "10" } });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(fake.seen.find((x) => x.method === "POST")!.body).configs, [
      { model: "fast", effort: "low", agent: "writer" },
      { model: "max", effort: "high", agent: "editor" },
      { model: "default", agent: "researcher" },
      { model: "vertex-model@20240620", agent: "researcher" },
    ]);
  } finally {
    fake.close();
  }
});

// ---- 26: Move to shared

test("source share asks the platform what would move, then moves it in one call", async () => {
  const bodies: any[] = [];
  const s = await serve({
    "POST /api/workspaces/blog-desk/source/share": (b) => {
      const body = JSON.parse(b);
      bodies.push(body);
      return { ok: true, kind: "skills", unit: "skills/house-style", files: [{ from: "skills/house-style/SKILL.md", to: "house-style/SKILL.md", replaces: false }, { from: "skills/house-style/examples.md", to: "house-style/examples.md", replaces: false }], moved: !body.dryRun };
    },
  });
  const r = await at(s.url, "source", "share", "skills/house-style/SKILL.md", "--to", "blog-desk", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(bodies, [{ path: "skills/house-style/SKILL.md", dryRun: true }, { path: "skills/house-style/SKILL.md" }]);
  assert.match(r.out, /skills\/house-style\/examples\.md → library\/skills\/house-style\/examples\.md/);
  assert.match(r.out, /moved to library\/skills\/house-style/);
  assert.equal(s.seen.filter((x) => x.method === "DELETE" || x.method === "PUT").length, 0, "the CLI copies and deletes nothing itself");
});

test("source share: a library file already there is refused without --overwrite; --dry-run moves nothing", async () => {
  const bodies: any[] = [];
  const s = await serve({
    "POST /api/workspaces/blog-desk/source/share": (b) => {
      const body = JSON.parse(b);
      bodies.push(body);
      return { ok: true, kind: "knowledge", unit: "knowledge/faq.md", files: [{ from: "knowledge/faq.md", to: "faq.md", replaces: true }], moved: !body.dryRun };
    },
  });
  const refused = await at(s.url, "source", "share", "knowledge/faq.md", "--to", "blog-desk", "--yes");
  assert.equal(refused.code, 1);
  assert.match(refused.out, /--overwrite replaces it/);
  assert.equal(bodies.length, 1, "only the dry run was asked");
  const dry = await at(s.url, "source", "share", "knowledge/faq.md", "--to", "blog-desk", "--overwrite", "--dry-run");
  assert.equal(dry.code, 0, dry.out);
  assert.equal(bodies.length, 2);
  const ok = await at(s.url, "source", "share", "knowledge/faq.md", "--to", "blog-desk", "--overwrite", "--yes");
  s.close();
  assert.equal(ok.code, 0, ok.out);
  assert.deepEqual(bodies.at(-1), { path: "knowledge/faq.md", overwrite: true });
});

test("source share: no terminal needs --yes; the platform's refusal is said and nothing moves", async () => {
  const s = await serve({
    "POST /api/workspaces/blog-desk/source/share": (b) =>
      JSON.parse(b).path.startsWith("skills/art")
        ? failing(409, { error: "skills/art holds files the shared library cannot hold (skills/art/logo.png) — only text files go there; nothing was moved" })
        : { ok: true, kind: "scripts", unit: "scripts/x.py", files: [{ from: "scripts/x.py", to: "x.py", replaces: false }], moved: false },
  });
  const asked = await at(s.url, "source", "share", "scripts/x.py", "--to", "blog-desk");
  assert.notEqual(asked.code, 0);
  assert.match(asked.out, /--yes/);
  const art = await at(s.url, "source", "share", "skills/art", "--to", "blog-desk", "--yes");
  s.close();
  assert.notEqual(art.code, 0);
  assert.match(art.out, /logo\.png/);
});

test("source share on a platform from before the route says so", async () => {
  const s = await serve({});
  const r = await at(s.url, "source", "share", "skills/x", "--to", "blog-desk", "--yes");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /no "Move to shared" route yet/);
});

test("account model use --if-version sends ifVersion; a bad value is refused before anything is sent", async () => {
  const s = await serve({ "PUT /api/account/model": () => ({ set: false, runsOn: "account", source: "own" }) });
  await at(s.url, "account", "model", "use", "own", "--if-version", "3");
  await at(s.url, "account", "model", "use", "foldrun", "--provider", "openai", "--if-version", "0");
  const bad = await at(s.url, "account", "model", "use", "own", "--if-version", "x");
  const bare = await at(s.url, "account", "model", "use", "own", "--if-version");
  s.close();
  assert.notEqual(bare.code, 0);
  assert.match(bare.out, /--if-version takes/);
  const puts = s.seen.filter((x) => x.method === "PUT").map((x) => JSON.parse(x.body));
  assert.deepEqual(puts, [{ source: "own", ifVersion: 3 }, { source: "foldrun", supply: "openai", ifVersion: 0 }]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /--if-version takes the choiceVersion/);
});

test("secrets workspaces --if-workspaces sends the list read (all: null, none: [])", async () => {
  const s = await serve({ "PATCH /api/secrets": () => ({ ok: true, name: "CRM", scope: "account", workspaces: ["sales"] }) });
  await at(s.url, "secrets", "workspaces", "CRM", "sales", "--if-workspaces", "sales,ops");
  await at(s.url, "secrets", "workspaces", "CRM", "sales", "--if-workspaces", "all");
  await at(s.url, "secrets", "workspaces", "CRM", "--all", "--if-workspaces", "none");
  const conflict = await serve({ "PATCH /api/secrets": () => failing(409, { error: "the list was changed since you read it" }) });
  const r = await at(conflict.url, "secrets", "workspaces", "CRM", "sales", "--if-workspaces", "ops");
  s.close();
  conflict.close();
  const bodies = s.seen.filter((x) => x.method === "PATCH").map((x) => JSON.parse(x.body));
  assert.deepEqual(bodies, [
    { name: "CRM", workspaces: ["sales"], ifWorkspaces: ["sales", "ops"] },
    { name: "CRM", workspaces: ["sales"], ifWorkspaces: null },
    { name: "CRM", workspaces: null, ifWorkspaces: [] },
  ]);
  assert.equal(r.code, 1);
  assert.match(r.out, /changed since you read it/);
});

// ---- 34: the rescan line without --online

test("check --to prints when the daily rescan last ran; a platform without it costs only the line", async () => {
  const files: Record<string, string> = { "AGENTS.md": "---\nname: blog-desk\n---\n", "flows/morning.md": FLOW };
  for (const a of AGENTS) files[`agents/${a}/agent.md`] = agent(a);
  const routes = {
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/source": (_b: string, q: URLSearchParams) => (q.get("path") ? { path: q.get("path"), content: files[q.get("path")!] } : { files: Object.keys(files) }),
  };
  const s = await serve({ ...routes, "/api/workspaces/blog-desk/check": () => ({ findings: [], rescan: { checkedAt: "2026-11-04T03:00:00.000Z", findings: 0, pending: 0, problems: [] } }) });
  const r = await at(s.url, "check", "--to", "blog-desk");
  s.close();
  assert.match(r.out, /the daily rescan last ran 2026-11-04T03:00:00\.000Z/);
  const old = await serve(routes);
  const o = await at(old.url, "check", "--to", "blog-desk");
  old.close();
  assert.equal(o.code, r.code, o.out);
  assert.doesNotMatch(o.out, /daily rescan/);
});

test("source share --json prints only JSON: the plan on --dry-run, the answer once moved", async () => {
  const s = await serve({
    "POST /api/workspaces/blog-desk/source/share": (b) => ({ ok: true, kind: "scripts", unit: "scripts/x.py", files: [{ from: "scripts/x.py", to: "x.py", replaces: false }], moved: !JSON.parse(b).dryRun }),
  });
  // stdout may open with the "acting with --token" line; the rest is one JSON value.
  const parse = (out: string) => JSON.parse(out.slice(out.search(/[[{]/)));
  const dry = await at(s.url, "source", "share", "scripts/x.py", "--to", "blog-desk", "--dry-run", "--json");
  const done = await at(s.url, "source", "share", "scripts/x.py", "--to", "blog-desk", "--yes", "--json");
  s.close();
  assert.equal(dry.code, 0, dry.out);
  assert.equal(parse(dry.out).moved, false);
  assert.doesNotMatch(dry.out, /the shared library/, "no human text");
  assert.equal(done.code, 0, done.out);
  assert.equal(parse(done.out).moved, true);
});
