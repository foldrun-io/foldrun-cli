// An account folder: the shape `foldrun init` makes now, and the commands
// that work on the whole of it.
//
// Half of these tests are about the OLD shape. A flat workspace — agents/ and
// flows/ at the root — is what every existing user has on disk, and a folder
// shape is a file format: it does not get to break because a better one
// arrived. So each new behaviour is pinned twice, once each way.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync, execFile } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const ENV = { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, NO_COLOR: "1" };

const foldrun = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: ROOT, env: ENV });
const foldrunIn = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd, env: ENV });

/** The fake platform answers from this process, so the CLI must not block it. */
const foldrunAsync = (cwd: string, ...args: string[]) =>
  new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [CLI, ...args], { encoding: "utf8", cwd, env: ENV }, (err, stdout, stderr) =>
      resolve({ status: err && "code" in err ? Number(err.code) : 0, stdout, stderr }),
    );
  });

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-account-"));
}
const read = (...p: string[]) => fs.readFileSync(path.join(...p), "utf8");
const exists = (...p: string[]) => fs.existsSync(path.join(...p));

// ------------------------------------------------------------------ init

test("init makes the platform's own shape: AGENTS.md, library/, workspaces/<name>", () => {
  const root = path.join(tmp(), "acme");
  const r = foldrun("init", root);
  assert.equal(r.status, 0, r.stdout + r.stderr);

  assert.ok(exists(root, "AGENTS.md"), "account AGENTS.md");
  assert.ok(exists(root, ".gitignore"), "account .gitignore");
  assert.match(read(root, ".gitignore"), /^\.foldrun\/$/m, "the vault key is ignored at the account root");
  for (const kind of ["tools", "knowledge", "memory", "skills", "scripts"]) {
    assert.ok(exists(root, "library", kind), `library/${kind}`);
  }
  assert.ok(exists(root, "workspaces", "main", "agents", "writer", "agent.md"));
  assert.ok(exists(root, "workspaces", "main", "flows", "publish.md"));
  assert.ok(exists(root, "workspaces", "main", "AGENTS.md"));
  // The account's AGENTS.md is NOT the workspace's — two scopes, two files.
  assert.notEqual(read(root, "AGENTS.md"), read(root, "workspaces", "main", "AGENTS.md"));
  // …and nothing was written outside the folder that was asked for.
  assert.deepEqual(fs.readdirSync(path.dirname(root)), ["acme"]);
});

test("--workspace names the first workspace, and --from fills it", () => {
  const root = path.join(tmp(), "acme");
  assert.equal(foldrun("init", root, "--workspace", "blog-desk").status, 0);
  assert.ok(exists(root, "workspaces", "blog-desk", "flows", "publish.md"));

  const other = path.join(tmp(), "b");
  const r = foldrun("init", other, "--workspace", "hello", "--from", "templates/hello");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(exists(other, "workspaces", "hello", "AGENTS.md"));
  assert.ok(exists(other, "library"), "a template still lands inside an account");
});

test("a workspace name that is not kebab-case is refused, with the rule", () => {
  const r = foldrun("init", path.join(tmp(), "x"), "--workspace", "Blog Desk");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /kebab-case/);
});

test("--flat still makes the old single-folder workspace", () => {
  const dir = path.join(tmp(), "my-desk");
  assert.equal(foldrun("init", dir, "--flat").status, 0);
  assert.ok(exists(dir, "agents", "writer", "agent.md"));
  assert.ok(!exists(dir, "workspaces"), "no wrapper");
  assert.ok(exists(path.dirname(dir), "AGENTS.md"), "the account AGENTS.md is still written one up");
});

test("init refuses to overwrite, and writes nothing when it does", () => {
  const root = path.join(tmp(), "acme");
  assert.equal(foldrun("init", root).status, 0);
  const before = read(root, "AGENTS.md");
  const r = foldrun("init", root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refusing to overwrite/);
  assert.equal(read(root, "AGENTS.md"), before);
});

// ------------------------------------------------------------------- new

test("new adds a second workspace beside the first", () => {
  const root = path.join(tmp(), "acme");
  foldrun("init", root);
  const r = foldrunIn(root, "new", "ads-desk");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(exists(root, "workspaces", "ads-desk", "flows", "publish.md"));
  assert.equal(foldrunIn(root, "new", "ads-desk").status, 1, "twice is a refusal");
});

test("new in a flat workspace says what a flat workspace is, and makes nothing", () => {
  const dir = path.join(tmp(), "my-desk");
  foldrun("init", dir, "--flat");
  const r = foldrunIn(dir, "new", "second");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /single workspace/);
  assert.ok(!exists(dir, "workspaces"));
});

// ----------------------------------------------------------------- check

