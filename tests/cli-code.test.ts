// `foldrun code`, `agent run --snapshot` and `report <run> patch` — the
// folder goes to the platform as a snapshot, an agent changes it in its own
// sandbox, and the patch the platform made comes back to be applied with git.
//
//   node --test tests/cli-code.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { serve, at, raw, failing } from "./fake-platform.ts";

const ID = "b".repeat(64);
const WS = "/api/workspaces/desk";
const RUN_ID = "run-code-1";

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" });

function repo(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cli-code-"));
  git(d, "init", "-q");
  for (const [p, t] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true });
    fs.writeFileSync(path.join(d, p), t);
  }
  git(d, "add", "-A");
  git(d, "commit", "-qm", "base");
  return d;
}

/** The patch the platform would make: what changed between the folder as
 *  sent and the folder after the agent, paths from the folder's own root. */
function patchFor(base: Record<string, string>, after: Record<string, string | null>): string {
  const d = repo(base);
  for (const [p, t] of Object.entries(after)) {
    if (t === null) fs.rmSync(path.join(d, p));
    else {
      fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true });
      fs.writeFileSync(path.join(d, p), t);
    }
  }
  git(d, "add", "-A");
  return git(d, "diff", "--cached", "--no-renames", "--binary");
}

const record = (status: string, result = "Added a greeting.") => ({
  id: RUN_ID,
  flow: "adhoc:coder",
  status,
  startedAt: "2026-11-18T01:00:00.000Z",
  finishedAt: "2026-11-18T01:02:00.000Z",
  steps: [{ agent: "coder", group: 1, status: status === "completed" ? "completed" : "failed", attempts: 1, costUsd: 0.05, events: [], result, startedAt: "2026-11-18T01:00:00.000Z", finishedAt: "2026-11-18T01:02:00.000Z" }],
});

/** A platform with a coder agent whose run changed the folder. */
function platform(opts: { agents?: string[]; status?: string; meta?: unknown; patch?: string } = {}) {
  const meta = opts.meta ?? { status: "changed", bytes: (opts.patch ?? "").length, modified: ["hello.txt"], added: ["greet.txt"], deleted: [] };
  return serve({
    [`GET ${WS}/agents`]: () => ({ agents: (opts.agents ?? ["coder"]).map((name) => ({ name })) }),
    [`PUT ${WS}/source`]: () => ({ ok: true }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 6, compressedBytes: 100, expiresAt: "2026-11-25T00:00:00.000Z", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => ({ ok: true, runId: RUN_ID, test: false, snapshot: ID }),
    [`GET ${WS}/runs/${RUN_ID}`]: () => record(opts.status ?? "completed"),
    [`GET ${WS}/runs/${RUN_ID}/archive`]: (_b, q) =>
      q.get("path") === "snapshot.json" ? raw(JSON.stringify(meta), "application/json") : raw(opts.patch ?? "", "text/x-diff"),
  });
}

const BASE = { "hello.txt": "hello\n" };
const AFTER = { "hello.txt": "hello, world\n", "greet.txt": "hi\n" };

test("code --task: the folder goes as a snapshot, the agent runs on it in a conversation, and its patch is applied with --yes", async () => {
  const d = repo(BASE);
  const s = await platform({ patch: patchFor(BASE, AFTER) });
  const r = await at(s.url, "code", d, "--to", "desk", "--task", "greet the world", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  const run = s.seen.find((x) => x.method === "POST" && x.url.endsWith("/agents/coder/run"))!;
  const body = JSON.parse(run.body);
  assert.equal(body.task, "greet the world");
  assert.equal(body.snapshot, ID);
  assert.match(body.context, /^code-[0-9a-f]{16}$/, "each session is a conversation");
  assert.ok(s.seen.some((x) => x.method === "POST" && x.url === `${WS}/snapshots`), "the folder was sent");
  assert.match(r.out, /Added a greeting\./, "the agent's reply is shown");
  assert.match(r.out, /✓ applied/);
  assert.equal(fs.readFileSync(path.join(d, "hello.txt"), "utf8"), "hello, world\n");
  assert.equal(fs.readFileSync(path.join(d, "greet.txt"), "utf8"), "hi\n");
});

test("code: with no terminal and no --yes the patch is not applied, and where it is kept is said", async () => {
  const d = repo(BASE);
  const s = await platform({ patch: patchFor(BASE, AFTER) });
  const r = await at(s.url, "code", d, "--to", "desk", "--task", "greet the world");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /not applied — no terminal to ask/);
  assert.match(r.out, /foldrun-run-code-1\.patch/);
  assert.equal(fs.readFileSync(path.join(d, "hello.txt"), "utf8"), "hello\n", "nothing changed in the folder");
});

test("code: a folder inside a repository gets the patch at its own paths — a git apply from the subfolder would skip them all", async () => {
  const top = repo({ "README.md": "top\n", "app/hello.txt": "hello\n" });
  const s = await platform({ patch: patchFor(BASE, AFTER) });
  const r = await at(s.url, "code", path.join(top, "app"), "--to", "desk", "--task", "greet", "--yes");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(path.join(top, "app", "hello.txt"), "utf8"), "hello, world\n");
  assert.equal(fs.readFileSync(path.join(top, "app", "greet.txt"), "utf8"), "hi\n");
  assert.ok(!fs.existsSync(path.join(top, "greet.txt")), "nothing landed at the repository's top");
});

