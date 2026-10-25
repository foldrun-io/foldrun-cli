// `foldrun proposals` and `foldrun eval improve` — proposed fixes — against a
// fake platform. Applying writes files, so it asks first, and refuses without
// a terminal unless --yes says so.
//
//   node --test tests/cli-proposals.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, cli, WORKSPACES } from "./fake-platform.ts";

const P = "prop_mvabc12345678";
const ready = {
  id: P,
  workspace: "blog-desk",
  eval: "digest-quality",
  by: "auto",
  createdAt: "2026-10-24T01:00:00.000Z",
  updatedAt: "2026-10-24T01:01:00.000Z",
  status: "ready",
  failures: [{ runId: "run-1", check: "cites sources", detail: "judge: names its sources — nothing is attributed", at: "x" }],
  jobId: "j-1",
  reply: "The writer was never told to cite sources.",
  files: [{ path: "agents/writer/agent.md", before: "Write the digest.\n", content: "Write the digest.\nName the source of every claim.\n", sha256: "abc" }],
  issues: [],
};
const base = "/api/workspaces/blog-desk/proposals";

test("proposals lists them, show prints the reasoning and the change", async () => {
  const fake = await serve({
    "/api/workspaces": () => WORKSPACES,
    [base]: (_b, q) => ({ proposals: q.get("status") === "applied" ? [] : [ready] }),
    [`GET ${base}/${P}`]: () => ready,
  });
  try {
    const list = await at(fake.url, "proposals", "--to", "blog-desk");
    assert.equal(list.code, 0, list.out);
    assert.match(list.out, new RegExp(`${P}\\s+ready to review\\s+digest-quality`));
    assert.match(list.out, /1 failure\(s\) · agents\/writer\/agent.md/);
    const none = await at(fake.url, "proposals", "--to", "blog-desk", "--status", "applied");
    assert.match(none.out, /no proposed fixes/);
    assert.equal(fake.seen.at(-1)?.query.get("status"), "applied");
    const show = await at(fake.url, "proposals", "show", P, "--to", "blog-desk");
    assert.match(show.out, /never told to cite sources/);
    assert.match(show.out, /run-1 — cites sources/);
    assert.match(show.out, /\+ Name the source of every claim\./);
  } finally {
    fake.close();
  }
});

test("apply asks first: no terminal and no --yes writes nothing", async () => {
  const fake = await serve({
    "/api/workspaces": () => WORKSPACES,
    [`GET ${base}/${P}`]: () => ready,
    [`POST ${base}/${P}`]: (body) => ({ ...ready, status: JSON.parse(body).action === "apply" ? "applied" : "dismissed", applied: ["agents/writer/agent.md"] }),
  });
  try {
    const refused = await at(fake.url, "proposals", "apply", P, "--to", "blog-desk");
    assert.notEqual(refused.code, 0);
    assert.match(refused.out, /needs a person/);
    assert.ok(!fake.seen.some((s) => s.method === "POST"), "nothing applied");
    const yes = await at(fake.url, "proposals", "apply", P, "--to", "blog-desk", "--yes");
    assert.equal(yes.code, 0, yes.out);
    assert.deepEqual(JSON.parse(fake.seen.find((s) => s.method === "POST")!.body), { action: "apply" });
    assert.match(yes.out, /applied.*wrote agents\/writer\/agent.md/);
    const dismissed = await at(fake.url, "proposals", "dismiss", P, "--to", "blog-desk");
    assert.equal(dismissed.code, 0);
    assert.match(dismissed.out, /dismissed/);
  } finally {
    fake.close();
  }
});

test("eval improve asks for one and waits for the draft", async () => {
  let polls = 0;
  const fake = await serve({
    "/api/workspaces": () => WORKSPACES,
    "POST /api/workspaces/blog-desk/evals/digest-quality/improve": () => ({ ...ready, status: "drafting", files: [], reply: "" }),
    [`GET ${base}/${P}`]: () => (++polls < 2 ? { ...ready, status: "drafting" } : ready),
  });
  try {
    const r = await cli(["eval", "improve", "digest-quality", "--to", "blog-desk", "--url", fake.url, "--token", "k"], { env: { FOLDRUN_EVAL_POLL_MS: "10" } });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /drafting it from 1 failure/);
    assert.match(r.out, /ready to review/);
    const quick = await at(fake.url, "eval", "improve", "digest-quality", "--to", "blog-desk", "--no-wait");
    assert.equal(quick.code, 0);
    assert.match(quick.out, /proposals show prop_/);
  } finally {
    fake.close();
  }
});

test("show is an ordered diff: a reorder or a removed duplicate shows, and --json apply keeps stdout one document", async () => {
  const reorder = { ...ready, files: [{ path: "flows/digest.md", before: "1. [[writer]] — Write.\n2. [[editor]] — Edit.\nkeep\nkeep\n", content: "1. [[editor]] — Edit.\n2. [[writer]] — Write.\nkeep\n", sha256: "x" }] };
  const fake = await serve({
    "/api/workspaces": () => WORKSPACES,
    [`GET ${base}/${P}`]: () => reorder,
    [`POST ${base}/${P}`]: () => ({ ...reorder, status: "applied", applied: ["flows/digest.md"] }),
  });
  try {
    const show = await at(fake.url, "proposals", "show", P, "--to", "blog-desk");
    assert.match(show.out, /- 1\. \[\[writer\]\] — Write\./);
    assert.match(show.out, /\+ 1\. \[\[editor\]\] — Edit\./);
    assert.match(show.out, /- keep/, "the removed duplicate shows");
    const child = await new Promise<{ out: string; code: number }>((resolve) => {
      import("node:child_process").then(({ spawn }) => {
        // Spawned here rather than through cli(): stdout alone, without stderr mixed in.
        const p = spawn(process.execPath, ["bin/foldrun.mjs", "proposals", "apply", P, "--to", "blog-desk", "--yes", "--json", "--url", fake.url, "--token", "k"], { env: { ...process.env, FOLDRUN_HOME: "/nonexistent/foldrun-home", NO_COLOR: "1" } });
        let out = "";
        p.stdout.on("data", (d) => (out += d));
        p.on("close", (code) => resolve({ out, code: code ?? 1 }));
      });
    });
    assert.equal(child.code, 0);
    assert.equal(JSON.parse(child.out).status, "applied", "stdout is the JSON alone");
  } finally {
    fake.close();
  }
});