test("check at an account root validates every workspace and the library", () => {
  const root = path.join(tmp(), "acme");
  foldrun("init", root);
  foldrunIn(root, "new", "ads-desk");
  fs.mkdirSync(path.join(root, "library/skills/house-style"), { recursive: true });
  fs.writeFileSync(path.join(root, "library/skills/house-style/SKILL.md"), "---\nname: house-style\ndescription: how we write\n---\nPlain.\n");

  const r = foldrun("check", root, "--local");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\bmain\b/);
  assert.match(r.stdout, /\bads-desk\b/);
  assert.match(r.stdout, /library\s+1 skills/);
});

test("check reports a broken library skill as the account's problem", () => {
  const root = path.join(tmp(), "acme");
  foldrun("init", root);
  fs.mkdirSync(path.join(root, "library/skills/broken"), { recursive: true });
  fs.writeFileSync(path.join(root, "library/skills/broken/SKILL.md"), "---\nname: broken\n---\nNo description.\n");
  const r = foldrun("check", root, "--local");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /library\/skills\/broken\/SKILL\.md/);
});

test("check on a flat workspace is unchanged", () => {
  const dir = path.join(tmp(), "my-desk");
  foldrun("init", dir, "--flat");
  const r = foldrun("check", dir, "--local");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /agents ·/);
});

// ---------------------------------------------- the library resolves shared

test("an agent in an account workspace resolves the shared library beside workspaces/", () => {
  const root = path.join(tmp(), "acme");
  foldrun("init", root);
  fs.mkdirSync(path.join(root, "library/tools"), { recursive: true });
  fs.writeFileSync(path.join(root, "library/tools/crm.md"), "---\nname: crm\ndescription: the CRM\ntransport: script\n---\n\n```sh\necho hi\n```\n");
  const agent = path.join(root, "workspaces/main/agents/writer/agent.md");
  fs.writeFileSync(agent, "---\nname: writer\ndescription: writes\ntools: [crm]\n---\n\nWrite.\n");

  // Before the account root was resolved properly this said `crm` was missing:
  // the account scope was `workspaces/`, which holds no library at all.
  const r = foldrun("check", root, "--local");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /tools: \[crm\]/);
});

// ------------------------------------------------------- a fake platform

interface Fake {
  url: string;
  close: () => void;
  workspaces: Map<string, Map<string, string>>;
  library: Map<string, Map<string, string>>;
  deploys: string[];
  deleted: string[];
}

function fakePlatform(): Promise<Fake> {
  const workspaces = new Map<string, Map<string, string>>();
  const library = new Map<string, Map<string, string>>();
  const deploys: string[] = [];
  const deleted: string[] = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, "http://x");
      const body: Buffer[] = [];
      req.on("data", (d) => body.push(d));
      req.on("end", () => {
        const json = body.length ? JSON.parse(Buffer.concat(body).toString()) : {};
        res.setHeader("content-type", "application/json");
        const send = (o: unknown) => res.end(JSON.stringify(o));

        let m = /^\/api\/workspaces\/([^/]+)\/source$/.exec(url.pathname);
        if (m) {
          const files = workspaces.get(m[1]) ?? new Map();
          const rel = url.searchParams.get("path");
          return send(rel ? { path: rel, content: files.get(rel) ?? "" } : { files: [...files.keys()] });
        }
        m = /^\/api\/workspaces\/([^/]+)\/deploy$/.exec(url.pathname);
        if (m) {
          deploys.push(m[1]);
          const files = new Map<string, string>(json.files.map((f: { path: string; content: string }) => [f.path, f.content]));
          workspaces.set(m[1], files);
          return send({ added: [...files.keys()], updated: [], removed: [], issues: [], blockedBy: [], preserved: 0, commit: null });
        }
        m = /^\/api\/workspaces\/([^/]+)$/.exec(url.pathname);
        if (m && req.method === "DELETE") {
          deleted.push(m[1]);
          workspaces.delete(m[1]);
          return send({ ok: true });
        }
        if (url.pathname === "/api/workspaces") {
          return send({ workspaces: [...workspaces.keys()].map((name) => ({ name })) });
        }
        m = /^\/api\/library\/([^/]+)$/.exec(url.pathname);
        if (m) {
          const kind = library.get(m[1]) ?? new Map<string, string>();
          if (req.method === "PUT") {
            kind.set(json.path, json.content);
            library.set(m[1], kind);
            return send({ ok: true });
          }
          const rel = url.searchParams.get("path");
          if (rel) return send({ path: rel, content: kind.get(rel) ?? "" });
          return send({ kind: m[1], entries: [...kind.keys()].map((p) => ({ name: p.replace(/\.md$/, ""), path: p })) });
        }
        res.statusCode = 404;
        send({ error: "nope" });
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close(), workspaces, library, deploys, deleted });
    });
  });
}

