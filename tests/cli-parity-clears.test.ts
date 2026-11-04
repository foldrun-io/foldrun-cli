// Dashboard → CLI parity, 5 Nov 2026: what the dashboard can clear one at a
// time, the CLI can too — one compute figure, one notify channel, an A2A
// card's words, the wallet's email and parts of the invoice details — and
// `billing wallet set auto-top-up off` keeps the threshold and refill, as
// the wallet page's switch does. `usage` prints by flow and by agent.
//
//   node --test tests/cli-parity-clears.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, at, cli, failing } from "./fake-platform.ts";
import { a2aPatchFor } from "../src/commands.mjs";

const bodies = (s: { seen: { method: string; body: string }[] }, method: string) => s.seen.filter((x) => x.method === method).map((x) => JSON.parse(x.body));

// --------------------------------------------------------------- compute

test("account and workspace clear compute <figure> send just those figures as null", async () => {
  const s = await serve({
    "PATCH /api/account": () => ({ ok: true, defaults: {} }),
    "PATCH /api/workspaces/desk": () => ({ ok: true }),
    "/api/workspaces/desk/source": () => ({ content: "---\nname: desk\n---\n" }),
  });
  const one = await at(s.url, "account", "clear", "compute", "disk");
  const two = await at(s.url, "workspace", "clear", "compute", "vcpu", "memory", "--to", "desk");
  const all = await at(s.url, "account", "clear", "compute");
  const bad = await at(s.url, "account", "clear", "compute", "gpus");
  s.close();
  assert.equal(one.code, 0, one.out);
  assert.equal(two.code, 0, two.out);
  assert.equal(all.code, 0, all.out);
  assert.deepEqual(bodies(s, "PATCH"), [{ compute: { diskGiB: null } }, { compute: { vcpu: null, memGiB: null } }, { compute: null }]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /not "gpus"/);
});

