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
import http from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { serve, at, raw, failing } from "./fake-platform.ts";

const ID = "b".repeat(64);
const WS = "/v1/workspaces/desk";
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

const record = (status: string, result = "Added a greeting.", snapshot: boolean = true) => ({
  id: RUN_ID,
  flow: "adhoc:coder",
  status,
  ...(snapshot ? { snapshot: { id: ID } } : {}),
  startedAt: "2026-11-18T01:00:00.000Z",
  finishedAt: "2026-11-18T01:02:00.000Z",
  steps: [{ agent: "coder", group: 1, status: status === "completed" ? "completed" : "failed", attempts: 1, costUsd: 0.05, events: [{ type: "tool", text: "Bash", call: "c1" }, { type: "tool", text: "Bash", call: "c1", ms: 5 }, { type: "tool", text: "Read", call: "c2" }, { type: "tool", text: "Read", call: "c2", ms: 5 }, { type: "tool", text: "Read", call: "c3" }, { type: "tool", text: "Read", call: "c3", ms: 5 }, { type: "tool", text: "Read", call: "c4" }, { type: "tool", text: "Read", call: "c4", ms: 5 }, ...(result ? [{ type: "text", text: result }] : [])], result, startedAt: "2026-11-18T01:00:00.000Z", finishedAt: "2026-11-18T01:02:00.000Z" }],
});

