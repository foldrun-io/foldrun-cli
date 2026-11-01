// `foldrun a2a …` and `foldrun keys create --a2a` (1 Nov 2026), against a
// fake platform and a fake A2A agent: what each sends — and, as much, what
// it never sends (this CLI's API key to a card's address) — and what it prints.
//
// publish/unpublish need a core that knows a2a: (@foldrun/core/a2a-publish)
// and call/status/cancel core's A2A client (@foldrun/core/a2a-client); with
// an older core installed those tests are skipped and the refusal is tested
// instead.
//
//   node --test tests/cli-a2a.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, at, cli, failing } from "./fake-platform.ts";
import { a2aPatchFor, a2aBlockFor, a2aExitCode } from "../src/commands.mjs";

// In variables: a literal would fail the typecheck against an older core.
const PUBLISH_MODULE: string = "@foldrun/core/a2a-publish";
const CLIENT_MODULE: string = "@foldrun/core/a2a-client";
const hasPublish = await import(PUBLISH_MODULE).then((m: any) => typeof m.a2aPublishProblems === "function", () => false);
const hasClient = await import(CLIENT_MODULE).then((m: any) => typeof m.fetchCard === "function" && typeof m.sendMessage === "function", () => false);

const sha = (t: string) => crypto.createHash("sha256").update(t, "utf8").digest("hex");
const writes = (s: { seen: { method: string; url: string; body: string }[] }) => s.seen.filter((x) => x.method !== "GET");
const json = (out: string) => JSON.parse(out.slice(out.search(/[[{]/)));

const AGENT = "---\nname: researcher\ndescription: Finds sources.\n---\n\nYou research a topic and report what you found.\n";
const FLOW = "---\ntrigger: manual\n---\n\n1. [[researcher]] — Find three leads for {{city}}.\n";
const PUBLISHED = "---\ntrigger: manual\na2a:\n  publish: true\n  name: Lead finder\n  public_card: true\n---\n\n1. [[researcher]] — Find three leads for {{city}}.\n";

function view(base: string, over: Record<string, unknown> = {}) {
  const endpoint = `${base}/a2a/acme/blog-desk/flows/publish`;
  return {
    flows: [
      { flow: "publish", published: true, publicCard: false, name: "Lead finder", description: "Finds leads.", hasInputSchema: false, card: `${endpoint}/.well-known/agent-card.json`, url: endpoint, ...over },
      { flow: "draft", published: false, publicCard: false, name: "draft", description: null, hasInputSchema: false, card: `${base}/a2a/acme/blog-desk/flows/draft/.well-known/agent-card.json`, url: `${base}/a2a/acme/blog-desk/flows/draft` },
    ],
    keys: [{ id: "k9", label: "partner bot", prefix: "mda_a2a12345", flows: ["publish"], maxTasks: 10, expiresAt: null }],
    tasks: [
      { id: "t1", flow: "publish", state: "TASK_STATE_COMPLETED", runId: "r1", contextId: "c1", key: { id: "k9", label: "partner bot", prefix: "mda_a2a12345", revoked: false }, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:01:00Z" },
      { id: "t2", flow: "publish", state: "TASK_STATE_WORKING", runId: "r2", contextId: "c2", key: { id: "k0", label: null, prefix: null, revoked: true }, createdAt: "2026-11-01T00:02:00Z", updatedAt: "2026-11-01T00:02:00Z" },
    ],
  };
}

// ------------------------------------------------------------------ the pure part

test("a2aPatchFor: publish names only what was said; unpublish is publish: false", () => {
  assert.deepEqual(a2aPatchFor("unpublish", { name: "x" }), { publish: false });
  assert.deepEqual(a2aPatchFor("publish", {}), { publish: true });
  assert.deepEqual(a2aPatchFor("publish", { name: "Lead finder", description: "Finds leads.", example: ["Perth dentists", "Hobart cafes"], "public-card": true }), {
    publish: true,
    name: "Lead finder",
    description: "Finds leads.",
    examples: ["Perth dentists", "Hobart cafes"],
    public_card: true,
  });
  assert.deepEqual(a2aPatchFor("publish", { "private-card": true }), { publish: true, public_card: null }, "null removes the key, as the PATCH reads it");
  assert.throws(() => a2aPatchFor("publish", { "public-card": true, "private-card": true }), /not both/);
});

test("a2aBlockFor merges the patch over the flow's block as the platform does: publish first, null removes", () => {
  const current = { name: "Old", public_card: true, input: { type: "object" }, publish: true };
  assert.deepEqual(a2aBlockFor(current, { publish: false }), { publish: false, name: "Old", public_card: true, input: { type: "object" } });
  assert.deepEqual(Object.keys(a2aBlockFor(current, { publish: true, name: "New" })), ["publish", "name", "public_card", "input"]);
  assert.deepEqual(a2aBlockFor(current, { publish: true, public_card: null }), { publish: true, name: "Old", input: { type: "object" } });
  assert.deepEqual(a2aBlockFor(undefined, { publish: true }), { publish: true });
  assert.deepEqual(a2aBlockFor("not a map", { publish: true }), { publish: true }, "a block that does not read is replaced, not merged");
});

// ------------------------------------------------------------------ a2a ls

test("a2a ls --to reads GET /api/workspaces/<ws>/a2a: flows with their cards, keys, tasks with the key that asked", async () => {
  let base = "";
  const s = await serve({ "/api/workspaces/blog-desk/a2a": () => view(base) });
  base = s.url;
  const r = await at(s.url, "a2a", "ls", "--to", "blog-desk");
  const j = await at(s.url, "a2a", "ls", "--to", "blog-desk", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen[0].method, "GET");
  assert.equal(s.seen[0].url, "/api/workspaces/blog-desk/a2a");
  assert.match(r.out, /published\s+publish\s+Lead finder\s+private card/);
  assert.match(r.out, new RegExp(`card\\s+${base}/a2a/acme/blog-desk/flows/publish/\\.well-known/agent-card\\.json`));
  assert.match(r.out, /not published\s+draft/);
  assert.doesNotMatch(r.out, /flows\/draft\/\.well-known/, "an unpublished flow's card is not offered");
  assert.match(r.out, /k9\s+mda_a2a12345…\s+partner bot\s+publish · up to 10 open/);
  assert.match(r.out, /✓ completed\s+publish\s+A2A · partner bot/);
  assert.match(r.out, /working\s+publish\s+A2A · a key since removed/);
  assert.deepEqual(json(j.out).tasks.length, 2);
});

test("a2a ls: keys null (not an admin) leaves the keys out; no workspace is refused before any request", async () => {
  let base = "";
  const s = await serve({ "/api/workspaces/blog-desk/a2a": () => ({ ...view(base), keys: null, tasks: [] }) });
  base = s.url;
  const r = await at(s.url, "a2a", "ls", "--to", "blog-desk");
  const none = await cli(["a2a", "ls", "--url", s.url, "--token", "k"], { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-a2a-empty-")) });
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /A2A keys/);
  assert.match(r.out, /none yet/);
  assert.equal(none.code, 1);
  assert.match(none.out, /which workspace/);
  assert.equal(s.seen.length, 1);
});

// ------------------------------------------------------------------ keys

test("keys create --a2a posts { purpose: a2a, workspace, flows, maxTasks } and prints the key once", async () => {
  const s = await serve({
    "POST /api/keys": () => ({ ok: true, key: "mda_a2asecret", id: "k9", prefix: "mda_a2asecr", purpose: "a2a", workspace: "blog-desk", flows: ["publish", "draft"], maxTasks: 3, role: "viewer", workspaces: ["blog-desk"], expiresAt: null }),
  });
  const r = await at(s.url, "keys", "create", "partner bot", "--a2a", "--to", "blog-desk", "--flows", "publish, draft,publish", "--max-tasks", "3", "--expires", "90d");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { label: "partner bot", purpose: "a2a", workspace: "blog-desk", flows: ["publish", "draft"], maxTasks: 3, expires: "90d" });
  assert.match(r.out, /✓ partner bot\s+k9\s+A2A · blog-desk · publish, draft · up to 3 open/);
  assert.equal(r.out.split("mda_a2asecret").length - 1, 1, "the key is printed once");
  assert.match(r.out, /opens \/a2a only/);
  assert.match(r.out, /FOLDRUN_A2A_KEY=<key> foldrun a2a call/);
});

test("keys create --a2a refuses, before any request, without --to or --flows, a bad --max-tasks, or --role", async () => {
  const s = await serve({ "POST /api/keys": () => ({ ok: true }) });
  const noWs = await at(s.url, "keys", "create", "bot", "--a2a", "--flows", "publish");
  const noFlows = await at(s.url, "keys", "create", "bot", "--a2a", "--to", "blog-desk");
  const bad = await at(s.url, "keys", "create", "bot", "--a2a", "--to", "blog-desk", "--flows", "publish", "--max-tasks", "500");
  const role = await at(s.url, "keys", "create", "bot", "--a2a", "--to", "blog-desk", "--flows", "publish", "--role", "admin");
  s.close();
  for (const r of [noWs, noFlows, bad, role]) assert.equal(r.code, 1, r.out);
  assert.match(noWs.out, /which workspace/);
  assert.match(noFlows.out, /which flows may it call/);
  assert.match(bad.out, /--max-tasks takes a whole number from 1 to 100/);
  assert.match(role.out, /not --role or --workspaces/);
  assert.equal(s.seen.length, 0);
});

test("keys ls shows an A2A key as A2A · <workspace> · <flows>", async () => {
  const s = await serve({
    "/api/keys": () => ({
      keys: [{ id: "k9", prefix: "mda_a2a12345", label: "partner bot", role: "viewer", workspaces: ["blog-desk"], purpose: "a2a", a2a: { workspace: "blog-desk", flows: ["publish"], principal: "k9", maxTasks: 10 }, createdAt: "2026-11-01T00:00:00Z", revokedAt: null, expiresAt: null, lastUsedAt: null }],
    }),
  });
  const r = await at(s.url, "keys", "ls");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /live\s+k9\s+mda_a2a12345…\s+partner bot\s+A2A · blog-desk · publish · up to 10 open/);
});

// ------------------------------------------------------------------ publish

function platformDesk(flow = FLOW) {
  const files: Record<string, string> = {
    "AGENTS.md": "---\nname: blog-desk\n---\n",
    "flows/publish.md": flow,
    "agents/researcher/agent.md": AGENT,
  };
  let base = "";
  return {
    files,
    setBase: (b: string) => (base = b),
    routes: {
      "/api/workspaces/blog-desk/source": (_b: string, q: URLSearchParams) => (q.get("path") ? { path: q.get("path"), content: files[q.get("path")!] } : { files: Object.keys(files) }),
      "/api/workspaces/blog-desk": () => ({ name: "blog-desk" }),
      "PATCH /api/workspaces/blog-desk/flows/publish": () => ({ ok: true }),
      "/api/workspaces/blog-desk/a2a": () => view(base),
    },
  };
}

test("a2a publish --to sends the flow page's PATCH { a2a, expect } and prints the card", { skip: !hasPublish && "this @foldrun/core has no a2a-publish" }, async () => {
  const d = platformDesk();
  const s = await serve(d.routes);
  d.setBase(s.url);
  const r = await at(s.url, "a2a", "publish", "publish", "--to", "blog-desk", "--name", "Lead finder", "--example", "Perth dentists", "--public-card");
  s.close();
  assert.equal(r.code, 0, r.out);
  const w = writes(s);
  assert.equal(w.length, 1, "one write");
  assert.equal(w[0].method, "PATCH");
  assert.equal(w[0].url, "/api/workspaces/blog-desk/flows/publish");
  assert.deepEqual(JSON.parse(w[0].body), { a2a: { publish: true, name: "Lead finder", examples: ["Perth dentists"], public_card: true }, expect: sha(FLOW) });
  assert.match(r.out, /\+ a2a:/, "the diff is shown");
  assert.match(r.out, /\+\s+publish: true/);
  assert.match(r.out, new RegExp(`card\\s+${s.url}/a2a/acme/blog-desk/flows/publish/\\.well-known/agent-card\\.json`));
  assert.match(r.out, /foldrun keys create <label> --a2a --to blog-desk --flows publish/);
});

test("a2a unpublish --to sends PATCH { a2a: { publish: false } }; --dry-run and a flow with no a2a: send nothing", { skip: !hasPublish && "this @foldrun/core has no a2a-publish" }, async () => {
  const d = platformDesk(PUBLISHED);
  const s = await serve(d.routes);
  d.setBase(s.url);
  const dry = await at(s.url, "a2a", "unpublish", "publish", "--to", "blog-desk", "--dry-run");
  assert.equal(writes(s).length, 0, "--dry-run writes nothing");
  const r = await at(s.url, "a2a", "unpublish", "publish", "--to", "blog-desk");
  s.close();
  assert.equal(dry.code, 0, dry.out);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(writes(s)[0].body), { a2a: { publish: false }, expect: sha(PUBLISHED) });
  assert.match(r.out, /-\s+publish: true/);
  assert.match(r.out, /\+\s+publish: false/);

  const plain = platformDesk(FLOW);
  const s2 = await serve(plain.routes);
  const none = await at(s2.url, "a2a", "unpublish", "publish", "--to", "blog-desk");
  s2.close();
  assert.equal(none.code, 0, none.out);
  assert.match(none.out, /nothing to change/);
  assert.equal(writes(s2).length, 0);
});

test("a2a publish: the platform's refusal (an editor) is its own words", { skip: !hasPublish && "this @foldrun/core has no a2a-publish" }, async () => {
  const d = platformDesk();
  const s = await serve({
    ...d.routes,
    "PATCH /api/workspaces/blog-desk/flows/publish": () => failing(403, { error: "this would change a2a: in flows/publish.md — changing it needs the admin role (workspace:manage); your role is editor." }),
  });
  const r = await at(s.url, "a2a", "publish", "publish", "--to", "blog-desk");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /needs the admin role/);
});

