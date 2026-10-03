// The second parity pass (2 Oct 2026): what the dashboard did that the
// terminal could not — the step editor, trigger picker, board drags, copy and
// paste, Draft with AI, History's restore, the library shelf, saved OAuth
// clients and the other secret kinds, plans/top-up/card, the API version pin,
// the theme, What's new, ⌘K, the scheduler tick, the demo workspace, a run's
// live frame, the editor's vocabulary, branch delete and the mirror.
//
// Local flow edits are compared byte for byte with core's rewriters (the ones
// the dashboard's routes call); platform ones assert the request the
// dashboard sends. Each write that asks first is also shown to send nothing
// without --yes on a pipe.
//
//   node --test tests/cli-parity-dashboard.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { updateFlowStep, updateFlowStepInstruction, setFlowTrigger, reorderFlowSteps } from "@foldrun/core";
import { stepSource, pasteSteps } from "@foldrun/core/flow-patterns";
import { serve, at, cli, raw, failing } from "./fake-platform.ts";

const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, FOLDRUN_HOME: "/nonexistent/foldrun-home", NO_COLOR: "1" };
const run = (cwd: string, args: string[], input?: string) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd, env: ENV, input });
const writes = (s: { seen: { method: string; url: string; body: string }[] }) =>
  s.seen.filter((x) => x.method !== "GET").map((x) => ({ method: x.method, url: x.url, body: x.body ? JSON.parse(x.body) : null }));

const FLOW = `---
name: publish
trigger: manual
---

1. [[researcher]] — find one topic
2. [[writer]] — draft it
   retry: 1
3. [[editor]] — tighten it
`;
const agent = (name: string) => `---\nname: ${name}\ndescription: The ${name}.\nmodel: fast\ntools: [write]\n---\n\nYou are the ${name}.\n`;

function desk(): { root: string; ws: string } {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-parity2-")), "acme");
  spawnSync(process.execPath, [CLI, "init", root, "--workspace", "main"], { encoding: "utf8", env: ENV });
  const ws = path.join(root, "workspaces/main");
  for (const d of ["flows", "agents", "evals"]) fs.rmSync(path.join(ws, d), { recursive: true, force: true });
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  fs.writeFileSync(path.join(ws, "flows/publish.md"), FLOW);
  fs.writeFileSync(path.join(ws, "flows/digest.md"), "---\nname: digest\n---\n\n1. [[writer]] — sum it up\n");
  for (const a of ["researcher", "writer", "editor"]) {
    fs.mkdirSync(path.join(ws, "agents", a), { recursive: true });
    fs.writeFileSync(path.join(ws, "agents", a, "agent.md"), agent(a));
  }
  return { root, ws };
}
const flowOf = (ws: string, f = "publish") => fs.readFileSync(path.join(ws, `flows/${f}.md`), "utf8");

function platformDesk() {
  const files: Record<string, string> = {
    "AGENTS.md": "---\nname: blog-desk\n---\n",
    "flows/publish.md": FLOW,
    "agents/researcher/agent.md": agent("researcher"),
    "agents/writer/agent.md": agent("writer"),
    "agents/editor/agent.md": agent("editor"),
  };
  return {
    files,
    routes: {
      "/api/workspaces/blog-desk/source": (_b: string, q: URLSearchParams) => (q.get("path") ? { path: q.get("path"), content: files[q.get("path")!] } : { files: Object.keys(files) }),
      "PATCH /api/workspaces/blog-desk/flows/publish": () => ({ ok: true }),
    } as Record<string, (b: string, q: URLSearchParams) => unknown>,
  };
}

// ------------------------------------------------------------ the step editor, locally