/** A platform with a coder agent whose run changed the folder. */
function platform(opts: { agents?: string[]; status?: string; meta?: unknown; patch?: string; missing?: boolean } = {}) {
  const meta = opts.meta ?? { status: "changed", bytes: (opts.patch ?? "").length, modified: ["hello.txt"], added: ["greet.txt"], deleted: [] };
  let exists = !opts.missing;
  let agents = opts.agents ?? ["coder"];
  return serve({
    [`GET ${WS}`]: () => (exists ? { name: "desk" } : failing(404, { error: "workspace not found" })),
    ["POST /v1/workspaces"]: () => {
      if (exists) return failing(409, { error: "a workspace called desk exists — nothing was changed" });
      exists = true;
      agents = [];
      return { name: "desk", agents: 0, flows: 0 };
    },
    [`GET ${WS}/agents`]: () => ({ agents: agents.map((name) => ({ name })) }),
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
  assert.equal((r.out.match(/Added a greeting\./g) ?? []).length, 1, "the reply is shown once, not also as a live line");
  assert.match(r.out, /● Run\n/, "the agent's steps are shown as they happen, as a verb (a call under a second has no time)");
  assert.match(r.out, /● Read ×3\n/, "the same bare call in a row is one line with a count");
  assert.equal((r.out.match(/● Read/g) ?? []).length, 1);
  assert.equal(r.out.match(/add capture: full to desk's AGENTS\.md — runs then keep each tool's input and output too/g)?.length, 1, "with no inputs recorded, how to see them is said once, with what it stores");
  assert.doesNotMatch(r.out, /run-code-1/, "the run's id is not on the turn's lines — /status has it");
  assert.match(r.out, /✓ done · 2m 00s · \$0\.050/, "the turn ends with how long and what it cost");
  assert.match(r.out, /session code-[0-9a-f]{16}/, "the header names the session");
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
  assert.match(r.out, /foldrun-patch-[^/\s]+\/run-code-1\.patch/);
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
  assert.equal(put.ifMatch, null, "create-only: a coder written meanwhile is never overwritten");
  assert.match(put.content, /^---\nname: coder\n/);
  assert.match(put.content, /tools: \[write, code\]/);
});

test("code --to a project that is not there: asked, refused with no terminal; with --yes made blank with its coder agent in one go (owner, 19 Nov)", async (t) => {
  const d = repo(BASE);
  const s = await platform({ missing: true, patch: patchFor(BASE, AFTER) });
  t.after(() => s.close());
  const no = await at(s.url, "code", d, "--to", "desk", "--task", "greet");
  assert.notEqual(no.code, 0);
  assert.match(no.out, /there is no project desk/);
  assert.match(no.out, /pass --yes/);
  assert.ok(!s.seen.some((x) => x.method !== "GET"), "nothing made");

  const yes = await at(s.url, "code", d, "--to", "desk", "--task", "greet", "--yes");
  assert.equal(yes.code, 0, yes.out);
  const made = JSON.parse(s.seen.find((x) => x.method === "POST" && x.url === "/v1/workspaces")!.body);
  assert.deepEqual(made, { name: "desk", template: true, ifAbsent: true }, "created only if absent: never over one made meanwhile");
  assert.match(yes.out, /✓ created desk/);
  assert.doesNotMatch(yes.out, /has no coder agent yet/, "one question, not two");
  assert.equal(JSON.parse(s.seen.find((x) => x.method === "PUT")!.body).path, "agents/coder/agent.md");
  assert.match(yes.out, /✓ applied/);
  assert.equal(fs.readFileSync(path.join(d, "greet.txt"), "utf8"), "hi\n");
});

test("code: a coder agent written while foldrun code waited is used, not overwritten (Codex)", async (t) => {
  const d = repo(BASE);
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [] }),
    [`PUT ${WS}/source`]: () => failing(409, { error: "agents/coder/agent.md changed since it was loaded", sha256: "x" }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 6, compressedBytes: 100, expiresAt: "x", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => ({ ok: true, runId: RUN_ID }),
    [`GET ${WS}/runs/${RUN_ID}`]: () => record("completed"),
    [`GET ${WS}/runs/${RUN_ID}/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "unchanged" }), "application/json") : raw("", "text/x-diff")),
  });
  t.after(() => s.close());
  const r = await at(s.url, "code", d, "--to", "desk", "--task", "x", "--yes");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /appeared in desk meanwhile — using that one/);
  assert.ok(s.seen.some((x) => x.url.endsWith("/agents/coder/run")), "the turn ran on the agent that won");
});

test("code --to a missing project with --agent other than coder: refused, nothing made", async () => {
  const d = repo(BASE);
  const s = await platform({ missing: true });
  const r = await at(s.url, "code", d, "--to", "desk", "--agent", "fixer", "--task", "x", "--yes");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /no project "desk".*no agent "fixer"/);
  assert.ok(!s.seen.some((x) => x.method !== "GET"), "nothing made");
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
  assert.match(p.out, /is not a git repository — the cloud needs git/);
  assert.ok(!s.seen.some((x) => x.method === "POST"), "nothing sent");
});

test("code with no terminal and no --task says how to script it", async () => {
  const d = repo(BASE);
  const s = await platform();
  const r = await at(s.url, "code", d, "--to", "desk");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /in a script, give one turn with -p "…" \(or --task/);
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

/** The binary with stdout and stderr apart — `report patch` promises the
 *  patch alone on stdout, byte for byte. */
function split(args: string[]): Promise<{ stdout: Buffer; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(import.meta.dirname, "..", "bin/foldrun.mjs"), ...args], {
      env: { ...process.env, FOLDRUN_HOME: "/nonexistent/foldrun-home", FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1" },
    });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => (err += d));
    child.stdin.end();
    child.on("close", (code) => resolve({ stdout: Buffer.concat(out), stderr: err, code: code ?? 1 }));
  });
}

test("report <run> patch: the patch to stdout, byte for byte and nothing else; --apply --yes puts it into --dir", async () => {
  const d = repo(BASE);
  // Large enough that an unflushed pipe at exit would cut it short.
  const big: Record<string, string> = { ...AFTER };
  for (let i = 0; i < 400; i++) big[`gen/file${i}.txt`] = `line ${i}\n`.repeat(50);
  const patch = patchFor(BASE, big);
  const s = await platform({ patch });
  const r = await split(["report", RUN_ID, "patch", "--to", "desk", "--url", s.url, "--token", "k"]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.length > 64 * 1024, "a patch bigger than one pipe buffer");
  assert.ok(r.stdout.equals(Buffer.from(patch)), "stdout is exactly the patch");
  assert.match(r.stderr, /M hello\.txt/);
  assert.match(r.stderr, /A greet\.txt/);

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

test("report <run> patch: a run that was sent no folder has no patch, whatever its agent left in outputs/ (Codex)", async () => {
  const d = repo(BASE);
  const s = await serve({
    [`GET ${WS}/runs/${RUN_ID}`]: () => record("completed", "done", false),
    [`GET ${WS}/runs/${RUN_ID}/archive`]: (_b, q) =>
      q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "changed", modified: ["hello.txt"], added: [], deleted: [] }), "application/json") : raw(patchFor(BASE, AFTER), "text/x-diff"),
  });
  const r = await at(s.url, "report", RUN_ID, "patch", "--to", "desk", "--apply", "--dir", d, "--yes");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /was not sent a folder/);
  assert.ok(!s.seen.some((x) => x.url.endsWith("/archive")), "the agent's own files are not even fetched");
  assert.equal(fs.readFileSync(path.join(d, "hello.txt"), "utf8"), "hello\n");
});

test("a patch that makes a link is refused whole, and kept in a private file (Codex)", async () => {
  const d = repo(BASE);
  const link = repo(BASE);
  fs.symlinkSync("/etc/passwd", path.join(link, "pw"));
  git(link, "add", "-A");
  const patch = git(link, "diff", "--cached", "--no-renames");
  assert.match(patch, /new file mode 120000/);
  const s = await platform({ patch });
  const r = await at(s.url, "code", d, "--to", "desk", "--task", "x", "--yes");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /makes or changes a link/);
  assert.ok(!fs.existsSync(path.join(d, "pw")), "no link was made");
  const kept = /The patch is kept at (\S+)/.exec(r.out)?.[1];
  assert.ok(kept && fs.existsSync(kept), r.out);
  assert.equal(fs.statSync(kept).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(kept)).mode & 0o777, 0o700);
  assert.ok(!kept.startsWith(path.join(os.tmpdir(), "foldrun-run-code-1")), "not the old guessable name");
});

test("an ordinary file whose name holds 120000 is not taken for a link; an edit to a link already here is refused (Codex)", async () => {
  const d = repo(BASE);
  const s = await platform({ patch: patchFor(BASE, { "build-120000.txt": "x\n" }) });
  const ok = await at(s.url, "code", d, "--to", "desk", "--task", "x", "--yes");
  s.close();
  assert.equal(ok.code, 0, ok.out);
  assert.equal(fs.readFileSync(path.join(d, "build-120000.txt"), "utf8"), "x\n");

  // A link the person has, and a patch that edits it in place (git writes
  // `index a..b 120000`, and --summary prints nothing for it).
  const here = repo(BASE);
  fs.symlinkSync("hello.txt", path.join(here, "ln"));
  git(here, "add", "-A");
  git(here, "commit", "-qm", "link");
  const src = repo(BASE);
  fs.symlinkSync("hello.txt", path.join(src, "ln"));
  git(src, "add", "-A");
  git(src, "commit", "-qm", "link");
  fs.rmSync(path.join(src, "ln"));
  fs.symlinkSync("/etc/hosts", path.join(src, "ln"));
  git(src, "add", "-A");
  const edit = git(src, "diff", "--cached", "--no-renames");
  assert.match(edit, /^index [0-9a-f]+\.\.[0-9a-f]+ 120000$/m);
  const s2 = await platform({ patch: edit });
  const r = await at(s2.url, "code", here, "--to", "desk", "--task", "x", "--yes");
  s2.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /makes or changes a link/);
  assert.equal(fs.readlinkSync(path.join(here, "ln")), "hello.txt");
});

test("a mode spelled another way is still refused — git reads 0120000 as a link (Codex, reproduced)", async () => {
  const d = repo(BASE);
  const patch = "diff --git a/ln b/ln\nnew file mode 0120000\nindex 0000000..e69de29\n--- /dev/null\n+++ b/ln\n@@ -0,0 +1 @@\n+/etc/hosts\n\\ No newline at end of file\n";
  const s = await platform({ patch });
  const r = await at(s.url, "code", d, "--to", "desk", "--task", "x", "--yes");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /new file mode 0120000/);
  assert.ok(!fs.existsSync(path.join(d, "ln")));
  const { patchTypeProblems } = await import("../src/commands.mjs");
  for (const bad of ["new mode 120000", "old mode 0100644", "new file mode 160000", "similarity index 90%", "index 1234567..89abcde 0120000", "deleted file mode 100644 "]) {
    assert.equal(patchTypeProblems(`diff --git a/x b/x\n${bad}\n`).length, 1, bad);
  }
  for (const good of ["new file mode 100644", "new mode 100755", "index 1234567..89abcde 100644", "index 1234567..89abcde"]) {
    assert.equal(patchTypeProblems(`diff --git a/x b/x\n${good}\n`).length, 0, good);
  }
});

test("patchTypeProblems reads header lines only: file content that looks like a header is not one", async () => {
  const { patchTypeProblems } = await import("../src/commands.mjs");
  const content = patchFor(BASE, { "notes.txt": "new file mode 120000\nrename from a\nindex 1234567..89abcde 160000\n" });
  assert.deepEqual(patchTypeProblems(content), []);
  assert.equal(patchTypeProblems("diff --git a/x b/y\nrename from x\nrename to y\n").length, 2);
});

test("code: the agent's reply cannot drive the terminal before the apply prompt (Codex)", async (t) => {
  const d = repo(BASE);
  const s = await serve({
    [`GET ${WS}`]: () => ({ name: "desk" }),
    [`GET ${WS}/agents`]: () => ({ agents: [{ name: "coder" }] }),
    [`POST ${WS}/snapshots`]: () => ({ snapshotId: ID, files: 1, bytes: 6, compressedBytes: 100, expiresAt: "x", reused: false }),
    [`POST ${WS}/agents/coder/run`]: () => ({ ok: true, runId: RUN_ID }),
    [`GET ${WS}/runs/${RUN_ID}`]: () => record("completed", "done\u001b[2K\u001b[1A\u001b]0;x\u0007 ✓ applied"),
    [`GET ${WS}/runs/${RUN_ID}/archive`]: (_b, q) => (q.get("path") === "snapshot.json" ? raw(JSON.stringify({ status: "changed", modified: ["a\u001b[31m.txt"] }), "application/json") : raw(patchFor(BASE, AFTER), "text/x-diff")),
  });
  t.after(() => s.close());
  const r = await at(s.url, "code", d, "--to", "desk", "--task", "x");
  assert.doesNotMatch(r.out, /\u001b\[2K|\u001b\[1A|\u001b\]0;/, "no control sequence from the agent reaches the screen");
  assert.match(r.out, /done ✓ applied/, "the words themselves are shown");
});

test("the no-patch reason (it can name an agent's file) cannot drive the terminal, in code and report patch (Codex)", async (t) => {
  const d = repo(BASE);
  const meta = { status: "unavailable", reason: "refused a link: x\u001b[2K\u001b]0;t\u0007y" };
  const s = await platform({ meta });
  t.after(() => s.close());
  const r = await at(s.url, "code", d, "--to", "desk", "--task", "x");
  assert.match(r.out, /no patch: refused a link: xy/);
  const rp = await at(s.url, "report", RUN_ID, "patch", "--to", "desk");
  assert.match(rp.out, /no patch: refused a link: xy/);
  for (const out of [r.out, rp.out]) assert.doesNotMatch(out, /\u001b\[2K|\u001b\]0;/);
});

test("code: binary files sent without a secret scan are named", async () => {
  const d = repo({ ...BASE, "logo.bin": "\u0000\u0001binary" });
  const s = await platform({ meta: { status: "unchanged", bytes: 0, modified: [], added: [], deleted: [] } });
  const r = await at(s.url, "code", d, "--to", "desk", "--task", "x");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /not checked for secrets \(binary\):\s+logo\.bin/);
});

test("code: a call that cannot run adds no agent on its way out, even with --yes (Codex)", async () => {
  const d = repo(BASE);
  const s = await platform({ agents: [] });
  const empty = await at(s.url, "code", d, "--to", "desk", "--task", "  ", "--yes");
  const noTask = await at(s.url, "code", d, "--to", "desk", "--yes");
  s.close();
  assert.notEqual(empty.code, 0);
  assert.match(empty.out, /--task needs the instruction/);
  assert.notEqual(noTask.code, 0);
  assert.match(noTask.out, /in a script, give one turn with -p "…" \(or --task/);
  assert.ok(!s.seen.some((x) => x.method === "PUT"), "no agent written");
});

/**
 * A platform whose run is live: the stream stays open until a stop arrives,
 * then — the race Codex named — reports the run COMPLETED anyway, with a
 * patch ready. `stopFails` answers the first stop with a 500.
 */
interface LiveOpts { stopFails?: boolean; stopDelayMs?: number; completeAtOnce?: boolean; holdArchive?: boolean; dropStream?: boolean }
function liveRun(patch: string, opts: LiveOpts = {}): Promise<{ url: string; seen: string[]; streaming: Promise<void>; archiving: Promise<void>; releaseArchive: () => void; close: () => void }> {
  const seen: string[] = [];
  let streamRes: http.ServerResponse | null = null;
  let markStreaming: () => void;
  const streaming = new Promise<void>((r) => (markStreaming = r));
  let markArchiving: () => void;
  const archiving = new Promise<void>((r) => (markArchiving = r));
  let release: () => void = () => {};
  const released = new Promise<void>((r) => (release = r));
  let stops = 0;
  let dropped = false;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const [u, q] = (req.url ?? "").split("?");
      seen.push(`${req.method} ${u}${q ? `?${q}` : ""}`);
      const json = (status: number, v: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(v));
      };
      if (u === WS) return json(200, { name: "desk" });
      if (u === `${WS}/agents`) return json(200, { agents: [{ name: "coder" }] });
      if (u === `${WS}/snapshots`) return json(200, { snapshotId: ID, files: 1, bytes: 6, compressedBytes: 100, expiresAt: "x", reused: false });
      if (u === `${WS}/agents/coder/run`) return json(200, { ok: true, runId: RUN_ID });
      if (u === `${WS}/runs/${RUN_ID}`) return json(200, record(dropped ? "completed" : "running"));
      if (u === `${WS}/runs/${RUN_ID}/stream`) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: run\ndata: ${JSON.stringify(record("running"))}\n\n`);
        streamRes = res;
        markStreaming();
        if (opts.dropStream) {
          // The laptop's network blinks: the socket dies mid-run; the run
          // goes on and completes on the platform.
          dropped = true;
          setTimeout(() => res.socket?.destroy(), 50);
          return;
        }
        if (opts.completeAtOnce) {
          res.write(`event: run\ndata: ${JSON.stringify(record("completed"))}\n\nevent: done\ndata: {}\n\n`);
          res.end();
        }
        return;
      }
      if (u === `${WS}/runs/${RUN_ID}/stop`) {
        stops++;
        if (opts.stopFails && stops === 1) return json(500, { error: "try again" });
        setTimeout(() => {
          json(200, { ok: true });
          streamRes?.write(`event: run\ndata: ${JSON.stringify(record("completed"))}\n\nevent: done\ndata: {}\n\n`);
          streamRes?.end();
        }, opts.stopDelayMs ?? 0);
        return;
      }
      if (u === `${WS}/runs/${RUN_ID}/archive`) {
        const meta = new URLSearchParams(q).get("path") === "snapshot.json";
        const answer = () => {
          res.writeHead(200, { "content-type": meta ? "application/json" : "text/x-diff" });
          res.end(meta ? JSON.stringify({ status: "changed", modified: ["hello.txt"], added: ["greet.txt"], deleted: [] }) : patch);
        };
        if (opts.holdArchive && meta) {
          markArchiving();
          released.then(answer);
          return;
        }
        return answer();
      }
      json(404, { error: "not found" });
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, seen, streaming, archiving, releaseArchive: () => release(), close: () => { server.closeAllConnections(); server.close(); } });
    }),
  );
}