test("flow compute --clear disk drops one figure on the platform and in the file", async () => {
  const s = await serve({
    "PATCH /api/workspaces/desk/flows/daily": () => ({ ok: true, flow: { name: "daily", compute: { vcpu: 2, memGiB: null, diskGiB: null } } }),
  });
  const r = await at(s.url, "flow", "compute", "daily", "--clear", "disk", "--to", "desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(bodies(s, "PATCH"), [{ compute: { diskGiB: null } }]);
  assert.match(r.out, /each run may hold 2 vCPU/);

  const { spawnSync } = await import("node:child_process");
  const CLI = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
  const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, FOLDRUN_HOME: "/nonexistent/foldrun-home", NO_COLOR: "1" };
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-clears-")), "acme");
  spawnSync(process.execPath, [CLI, "init", root, "--workspace", "main"], { encoding: "utf8", env: ENV });
  const ws = path.join(root, "workspaces/main");
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  fs.writeFileSync(path.join(ws, "flows/daily.md"), "---\nname: daily\ncompute: { vcpu: 2, memory: 4Gi, disk: 20Gi }\n---\n\n1. [[writer]] — write\n");
  try {
    const one = spawnSync(process.execPath, [CLI, "flow", "compute", "daily", "--clear", "disk"], { encoding: "utf8", cwd: ws, env: ENV });
    assert.equal(one.status, 0, one.stdout + one.stderr);
    let text = fs.readFileSync(path.join(ws, "flows/daily.md"), "utf8");
    assert.doesNotMatch(text, /disk/);
    assert.match(text, /vcpu: 2/);
    assert.match(text, /memory: 4Gi/);
    // The last two go: no compute: block is left behind empty.
    const rest = spawnSync(process.execPath, [CLI, "flow", "compute", "daily", "--clear", "vcpu", "memory"], { encoding: "utf8", cwd: ws, env: ENV });
    assert.equal(rest.status, 0, rest.stdout + rest.stderr);
    text = fs.readFileSync(path.join(ws, "flows/daily.md"), "utf8");
    assert.doesNotMatch(text, /compute:/);
    assert.match(text, /1\. \[\[writer\]\] — write/);
  } finally {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- notify

test("account clear notify email keeps the URL and the events; clear notify url keeps the email", async () => {
  let notify: any = { url: "https://hooks.example.test/x", email: "ops@example.test", events: ["failed", "completed"] };
  const s = await serve({
    "GET /api/account": () => ({ defaults: { notify } }),
    "PATCH /api/account": (b: string) => ({ ok: true, defaults: { notify: JSON.parse(b).notify } }),
  });
  const email = await at(s.url, "account", "clear", "notify", "email");
  const url = await at(s.url, "account", "clear", "notify", "url");
  notify = { email: "ops@example.test", events: ["failed"] };
  const last = await at(s.url, "account", "clear", "notify", "email");
  const none = await at(s.url, "account", "clear", "notify", "url");
  const bad = await at(s.url, "account", "clear", "notify", "slack");
  s.close();
  assert.equal(email.code, 0, email.out);
  assert.equal(url.code, 0, url.out);
  assert.deepEqual(bodies(s, "PATCH"), [
    { notify: { url: "https://hooks.example.test/x", events: ["failed", "completed"] } },
    { notify: { email: "ops@example.test", events: ["failed", "completed"] } },
  ]);
  assert.notEqual(last.code, 0, "the last channel is not cleared by name");
  assert.match(last.out, /only channel — `foldrun account clear notify` turns notify off/);
  assert.notEqual(none.code, 0);
  assert.match(none.out, /no webhook URL set here/);
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /drops one channel/);
});

test("workspace clear notify url reads the workspace's own block and keeps the email", async () => {
  const s = await serve({
    "/api/workspaces/desk/source": () => ({ content: "---\nname: desk\nnotify:\n  url: https://hooks.example.test/y\n  email: desk@example.test\n  events: [failed]\n---\n" }),
    "PATCH /api/workspaces/desk": () => ({ ok: true }),
  });
  const r = await at(s.url, "workspace", "clear", "notify", "url", "--to", "desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(bodies(s, "PATCH"), [{ notify: { email: "desk@example.test", events: ["failed"] } }]);
});

// ------------------------------------------------------------------- a2a

test("a2a --clear-name / --clear-description / --clear-examples send null, on publish and unpublish", () => {
  assert.deepEqual(a2aPatchFor("publish", { "clear-name": true, "clear-examples": true }), { publish: true, name: null, examples: null });
  assert.deepEqual(a2aPatchFor("unpublish", { "clear-description": true }), { publish: false, description: null });
  assert.deepEqual(a2aPatchFor("unpublish", {}), { publish: false }, "unchanged without them");
  assert.throws(() => a2aPatchFor("publish", { name: "x", "clear-name": true }), /--name or --clear-name, not both/);
  assert.throws(() => a2aPatchFor("publish", { example: ["a"], "clear-examples": true }), /--example or --clear-examples, not both/);
});

const PUBLISH_MODULE: string = "@foldrun/core/a2a-publish";
const hasPublish = await import(PUBLISH_MODULE).then((m: any) => typeof m.a2aPublishProblems === "function", () => false);

test("a2a publish --clear-name in a folder removes the card's name from the flow file", { skip: !hasPublish && "this @foldrun/core has no a2a-publish" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-a2a-clear-"));
  fs.mkdirSync(path.join(dir, "flows"));
  fs.mkdirSync(path.join(dir, "agents/researcher"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "---\nname: blog-desk\n---\n");
  fs.writeFileSync(path.join(dir, "flows/publish.md"), "---\ntrigger: manual\na2a:\n  publish: true\n  name: Lead finder\n  description: Finds leads.\n---\n\n1. [[researcher]] — Find leads.\n");
  fs.writeFileSync(path.join(dir, "agents/researcher/agent.md"), "---\nname: researcher\ndescription: Finds sources.\n---\n\nYou research.\n");
  try {
    const r = await cli(["a2a", "publish", "publish", "--clear-name"], { cwd: dir });
    assert.equal(r.code, 0, r.out);
    const text = fs.readFileSync(path.join(dir, "flows/publish.md"), "utf8");
    assert.doesNotMatch(text, /name: Lead finder/);
    assert.match(text, /description: Finds leads\./, "the rest of a2a: kept");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------- billing

test("wallet set auto-top-up off keeps the threshold and refill; wallet clear email sends null", async () => {
  const s = await serve({
    "GET /api/billing/wallet": () => ({ enabled: true, summary: {}, cardSaved: true, autoTopUp: { enabled: true, thresholdUsd: 10, amountUsd: 50 }, email: "ap@acme.test" }),
    "PUT /api/billing/wallet": () => ({ ok: true }),
  });
  const off = await at(s.url, "billing", "wallet", "set", "auto-top-up", "off");
  const clear = await at(s.url, "billing", "wallet", "clear", "email");
  const bad = await at(s.url, "billing", "wallet", "clear", "card");
  s.close();
  assert.equal(off.code, 0, off.out);
  assert.match(off.out, /auto top-up off.*\$50\.00 below \$10\.00 kept/);
  assert.equal(clear.code, 0, clear.out);
  assert.deepEqual(bodies(s, "PUT"), [{ autoTopUp: { enabled: false, thresholdUsd: 10, amountUsd: 50 } }, { email: null }]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /wallet clear email/);
});

test("wallet shows a kept auto top-up as off, with its figures", async () => {
  const s = await serve({
    "GET /api/billing/wallet": () => ({ enabled: true, summary: { balanceUsd: 5 }, cardSaved: true, autoTopUp: { enabled: false, thresholdUsd: 10, amountUsd: 50 }, email: null }),
  });
  const r = await at(s.url, "billing", "wallet");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /auto top-up\s+off \(\$50\.00 below \$10\.00 kept\)/);
});

test("billing details set --clear-address / --clear-email / --clear-abn drop that one and keep the rest", async () => {
  const s = await serve({
    "GET /api/billing/details": () => ({
      details: { legalName: "Acme Pty Ltd", email: "ap@acme.test", abn: "51824753556", address: { line1: "1 Main St", city: "Sydney", country: "AU" } },
      stripe: true,
      customer: true,
    }),
    "PUT /api/billing/details": (b: string) => ({ ok: true, details: JSON.parse(b), synced: true }),
  });
  const addr = await at(s.url, "billing", "details", "set", "--clear-address");
  const rest = await at(s.url, "billing", "details", "set", "--clear-email", "--clear-abn");
  const both = await at(s.url, "billing", "details", "set", "--clear-email", "--email", "x@acme.test");
  s.close();
  assert.equal(addr.code, 0, addr.out);
  assert.equal(rest.code, 0, rest.out);
  assert.deepEqual(bodies(s, "PUT"), [
    { legalName: "Acme Pty Ltd", email: "ap@acme.test", abn: "51824753556" },
    { legalName: "Acme Pty Ltd", address: { line1: "1 Main St", city: "Sydney", country: "AU" } },
  ]);
  assert.notEqual(both.code, 0);
  assert.match(both.out, /--email or --clear-email, not both/);
});

test("a refused wallet read on auto-top-up off says it is the owner's / hosted", async () => {
  const s = await serve({ "GET /api/billing/wallet": () => failing(501, { error: "billing is not part of this edition" }) });
  const r = await at(s.url, "billing", "wallet", "set", "auto-top-up", "off");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /changing the wallet: .*not part of this edition/);
  assert.equal(s.seen.filter((x) => x.method === "PUT").length, 0);
});

// ----------------------------------------------------------------- usage

const series = (name: string, totalUsd: number, runs = 1, change: number | null = null) => ({ name, totalUsd, runs, periods: [], change });

test("usage prints by flow and by agent, most charged first, capped by --limit", async () => {
  const s = await serve({
    "/api/usage": () => ({ tenant: "acme", totals: { runs: 3 }, workspaces: [] }),
    "/api/usage/history": () => ({
      from: "2026-09-10T00:00:00Z",
      to: "2026-11-05T00:00:00Z",
      bucket: "week",
      totalUsd: 12,
      modelUsd: 10,
      platformUsd: 2,
      byWorkspace: [],
      byFlow: [series("desk/cheap", 1, 2), series("desk/costly", 9, 4, 0.5), series("desk/mid", 2, 1, -0.25)],
      byAgent: [series("desk/writer", 7, 5), series("desk/editor", 3, 2)],
    }),
  });
  const r = await at(s.url, "usage");
  const two = await at(s.url, "usage", "--limit", "2");
  const hidden = await at(s.url, "usage", "--limit", "0");
  const bad = await at(s.url, "usage", "--limit", "x");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /by flow/);
  assert.match(r.out, /desk\/costly\s+\$9\.00\s+4 runs\s+\+50%[\s\S]*desk\/mid\s+\$2\.00[\s\S]*desk\/cheap\s+\$1\.00/);
  assert.match(r.out, /by agent[\s\S]*desk\/writer\s+\$7\.00\s+5 runs[\s\S]*desk\/editor/);
  assert.equal(two.code, 0, two.out);
  assert.doesNotMatch(two.out, /desk\/cheap/);
  assert.match(two.out, /and 1 more — --limit <n> shows more/);
  assert.equal(hidden.code, 0, hidden.out);
  assert.doesNotMatch(hidden.out, /desk\/costly/);
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /--limit is a whole number/);
});