test("code: a patch that no longer fits the folder is refused by git apply --check, and nothing is half-applied", async () => {
  const d = repo(BASE);
  fs.writeFileSync(path.join(d, "hello.txt"), "edited meanwhile\n");
  const s = await platform({ patch: patchFor(BASE, AFTER) });
  const r = await at(s.url, "code", d, "--to", "desk", "--task", "greet", "--yes");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /does not apply to .* as it is now/);
  assert.match(r.out, /The patch is kept at/);
  assert.equal(fs.readFileSync(path.join(d, "hello.txt"), "utf8"), "edited meanwhile\n");
  assert.ok(!fs.existsSync(path.join(d, "greet.txt")), "the added file was not applied either");
});

test("code: a failed run applies nothing and says how to read it", async () => {
  const d = repo(BASE);
  const s = await platform({ status: "failed", patch: patchFor(BASE, AFTER) });
  const r = await at(s.url, "code", d, "--to", "desk", "--task", "greet", "--yes");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /✗ failed/);
  assert.match(r.out, /foldrun report run-code-1 --to desk/);
  assert.ok(!s.seen.some((x) => x.url.endsWith("/archive")), "no patch fetched for a failed run");
  assert.equal(fs.readFileSync(path.join(d, "hello.txt"), "utf8"), "hello\n");
});

test("code: a project with no coder agent is asked first — refused with no terminal, added with --yes", async () => {
  const d = repo(BASE);
  const s = await platform({ agents: [], patch: patchFor(BASE, AFTER) });
  const no = await at(s.url, "code", d, "--to", "desk", "--task", "greet");
  assert.notEqual(no.code, 0);
  assert.match(no.out, /has no coder agent yet/);
  assert.ok(!s.seen.some((x) => x.method === "PUT" || x.url.endsWith("/run")), "nothing written, nothing run");

  const yes = await at(s.url, "code", d, "--to", "desk", "--task", "greet", "--yes");
  s.close();
  assert.equal(yes.code, 0, yes.out);
  const put = JSON.parse(s.seen.find((x) => x.method === "PUT")!.body);
  assert.equal(put.path, "agents/coder/agent.md");
  assert.match(put.content, /^---\nname: coder\n/);
  assert.match(put.content, /tools: \[write, code\]/);
});