function codeChild(url: string, d: string) {
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "..", "bin/foldrun.mjs"), "code", d, "--to", "desk", "--task", "greet", "--yes", "--url", url, "--token", "k"], {
    env: { ...process.env, FOLDRUN_HOME: "/nonexistent/foldrun-home", FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1" },
  });
  let out = "";
  child.stdout.on("data", (x) => (out += x));
  child.stderr.on("data", (x) => (out += x));
  child.stdin.end();
  const done = new Promise<number>((r) => child.on("close", (code) => r(code ?? 1)));
  return { child, done, out: () => out };
}

const LIVE = { timeout: 20_000 };

test("Ctrl-C mid-run stops it on the platform, and a run that completes anyway applies nothing, even with --yes (Codex)", LIVE, async (t) => {
  const d = repo(BASE);
  const p = await liveRun(patchFor(BASE, AFTER));
  const c = codeChild(p.url, d);
  t.after(() => { c.child.kill("SIGKILL"); p.close(); });
  await p.streaming;
  c.child.kill("SIGINT");
  const code = await c.done;
  assert.equal(code, 130, c.out());
  assert.ok(p.seen.includes(`POST ${WS}/runs/${RUN_ID}/stop`), c.out());
  assert.match(c.out(), /stopped by you — nothing applied/);
  assert.ok(!p.seen.some((x) => x.includes("/archive")), "the patch is not even fetched");
  assert.equal(fs.readFileSync(path.join(d, "hello.txt"), "utf8"), "hello\n");
});