function account(): string {
  const root = path.join(tmp(), "acme");
  foldrun("init", root);
  foldrunIn(root, "new", "ads-desk");
  fs.mkdirSync(path.join(root, "library/skills/house-style"), { recursive: true });
  fs.writeFileSync(path.join(root, "library/skills/house-style/SKILL.md"), "---\nname: house-style\ndescription: how we write\n---\nPlain.\n");
  return root;
}

// ---------------------------------------------------------------- deploy

test("deploy at an account root pushes every workspace and the library", async () => {
  const root = account();
  const p = await fakePlatform();
  try {
    const r = await foldrunAsync(root, "deploy", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(p.deploys.sort(), ["ads-desk", "main"]);
    assert.equal(p.library.get("skills")?.get("house-style/SKILL.md")?.includes("Plain."), true);
    // No endpoint exists for the account's own AGENTS.md — said, not dropped.
    assert.match(r.stdout, /AGENTS\.md.*not sent/s);
  } finally {
    p.close();
  }
});

test("deploy <workspace> pushes just that one", async () => {
  const root = account();
  const p = await fakePlatform();
  try {
    const r = await foldrunAsync(root, "deploy", "ads-desk", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(p.deploys, ["ads-desk"]);
  } finally {
    p.close();
  }
});

test("a deploy never removes a workspace the platform has and this folder does not", async () => {
  const root = account();
  const p = await fakePlatform();
  p.workspaces.set("someone-elses", new Map([["AGENTS.md", "# theirs\n"]]));
  try {
    await foldrunAsync(root, "deploy", "--url", p.url, "--token", "k");
    assert.ok(p.workspaces.has("someone-elses"), "left alone");
    assert.deepEqual(p.deleted, []);
  } finally {
    p.close();
  }
});

test("a flat workspace deploys exactly as it did, under its folder name", async () => {
  const dir = path.join(tmp(), "my-desk");
  foldrun("init", dir, "--flat");
  const p = await fakePlatform();
  try {
    const r = await foldrunAsync(dir, "deploy", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(p.deploys, ["my-desk"]);
    assert.ok(p.workspaces.get("my-desk")?.has("flows/publish.md"));
  } finally {
    p.close();
  }
});

// ---------------------------------------------------------------- status

test("status says what is added, changed and only-there, and writes nothing", async () => {
  const root = account();
  const p = await fakePlatform();
  try {
    await foldrunAsync(root, "deploy", "--url", p.url, "--token", "k");
    fs.writeFileSync(path.join(root, "workspaces/main/flows/second.md"), "1. [[writer]] — go.\n");
    fs.writeFileSync(path.join(root, "workspaces/main/AGENTS.md"), "# changed\n");
    p.workspaces.get("main")!.set("flows/only-there.md", "1. [[writer]] — go.\n");

    const r = await foldrunAsync(root, "status", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\+ flows\/second\.md/);
    assert.match(r.stdout, /~ AGENTS\.md/);
    assert.match(r.stdout, /- flows\/only-there\.md/);
    assert.match(r.stdout, /a deploy never removes it/);
    // Read-only: the local file is still what we wrote.
    assert.equal(read(root, "workspaces/main/AGENTS.md"), "# changed\n");
  } finally {
    p.close();
  }
});

test("status flags a file the platform changed since the last deploy from here", async () => {
  const root = account();
  const p = await fakePlatform();
  try {
    await foldrunAsync(root, "deploy", "--url", p.url, "--token", "k");
    p.workspaces.get("main")!.set("flows/publish.md", "1. [[writer]] — edited in the dashboard.\n");
    const r = await foldrunAsync(root, "status", "--url", p.url, "--token", "k");
    assert.match(r.stdout, /changed on the platform since your last deploy: flows\/publish\.md/);
  } finally {
    p.close();
  }
});

// ------------------------------------------------------------------ pull

test("pull brings workspaces and the library down into the folder", async () => {
  const root = path.join(tmp(), "acme");
  foldrun("init", root);
  const p = await fakePlatform();
  p.workspaces.set("ads-desk", new Map([["AGENTS.md", "# ads\n"], ["flows/daily.md", "1. [[writer]] — go.\n"]]));
  p.library.set("tools", new Map([["crm.md", "---\nname: crm\n---\n"]]));
  try {
    const r = await foldrunAsync(root, "pull", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(read(root, "workspaces/ads-desk/flows/daily.md"), "1. [[writer]] — go.\n");
    assert.equal(read(root, "library/tools/crm.md"), "---\nname: crm\n---\n");
  } finally {
    p.close();
  }
});

test("pull refuses to clobber a local edit, names it, and changes nothing until --force", async () => {
  const root = path.join(tmp(), "acme");
  foldrun("init", root);
  const p = await fakePlatform();
  p.workspaces.set("main", new Map([["flows/publish.md", "1. [[writer]] — the platform's version.\n"]]));
  fs.writeFileSync(path.join(root, "workspaces/main/flows/publish.md"), "1. [[writer]] — mine.\n");
  try {
    const refused = await foldrunAsync(root, "pull", "--url", p.url, "--token", "k");
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /would be overwritten/);
    assert.match(refused.stdout, /workspaces\/main\/flows\/publish\.md/);
    assert.equal(read(root, "workspaces/main/flows/publish.md"), "1. [[writer]] — mine.\n");

    const forced = await foldrunAsync(root, "pull", "--url", p.url, "--token", "k", "--force");
    assert.equal(forced.status, 0, forced.stdout + forced.stderr);
    assert.equal(read(root, "workspaces/main/flows/publish.md"), "1. [[writer]] — the platform's version.\n");
  } finally {
    p.close();
  }
});

// ------------------------------------------------------------ workspaces

test("workspaces marks what is in both, here only, and there only", async () => {
  const root = account();
  const p = await fakePlatform();
  p.workspaces.set("main", new Map());
  p.workspaces.set("theirs", new Map());
  try {
    const r = await foldrunAsync(root, "workspaces", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /● main\s+here ·/);
    assert.match(r.stdout, /○ ads-desk\s+here only/);
    assert.match(r.stdout, /○ theirs\s+.*only/);
  } finally {
    p.close();
  }
});

test("workspaces rm removes the local folder and leaves the platform alone", async () => {
  const root = account();
  const p = await fakePlatform();
  p.workspaces.set("ads-desk", new Map());
  try {
    const r = await foldrunAsync(root, "workspaces", "rm", "ads-desk", "--url", p.url, "--token", "k");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!exists(root, "workspaces", "ads-desk"));
    assert.deepEqual(p.deleted, []);
  } finally {
    p.close();
  }
});

test("deleting on the platform needs saying so twice", async () => {
  const root = account();
  const p = await fakePlatform();
  p.workspaces.set("ads-desk", new Map());
  try {
    const refused = await foldrunAsync(root, "workspaces", "rm", "ads-desk", "--platform", "--url", p.url, "--token", "k");
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /--yes/);
    assert.deepEqual(p.deleted, []);
    assert.ok(exists(root, "workspaces", "ads-desk"), "the local copy is untouched by a refusal");

    const done = await foldrunAsync(root, "workspaces", "rm", "ads-desk", "--platform", "--yes", "--url", p.url, "--token", "k");
    assert.equal(done.status, 0, done.stdout + done.stderr);
    assert.deepEqual(p.deleted, ["ads-desk"]);
  } finally {
    p.close();
  }
});

// -------------------------------------------- workspace-scoped secrets/runs

test("secrets takes the workspace as a positional inside an account", () => {
  const root = account();
  assert.equal(foldrunIn(root, "secrets", "ads-desk", "set", "TOKEN", "--value", "v", "--local").status, 0);
  const ls = foldrunIn(root, "secrets", "ads-desk", "ls", "--local");
  assert.match(ls.stdout, /TOKEN/);
  // It landed in that workspace's store, not the other one's.
  assert.doesNotMatch(foldrunIn(root, "secrets", "main", "ls", "--local").stdout, /TOKEN/);
});

test("with several workspaces and none named, it asks which — it does not pick", () => {
  const root = account();
  const r = foldrunIn(root, "secrets", "ls", "--local");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /which workspace\?.*ads-desk, main/s);
});

test("with exactly one workspace there is nothing to say", () => {
  const root = path.join(tmp(), "acme");
  foldrun("init", root);
  assert.equal(foldrunIn(root, "secrets", "set", "TOKEN", "--value", "v", "--local").status, 0);
  assert.match(foldrunIn(root, "secrets", "ls", "--local").stdout, /TOKEN/);
});

test("runs is logs, and takes the workspace the same way", () => {
  const root = account();
  const r = foldrunIn(root, "runs", "ads-desk", "--local");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /no runs yet/);
});

test("a flat workspace still needs no workspace named anywhere", () => {
  const dir = path.join(tmp(), "my-desk");
  foldrun("init", dir, "--flat");
  assert.equal(foldrunIn(dir, "secrets", "set", "TOKEN", "--value", "v", "--local").status, 0);
  assert.match(foldrunIn(dir, "secrets", "ls", "--local").stdout, /TOKEN/);
  assert.match(foldrunIn(dir, "logs", "--local").stdout, /no runs yet/);
});