test("flow set writes what the step editor writes: options, the instruction, key= clears", () => {
  const { root, ws } = desk();
  const r = run(root, ["flow", "set", "publish", "--step", "writer", "model=max", "timeout=900", "verify=judge: cites a source", "limits={web.search: 10}", "retry=", "instruction=draft it twice"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const want = updateFlowStep(updateFlowStepInstruction(FLOW, 1, "draft it twice"), 1, { model: "max", timeout: "900", verify: "judge: cites a source", limits: "{web.search: 10}", retry: null });
  assert.equal(flowOf(ws), want);
  assert.match(flowOf(ws), /2\. \[\[writer\]\] — draft it twice\n   model: max/);
  assert.doesNotMatch(flowOf(ws), /retry/);
  assert.match(r.stdout, /set step 2 · writer/);
});

test("flow set refuses what the editor would silently drop, and unknown keys", () => {
  const { root, ws } = desk();
  const each = run(root, ["flow", "set", "publish", "--step", "2", "each=items"]);
  assert.equal(each.status, 1);
  assert.match(each.stderr, /flow add <flow> fan-out --each "items"/);
  const bad = run(root, ["flow", "set", "publish", "--step", "2", "ask=Which?"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /not a step option flow set writes/);
  const none = run(root, ["flow", "set", "publish", "model=max"]);
  assert.equal(none.status, 1);
  assert.match(none.stdout + none.stderr, /which step\?/);
  assert.equal(flowOf(ws), FLOW);
});

test("flow set refuses a value core's rewriter would drop or zero: effort, timeout, retry, loop, max", () => {
  const { root, ws } = desk();
  const before = FLOW.replace("   retry: 1\n", "   retry: 1\n   timeout: 900\n   loop: 2\n   max: 5\n   effort: low\n");
  fs.writeFileSync(path.join(ws, "flows/publish.md"), before);
  for (const [pair, why] of [
    ["timeout=15m", /timeout=15m.*seconds.*timeout=900/],
    ["timeout=0", /timeout=0.*whole number of seconds/],
    ["effort=hihg", /effort=hihg.*low, medium, high, xhigh, max/],
    ["retry=abc", /retry=abc.*0 to 5/],
    ["retry=9", /retry=9.*0 to 5/],
    ["loop=0", /loop=0.*1 to 5/],
    ["loop=2.5", /loop=2\.5.*1 to 5/],
    ["max=50", /max=50.*1 to 20/],
  ] as const) {
    const r = run(root, ["flow", "set", "publish", "--step", "2", pair]);
    assert.equal(r.status, 1, `${pair}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, why, pair);
    assert.equal(flowOf(ws), before, `${pair} left the file as it was`);
  }
  const ok = run(root, ["flow", "set", "publish", "--step", "2", "timeout=1800", "effort=deep", "retry=0", "loop=5", "max=20"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(flowOf(ws), updateFlowStep(before, 1, { timeout: "1800", effort: "deep", retry: "0", loop: "5", max: "20" }));
});

test("flow set to what the step already says changes nothing — no reordering diff, no platform revision", async () => {
  const { root, ws } = desk();
  const before = FLOW.replace("   retry: 1\n", "   verify: judge: cites a source\n   retry: 1\n");
  fs.writeFileSync(path.join(ws, "flows/publish.md"), before);
  const r = run(root, ["flow", "set", "publish", "--step", "2", "retry=1", "instruction=draft it"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /nothing to change/);
  assert.equal(flowOf(ws), before);
  const d = platformDesk();
  d.files["flows/publish.md"] = before;
  const s = await serve(d.routes);
  const p = await at(s.url, "flow", "set", "publish", "--to", "blog-desk", "--step", "2", "retry=1");
  s.close();
  assert.equal(p.code, 0, p.out);
  assert.match(p.out, /nothing to change/);
  assert.deepEqual(writes(s), []);
});

test("flow with an unknown verb names every flow verb the dispatcher has", () => {
  const { root } = desk();
  const r = run(root, ["flow", "wibble"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /new, add, rm-step, dup-step, show, run, rotate-hook, set, trigger, move-step, copy-step, paste, draft are the verbs, not "wibble"/);
});

test("flow trigger writes the trigger picker's lines; a schedule needs its cron; --dry-run writes nothing", () => {
  const { root, ws } = desk();
  const dry = run(root, ["flow", "trigger", "publish", "schedule", "--schedule", "0 9 * * 1", "--timezone", "Australia/Sydney", "--dry-run"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /\+ schedule: "0 9 \* \* 1"/);
  assert.equal(flowOf(ws), FLOW);
  const r = run(root, ["flow", "trigger", "publish", "schedule", "--schedule", "0 9 * * 1", "--timezone", "Australia/Sydney"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(flowOf(ws), setFlowTrigger(FLOW, { trigger: "schedule", schedule: "0 9 * * 1", timezone: "Australia/Sydney" }));
  const back = run(root, ["flow", "trigger", "publish", "manual"]);
  assert.equal(back.status, 0, back.stderr);
  assert.equal(flowOf(ws), setFlowTrigger(flowOf(ws) === FLOW ? FLOW : setFlowTrigger(FLOW, { trigger: "schedule", schedule: "0 9 * * 1", timezone: "Australia/Sydney" }), { trigger: "manual" }));
  const missing = run(root, ["flow", "trigger", "publish", "schedule"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /needs its cron line/);
});

test("flow move-step is the board's drag: beside a group, or its own group after one", () => {
  const { root, ws } = desk();
  const beside = run(root, ["flow", "move-step", "publish", "--step", "editor", "--group", "2"]);
  assert.equal(beside.status, 0, beside.stdout + beside.stderr);
  assert.equal(flowOf(ws), reorderFlowSteps(FLOW, [[0], [1, 2]]));
  const own = run(root, ["flow", "move-step", "publish", "--step", "3", "--after", "0"]);
  assert.equal(own.status, 0, own.stdout + own.stderr);
  assert.equal(flowOf(ws), reorderFlowSteps(reorderFlowSteps(FLOW, [[0], [1, 2]]), [[2], [0], [1]]));
  const both = run(root, ["flow", "move-step", "publish", "--step", "1", "--group", "1", "--after", "1"]);
  assert.equal(both.status, 1);
});

test("flow copy-step prints core's step markdown, and flow paste puts it into another flow", () => {
  const { root, ws } = desk();
  const copy = run(root, ["flow", "copy-step", "publish", "--step", "2"]);
  assert.equal(copy.status, 0, copy.stderr);
  assert.equal(copy.stdout, stepSource(FLOW, 1) + "\n");
  const digest = flowOf(ws, "digest");
  const paste = run(root, ["flow", "paste", "digest"], copy.stdout);
  assert.equal(paste.status, 0, paste.stdout + paste.stderr);
  assert.equal(flowOf(ws, "digest"), pasteSteps(digest, copy.stdout, { rail: 1 }).text);
  assert.match(flowOf(ws, "digest"), /2\. \[\[writer\]\] — draft it\n   retry: 1/);
  const junk = run(root, ["flow", "paste", "digest"], "hello\n");
  assert.equal(junk.status, 1);
  assert.match(junk.stderr, /not step markdown/);
});

// ------------------------------------------------------------ the same edits on a platform

test("flow set --to sends the editor's PATCHes, each with the text it expects", async () => {
  const d = platformDesk();
  const s = await serve(d.routes);
  const r = await at(s.url, "flow", "set", "publish", "--to", "blog-desk", "--step", "2", "instruction=draft it twice", "effort=high");
  s.close();
  assert.equal(r.code, 0, r.out);
  const afterInstruction = updateFlowStepInstruction(FLOW, 1, "draft it twice");
  assert.deepEqual(writes(s), [
    { method: "PATCH", url: "/api/workspaces/blog-desk/flows/publish", body: { step: 1, instruction: "draft it twice", expect: sha(FLOW) } },
    { method: "PATCH", url: "/api/workspaces/blog-desk/flows/publish", body: { step: 1, options: { effort: "high" }, expect: sha(afterInstruction) } },
  ]);
});

test("flow trigger, move-step and paste --to send the dashboard's bodies", async () => {
  const d = platformDesk();
  const s = await serve(d.routes);
  const t = await at(s.url, "flow", "trigger", "publish", "webhook", "--to", "blog-desk");
  const m = await at(s.url, "flow", "move-step", "publish", "--to", "blog-desk", "--step", "1", "--after", "3");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-paste-")), "steps.md");
  fs.writeFileSync(file, "1. [[editor]] — once more\n");
  const p = await at(s.url, "flow", "paste", "publish", "--to", "blog-desk", "--group", "2", "--file", file);
  s.close();
  for (const r of [t, m, p]) assert.equal(r.code, 0, r.out);
  assert.deepEqual(writes(s).map((w) => w.body), [
    { trigger: { trigger: "webhook" }, expect: sha(FLOW) },
    { groups: [[1], [2], [0]], expect: sha(FLOW) },
    { edit: { op: "paste", text: "1. [[editor]] — once more\n", at: { column: 1 } }, expect: sha(FLOW) },
  ]);
});

// ------------------------------------------------------------ Draft with AI

function draftPlatform() {
  return serve({
    "POST /api/workspaces/blog-desk/flows/draft": () => ({
      ok: true,
      files: [
        { path: "flows/weekly.md", content: "---\nname: weekly\n---\n\n1. [[writer]] — write it\n", before: null, sha256: null },
        { path: "agents/writer/agent.md", content: agent("writer") + "Be brief.\n", before: agent("writer"), sha256: sha(agent("writer")) },
      ],
      issues: [{ where: "flows/weekly.md", message: "no evals", level: "warn" }],
      repaired: false,
      notes: "A weekly flow.",
      supply: "mock",
    }),
    "PUT /api/workspaces/blog-desk/source": () => ({ ok: true }),
  });
}

test("flow draft shows the files and saves them only on --yes, each with ifMatch", async () => {
  const s = await draftPlatform();
  const pipe = await at(s.url, "flow", "draft", "a weekly digest", "--to", "blog-desk");
  const yes = await at(s.url, "flow", "draft", "a weekly digest", "--to", "blog-desk", "--yes", "--flow", "weekly");
  s.close();
  assert.equal(pipe.code, 1, "a draft paid for and not saved is not a success");
  assert.match(pipe.out, /A weekly flow\./);
  assert.match(pipe.out, /\+ 1\. \[\[writer\]\] — write it/);
  assert.match(pipe.out, /warn\s+flows\/weekly\.md\s+no evals/);
  assert.match(pipe.out, /the draft call was made[\s\S]*nothing saved — run it again with --yes/);
  assert.equal(yes.code, 0, yes.out);
  const w = writes(s);
  assert.deepEqual(w.filter((x) => x.method === "POST").map((x) => x.body), [{ description: "a weekly digest" }, { description: "a weekly digest", flow: "weekly" }]);
  assert.deepEqual(w.filter((x) => x.method === "PUT").map((x) => x.body), [
    { path: "flows/weekly.md", content: "---\nname: weekly\n---\n\n1. [[writer]] — write it\n", message: "drafted with AI: a weekly digest", ifMatch: null },
    { path: "agents/writer/agent.md", content: agent("writer") + "Be brief.\n", message: "drafted with AI: a weekly digest", ifMatch: sha(agent("writer")) },
  ]);
});

// ------------------------------------------------------------ History's restore

test("history restore puts one file back as a revision left it, with ifMatch, only on --yes", async () => {
  const now = "1. [[writer]] — now\n";
  const then = "1. [[writer]] — then\n";
  const s = await serve({
    "/api/workspaces/blog-desk/history": (_b, q) => ({ id: q.get("id"), at: "2026-10-01T00:00:00Z", by: "matt", commit: "abcdef1234567890", files: [{ path: q.get("path"), before: "x", after: then, diff: [] }] }),
    "/api/workspaces/blog-desk/source": (_b, q) => ({ path: q.get("path"), content: now, sha256: sha(now) }),
    "PUT /api/workspaces/blog-desk/source": () => ({ ok: true }),
  });
  const pipe = await at(s.url, "history", "restore", "flows/publish.md", "--id", "r1", "--to", "blog-desk");
  const yes = await at(s.url, "history", "restore", "flows/publish.md", "--id", "r1", "--to", "blog-desk", "--yes");
  s.close();
  assert.equal(pipe.code, 1);
  assert.match(pipe.out, /needs a person/);
  assert.equal(yes.code, 0, yes.out);
  assert.match(yes.out, /- 1\. \[\[writer\]\] — now[\s\S]*\+ 1\. \[\[writer\]\] — then/);
  assert.deepEqual(writes(s), [{ method: "PUT", url: "/api/workspaces/blog-desk/source", body: { path: "flows/publish.md", content: then, message: "restored abcdef1 from history", ifMatch: sha(now) } }]);
  assert.equal(s.seen.find((x) => x.url.endsWith("/history"))!.query.get("path"), "flows/publish.md");
});

// ------------------------------------------------------------ settings and account

test("schedule tick POSTs the tick and says what fired", async () => {
  const s = await serve({ "POST /api/schedule": () => ({ ok: true, fired: ["blog-desk/publish"] }) });
  const r = await at(s.url, "schedule", "tick");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /fired blog-desk\/publish/);
  assert.deepEqual(writes(s).map((w) => w.url), ["/api/schedule"]);
});

test("library ls / cat / put / rm go to /api/library/<kind>", async () => {
  const s = await serve({
    "/api/library/skills": (_b, q) => (q.get("path") ? { path: q.get("path"), content: "# house style\n" } : { kind: "skills", entries: [{ name: "house-style", description: "How we write." }] }),
    "/api/library/tools": () => ({ entries: [] }),
    "/api/library/scripts": () => ({ entries: [] }),
    "/api/library/knowledge": () => ({ entries: [] }),
    "PUT /api/library/skills": () => ({ ok: true }),
    "DELETE /api/library/skills": () => ({ ok: true }),
  });
  const ls = await at(s.url, "library");
  const cat = await at(s.url, "library", "cat", "skills/house-style/SKILL.md");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-lib-")), "SKILL.md");
  fs.writeFileSync(file, "# new\n");
  const put = await at(s.url, "library", "put", "skills/house-style/SKILL.md", "--file", file);
  const rmPipe = await at(s.url, "library", "rm", "skills/house-style");
  const rm = await at(s.url, "library", "rm", "skills/house-style", "--yes");
  const bad = await at(s.url, "library", "cat", "agents/x.md");
  s.close();
  assert.match(ls.out, /skills 1[\s\S]*house-style\s+How we write\./);
  assert.equal(cat.out.includes("# house style"), true, cat.out);
  assert.equal(put.code, 0, put.out);
  assert.equal(rmPipe.code, 1);
  assert.equal(rm.code, 0, rm.out);
  assert.equal(bad.code, 1);
  assert.deepEqual(writes(s), [
    { method: "PUT", url: "/api/library/skills", body: { path: "house-style/SKILL.md", content: "# new\n" } },
    { method: "DELETE", url: "/api/library/skills", body: { path: "house-style" } },
  ]);
});

test("secrets clients ls / add / rm, and connect --client runs the consent from a saved client", async () => {
  let connected: string | null = null;
  const s = await serve({
    "/api/oauth/clients": () => ({ clients: [{ name: "gmail", authorize_url: "https://accounts.google.com/o/oauth2/v2/auth", client_id: "id-1", scopes: "mail" }] }),
    "POST /api/oauth/clients": () => ({ ok: true, name: "gmail" }),
    "DELETE /api/oauth/clients": () => ({ ok: true }),
    "POST /api/oauth/start": () => {
      connected = "2026-10-02T00:00:00Z";
      return { ok: true, url: "https://accounts.google.com/consent?x=1" };
    },
    "/api/oauth/connections": () => ({ connections: connected ? [{ name: "GMAIL", workspace: null, connectedAt: connected }] : [] }),
  });
  const ls = await at(s.url, "secrets", "clients");
  const add = await at(s.url, "secrets", "clients", "add", "gmail", "--provider", "google", "--client-id", "id-1", "--client-secret", "shh", "--scopes", "mail");
  const rm = await at(s.url, "secrets", "clients", "rm", "gmail", "--yes");
  const c = await cli(["connect", "GMAIL", "--client", "gmail", "--url", s.url, "--token", "k"], { env: { FOLDRUN_CONNECT_POLL_MS: "10" } });
  s.close();
  assert.match(ls.out, /gmail\s+accounts\.google\.com · id-1 · mail/);
  assert.doesNotMatch(ls.out, /shh/);
  for (const r of [add, rm, c]) assert.equal(r.code, 0, r.out);
  assert.match(c.out, /https:\/\/accounts\.google\.com\/consent\?x=1[\s\S]*GMAIL connected/);
  const w = writes(s);
  assert.equal(w[0].body.name, "gmail");
  assert.equal(w[0].body.config.client_secret, "shh");
  assert.equal(w[0].body.config.token_url, "https://oauth2.googleapis.com/token");
  assert.deepEqual(w.slice(1), [
    { method: "DELETE", url: "/api/oauth/clients", body: { client: "gmail" } },
    { method: "POST", url: "/api/oauth/start", body: { client: "gmail", secret: "GMAIL" } },
  ]);
});

test("secrets set --kind stores each shape the Connections form stores", async () => {
  const s = await serve({ "PUT /api/secrets": () => ({ ok: true }) });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-kinds-"));
  fs.writeFileSync(path.join(dir, "cert.pem"), "PEM\n");
  fs.writeFileSync(path.join(dir, "id_ed25519"), "KEY\n");
  fs.writeFileSync(path.join(dir, "sa.json"), JSON.stringify({ client_email: "bot@x.iam", private_key: "PK", token_uri: "https://oauth2.googleapis.com/token" }));
  const base = ["--to", "blog-desk"];
  const rs = [
    await at(s.url, "secrets", "set", "CERT", "--kind", "file", "--file", path.join(dir, "cert.pem"), ...base),
    await at(s.url, "secrets", "set", "BOX", "--kind", "ssh", "--host", "box.example.com", "--user", "deploy", "--port", "2222", "--key-file", path.join(dir, "id_ed25519"), ...base),
    await at(s.url, "secrets", "set", "CRM", "--kind", "api", "--base-url", "https://crm.example.com", "--header", "Authorization: Bearer x", "--header", "X-Org: 7", ...base),
    await at(s.url, "secrets", "set", "SA", "--kind", "service-account", "--file", path.join(dir, "sa.json"), "--scopes", "drive", ...base),
    await at(s.url, "secrets", "set", "APP", "--kind", "m2m", "--token-url", "https://id.example.com/token", "--client-id", "c1", "--client-secret", "s1", "--scopes", "read", ...base),
  ];
  const bad = await at(s.url, "secrets", "set", "X", "--kind", "pgp", ...base);
  s.close();
  for (const r of rs) assert.equal(r.code, 0, r.out);
  assert.equal(bad.code, 1);
  assert.deepEqual(writes(s).map((w) => w.body), [
    { name: "CERT", file: "PEM\n", workspace: "blog-desk" },
    { name: "BOX", ssh: { host: "box.example.com", user: "deploy", port: 2222, private_key: "KEY\n" }, workspace: "blog-desk" },
    { name: "CRM", api: { base_url: "https://crm.example.com", headers: { Authorization: "Bearer x", "X-Org": "7" } }, workspace: "blog-desk" },
    { name: "SA", service_account: { token_url: "https://oauth2.googleapis.com/token", issuer: "bot@x.iam", private_key: "PK", scope: "drive" }, workspace: "blog-desk" },
    { name: "APP", oauth2: { token_url: "https://id.example.com/token", client_id: "c1", client_secret: "s1", grant_type: "client_credentials", extra: { scope: "read" } }, workspace: "blog-desk" },
  ]);
});

test("billing plans / plan / cancel / resume / top-up / card", async () => {
  const s = await serve({
    "/api/billing/plans": () => ({
      creditUsd: 0.01, trialCredits: 500, cards: true, balanceUsd: 12.5,
      plans: [{ id: "starter", monthlyUsd: 29, credits: 2900, concurrency: 1, workspaces: 3, pitch: "One desk." }, { id: "creator", monthlyUsd: 79, credits: 8800, concurrency: 2, workspaces: 10, pitch: "A few." }],
      current: { plan: "starter", status: "active", cycleCredits: 2900, cycleRemainingCredits: 1000, resetsAt: "2026-10-20T00:00:00Z" },
    }),
    "POST /api/billing/subscribe": (b) => (JSON.parse(b).resume ? { ok: true, resumed: true, plan: "starter" } : { ok: true, changed: true, plan: JSON.parse(b).plan }),
    "DELETE /api/billing/subscribe": () => ({ ok: true, endsAt: "2026-10-20T00:00:00Z" }),
    "POST /api/billing/checkout": () => ({ ok: true, url: "https://checkout.stripe.com/c/1" }),
    "POST /api/billing/card": () => failing(403, { error: "forbidden: billing:manage" }),
  });
  const plans = await at(s.url, "billing", "plans");
  const pipe = await at(s.url, "billing", "plan", "creator");
  const plan = await at(s.url, "billing", "plan", "creator", "--yes");
  const cancel = await at(s.url, "billing", "plan", "cancel", "--yes");
  const resume = await at(s.url, "billing", "plan", "resume");
  const top = await at(s.url, "billing", "top-up", "50");
  const card = await at(s.url, "billing", "card");
  s.close();
  assert.match(plans.out, /● starter\s+\$29\/mo\s+2,900 credits[\s\S]*○ creator/);
  assert.match(plans.out, /1000 of 2900 credits left, resets 2026-10-20/);
  assert.equal(pipe.code, 1);
  for (const r of [plan, cancel, resume, top]) assert.equal(r.code, 0, r.out);
  assert.match(plan.out, /moving to creator/);
  assert.match(cancel.out, /stops on 2026-10-20/);
  assert.match(top.out, /https:\/\/checkout\.stripe\.com\/c\/1/);
  assert.equal(card.code, 1);
  assert.match(card.out, /needs billing:manage/);
  assert.deepEqual(writes(s).map((w) => [w.method, w.url, w.body]), [
    ["POST", "/api/billing/subscribe", { plan: "creator" }],
    ["DELETE", "/api/billing/subscribe", null],
    ["POST", "/api/billing/subscribe", { resume: true }],
    ["POST", "/api/billing/checkout", { usd: 50 }],
    ["POST", "/api/billing/card", {}],
  ]);
});

test("api version shows the pin and limits; pin and unpin PATCH /api/account/api", async () => {
  const facts = (pinned: string | null) => ({
    version: { current: "2026-10-01", pinned, effective: pinned ?? "2026-10-01", supported: ["2026-09-25", "2026-10-01"], supportMonths: 12 },
    limits: { plan: "free", windowSeconds: 60, perCredential: { read: 300, write: 60 }, perAccount: { read: 900, write: 180 } },
  });
  const s = await serve({ "GET /api/account/api": () => facts(null), "PATCH /api/account/api": (b) => facts(JSON.parse(b).version) });
  const show = await at(s.url, "api", "version");
  const pin = await at(s.url, "api", "version", "pin", "2026-09-25");
  const unpin = await at(s.url, "api", "version", "unpin");
  const bad = await at(s.url, "api", "version", "pin", "soon");
  s.close();
  assert.match(show.out, /API version\s+2026-10-01\s+current — not pinned/);
  assert.match(show.out, /per key 300 reads \/ 60 writes/);
  assert.match(pin.out, /now get 2026-09-25[\s\S]*pinned \(current is 2026-10-01\)/);
  assert.equal(bad.code, 1);
  assert.deepEqual(writes(s).map((w) => w.body), [{ version: "2026-09-25" }, { version: null }]);
  assert.equal(unpin.code, 0, unpin.out);
});

test("preferences shows and sets the theme", async () => {
  const s = await serve({ "GET /api/me/preferences": () => ({ theme: "system" }), "PATCH /api/me/preferences": (b) => ({ theme: JSON.parse(b).theme }) });
  const show = await at(s.url, "preferences");
  const set = await at(s.url, "preferences", "set", "theme", "dark");
  const bad = await at(s.url, "preferences", "set", "theme", "blue");
  s.close();
  assert.match(show.out, /theme\s+system — follows the device/);
  assert.match(set.out, /theme dark/);
  assert.equal(bad.code, 1);
  assert.deepEqual(writes(s).map((w) => w.body), [{ theme: "dark" }]);
});

test("changelog prints each release's notes; find prints ranked hits", async () => {
  const s = await serve({
    "/api/changelog": (_b, q) => ({ version: "v2026.10.02.1", limit: q.get("limit"), releases: [{ version: "v2026.10.02.1", released_at: "2026-10-02T00:00:00Z", previous: null, components: {}, notes: { features: [{ subject: "canvas paste" }], fixes: ["a fix"], docs: [], other: [] } }] }),
    "/api/search": (_b, q) => ({ hits: q.get("q") === "digest" ? [{ kind: "flow", title: "digest", subtitle: "schedule · 0 9 * * 1", workspace: "blog-desk", href: "/x" }, { kind: "run", title: "run-9", subtitle: "digest — good", workspace: "blog-desk", status: "completed", href: "/y" }] : [] }),
  });
  const cl = await at(s.url, "changelog", "--limit", "3");
  const f = await at(s.url, "find", "digest");
  const none = await at(s.url, "find", "zzz");
  s.close();
  assert.match(cl.out, /v2026\.10\.02\.1\s+← running[\s\S]*features[\s\S]*canvas paste[\s\S]*fixes[\s\S]*a fix/);
  assert.equal(s.seen.find((x) => x.url === "/api/changelog")!.query.get("limit"), "3");
  assert.match(f.out, /flow\s+digest\s+blog-desk · schedule/);
  assert.match(f.out, /run\s+run-9 completed/);
  assert.match(none.out, /nothing matches "zzz"/);
});

test("workspaces demo POSTs { demo: true }", async () => {
  const s = await serve({ "POST /api/workspaces": () => ({ ok: true, name: "demo-pipeline", agents: 4, flows: 1 }) });
  const r = await at(s.url, "workspaces", "demo");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /demo-pipeline[\s\S]*4 agents, 1 flow/);
  assert.deepEqual(writes(s).map((w) => w.body), [{ demo: true }]);
});

test("report live lists the agents with frames and saves the newest one", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const s = await serve({
    "/api/workspaces/blog-desk/runs/run-1": () => ({ id: "run-1", status: "running", steps: [] }),
    "/api/workspaces/blog-desk/runs/run-1/live": (_b, q) =>
      q.get("agent") ? raw(jpeg, "image/jpeg", { "x-live-url": encodeURIComponent("https://example.com/a b"), "x-live-at": "2026-10-02T00:00:00Z", "x-live-ended": "1", "x-live-engine": "chromium" }) : { agents: { scout: "2026-10-02T00:00:00Z", reader: "2026-10-02T00:00:01Z" } },
  });
  const list = await at(s.url, "report", "run-1", "live", "--to", "blog-desk");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-live-")), "f.jpg");
  const got = await at(s.url, "report", "run-1", "live", "--to", "blog-desk", "--agent", "scout", "--file", file);
  s.close();
  assert.match(list.out, /scout[\s\S]*reader/);
  assert.equal(got.code, 0, got.out);
  assert.deepEqual(fs.readFileSync(file), jpeg);
  assert.match(got.out, /https:\/\/example\.com\/a b · chromium · .* · browser closed/);
});

test("workspace vocabulary prints each list the editor completes", async () => {
  const s = await serve({ "/api/workspaces/blog-desk/vocabulary": () => ({ agents: ["writer"], flows: ["publish"], skills: [], tools: ["web"], secrets: ["CRM"], scripts: [], types: [], docs: [] }) });
  const r = await at(s.url, "workspace", "vocabulary", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /agents \(1\)\s+writer[\s\S]*secrets \(1\)\s+CRM/);
});

test("repo rm-branch asks, mirror sets and clears, mirror-now reports the push", async () => {
  const s = await serve({
    "POST /api/workspaces/blog-desk/repo": (b) => {
      const body = JSON.parse(b);
      if (body.action === "mirror") return { ok: true, settings: { mirror: body.url } };
      if (body.action === "mirror-now") return { ok: true, status: { ok: false, sha: "abc", detail: "MIRROR_TOKEN is not set — add it under Secrets" } };
      return { ok: true };
    },
  });
  const pipe = await at(s.url, "repo", "rm-branch", "draft", "--to", "blog-desk");
  const rm = await at(s.url, "repo", "rm-branch", "draft", "--to", "blog-desk", "--yes");
  const set = await at(s.url, "repo", "mirror", "https://github.com/acme/desk.git", "--to", "blog-desk");
  const off = await at(s.url, "repo", "mirror", "off", "--to", "blog-desk");
  const now = await at(s.url, "repo", "mirror-now", "--to", "blog-desk");
  s.close();
  assert.equal(pipe.code, 1);
  assert.equal(rm.code, 0, rm.out);
  assert.match(set.out, /mirrored to https:\/\/github\.com\/acme\/desk\.git/);
  assert.match(off.out, /no mirror/);
  assert.equal(now.code, 1);
  assert.match(now.out, /MIRROR_TOKEN is not set/);
  assert.deepEqual(writes(s).map((w) => w.body), [
    { action: "delete-branch", branch: "draft" },
    { action: "mirror", url: "https://github.com/acme/desk.git" },
    { action: "mirror", url: null },
    { action: "mirror-now" },
  ]);
});

test("help names every new verb, and never runs one", async () => {
  for (const [cmd, want] of [["flow", /flow set[\s\S]*flow trigger[\s\S]*flow move-step[\s\S]*flow copy-step[\s\S]*flow paste[\s\S]*flow draft/], ["library", /foldrun library/], ["find", /foldrun find/], ["changelog", /foldrun changelog/], ["preferences", /foldrun preferences/], ["api", /api version/], ["billing", /billing plans[\s\S]*top-up[\s\S]*billing card/], ["history", /history restore/], ["repo", /rm-branch[\s\S]*mirror-now/], ["secrets", /--kind file\|ssh\|api\|service-account\|m2m[\s\S]*secrets clients/], ["schedule", /schedule tick/], ["workspaces", /workspaces demo/], ["report", /report <run-id> live/]] as const) {
    const r = await cli([cmd, "--help"]);
    assert.equal(r.code, 0);
    assert.match(r.out, want, cmd);
  }
});

test("source ls / cat / put / mv / rm — the editor's file door, which had no test of its own", async () => {
  const s = await serve({
    "GET /api/workspaces/blog-desk/source": (_b, q) => (q.get("path") ? { path: q.get("path"), content: "# hi" } : { files: ["AGENTS.md", "flows/publish.md"] }),
    "PUT /api/workspaces/blog-desk/source": () => ({ ok: true }),
    "PATCH /api/workspaces/blog-desk/source": () => ({ ok: true }),
    "DELETE /api/workspaces/blog-desk/source": () => ({ ok: true }),
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-src-")), "x.md");
  fs.writeFileSync(file, "# new\n");
  const ls = await at(s.url, "source", "ls", "flows", "--to", "blog-desk");
  const cat = await at(s.url, "source", "cat", "AGENTS.md", "--to", "blog-desk");
  const put = await at(s.url, "source", "put", "knowledge/x.md", "--file", file, "--message", "why", "--to", "blog-desk");
  const mv = await at(s.url, "source", "mv", "knowledge/x.md", "knowledge/y.md", "--to", "blog-desk");
  const rmPipe = await at(s.url, "source", "rm", "knowledge/y.md", "--to", "blog-desk");
  const rm = await at(s.url, "source", "rm", "knowledge/y.md", "--to", "blog-desk", "--yes");
  s.close();
  assert.match(ls.out, /flows\/publish\.md/);
  assert.doesNotMatch(ls.out, /AGENTS\.md/);
  assert.match(cat.out, /# hi/);
  for (const r of [put, mv, rm]) assert.equal(r.code, 0, r.out);
  assert.equal(rmPipe.code, 1);
  assert.deepEqual(writes(s), [
    { method: "PUT", url: "/api/workspaces/blog-desk/source", body: { path: "knowledge/x.md", content: "# new\n", message: "why" } },
    { method: "PATCH", url: "/api/workspaces/blog-desk/source", body: { from: "knowledge/x.md", to: "knowledge/y.md" } },
    { method: "DELETE", url: "/api/workspaces/blog-desk/source", body: { path: "knowledge/y.md" } },
  ]);
});
