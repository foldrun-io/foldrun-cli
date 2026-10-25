// `network:` and bound secrets from the terminal: `check` refuses a value
// nobody can read, `agent network` prints and edits the one line the
// dashboard's Network card edits, and `secrets sites` binds a secret so the
// egress proxy fills it and no sandbox holds it.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");

function desk(agents: Record<string, string>, agentsMd?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-network-"));
  const ws = path.join(root, "desk");
  for (const [name, front] of Object.entries(agents)) {
    fs.mkdirSync(path.join(ws, "agents", name), { recursive: true });
    fs.writeFileSync(path.join(ws, "agents", name, "agent.md"), `---\nname: ${name}\ndescription: ${name}\n${front}---\n\nWork.\n`);
  }
  if (agentsMd) fs.writeFileSync(path.join(ws, "AGENTS.md"), agentsMd);
  const data = path.join(root, "data");
  const foldrun = (...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      cwd: ws,
      env: { ...process.env, FOLDRUN_DATA: data, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, NO_COLOR: "1" },
    });
  return { ws, foldrun, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("check refuses a network: nobody can read, on an agent and in AGENTS.md", () => {
  const d = desk({ scout: "network: closed\n", writer: "network: [\"https://a.com/x\"]\n" }, "---\nnetwork: { level: wide }\n---\n\nContext.\n");
  try {
    const r = d.foldrun("check", d.ws, "--local");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /error\s+agents\/scout\s+network is open, trusted, none/);
    assert.match(r.stdout, /error\s+agents\/writer\s+network: https:\/\/a\.com\/x — a site is a domain, no scheme or path: a\.com/);
    assert.match(r.stdout, /error\s+AGENTS\.md\s+network\.level is open, trusted, none/);
  } finally {
    d.done();
  }
});

test("agent network prints the level a run resolves, and edits only the network: line", () => {
  const d = desk({ scout: "tools: [web]\n", writer: "tools: [write]\nmodel: fast\n" });
  try {
    let r = d.foldrun("agent", "network", "scout", "--local");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /network: open \(default — the agent reads the web\) — any public site/);

    r = d.foldrun("agent", "network", "writer", "--local");
    assert.match(r.stdout, /network: trusted \(default\) — the trusted list \(\d+ sites\)/);

    r = d.foldrun("agent", "network", "writer", "--add", "api.dataforseo.com", "--add", "*.example.org", "--local");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const file = path.join(d.ws, "agents/writer/agent.md");
    assert.equal(
      fs.readFileSync(file, "utf8"),
      '---\nname: writer\ndescription: writer\ntools: [write]\nmodel: fast\nnetwork: [api.dataforseo.com, "*.example.org"]\n---\n\nWork.\n',
    );
    assert.match(r.stdout, /added: api\.dataforseo\.com, \*\.example\.org/);

    r = d.foldrun("agent", "network", "writer", "none", "--remove", "*.example.org", "--local");
    assert.match(fs.readFileSync(file, "utf8"), /^network: \{ level: none, allow: \[api\.dataforseo\.com\] \}$/m);

    r = d.foldrun("agent", "network", "writer", "inherit", "--remove", "api.dataforseo.com", "--local");
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /network:/, "nothing left to say: the line goes");

    r = d.foldrun("agent", "network", "writer", "wide", "--local");
    assert.equal(r.status, 1);
    assert.match(r.stderr + r.stdout, /"wide" is not a level/);
    r = d.foldrun("agent", "network", "nobody", "--local");
    assert.match(r.stderr + r.stdout, /no agent "nobody"/);
  } finally {
    d.done();
  }
});

test("agent network reads a network: set inside a guardrail: block, the way a run does (FOL-77)", () => {
  // The allow list lives in a `guardrail:` block, not at the top. A run reads
  // it folded up (core's configMatter); `agent network` must too, or an edit
  // builds on an empty list and silently drops the sites already there.
  const d = desk({ writer: "model: fast\nguardrail:\n  network: [api.dataforseo.com]\n" });
  try {
    const r = d.foldrun("agent", "network", "writer", "none", "--dry-run", "--local");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // Folded: the pre-existing site is kept under the new level. Unfolded, the
    // read was undefined and this collapsed to a bare `network: none`.
    assert.match(r.stdout, /level: none, allow: \[api\.dataforseo\.com\]/);
  } finally {
    d.done();
  }
});

test("secrets sites binds, lists, refuses a URL, and unbinds", () => {
  const d = desk({ scout: "secrets: [DFS_KEY]\n" });
  try {
    let r = d.foldrun("secrets", "set", "DFS_KEY", "--value", "abcdefgh123", "--site", "api.dataforseo.com", "--local");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /DFS_KEY stored and sent only to api\.dataforseo\.com/);
    r = d.foldrun("secrets", "sites", "DFS_KEY", "--local");
    assert.match(r.stdout, /DFS_KEY is sent only to api\.dataforseo\.com/);
    r = d.foldrun("secrets", "sites", "DFS_KEY", "api.dataforseo.com", "*.dataforseo.com", "--local");
    assert.match(r.stdout, /sent only to api\.dataforseo\.com, \*\.dataforseo\.com/);
    r = d.foldrun("secrets", "ls", "--local");
    assert.match(r.stdout, /DFS_KEY .* sent only to api\.dataforseo\.com, \*\.dataforseo\.com/);
    r = d.foldrun("secrets", "sites", "DFS_KEY", "https://x.com/", "--local");
    assert.equal(r.status, 1);
    assert.match(r.stderr + r.stdout, /is not a site/);
    r = d.foldrun("secrets", "sites", "DFS_KEY", "--clear", "--local");
    assert.match(r.stdout, /DFS_KEY unbound/);
    r = d.foldrun("secrets", "sites", "DFS_KEY", "--local");
    assert.match(r.stdout, /not bound to sites/);
  } finally {
    d.done();
  }
});