test("Ctrl-C: a stop that fails says so, and a second Ctrl-C tries again (Codex)", LIVE, async (t) => {
  const d = repo(BASE);
  const p = await liveRun(patchFor(BASE, AFTER), { stopFails: true });
  const c = codeChild(p.url, d);
  t.after(() => { c.child.kill("SIGKILL"); p.close(); });
  await p.streaming;
  c.child.kill("SIGINT");
  for (let i = 0; i < 100 && !/tries once more/.test(c.out()); i++) await new Promise((r) => setTimeout(r, 50));
  assert.match(c.out(), /stop: .*Ctrl-C again tries once more/);
  c.child.kill("SIGINT");
  const code = await c.done;
  assert.equal(code, 130, c.out());
  assert.equal(p.seen.filter((x) => x === `POST ${WS}/runs/${RUN_ID}/stop`).length, 2);
  assert.match(c.out(), /nothing applied/);
  assert.equal(fs.readFileSync(path.join(d, "hello.txt"), "utf8"), "hello\n");
});

test("Ctrl-C twice while the stop is still on its way does not leave before the platform answers (Codex)", LIVE, async (t) => {
  const d = repo(BASE);
  const p = await liveRun(patchFor(BASE, AFTER), { stopDelayMs: 800 });
  const c = codeChild(p.url, d);
  t.after(() => { c.child.kill("SIGKILL"); p.close(); });
  await p.streaming;
  c.child.kill("SIGINT");
  for (let i = 0; i < 100 && !p.seen.includes(`POST ${WS}/runs/${RUN_ID}/stop`); i++) await new Promise((r) => setTimeout(r, 20));
  c.child.kill("SIGINT");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(c.child.exitCode, null, "still there while the stop is unanswered");
  assert.match(c.out(), /the stop is on its way/);
  const code = await c.done;
  assert.equal(code, 130, c.out());
  assert.match(c.out(), /stopped by you — nothing applied/);
  assert.equal(fs.readFileSync(path.join(d, "hello.txt"), "utf8"), "hello\n");
});

