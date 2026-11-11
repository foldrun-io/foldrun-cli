// `foldrun agent run` — one agent, once, on the platform. No flow file.
//
// Two shapes: queued, where the answer is a run id and how to follow it, and
// --wait, where the CLI holds on in short pieces and then prints the same
// report `foldrun report` prints. The second matters because a waited run
// that FAILS comes back as HTTP 500 with the whole record — the answer to the
// question, not a broken platform — and a CLI that throws on it tells the
// reader to go hunting for an outage that never happened.
//
//   node --test tests/cli-agent-run.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, failing, WORKSPACES } from "./fake-platform.ts";

const RUN = "/api/workspaces/rank-desk/agents/tracker/run";

const record = (status: string) => ({
  id: "run-adhoc-1",
  flow: "adhoc:tracker",
  status,
  startedAt: "2026-09-16T01:00:00.000Z",
  finishedAt: "2026-09-16T01:02:00.000Z",
  summary: "Four targets slipped this week.",
  steps: [
    {
      agent: "tracker",
      group: 1,
      status: status === "completed" ? "completed" : "failed",
      attempts: 1,
      costUsd: 0.12,
      events: [],
      result: "Four targets slipped this week.",
      startedAt: "2026-09-16T01:00:00.000Z",
      finishedAt: "2026-09-16T01:02:00.000Z",
    },
  ],
});

test("queued: the run id, and the two ways to follow it", async () => {
  const s = await serve({ [`POST ${RUN}`]: () => ({ ok: true, runId: "run-adhoc-1", test: false }) });
  const r = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "check the target list");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /✓ queued run-adhoc-1\s+tracker · rank-desk/);
  assert.match(r.out, /foldrun report run-adhoc-1 --to rank-desk/);
  assert.match(r.out, /foldrun logs run-adhoc-1 --to rank-desk --follow/);
  const body = JSON.parse(s.seen.find((x) => x.method === "POST")!.body);
  assert.equal(body.task, "check the target list");
  assert.equal(body.test, undefined);
});

test("--test marks the run a test run, the way invoke does", async () => {
  const s = await serve({ [`POST ${RUN}`]: () => ({ ok: true, runId: "run-adhoc-1", test: true }) });
  const r = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "dry it", "--test");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /TEST/);
  assert.equal(JSON.parse(s.seen.find((x) => x.method === "POST")!.body).test, true);
});

test("--wait polls through a 202 and then prints the report", async () => {
  let asked = 0;
  const s = await serve({
    [`POST ${RUN}`]: () => ({ ok: false, runId: "run-adhoc-1", status: "running", timedOut: true, steps: [] }),
    // Two more 202s, then the finished run — and finally the full record,
    // which is what `report` asks for once the waiting is over.
    "/api/workspaces/rank-desk/runs/run-adhoc-1": (_body, query) =>
      query.get("wait") === "true" && ++asked === 1
        ? { ok: false, runId: "run-adhoc-1", status: "running", timedOut: true, steps: [] }
        : record("completed"),
  });
  const r = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "go", "--wait");
  s.close();
  assert.equal(r.code, 0, r.out);
  // The wait is asked in pieces, not one long request.
  assert.ok(s.seen.filter((x) => x.query.get("wait") === "true").length >= 3, r.out);
  // …and the last question is the report's own, unwaited.
  assert.match(r.out, /adhoc:tracker\s+run-adhoc-1/);
  assert.match(r.out, /Four targets slipped this week/);
});

test("--wait on a run that FAILS reports the run, not a broken platform", async () => {
  const s = await serve({
    [`POST ${RUN}`]: () => failing(500, { ok: false, runId: "run-adhoc-1", status: "failed", steps: [{ agent: "tracker", status: "failed" }] }),
    "/api/workspaces/rank-desk/runs/run-adhoc-1": () => record("failed"),
  });
  const r = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "go", "--wait");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /failed/);
  assert.doesNotMatch(r.out, /HTTP 500/);
});

test("no --task is refused before anything is started", async () => {
  const s = await serve({ [`POST ${RUN}`]: () => ({ ok: true, runId: "x" }) });
  const r = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /what should tracker do\?/);
  assert.equal(s.seen.filter((x) => x.method === "POST").length, 0);
});