test("a2a publish in a folder writes a2a: into the flow file, the rest byte for byte", { skip: !hasPublish && "this @foldrun/core has no a2a-publish" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-a2a-local-"));
  fs.mkdirSync(path.join(dir, "flows"));
  fs.mkdirSync(path.join(dir, "agents/researcher"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "---\nname: blog-desk\n---\n");
  fs.writeFileSync(path.join(dir, "flows/publish.md"), FLOW);
  fs.writeFileSync(path.join(dir, "agents/researcher/agent.md"), AGENT);
  const r = await cli(["a2a", "publish", "publish", "--description", "Finds three leads"], { cwd: dir });
  assert.equal(r.code, 0, r.out);
  const text = fs.readFileSync(path.join(dir, "flows/publish.md"), "utf8");
  assert.match(text, /^---\ntrigger: manual\na2a:\n  publish: true\n  description: Finds three leads\n---\n/);
  assert.ok(text.endsWith("1. [[researcher]] — Find three leads for {{city}}.\n"));
  assert.match(r.out, /foldrun deploy/);
});

test("a2a publish on a core without a2a-publish refuses clearly and writes nothing", { skip: hasPublish && "this @foldrun/core has a2a-publish" }, async () => {
  const d = platformDesk();
  const s = await serve(d.routes);
  const r = await at(s.url, "a2a", "publish", "publish", "--to", "blog-desk");
  s.close();
  assert.equal(r.code, 1);
  assert.match(r.out, /needs an @foldrun\/core that knows a2a:/);
  assert.equal(writes(s).length, 0);
});

// ------------------------------------------------------------------ the card

test("a2a card: a public card is fetched with no Authorization at all — never this CLI's API key", async () => {
  let base = "";
  const card = { name: "Lead finder", supportedInterfaces: [{ url: "x", protocolBinding: "JSONRPC", protocolVersion: "1.0" }] };
  const s = await serve({
    "/api/workspaces/blog-desk/a2a": () => view(base, { publicCard: true }),
    "/a2a/acme/blog-desk/flows/publish/.well-known/agent-card.json": () => card,
  });
  base = s.url;
  const r = await cli(["a2a", "card", "publish", "--to", "blog-desk", "--url", s.url, "--token", "k"], { env: { FOLDRUN_A2A_KEY: "mda_a2asecret" } });
  s.close();
  assert.equal(r.code, 0, r.out);
  const got = s.seen.find((x) => x.url.endsWith("agent-card.json"))!;
  assert.equal(got.headers.authorization, undefined, "a public card needs no key, so none is sent");
  assert.equal(got.headers["a2a-version"], "1.0");
  assert.match(r.out, /"name": "Lead finder"/);
});

test("a2a card: a private card without an A2A key prints the URLs and says how; with one, sends only that key", async () => {
  let base = "";
  const s = await serve({
    "/api/workspaces/blog-desk/a2a": () => view(base),
    "/a2a/acme/blog-desk/flows/publish/.well-known/agent-card.json": () => ({ name: "Lead finder" }),
  });
  base = s.url;
  const bare = await cli(["a2a", "card", "publish", "--to", "blog-desk", "--url", s.url, "--token", "k"], { env: { FOLDRUN_A2A_KEY: "" } });
  assert.equal(bare.code, 0, bare.out);
  assert.match(bare.out, /a private card — reading it takes an A2A key/);
  assert.equal(s.seen.filter((x) => x.url.endsWith("agent-card.json")).length, 0, "nothing sent to the card");
  const keyed = await cli(["a2a", "card", "publish", "--to", "blog-desk", "--url", s.url, "--token", "k", "--key-env", "PARTNER_KEY"], { env: { PARTNER_KEY: "mda_partner" } });
  const unpub = await at(s.url, "a2a", "card", "draft", "--to", "blog-desk");
  s.close();
  assert.equal(keyed.code, 0, keyed.out);
  const got = s.seen.find((x) => x.url.endsWith("agent-card.json"))!;
  assert.equal(got.headers.authorization, "Bearer mda_partner");
  assert.equal(unpub.code, 1);
  assert.match(unpub.out, /is not published/);
});

// ------------------------------------------------------------------ call, status, cancel

/** A fake A2A 1.0 agent: its card, and JSON-RPC that answers each method. */
async function agent(answer: (method: string, params: any) => unknown) {
  let base = "";
  const s = await serve({
    "/a2a/acme/blog-desk/flows/publish/.well-known/agent-card.json": () => ({
      name: "Lead finder",
      supportedInterfaces: [{ url: `${base}/a2a/acme/blog-desk/flows/publish`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
      capabilities: { streaming: false, pushNotifications: false },
    }),
    "POST /a2a/acme/blog-desk/flows/publish": (body) => {
      const req = JSON.parse(body);
      return { jsonrpc: "2.0", id: req.id, ...(answer(req.method, req.params) as object) };
    },
  });
  base = s.url;
  return { ...s, card: `${s.url}/a2a/acme/blog-desk/flows/publish/.well-known/agent-card.json` };
}

const task = (state: string, extra: Record<string, unknown> = {}) => ({ id: "t1", contextId: "c1", status: { state, ...(state === "TASK_STATE_WORKING" ? { message: { messageId: "s", role: "ROLE_AGENT", parts: [{ text: "waiting for a person" }] } } : {}) }, ...extra });
const DONE = task("TASK_STATE_COMPLETED", { artifacts: [{ artifactId: "a1", name: "result", parts: [{ text: "Three leads: A, B, C" }] }] });

test("a2a call: SendMessage with the text and data, then GetTask until it ends; the A2A key, never the API key", { skip: !hasClient && "this @foldrun/core has no a2a-client" }, async () => {
  const calls: { method: string; params: any }[] = [];
  const a = await agent((method, params) => {
    calls.push({ method, params });
    return { result: method === "SendMessage" ? { task: task("TASK_STATE_WORKING") } : DONE };
  });
  const r = await cli(["a2a", "call", a.card, "Leads", "for", "Perth", "--data", '{"city":"Perth"}', "--context", "c1", "--url", a.url, "--token", "k"], { env: { FOLDRUN_A2A_KEY: "mda_a2asecret" } });
  a.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(calls.map((c) => c.method), ["SendMessage", "GetTask"]);
  const sent = calls[0].params.message;
  assert.equal(sent.role, "ROLE_USER");
  assert.equal(sent.contextId, "c1");
  assert.deepEqual(sent.parts, [{ text: "Leads for Perth" }, { data: { city: "Perth" }, mediaType: "application/json" }]);
  assert.ok(sent.messageId, "a messageId on every message");
  for (const x of a.seen) {
    assert.notEqual(x.headers.authorization, "Bearer k", "this CLI's API key never goes to a card's address");
    assert.equal(x.headers.authorization, "Bearer mda_a2asecret");
    assert.equal(x.headers["a2a-version"], "1.0");
  }
  assert.match(r.out, /task t1/);
  assert.match(r.out, /✓ completed\s+task t1 · context c1/);
  assert.match(r.out, /Three leads: A, B, C/);
});

test("a2a call --no-wait answers the task as SendMessage left it, with how to ask again", { skip: !hasClient && "this @foldrun/core has no a2a-client" }, async () => {
  const a = await agent(() => ({ result: { task: task("TASK_STATE_WORKING") } }));
  const r = await cli(["a2a", "call", a.card, "Leads", "--no-wait", "--url", a.url, "--token", "k"], { env: { FOLDRUN_A2A_KEY: "mda_a2asecret" } });
  a.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(a.seen.filter((x) => x.method === "POST").length, 1, "no GetTask");
  assert.match(r.out, /working/);
  assert.match(r.out, /waiting for a person/);
  assert.match(r.out, new RegExp(`foldrun a2a status t1 --card ${a.card.replace(/[.]/g, "\\.")}`));
});

test("a2a call: a refused key says where the A2A key goes; a failed task exits 1", { skip: !hasClient && "this @foldrun/core has no a2a-client" }, async () => {
  let base = "";
  const s = await serve({ "/a2a/x/.well-known/agent-card.json": () => failing(401, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "no key" } }) });
  base = s.url;
  const r = await cli(["a2a", "call", `${base}/a2a/x/.well-known/agent-card.json`, "hi", "--url", s.url, "--token", "k"], { env: { FOLDRUN_A2A_KEY: "" } });
  s.close();
  assert.equal(r.code, 1);
  assert.match(r.out, /no A2A key was sent: export it in \$FOLDRUN_A2A_KEY/);
  assert.equal(s.seen[0].headers.authorization, undefined, "with no A2A key, nothing — not the API key");

  const a = await agent(() => ({ result: { task: task("TASK_STATE_FAILED", { status: { state: "TASK_STATE_FAILED", message: { messageId: "s", role: "ROLE_AGENT", parts: [{ text: "the run failed" }] } } }) } }));
  const failed = await cli(["a2a", "call", a.card, "hi", "--url", a.url, "--token", "k"], { env: { FOLDRUN_A2A_KEY: "mda_a2asecret" } });
  a.close();
  assert.equal(failed.code, 1, failed.out);
  assert.match(failed.out, /✗ failed/);
  assert.match(failed.out, /the run failed/);
});

test("a2a status and cancel ask the card's agent; cancel asks first (--yes) and exits 0 on canceled", { skip: !hasClient && "this @foldrun/core has no a2a-client" }, async () => {
  const calls: { method: string; params: any }[] = [];
  const a = await agent((method, params) => {
    calls.push({ method, params });
    return { result: method === "CancelTask" ? task("TASK_STATE_CANCELED") : task("TASK_STATE_WORKING") };
  });
  const env = { env: { FOLDRUN_A2A_KEY: "mda_a2asecret" } };
  const st = await cli(["a2a", "status", "t1", "--card", a.card, "--url", a.url, "--token", "k"], env);
  const noYes = await cli(["a2a", "cancel", "t1", "--card", a.card, "--url", a.url, "--token", "k"], env);
  const cancel = await cli(["a2a", "cancel", "t1", "--card", a.card, "--yes", "--url", a.url, "--token", "k"], env);
  a.close();
  assert.equal(st.code, 0, st.out);
  assert.match(st.out, /working/);
  assert.equal(noYes.code, 1);
  assert.match(noYes.out, /pass --yes/);
  assert.equal(cancel.code, 0, cancel.out);
  assert.match(cancel.out, /canceled/);
  assert.deepEqual(calls.map((c) => [c.method, c.params.id]), [["GetTask", "t1"], ["CancelTask", "t1"]]);
});

// An outside agent's words reach this terminal: escape sequences in them
// (cursor moves, a retitle, OSC 52 writing the clipboard) are stripped
// from the reply text and from the ids it sends back (Codex review, 1 Nov).
const ESC = "\u001b";
const HOSTILE = `${ESC}]52;c;cm0gLXJmIH4=\u0007${ESC}[2J${ESC}]0;owned\u0007`;

test("a2a call/status: an agent's reply text and ids are printed without control sequences", { skip: !hasClient && "this @foldrun/core has no a2a-client" }, async () => {
  const env = { env: { FOLDRUN_A2A_KEY: "mda_a2asecret" } };
  const evilTask = { id: `t1${HOSTILE}`, contextId: `c1${HOSTILE}`, status: { state: "TASK_STATE_COMPLETED" }, artifacts: [{ artifactId: "a1", parts: [{ text: `Three leads${HOSTILE}\nline two` }] }] };
  // GetTask answers about the task it was asked for (core refuses an answer
  // about another one); the hostile text still rides its context id and reply.
  const a = await agent((method, params) => ({ result: method === "SendMessage" ? { task: evilTask } : { ...evilTask, id: params.id } }));
  const called = await cli(["a2a", "call", a.card, "Leads", "--url", a.url, "--token", "k"], env);
  const status = await cli(["a2a", "status", "t1", "--card", a.card, "--url", a.url, "--token", "k"], env);
  a.close();
  for (const r of [called, status]) {
    assert.equal(r.code, 0, r.out);
    assert.ok(!r.out.includes(ESC), `no escape character reaches the terminal: ${JSON.stringify(r.out)}`);
    assert.ok(!r.out.includes("\u0007"), "no BEL either");
    assert.match(r.out, /Three leads\]52;c;cm0gLXJmIH4=/, "the text is kept, its control characters gone");
    assert.match(r.out, /line two/, "newlines survive");
  }

  // A direct Message answer (no task) goes through the same filter.
  const m = await agent(() => ({ result: { message: { messageId: "r1", role: "ROLE_AGENT", parts: [{ text: `hello${HOSTILE}` }] } } }));
  const direct = await cli(["a2a", "call", m.card, "hi", "--url", m.url, "--token", "k"], env);
  m.close();
  assert.equal(direct.code, 0, direct.out);
  assert.match(direct.out, /hello/);
  assert.ok(!direct.out.includes(ESC), JSON.stringify(direct.out));
});