test("Ctrl-C while the patch is being fetched: not applied, kept on the run, and no stop is sent for a finished run (Codex)", LIVE, async (t) => {
  const d = repo(BASE);
  const p = await liveRun(patchFor(BASE, AFTER), { completeAtOnce: true, holdArchive: true });
  const c = codeChild(p.url, d);
  t.after(() => { c.child.kill("SIGKILL"); p.close(); });
  await p.archiving;
  c.child.kill("SIGINT");
  for (let i = 0; i < 100 && !/not applying/.test(c.out()); i++) await new Promise((r) => setTimeout(r, 20));
  p.releaseArchive();
  const code = await c.done;
  assert.equal(code, 0, c.out());
  assert.match(c.out(), /not applied — you pressed Ctrl-C/);
  assert.ok(!p.seen.some((x) => x.endsWith("/stop")), "a finished run is not stopped");
  assert.equal(fs.readFileSync(path.join(d, "hello.txt"), "utf8"), "hello\n");
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

/** The CLI on a real pseudo-terminal, through Python's pty module (macOS
 *  and Linux alike; script(1) refuses the socket Node gives it for stdin) —
 *  so Ctrl-C (\x03) and Ctrl-D (\x04) arrive as they do from a keyboard.
 *  Null where there is no python3. */
function onTerminal(args: string[]) {
  const cli = path.join(import.meta.dirname, "..", "bin/foldrun.mjs");
  try {
    execFileSync("python3", ["-c", "import pty"], { stdio: "ignore" });
  } catch {
    return null;
  }
  const child = spawn("python3", ["-c", "import pty, sys; pty.spawn(sys.argv[1:])", process.execPath, cli, ...args], { env: { ...process.env, FOLDRUN_HOME: "/nonexistent/foldrun-home", FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1", TERM: "dumb" } });
  let out = "";
  child.stdout.on("data", (x) => (out += x));
  child.stderr.on("data", (x) => (out += x));
  const done = new Promise<number>((r) => child.on("close", (code) => r(code ?? 1)));
  const until = async (re: RegExp, ms = 10_000) => {
    for (let t = 0; t < ms && !re.test(out); t += 25) await new Promise((r) => setTimeout(r, 25));
    assert.match(out, re);
  };
  return { child, done, out: () => out, until, type: (x: string) => child.stdin.write(x) };
}

test("on a terminal: Ctrl-C at the apply prompt applies nothing and the session goes on to its next prompt; Ctrl-D leaves (Codex)", LIVE, async (t) => {
  const d = repo(BASE);
  const s = await platform({ patch: patchFor(BASE, AFTER) });
  const term = onTerminal(["code", d, "--cloud", "--to", "desk", "--url", s.url, "--token", "k"]);
  if (!term) {
    s.close();
    t.skip("no python3 to give the CLI a terminal");
    return;
  }
  t.after(() => { term.child.kill("SIGKILL"); s.close(); });
  await term.until(/\w ❯ /);
  term.type("greet the world\r");
  await term.until(/send it\? \[y\]es/);
  term.type("y\r"); // the upload preview (FOL-212)
  await term.until(/apply it to .*\[y\/N\]/);
  term.type("\x03");
  await term.until(/not applied — the patch is at/);
  await term.until(/\w ❯ [\s\S]*\w ❯ /);
  term.type("\x04");
  const code = await term.done;
  assert.equal(code, 0, term.out());
  assert.equal(fs.readFileSync(path.join(d, "hello.txt"), "utf8"), "hello\n", "nothing applied");
  assert.ok(!fs.existsSync(path.join(d, "greet.txt")));
});

test("on a terminal: y at the apply prompt applies it, and /quit leaves", LIVE, async (t) => {
  const d = repo(BASE);
  const s = await platform({ patch: patchFor(BASE, AFTER) });
  const term = onTerminal(["code", d, "--cloud", "--to", "desk", "--url", s.url, "--token", "k"]);
  if (!term) {
    s.close();
    t.skip("no python3 to give the CLI a terminal");
    return;
  }
  t.after(() => { term.child.kill("SIGKILL"); s.close(); });
  await term.until(/\w ❯ /);
  term.type("greet the world\r");
  await term.until(/send it\? \[y\]es/);
  term.type("y\r"); // the upload preview (FOL-212)
  await term.until(/apply it to .*\[y\/N\]/);
  term.type("y\r");
  await term.until(/✓ applied/);
  await term.until(/\w ❯ [\s\S]*\w ❯ /);
  term.type("/quit\r");
  assert.equal(await term.done, 0, term.out());
  assert.equal(fs.readFileSync(path.join(d, "greet.txt"), "utf8"), "hi\n");
});

test("Ctrl-C while git checks the patch, with --yes: the apply never starts (Codex)", LIVE, async (t) => {
  const d = repo(BASE);
  const s = await platform({ patch: patchFor(BASE, AFTER) });
  // A git first on PATH that, for the preflight's --numstat, says it started
  // and holds for a moment; everything else is the real git.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cli-git-"));
  const marker = path.join(bin, "preflight-started");
  const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\ncase " $* " in *" --numstat "*) touch '${marker}'; sleep 1;; esac\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "..", "bin/foldrun.mjs"), "code", d, "--to", "desk", "--task", "greet", "--yes", "--url", s.url, "--token", "k"], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FOLDRUN_HOME: "/nonexistent/foldrun-home", FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1" },
  });
  let out = "";
  child.stdout.on("data", (x) => (out += x));
  child.stderr.on("data", (x) => (out += x));
  child.stdin.end();
  const done = new Promise<number>((r) => child.on("close", (code) => r(code ?? 1)));
  t.after(() => { child.kill("SIGKILL"); s.close(); });
  for (let i = 0; i < 400 && !fs.existsSync(marker); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(fs.existsSync(marker), out);
  child.kill("SIGINT");
  await done;
  assert.match(out, /not applied — you pressed Ctrl-C/);
  assert.doesNotMatch(out, /✓ applied/);
  assert.equal(fs.readFileSync(path.join(d, "hello.txt"), "utf8"), "hello\n");
  assert.ok(!fs.existsSync(path.join(d, "greet.txt")));
});

// The live view of foldrun code (19 Nov 2026, from a tester's screen): the
// platform's notes on each step filled the screen, and the reply showed
// twice — once as a clipped event line while the run was live (no result to
// compare with yet), then in full.
test("code's live view: the platform's notes are left to the run page, and the reply is printed once even while the run is live", async () => {
  const { printNew, dropHeldReply } = await import("../src/commands.mjs");
  const out: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    const seen = new Map();
    const open = new Map();
    const step = { agent: "coder", events: [] as any[], result: undefined as string | undefined };
    const run = { steps: [step] };
    step.events.push({ type: "info", text: "clock: UTC (default)" }, { type: "info", text: "isolation: k8s" });
    step.events.push({ type: "text", text: "Let me look at calc.py first." });
    printNew(run, seen, open, { skipResult: true, quiet: true });
    // A tool call after the remark: the remark was on the way, so it shows.
    step.events.push({ type: "tool", text: "Read", call: "c1" }, { type: "tool", text: "Read", call: "c1", ms: 3 });
    step.events.push({ type: "text", text: "Fixed add() and added a test." });
    printNew(run, seen, open, { skipResult: true, quiet: true });
    // The run ends: the result is the held text, printed once by the caller.
    step.events.push({ type: "info", text: "timing: sandbox ready in 1.1s" });
    step.result = "Fixed add() and added a test.";
    printNew(run, seen, open, { skipResult: true, quiet: true });
    dropHeldReply(run, seen, open);
  } finally {
    console.log = log;
  }
  const text = out.join("\n");
  assert.doesNotMatch(text, /clock:|isolation:|timing:/, "no platform notes");
  assert.match(text, /Let me look at calc\.py first\./, "a remark before a tool call stays");
  assert.match(text, /Read/);
  assert.doesNotMatch(text, /Fixed add\(\) and added a test\./, "the reply is left for the caller to print in full, once");
});

