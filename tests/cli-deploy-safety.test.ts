// Two ways the CLI once acted when a person only asked a question, or did
// not mean it (2026-09-30):
//
//   `foldrun deploy --help` DEPLOYED — --help after a command was parsed into
//   a flag nothing read.
//   A deploy deleted the platform's storage/ outputs and trigger log with no
//   question, as whichever profile happened to be the default.
//
// Help must make no request at all; a deploy that removes files must name
// where it is going and need a yes — and --yes is the only way through
// without a terminal.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, cli } from "./fake-platform.ts";

function flatWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-deploy-safety-"));
  const dir = path.join(root, "blog-desk");
  fs.mkdirSync(path.join(dir, "agents", "writer"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "---\nname: blog-desk\n---\n\nThe blog.\n");
  fs.writeFileSync(path.join(dir, "agents", "writer", "agent.md"), "---\nname: writer\n---\n\nYou write.\n");
  return dir;
}

type Plan = { added: string[]; updated: string[]; removed: string[] };

async function platform(plan: Plan) {
  const deploys: { dryRun: boolean }[] = [];
  const answer = (body: string) => {
    const b = JSON.parse(body || "{}");
    deploys.push({ dryRun: b.dryRun === true });
    return { ok: true, ...plan, issues: [], warnings: [], blockedBy: [], preserved: 0, commit: "c0ffee" };
  };
  const fake = await serve({
    "/api/workspaces/blog-desk/deploy": answer,
    "/api/me": () => ({ actor: { kind: "user", email: "dev@example.com" }, account: "matt", role: "owner", workspaces: null }),
    "/api/workspaces/blog-desk/runtimes": () => ({ runtimes: [] }),
  });
  return { fake, deploys };
}

const run = (dir: string, url: string, ...args: string[]) =>
  cli(["deploy", ...args, "--url", url, "--token", "k"], { cwd: dir });

test("--help, -h and `help deploy` print help and make no request at all", async () => {
  const { fake } = await platform({ added: [], updated: [], removed: [] });
  try {
    const dir = flatWorkspace();
    for (const args of [["deploy", "--help"], ["deploy", "-h"], ["help", "deploy"]]) {
      const r = await cli([...args, "--url", fake.url, "--token", "k"], { cwd: dir });
      assert.equal(r.code, 0, `${args.join(" ")} exits 0`);
      assert.match(r.out, /foldrun deploy/, `${args.join(" ")} prints deploy's help`);
    }
    assert.deepEqual(fake.seen, [], "help reached the platform");
  } finally {
    fake.close();
  }
});

test("a deploy that removes files, with no terminal and no --yes, sends no real deploy", async () => {
  const { fake, deploys } = await platform({ added: [], updated: [], removed: ["storage/report.md", "trigger-log.jsonl", "agents/old/agent.md"] });
  try {
    const r = await run(flatWorkspace(), fake.url);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /deploying to/);
    assert.match(r.out, /dev@example\.com/, "names who it acts as");
    assert.match(r.out, /3 files would be DELETED/);
    assert.match(r.out, /storage\/report\.md/);
    assert.match(r.out, /--yes/, "says how to mean it");
    assert.deepEqual(deploys, [{ dryRun: true }], "only the plan was asked for");
  } finally {
    fake.close();
  }
});

test("the same deploy with --yes deploys", async () => {
  const { fake, deploys } = await platform({ added: [], updated: [], removed: ["storage/report.md"] });
  try {
    const r = await run(flatWorkspace(), fake.url, "--yes");
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(deploys, [{ dryRun: true }, { dryRun: false }]);
    assert.match(r.out, /deployed/);
  } finally {
    fake.close();
  }
});

test("a deploy that only adds and changes files goes straight through, no question", async () => {
  const { fake, deploys } = await platform({ added: ["agents/new/agent.md"], updated: ["AGENTS.md"], removed: [] });
  try {
    const r = await run(flatWorkspace(), fake.url);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(deploys, [{ dryRun: true }, { dryRun: false }]);
  } finally {
    fake.close();
  }
});

test("--dry-run asks for the plan once and deletes nothing", async () => {
  const { fake, deploys } = await platform({ added: [], updated: [], removed: ["storage/report.md"] });
  try {
    const r = await run(flatWorkspace(), fake.url, "--dry-run");
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(deploys, [{ dryRun: true }]);
  } finally {
    fake.close();
  }
});