test("a2aExitCode: the same answer for words and --json; cancel succeeds only on canceled", () => {
  const TERMINAL = new Set(["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"]);
  const t = (state: string) => ({ status: { state } });
  assert.equal(a2aExitCode("status", t("TASK_STATE_COMPLETED"), TERMINAL), 0);
  assert.equal(a2aExitCode("status", t("TASK_STATE_WORKING"), TERMINAL), 0, "still open is not a failure");
  assert.equal(a2aExitCode("status", t("TASK_STATE_FAILED"), TERMINAL), 1);
  assert.equal(a2aExitCode("status", t("TASK_STATE_REJECTED"), TERMINAL), 1);
  assert.equal(a2aExitCode("call", t("TASK_STATE_CANCELED"), TERMINAL), 1);
  assert.equal(a2aExitCode("cancel", t("TASK_STATE_CANCELED"), TERMINAL), 0);
  assert.equal(a2aExitCode("cancel", t("TASK_STATE_WORKING"), TERMINAL), 1, "a cancel the agent did not carry out");
  assert.equal(a2aExitCode("cancel", t("TASK_STATE_COMPLETED"), TERMINAL), 1);
  assert.equal(a2aExitCode("cancel", {}, TERMINAL), 1);
});

test("a2a status --json exits 1 for a failed or rejected task; cancel --json exits 1 when the task is not canceled", { skip: !hasClient && "this @foldrun/core has no a2a-client" }, async () => {
  const env = { env: { FOLDRUN_A2A_KEY: "mda_a2asecret" } };
  for (const state of ["TASK_STATE_FAILED", "TASK_STATE_REJECTED"]) {
    const a = await agent(() => ({ result: task(state) }));
    const words = await cli(["a2a", "status", "t1", "--card", a.card, "--url", a.url, "--token", "k"], env);
    const asJson = await cli(["a2a", "status", "t1", "--card", a.card, "--json", "--url", a.url, "--token", "k"], env);
    a.close();
    assert.equal(words.code, 1, words.out);
    assert.equal(asJson.code, 1, `--json exits as the words do: ${asJson.out}`);
    assert.equal(json(asJson.out).status.state, state);
  }
  const ok = await agent(() => ({ result: task("TASK_STATE_WORKING") }));
  const working = await cli(["a2a", "status", "t1", "--card", ok.card, "--json", "--url", ok.url, "--token", "k"], env);
  // The agent answers CancelTask with a task still working: not canceled.
  const notCanceled = await cli(["a2a", "cancel", "t1", "--card", ok.card, "--yes", "--json", "--url", ok.url, "--token", "k"], env);
  ok.close();
  assert.equal(working.code, 0, working.out);
  assert.equal(notCanceled.code, 1, notCanceled.out);
  const done = await agent(() => ({ result: task("TASK_STATE_CANCELED") }));
  const canceled = await cli(["a2a", "cancel", "t1", "--card", done.card, "--yes", "--json", "--url", done.url, "--token", "k"], env);
  done.close();
  assert.equal(canceled.code, 0, canceled.out);
});