test("code's live view with --verbose keeps the notes; a held text that is not the reply is still printed", async () => {
  const { printNew, dropHeldReply } = await import("../src/commands.mjs");
  const out: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    const seen = new Map();
    const step = { agent: "coder", events: [{ type: "info", text: "clock: UTC (default)" }, { type: "text", text: "Thinking aloud." }], result: "The real answer." };
    printNew({ steps: [step] }, seen, new Map(), { skipResult: true, quiet: false });
    dropHeldReply({ steps: [step] }, seen, new Map());
  } finally {
    console.log = log;
  }
  assert.match(out.join("\n"), /clock: UTC/);
  assert.match(out.join("\n"), /Thinking aloud\./);
});

test("code to <name> (the dashes left off) says --to", async () => {
  const d = repo(BASE);
  const r = await new Promise<{ out: string; code: number }>((resolve) => {
    const c = spawn(process.execPath, [path.join(import.meta.dirname, "..", "bin/foldrun.mjs"), "code", "to", "my-project"], { cwd: d, env: { ...process.env, NO_COLOR: "1", FOLDRUN_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "fh-")) } });
    let out = "";
    c.stdout.on("data", (x) => (out += x));
    c.stderr.on("data", (x) => (out += x));
    c.on("close", (code) => resolve({ out, code: code ?? 1 }));
  });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /did you mean `foldrun code --to my-project`\?/);
});

