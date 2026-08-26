// What depends on a shared file.
//
// This test could not be written before `dataRoot()` existed: the data
// directory was captured into a module-level const at import time, so pointing
// core at a fixture directory after importing it silently read the wrong root
// and returned nothing. An empty result reads as "no consumers" rather than
// "wrong directory", which is the failure mode worth designing out.
//
//   node --test tests/library-usage.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { libraryUsage, type LibraryUse } from "../packages/core/src/library.ts";

/** Build a throwaway account on disk and point core at it for one callback. */
function withAccount(files: Record<string, string>, run: () => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-usage-"));
  const previous = process.env.FOLDRUN_DATA;
  process.env.FOLDRUN_DATA = root;
  try {
    for (const [rel, content] of Object.entries(files)) {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    run();
  } finally {
    if (previous === undefined) delete process.env.FOLDRUN_DATA;
    else process.env.FOLDRUN_DATA = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const agent = (name: string, use?: string) =>
  `---\nkind: Agent\nname: ${name}\ndescription: t\n${use ? `use: [${use}]\n` : ""}---\n\nwork.\n`;

const tool = (name: string) =>
  `---\nkind: Tool\ntransport: http\nname: ${name}\ndescription: t\nbase: https://example.com\nmethods: [GET]\n---\n`;

const sorted = (u: LibraryUse[]) =>
  [...u].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

test("a library tool is traced to the agents that opted in", () => {
  withAccount(
    {
      "acme/library/tools/billing.md": tool("billing"),
      "acme/workspaces/desk/AGENTS.md": "---\nname: desk\n---\n",
      "acme/workspaces/desk/agents/writer/agent.md": agent("writer", "billing"),
      "acme/workspaces/desk/agents/idle/agent.md": agent("idle"),
      "acme/workspaces/other/AGENTS.md": "---\nname: other\n---\n",
      "acme/workspaces/other/agents/biller/agent.md": agent("biller", "billing"),
    },
    () => {
      // Exactly the agents that named it — across workspaces, and not the one
      // that didn't. This is the blast radius of rotating its credential.
      assert.deepEqual(sorted(libraryUsage("acme", "tools", "billing")), [
        { workspace: "desk", agent: "writer", relation: "use" },
        { workspace: "other", agent: "biller", relation: "use" },
      ]);
    },
  );
});

test("a tool nobody opted into has no consumers", () => {
  withAccount(
    {
      "acme/library/tools/unused.md": tool("unused"),
      "acme/workspaces/desk/AGENTS.md": "---\nname: desk\n---\n",
      "acme/workspaces/desk/agents/writer/agent.md": agent("writer"),
    },
    () => assert.deepEqual(libraryUsage("acme", "tools", "unused"), []),
  );
});

test("a nearer file of the same name is reported as shadowing", () => {
  // Resolution is nearest-wins, so this is silent: the account file still
  // exists and is not what runs. Both scopes that can override are checked.
  withAccount(
    {
      "acme/library/skills/tone/SKILL.md": "---\nkind: Skill\nname: tone\ndescription: t\n---\n",
      "acme/workspaces/desk/AGENTS.md": "---\nname: desk\n---\n",
      "acme/workspaces/desk/agents/writer/agent.md": agent("writer"),
      "acme/workspaces/desk/skills/tone/SKILL.md": "---\nkind: Skill\nname: tone\ndescription: w\n---\n",
      "acme/workspaces/desk/agents/writer/skills/tone/SKILL.md":
        "---\nkind: Skill\nname: tone\ndescription: a\n---\n",
    },
    () => {
      assert.deepEqual(sorted(libraryUsage("acme", "skills", "tone")), [
        { workspace: "desk", agent: "writer", relation: "shadowed" },
        { workspace: "desk", agent: null, relation: "shadowed" },
      ]);
    },
  );
});

test("a tool can be used and shadowed at once", () => {
  // The case that most needs saying out loud: an agent opted in by name, and
  // a workspace file of that name is what it actually gets.
  withAccount(
    {
      "acme/library/tools/billing.md": tool("billing"),
      "acme/workspaces/desk/AGENTS.md": "---\nname: desk\n---\n",
      "acme/workspaces/desk/agents/writer/agent.md": agent("writer", "billing"),
      "acme/workspaces/desk/tools/billing.md": tool("billing"),
    },
    () => {
      assert.deepEqual(sorted(libraryUsage("acme", "tools", "billing")), [
        { workspace: "desk", agent: "writer", relation: "use" },
        { workspace: "desk", agent: null, relation: "shadowed" },
      ]);
    },
  );
});

test("knowledge and memory report shadowing but never use", () => {
  // They are indexed for every agent in scope with no opt-in, so "used by"
  // would be "everyone" — true, and not information.
  withAccount(
    {
      "acme/library/knowledge/pricing.md": "---\ntype: Price List\nname: pricing\n---\n",
      "acme/workspaces/desk/AGENTS.md": "---\nname: desk\n---\n",
      "acme/workspaces/desk/agents/writer/agent.md": agent("writer"),
      "acme/workspaces/desk/knowledge/pricing.md": "---\ntype: Price List\nname: pricing\n---\n",
    },
    () => {
      const uses = libraryUsage("acme", "knowledge", "pricing");
      assert.deepEqual(uses, [{ workspace: "desk", agent: null, relation: "shadowed" }]);
      assert.equal(uses.filter((u) => u.relation === "use").length, 0);
    },
  );
});

test("the data root is read per call, not captured at import", () => {
  // The regression that made this file impossible to write. If dataRoot() is
  // ever hoisted back into a const, the second account below reads the first.
  let first: LibraryUse[] = [];
  withAccount(
    {
      "acme/library/tools/billing.md": tool("billing"),
      "acme/workspaces/desk/AGENTS.md": "---\nname: desk\n---\n",
      "acme/workspaces/desk/agents/writer/agent.md": agent("writer", "billing"),
    },
    () => (first = libraryUsage("acme", "tools", "billing")),
  );
  assert.equal(first.length, 1);

  withAccount(
    {
      "acme/library/tools/billing.md": tool("billing"),
      "acme/workspaces/desk/AGENTS.md": "---\nname: desk\n---\n",
      "acme/workspaces/desk/agents/writer/agent.md": agent("writer"),
    },
    () => assert.deepEqual(libraryUsage("acme", "tools", "billing"), []),
  );
});