test("a2a call/status refuse a bad card URL, a key in the URL, and an unset --key-env before sending anything", async () => {
  const s = await serve({});
  const notUrl = await at(s.url, "a2a", "call", "not-a-url", "hi");
  const creds = await at(s.url, "a2a", "call", `http://u:p@127.0.0.1:1/card.json`, "hi");
  const noText = await at(s.url, "a2a", "call", `${s.url}/card.json`);
  const unset = await cli(["a2a", "status", "t1", "--card", `${s.url}/card.json`, "--key-env", "NOT_SET_ANYWHERE", "--url", s.url, "--token", "k"]);
  const noCard = await at(s.url, "a2a", "status", "t1");
  s.close();
  for (const r of [notUrl, creds, noText, noCard]) assert.equal(r.code, 1, r.out);
  assert.match(notUrl.out, /is not a URL/);
  assert.match(creds.out, /user name or password/);
  assert.match(noText.out, /what should it do/);
  assert.match(noCard.out, /agent card's URL/);
  assert.equal(unset.code, 1);
  assert.match(unset.out, hasClient ? /\$NOT_SET_ANYWHERE is not set/ : /needs an @foldrun\/core with the A2A client/);
  assert.equal(s.seen.length, 0);
});

test("a2a call on a core without the A2A client refuses clearly", { skip: hasClient && "this @foldrun/core has a2a-client" }, async () => {
  const s = await serve({});
  const r = await at(s.url, "a2a", "call", `${s.url}/card.json`, "hi");
  s.close();
  assert.equal(r.code, 1);
  assert.match(r.out, /needs an @foldrun\/core with the A2A client/);
  assert.equal(s.seen.length, 0);
});

test("a2a --help lists every verb, and never runs one", async () => {
  const r = await cli(["a2a", "--help"]);
  assert.equal(r.code, 0);
  for (const v of ["ls", "publish", "unpublish", "card", "call", "status"]) assert.match(r.out, new RegExp(`foldrun a2a ${v}`));
  assert.match(r.out, /--key-env/);
  assert.match(r.out, /--card <url>/);
  const k = await cli(["keys", "--help"]);
  assert.match(k.out, /keys create <label> --a2a --to <ws> --flows a,b/);
  assert.match(k.out, /--a2a/);
});