test("agent new still works, and an unknown verb names both", async () => {
  const s = await serve({ "/api/workspaces": () => WORKSPACES });
  const r = await at(s.url, "agent", "wibble", "tracker", "--to", "rank-desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /new, run, link, unlink, import, ls are the verbs, not "wibble"/);
});

test("--context sends the conversation (FOL-162); invoke carries it too, and runs --context lists only its runs", async () => {
  const s = await serve({
    [`POST ${RUN}`]: () => ({ ok: true, runId: "run-adhoc-1", test: false, context: "order-42" }),
    "POST /api/workspaces/rank-desk/flows/weekly/run": () => ({ ok: true, runId: "run-flow-1", steps: 1, test: false, context: "order-42" }),
    "GET /api/workspaces/rank-desk/runs": () => ({
      runs: [
        { id: "run-a", flow: "adhoc:tracker", status: "completed", startedAt: "2026-11-11T01:00:00.000Z", finishedAt: "2026-11-11T01:01:00.000Z", summary: "first turn", context: { id: "order-42", key: "k" }, steps: [] },
        { id: "run-b", flow: "adhoc:tracker", status: "completed", startedAt: "2026-11-11T00:00:00.000Z", finishedAt: "2026-11-11T00:01:00.000Z", summary: "another chat", context: { id: "order-7", key: "k2" }, steps: [] },
      ],
      next: null,
    }),
  });
  try {
  const r = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "and april?", "--context", "order-42");
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(s.seen.find((x) => x.method === "POST" && x.url.includes("/agents/"))!.body).context, "order-42");
  const inv = await at(s.url, "invoke", "weekly", "--to", "rank-desk", "--task", "x", "--context", "order-42");
  assert.equal(inv.code, 0, inv.out);
  assert.equal(JSON.parse(s.seen.find((x) => x.method === "POST" && x.url.includes("/flows/"))!.body).context, "order-42");
  const listed = await at(s.url, "runs", "--to", "rank-desk", "--context", "order-42");
  assert.equal(listed.code, 0, listed.out);
  assert.match(listed.out, /first turn/);
  assert.doesNotMatch(listed.out, /another chat/, "only that conversation's runs, even where the platform does not filter");
  assert.equal(s.seen.find((x) => x.method === "GET" && x.url.includes("/runs"))!.query.get("context"), "order-42", "the platform is asked to filter");
  const none = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "x", "--context");
  assert.notEqual(none.code, 0);
  assert.match(none.out, /which conversation/);
  assert.equal(s.seen.filter((x) => x.method === "POST" && x.url.includes("/agents/")).length, 1, "nothing was started for it");
  } finally {
    s.close();
  }
});

test("--file hands the run files (FOL-163): a storage path as it is; ./local is uploaded to storage/inputs/<id>/ first; a bare --file is refused", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-file-"));
  fs.writeFileSync(path.join(dir, "brief.pdf"), "%PDF-1.7 brief");
  const s = await serve({
    [`POST ${RUN}`]: () => ({ ok: true, runId: "run-adhoc-1", test: false, inputs: ["reports/q4.pdf"] }),
    "POST /api/workspaces/rank-desk/storage/upload-url": () => failing(404, { error: "older platform" }),
    "PUT /api/workspaces/rank-desk/storage": () => ({ file: { path: "x" } }),
    "POST /api/workspaces/rank-desk/flows/weekly/run": () => ({ ok: true, runId: "run-flow-1", steps: 1, test: false }),
  });
  try {
    const r = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "read", "--file", "reports/q4.pdf", "--file", "storage/img/a.png");
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "POST" && x.url.includes("/agents/"))!.body).inputs, ["reports/q4.pdf", "img/a.png"], "a leading storage/ is the folder's name, not the path");

    const local = path.join(dir, "brief.pdf");
    const inv = await at(s.url, "invoke", "weekly", "--to", "rank-desk", "--task", "x", "--file", local);
    assert.equal(inv.code, 0, inv.out);
    const put = s.seen.find((x) => x.method === "PUT" && x.url.includes("/storage"))!;
    const rel = put.query.get("path")!;
    assert.match(rel, /^inputs\/\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\/brief\.pdf$/);
    assert.equal(put.body, "%PDF-1.7 brief");
    assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "POST" && x.url.includes("/flows/"))!.body).inputs, [rel]);

    const bare = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "x", "--file");
    assert.notEqual(bare.code, 0);
    assert.match(bare.out, /which file/);
    const missing = await at(s.url, "agent", "run", "tracker", "--to", "rank-desk", "--task", "x", "--file", "./no-such-file.pdf");
    assert.notEqual(missing.code, 0);
    assert.match(missing.out, /no such file here/);
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