/** printNew's lines for a sequence of frames (each frame: events added, then printed). */
async function frames(steps: any[], batches: Array<() => void>, opts: { quiet: boolean }, end: "reply" | "flush" = "reply") {
  const { printNew, dropHeldReply, flushHeld } = await import("../src/commands.mjs");
  const out: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    const seen = new Map();
    const open = new Map();
    const run = { steps };
    for (const b of batches) {
      b();
      printNew(run, seen, open, { skipResult: true, quiet: opts.quiet });
    }
    if (end === "reply") dropHeldReply(run, seen, open);
    else flushHeld(seen, open);
  } finally {
    console.log = log;
  }
  return out;
}

test("live view, --verbose: a trailing note does not release the reply before its result arrives (Codex)", async () => {
  const step: any = { agent: "coder", events: [], result: undefined };
  const out = await frames([step], [
    () => step.events.push({ type: "text", text: "Done: add() fixed." }, { type: "info", text: "timing: 7s" }),
    () => (step.result = "Done: add() fixed."),
  ], { quiet: false });
  assert.equal(out.filter((l) => l.includes("Done: add() fixed.")).length, 0, "left for the caller's one full print");
  assert.ok(out.some((l) => l.includes("timing: 7s")));
});

test("live view: a parent's remark shows before its sub-agent's output (Codex)", async () => {
  const parent: any = { agent: "coder", events: [], result: undefined };
  const sub: any = { agent: "helper", subagentOf: "coder", events: [] };
  const out = await frames([parent, sub], [
    () => parent.events.push({ type: "text", text: "I'll hand the tests to helper." }),
    () => sub.events.push({ type: "tool", text: "Bash", call: "s1" }, { type: "tool", text: "Bash", call: "s1", ms: 4 }),
    () => { parent.events.push({ type: "text", text: "All green." }); parent.result = "All green."; },
  ], { quiet: true });
  const remark = out.findIndex((l) => l.includes("hand the tests"));
  const tool = out.findIndex((l) => l.includes("Bash"));
  assert.ok(remark >= 0 && tool > remark, out.join("\n"));
});

test("live view, quiet: a limits refusal is shown; other notes are not (Codex)", async () => {
  const step: any = { agent: "coder", events: [], result: "ok" };
  const out = await frames([step], [
    () => step.events.push({ type: "info", text: "isolation: k8s" }, { type: "info", text: "limits: calls 1000, repeat 25 — per step; a call past one is refused" }, { type: "info", text: "web.search: 10 of 10 used (WebSearch refused)" }),
  ], { quiet: true });
  assert.ok(out.some((l) => l.includes("WebSearch refused")));
  assert.ok(!out.some((l) => l.includes("isolation")));
  assert.ok(!out.some((l) => l.includes("a call past one is refused")), "the limits setup note is not a refusal");
});

test("live view: a turn that ends another way (an error, Ctrl-C) still prints the held text (Codex)", async () => {
  const step: any = { agent: "coder", events: [], result: undefined };
  const out = await frames([step], [() => step.events.push({ type: "text", text: "Half way through the refactor." })], { quiet: true }, "flush");
  assert.ok(out.some((l) => l.includes("Half way through the refactor.")));
});

test("live view: an older sub-agent event seen in the same frame does not release the parent's newer reply (Codex)", async () => {
  const parent: any = { agent: "coder", events: [], result: undefined };
  const sub: any = { agent: "helper", subagentOf: "coder", events: [] };
  const out = await frames([parent, sub], [
    () => {
      sub.events.push({ type: "tool", text: "Bash", call: "s1", t: "2026-11-19T00:00:01Z" }, { type: "tool", text: "Bash", call: "s1", ms: 4, t: "2026-11-19T00:00:02Z" });
      parent.events.push({ type: "text", text: "All green.", t: "2026-11-19T00:00:05Z" });
    },
    () => (parent.result = "All green."),
  ], { quiet: true });
  assert.equal(out.filter((l) => l.includes("All green.")).length, 0, out.join("\n"));
});

test("live view, quiet: a failure note shows (browser pod reconnect failed) (Codex)", async () => {
  const step: any = { agent: "coder", events: [], result: "ok" };
  const out = await frames([step], [() => step.events.push({ type: "info", text: "browser pod: reconnect failed (try 3 of 3) — connection reset" })], { quiet: true });
  assert.ok(out.some((l) => l.includes("reconnect failed")));
});

test("live view: one frame's events from several steps print in the order they happened (Codex)", async () => {
  const parent: any = { agent: "coder", events: [], result: undefined };
  const sub: any = { agent: "helper", subagentOf: "coder", events: [] };
  const out = await frames([parent, sub], [
    () => {
      parent.events.push({ type: "text", text: "R1", t: "2026-11-19T00:00:01Z" }, { type: "text", text: "R3", t: "2026-11-19T00:00:03Z" }, { type: "text", text: "R4", t: "2026-11-19T00:00:04Z" });
      sub.events.push({ type: "tool", text: "Bash", call: "s1", t: "2026-11-19T00:00:01.5Z" }, { type: "tool", text: "Bash", call: "s1", ms: 4, t: "2026-11-19T00:00:02Z" });
    },
    () => { parent.events.push({ type: "text", text: "Done.", t: "2026-11-19T00:00:06Z" }); parent.result = "Done."; },
  ], { quiet: true });
  const at = (s: string) => out.findIndex((l) => l.includes(s));
  assert.ok(at("R1") < at("Bash") && at("Bash") < at("R3") && at("R3") < at("R4"), out.join("\n"));
  assert.equal(out.filter((l) => l.includes("Done.")).length, 0);
});