test("code: --agent names one that must exist; not a git folder is refused before anything is sent", async () => {
  const d = repo(BASE);
  const s = await platform({ agents: ["coder"] });
  const r = await at(s.url, "code", d, "--to", "desk", "--agent", "fixer", "--task", "x");
  assert.notEqual(r.code, 0);
  assert.match(r.out, /no agent "fixer" in desk/);
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cli-code-plain-"));
  const p = await at(s.url, "code", plain, "--to", "desk", "--task", "x");
  s.close();
  assert.notEqual(p.code, 0);
  assert.match(p.out, /not in a git repository/);
  assert.ok(!s.seen.some((x) => x.method === "POST"), "nothing sent");
});

test("code with no terminal and no --task says how to script it", async () => {
  const d = repo(BASE);
  const s = await platform();
  const r = await at(s.url, "code", d, "--to", "desk");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /in a script, give one turn with --task/);
});

test("agent run --snapshot: a folder is sent first and the run takes its id; an id is used as it is", async () => {
  const d = repo(BASE);
  const s = await platform();
  const r = await at(s.url, "agent", "run", "coder", "--to", "desk", "--task", "greet", "--snapshot", d);
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(s.seen.find((x) => x.url.endsWith("/agents/coder/run"))!.body).snapshot, ID);
  assert.match(r.out, /foldrun report run-code-1 patch --to desk --apply/);

  const before = s.seen.length;
  const id = "c".repeat(64);
  const r2 = await at(s.url, "agent", "run", "coder", "--to", "desk", "--task", "greet", "--snapshot", id);
  s.close();
  assert.equal(r2.code, 0, r2.out);
  const after = s.seen.slice(before);
  assert.ok(!after.some((x) => x.url.endsWith("/snapshots")), "an id sends no folder");
  assert.equal(JSON.parse(after.find((x) => x.url.endsWith("/run"))!.body).snapshot, id);
});

test("report <run> patch: the patch to stdout; --apply --yes puts it into --dir", async () => {
  const d = repo(BASE);
  const patch = patchFor(BASE, AFTER);
  const s = await platform({ patch });
  const r = await at(s.url, "report", RUN_ID, "patch", "--to", "desk");
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes(patch.trim()), "the patch itself is printed");
  assert.match(r.out, /M hello\.txt/);
  assert.match(r.out, /A greet\.txt/);

  const a = await at(s.url, "report", RUN_ID, "patch", "--to", "desk", "--apply", "--dir", d, "--yes");
  s.close();
  assert.equal(a.code, 0, a.out);
  assert.equal(fs.readFileSync(path.join(d, "greet.txt"), "utf8"), "hi\n");
});

test("report <run> patch: unchanged is not an error; unavailable says why; a run with no snapshot says so", async () => {
  const u = await platform({ meta: { status: "unchanged", bytes: 0, modified: [], added: [], deleted: [] } });
  const r = await at(u.url, "report", RUN_ID, "patch", "--to", "desk");
  u.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /changed nothing/);

  const n = await platform({ meta: { status: "unavailable", reason: "the step was stopped before its patch was made" } });
  const r2 = await at(n.url, "report", RUN_ID, "patch", "--to", "desk");
  n.close();
  assert.equal(r2.code, 1);
  assert.match(r2.out, /no patch: the step was stopped/);

  const none = await serve({
    [`GET ${WS}/runs/${RUN_ID}`]: () => record("completed"),
    [`GET ${WS}/runs/${RUN_ID}/archive`]: () => failing(404, { error: "no such file" }),
  });
  const r3 = await at(none.url, "report", RUN_ID, "patch", "--to", "desk");
  none.close();
  assert.equal(r3.code, 1);
  assert.match(r3.out, /was not sent a folder/);
});

test("--help runs nothing", async () => {
  const s = await platform();
  for (const args of [["code", "--help"], ["report", "--help"]]) {
    const h = await at(s.url, ...args);
    assert.equal(h.code, 0);
  }
  s.close();
  assert.equal(s.seen.length, 0);
});
