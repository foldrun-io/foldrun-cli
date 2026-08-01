// AGENTS.md, at both scopes.
//
// The prose in AGENTS.md was written by every scaffold, shown in the dashboard
// and described in its own template as "context every agent here shares" — and
// never read. Only the frontmatter reached the runtime, so the instructions
// people actually wrote reached no model. These tests are the guard on that.
//
//   node --test tests/shared-context.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sharedInstructions } from "../packages/core/src/runner.ts";

/**
 * A laptop-layout account: `library/` and AGENTS.md beside the workspace.
 * MDAGENT_WORKSPACE is what puts the runtime in single-workspace mode, where
 * the account is the workspace's parent.
 */
function withAccount(files: Record<string, string>, run: (agentDir: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdagent-shared-"));
  const previous = process.env.MDAGENT_WORKSPACE;
  process.env.MDAGENT_WORKSPACE = path.join(root, "desk");
  try {
    for (const [rel, content] of Object.entries(files)) {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    run(path.join(root, "desk/agents/writer"));
  } finally {
    if (previous === undefined) delete process.env.MDAGENT_WORKSPACE;
    else process.env.MDAGENT_WORKSPACE = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const AGENT = "---\nname: writer\ndescription: d\n---\n\nWrite the draft.\n";

test("an agent is given both the account's and the workspace's instructions", () => {
  withAccount(
    {
      "AGENTS.md": "---\nname: acme\n---\n\nNever quote a price without checking.\n",
      "desk/AGENTS.md": "---\nname: desk\n---\n\nKeep it under 300 words.\n",
      "desk/agents/writer/agent.md": AGENT,
    },
    (agentDir) => {
      const out = sharedInstructions(agentDir, "acme") ?? "";
      assert.match(out, /Never quote a price without checking\./);
      assert.match(out, /Keep it under 300 words\./);
      // Outermost first: the account frames what the workspace narrows.
      assert.ok(
        out.indexOf("Never quote") < out.indexOf("Keep it under"),
        "the account's context must come before the workspace's",
      );
    },
  );
});

test("instructions accumulate — a workspace cannot silently drop an account rule", () => {
  // Config is nearest-wins; prose is not. An account rule that a workspace
  // could shadow just by having its own AGENTS.md would be worthless as a rule.
  withAccount(
    {
      "AGENTS.md": "---\nname: acme\n---\n\nNever contact a competitor.\n",
      "desk/AGENTS.md": "---\nname: desk\n---\n\nWrite in plain English.\n",
      "desk/agents/writer/agent.md": AGENT,
    },
    (agentDir) => {
      assert.match(sharedInstructions(agentDir, "acme") ?? "", /Never contact a competitor\./);
    },
  );
});

test("either scope alone is enough", () => {
  withAccount(
    {
      "AGENTS.md": "---\nname: acme\n---\n\nAccount rule.\n",
      "desk/agents/writer/agent.md": AGENT,
    },
    (agentDir) => {
      const out = sharedInstructions(agentDir, "acme") ?? "";
      assert.match(out, /Account rule\./);
      assert.doesNotMatch(out, /Everyone in this workspace/);
    },
  );

  withAccount(
    {
      "desk/AGENTS.md": "---\nname: desk\n---\n\nWorkspace rule.\n",
      "desk/agents/writer/agent.md": AGENT,
    },
    (agentDir) => {
      const out = sharedInstructions(agentDir, "acme") ?? "";
      assert.match(out, /Workspace rule\./);
      assert.doesNotMatch(out, /Everyone in this account/);
    },
  );
});

test("no AGENTS.md anywhere adds nothing to the prompt", () => {
  withAccount({ "desk/agents/writer/agent.md": AGENT }, (agentDir) => {
    assert.equal(sharedInstructions(agentDir, "acme"), null);
  });
});

test("frontmatter-only AGENTS.md contributes no prose", () => {
  // Config in, nothing out — an empty "Shared context" heading would be noise
  // in every prompt in the account.
  withAccount(
    {
      "AGENTS.md": '---\nname: acme\nruntime:\n  python: "3.12"\n---\n',
      "desk/agents/writer/agent.md": AGENT,
    },
    (agentDir) => assert.equal(sharedInstructions(agentDir, "acme"), null),
  );
});

test("legacy project.md is still read", () => {
  withAccount(
    {
      "desk/project.md": "---\nname: desk\n---\n\nOld-style workspace context.\n",
      "desk/agents/writer/agent.md": AGENT,
    },
    (agentDir) => {
      assert.match(sharedInstructions(agentDir, "acme") ?? "", /Old-style workspace context\./);
    },
  );
});

test("a broken AGENTS.md does not take down every agent under it", () => {
  withAccount(
    {
      "AGENTS.md": "---\nname: [unclosed\n---\n\nUnreachable.\n",
      "desk/AGENTS.md": "---\nname: desk\n---\n\nWorkspace still applies.\n",
      "desk/agents/writer/agent.md": AGENT,
    },
    (agentDir) => {
      const out = sharedInstructions(agentDir, "acme") ?? "";
      assert.match(out, /Workspace still applies\./);
    },
  );
});
