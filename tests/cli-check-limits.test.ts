// `foldrun check` and `limits:` — a count nobody can read would run
// uncapped, and a key that names no tool caps nothing. Both are errors
// offline; a limit on a real tool the agent does not hold is a warning.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");
const foldrun = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, FOLDRUN_DATA: undefined, FOLDRUN_URL: undefined, FOLDRUN_TOKEN: undefined, NO_COLOR: "1" },
  });

function desk(agents: Record<string, string>, agentsMd?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-limits-"));
  const ws = path.join(root, "desk");
  for (const [name, front] of Object.entries(agents)) {
    fs.mkdirSync(path.join(ws, "agents", name), { recursive: true });
    fs.writeFileSync(path.join(ws, "agents", name, "agent.md"), `---\nname: ${name}\ndescription: ${name}\n${front}---\n\nWork.\n`);
  }
  fs.mkdirSync(path.join(ws, "tools"), { recursive: true });
  fs.writeFileSync(path.join(ws, "tools", "crm.md"), "---\ntransport: http\nname: crm\nbase: https://crm.example.com\ndescription: the CRM\n---\n");
  fs.writeFileSync(path.join(ws, "tools", "hubspot.md"), "---\ntransport: http\nname: hubspot\nbase: https://api.hubapi.com\ndescription: HubSpot\n---\n");
  if (agentsMd) fs.writeFileSync(path.join(ws, "AGENTS.md"), agentsMd);
  return ws;
}

test("check errors on an unknown key and an unreadable count, warns on a tool not granted", () => {
  const ws = desk({
    scout: "tools: [read, crm]\nlimits:\n  ghost: 3\n  crm: 0\n  web.surf: 2\n  hubspot: 5\n",
  });
  try {
    const r = foldrun("check", ws, "--local");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /error\s+agents\/scout\s+limits: ghost — not a tool this agent could call\. The keys: calls, web, web\.search/);
    assert.match(r.stdout, /error\s+agents\/scout\s+limits: crm: 0 — a whole number of calls, 1 or more/);
    assert.match(r.stdout, /error\s+agents\/scout\s+limits: "web\.surf" is not a key/);
    assert.match(r.stdout, /warn\s+agents\/scout\s+limits: hubspot — this agent is not granted hubspot/);
  } finally {
    fs.rmSync(path.dirname(ws), { recursive: true, force: true });
  }
});

test("good limits pass, and AGENTS.md defaults are checked for their values", () => {
  const ws = desk(
    { scout: "tools: [web, read, code, crm]\nlimits:\n  web.search: 40\n  crm: 20\n  read: 100\n  Bash: 5\n  calls: 300\n" },
    "---\nlimits:\n  calls: 500\n---\n\nContext.\n",
  );
  try {
    const r = foldrun("check", ws, "--local");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /limits:/);
    fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nlimits:\n  calls: lots\n---\n\nContext.\n");
    const bad = foldrun("check", ws, "--local");
    assert.equal(bad.status, 1, bad.stdout);
    assert.match(bad.stdout, /error\s+AGENTS\.md\s+limits: calls: lots — a whole number/);
  } finally {
    fs.rmSync(path.dirname(ws), { recursive: true, force: true });
  }
});
