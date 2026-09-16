// `foldrun check --to <workspace>` — validate the copy that is DEPLOYED.
//
// A workspace can be edited through the API, by an agent or by `foldrun
// source put`, and until this existed the only way to find out whether what
// landed there was valid was to spend a run and read the failure. The files
// come down into a temp folder and the ORDINARY check runs over them, so
// there is one copy of the rules and not two that disagree by Friday.
//
//   node --test tests/cli-check-remote.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, cli } from "./fake-platform.ts";

const agent = (name: string) => `---
name: ${name}
description: ${name} does one thing.
---

You are ${name}. Do the one thing.
`;

/** A deployed workspace: its file list, and each file when asked for by path. */
function deployed(files: Record<string, string>) {
  return {
    "/api/workspaces/rank-desk/source": (_b: string, query: URLSearchParams) => {
      const path = query.get("path");
      if (!path) return { files: Object.keys(files) };
      return { path, content: files[path] ?? "" };
    },
    "/api/library/tools": () => ({ entries: [] }),
    "/api/library/skills": () => ({ entries: [] }),
  };
}

const clean = {
  "AGENTS.md": "# rank-desk\n\nThe desk that watches rankings.\n",
  "agents/tracker/agent.md": agent("tracker"),
  "agents/writer/agent.md": agent("writer"),
  "flows/weekly.md": `---
trigger: manual
---

1. [[tracker]] — Pull this week's positions.
2. [[writer]] — Write up what moved.
`,
};

test("a clean deployed workspace checks green, and says it checked the deployed copy", async () => {
  const s = await serve(deployed(clean));
  const r = await at(s.url, "check", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /rank-desk\s+the deployed copy on http/);
  assert.match(r.out, /4 files/);
  assert.match(r.out, /✓ 2 agents · 1 flows/);
  assert.match(r.out, /checked what is deployed, not this folder — rank-desk · http/);
});

test("an unknown agent in a deployed flow is an error, with the file and the line", async () => {
  const s = await serve(
    deployed({
      ...clean,
      "flows/weekly.md": `---
trigger: manual
---

1. [[tracker]] — Pull this week's positions.
2. [[ghost]] — Write up what moved.
`,
    }),
  );
  const r = await at(s.url, "check", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /error\s+flows\/weekly\.md:\d+\s+\[\[ghost\]\] does not exist/);
  assert.match(r.out, /1 error/);
});

test("every source file is fetched by path, and nothing is written into this folder", async () => {
  const s = await serve(deployed(clean));
  const r = await at(s.url, "check", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  const asked = s.seen.filter((x) => x.query.get("path")).map((x) => x.query.get("path"));
  assert.deepEqual(asked.sort(), Object.keys(clean).sort());
});

test("a workspace with nothing in it says so rather than checking an empty folder", async () => {
  const s = await serve({
    "/api/workspaces/rank-desk/source": () => ({ files: [] }),
    "/api/library/tools": () => ({ entries: [] }),
    "/api/library/skills": () => ({ entries: [] }),
  });
  const r = await at(s.url, "check", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no source files in "rank-desk"/);
});

test("--to works from anywhere, including a folder that is not a workspace", async () => {
  const s = await serve(deployed(clean));
  const r = await cli(["check", "--to", "rank-desk", "--url", s.url, "--token", "k"], { cwd: "/tmp" });
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /the deployed copy/);
});