test("live view: a refusal after the agent's last words does not print the reply twice (seen 19 Nov 2026)", async () => {
  const step: any = { agent: "coder", events: [], result: undefined };
  const out = await frames([step], [
    () => step.events.push({ type: "text", text: "I fixed add()." }, { type: "error", text: "refused before it ran: Bash" }),
    () => (step.result = "I'm in snapshot/.\nI fixed add()."),
  ], { quiet: true });
  assert.equal(out.filter((l) => l.includes("I fixed add().")).length, 0, out.join("\n"));
  assert.ok(out.some((l) => l.includes("refused before it ran")));
});

test("live view, quiet: core's other refusal notes show (Codex)", async () => {
  const step: any = { agent: "coder", events: [], result: "ok" };
  const out = await frames([step], [() => step.events.push(
    { type: "info", text: "refused path: agents/coder/agent.md (config) — a step cannot change the project's configuration or code" },
    { type: "info", text: "the model credential was refused mid-step — waiting for the refreshed one" },
  )], { quiet: true });
  assert.ok(out.some((l) => l.includes("refused path:")));
  assert.ok(out.some((l) => l.includes("credential was refused")));
});

test("live view: the final text inside a finished result is not released by a later sub-agent event (Codex)", async () => {
  const parent: any = { agent: "coder", events: [], result: undefined };
  const sub: any = { agent: "helper", subagentOf: "coder", events: [] };
  const out = await frames([parent, sub], [() => {
    parent.events.push({ type: "text", text: "Done." , t: "2026-11-19T00:00:01Z" });
    parent.result = "Looked first.\nDone.";
    sub.events.push({ type: "tool", text: "Bash", call: "s1", t: "2026-11-19T00:00:02Z" }, { type: "tool", text: "Bash", call: "s1", ms: 2, t: "2026-11-19T00:00:03Z" });
  }], { quiet: true });
  assert.equal(out.filter((l) => l.includes("Done.")).length, 0, out.join("\n"));
});

test("live view: text held in an earlier frame is not released when the finished frame brings the result and a sub-agent event (Codex)", async () => {
  const parent: any = { agent: "coder", events: [], result: undefined };
  const sub: any = { agent: "helper", subagentOf: "coder", events: [] };
  const out = await frames([parent, sub], [
    () => parent.events.push({ type: "text", text: "Done.", t: "2026-11-19T00:00:01Z" }),
    () => {
      parent.result = "Looked first.\nDone.";
      sub.events.push({ type: "tool", text: "Bash", call: "s1", t: "2026-11-19T00:00:02Z" }, { type: "tool", text: "Bash", call: "s1", ms: 2, t: "2026-11-19T00:00:03Z" });
    },
  ], { quiet: true });
  assert.equal(out.filter((l) => l.includes("Done.")).length, 0, out.join("\n"));
});

test("code: the session line counts turns and spend, and names the model, context and time (owner, 19 Nov 2026)", async () => {
  const { noteSessionTurn, sessionLine } = await import("../src/commands.mjs");
  const s: any = { context: "code-abc" };
  const run = (input: number) => ({
    startedAt: "2026-11-19T00:00:00.000Z",
    finishedAt: "2026-11-19T00:00:07.500Z",
    steps: [{ agent: "coder", tokens: { input, output: 10 }, events: [{ type: "info", text: "step started (agent: coder, model: sonnet — agent, effort: medium)" }] }],
  });
  noteSessionTurn(s, run(1200), 0.01);
  noteSessionTurn(s, run(60340), 0.0236);
  assert.equal(sessionLine(s), "session: 2 turns · $0.0336 in all · sonnet · last turn read 60k tokens · 7.5s · conversation code-abc");
});

test("code: a dropped stream mid-run is followed again — the turn ends with the run, and its patch is offered (seen 19 Nov 2026)", LIVE, async () => {
  const patch = patchFor(BASE, AFTER);
  const d = repo(BASE);
  const p = await liveRun(patch, { dropStream: true });
  try {
    const run = codeChild(p.url, d);
    const code = await run.done;
    assert.equal(code, 0, run.out());
    assert.match(run.out(), /✓ done/);
    assert.match(run.out(), /applied/);
    assert.equal(fs.readFileSync(path.join(d, "greet.txt"), "utf8"), "hi\n");
  } finally {
    p.close();
  }
});

test("droppedConnection: socket failures yes; an abort, an HTTP answer or anything else no", async () => {
  const { droppedConnection } = await import("../src/commands.mjs");
  assert.ok(droppedConnection(new TypeError("terminated", { cause: Object.assign(new Error("read ETIMEDOUT"), { code: "ETIMEDOUT" }) })));
  assert.ok(droppedConnection(new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } })));
  assert.ok(!droppedConnection(Object.assign(new Error("aborted"), { name: "AbortError" })));
  assert.ok(!droppedConnection(Object.assign(new Error("could not reach x"), { status: 500 })));
  assert.ok(!droppedConnection(new Error("workspace not found")));
  assert.ok(droppedConnection(new Error("api.foldrun.dev did not answer GET /v1/workspaces/x/runs/y within 30s — FOLDRUN_TIMEOUT=<seconds> allows longer")), "the CLI's own timeout (Codex)");
});
