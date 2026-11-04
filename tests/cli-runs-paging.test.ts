// `foldrun runs` pages (5 Nov 2026): --limit is one page, --before <cursor>
// the page after, --page <n> the nth, --all every match — across every
// workspace with one cursor (GET …/runs?before=, answering `next`). And
// `foldrun runs outputs <run-id>`: which files a run archived (GET …/files).
//
//   node --test tests/cli-runs-paging.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, failing, WORKSPACES } from "./fake-platform.ts";

type Row = { id: string; flow: string; status: string; startedAt: string; steps: unknown[] };

/** Newest first, a tie broken by id — the platform's order. */
const order = (a: Row, b: Row) => (a.startedAt !== b.startedAt ? (a.startedAt < b.startedAt ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** A workspace's runs route as the platform answers it: limit, before, next. */
function runsRoute(rows: Row[], { paged = true } = {}) {
  const all = [...rows].sort(order);
  return (_body: string, q: URLSearchParams) => {
    const limit = Number(q.get("limit") ?? 50);
    if (!paged) return { runs: all.slice(0, limit) };
    const before = q.get("before");
    let after = all;
    if (before) {
      const [t, id] = before.split("~");
      after = all.filter((r) => r.startedAt < t || (r.startedAt === t && id !== undefined && r.id < id));
    }
    const runs = after.slice(0, limit);
    return { runs, next: after.length > runs.length ? `${runs.at(-1)!.startedAt}~${runs.at(-1)!.id}` : null };
  };
}

const at0 = Date.parse("2026-11-01T00:00:00.000Z");
const row = (id: string, minutes: number, status = "completed"): Row => ({
  id,
  flow: "daily",
  status,
  startedAt: new Date(at0 + minutes * 60_000).toISOString(),
  steps: [],
});

// Two desks interleaved, and two runs that started in the same millisecond.
const BLOG = [row("run-b1", 1), row("run-b2", 3), row("run-b3", 5), row("run-b4", 7), row("run-tie-a", 9), row("run-b5", 11)];
const RANK = [row("run-r1", 2), row("run-r2", 4), row("run-tie-b", 9), row("run-r3", 10)];
const EVERY = [...BLOG, ...RANK].sort(order).map((r) => r.id);

const platform = (opts: { paged?: boolean } = {}) =>
  serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs": runsRoute(BLOG, opts),
    "/api/workspaces/rank-desk/runs": runsRoute(RANK, opts),
    "/api/workspaces/rank-desk/runs/run-r2": () => RANK[1],
  });

const idsOf = (out: string) => (JSON.parse(out.slice(out.indexOf("{"))) as { runs: { id: string }[] }).runs.map((r) => r.id);
const nextOf = (out: string) => (JSON.parse(out.slice(out.indexOf("{"))) as { next: string | null }).next;

test("pages walked with --before meet every run once, in the merged order", async () => {
  const s = await platform();
  const seen: string[] = [];
  let before: string | null = null;
  for (let i = 0; i < 10; i++) {
    const r = await at(s.url, "runs", "--limit", "3", "--json", ...(before ? ["--before", before] : []));
    assert.equal(r.code, 0, r.out);
    seen.push(...idsOf(r.out));
    before = nextOf(r.out);
    if (!before) break;
  }
  s.close();
  assert.deepEqual(seen, EVERY);
  // The cursor went to every workspace, not only the one that held the run.
  const asked = s.seen.filter((x) => x.url.endsWith("/runs") && x.query.get("before"));
  assert.ok(asked.some((x) => x.url.includes("blog-desk")) && asked.some((x) => x.url.includes("rank-desk")));
});

test("the table prints the next page's cursor, and --page <n> is that page", async () => {
  const s = await platform();
  const first = await at(s.url, "runs", "--limit", "4");
  assert.equal(first.code, 0, first.out);
  const m = /--before (\S+)/.exec(first.out);
  assert.ok(m, first.out);
  const viaCursor = await at(s.url, "runs", "--limit", "4", "--before", m![1], "--json");
  const viaPage = await at(s.url, "runs", "--limit", "4", "--page", "2", "--json");
  s.close();
  assert.deepEqual(idsOf(viaCursor.out), EVERY.slice(4, 8));
  assert.deepEqual(idsOf(viaPage.out), EVERY.slice(4, 8));
});

test("--all reads every page and answers no next", async () => {
  const s = await platform();
  const r = await at(s.url, "runs", "--all", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(idsOf(r.out), EVERY);
  assert.equal(nextOf(r.out), null);
});

test("--before <run-id> pages from that run's position in every workspace", async () => {
  const s = await platform();
  const r = await at(s.url, "runs", "--before", "run-r2", "--to", "rank-desk", "--json");
  const all = await at(s.url, "runs", "--before", "run-r2", "--all", "--json");
  s.close();
  assert.deepEqual(idsOf(r.out), ["run-r1"]);
  assert.deepEqual(idsOf(all.out), EVERY.slice(EVERY.indexOf("run-r2") + 1));
});

test("a filter the CLI applies still reaches past a busy desk's first 500", async () => {
  // blog-desk: 520 newer successes, then a failure; rank-desk: one failure.
  const busy = [...Array.from({ length: 520 }, (_, i) => row(`run-ok${String(i).padStart(3, "0")}`, 1000 + i)), row("run-old-fail", 5, "failed")];
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs": runsRoute(busy),
    "/api/workspaces/rank-desk/runs": runsRoute([row("run-rank-fail", 2, "failed")]),
  });
  const r = await at(s.url, "runs", "--status", "failed", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(idsOf(r.out), ["run-old-fail", "run-rank-fail"]);
});

test("a platform from before paging is told so, not paged from the top again", async () => {
  const s = await platform({ paged: false });
  const plain = await at(s.url, "runs", "--limit", "3", "--json");
  const paged = await at(s.url, "runs", "--before", "2026-11-01T00:05:00.000Z", "--json");
  s.close();
  assert.equal(plain.code, 0, plain.out);
  assert.equal(idsOf(plain.out).length, 3, "without a cursor it is the list as it always was");
  assert.notEqual(paged.code, 0);
  assert.match(paged.out, /does not page runs/);
});

test("--page takes a page number, and not beside --all", async () => {
  const s = await platform();
  const bad = await at(s.url, "runs", "--page", "0");
  const both = await at(s.url, "runs", "--page", "2", "--all");
  s.close();
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /--page is a page number/);
  assert.notEqual(both.code, 0);
  assert.match(both.out, /leave --page out/);
});

// ------------------------------------------------------------ runs outputs

const FILES = {
  runId: "run-r2",
  files: [
    { agent: "writer", path: "draft.md", bytes: 2048, href: "/api/workspaces/rank-desk/runs/run-r2/archive?agent=writer&path=draft.md" },
    { agent: "writer", path: "img/cover.png", bytes: 3 * 1024 * 1024, href: "/api/workspaces/rank-desk/runs/run-r2/archive?agent=writer&path=img%2Fcover.png" },
  ],
  totalBytes: 2048 + 3 * 1024 * 1024,
};

test("runs outputs lists what the run archived, finding its workspace", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/rank-desk/runs/run-r2": () => RANK[1],
    "/api/workspaces/rank-desk/runs/run-r2/files": () => FILES,
  });
  const r = await at(s.url, "runs", "outputs", "run-r2");
  const json = await at(s.url, "runs", "outputs", "run-r2", "--to", "rank-desk", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /run-r2.*in rank-desk · 2 files · 3\.0MB/);
  assert.match(r.out, /writer/);
  assert.match(r.out, /2\.0KB\s+draft\.md/);
  assert.match(r.out, /img\/cover\.png/);
  assert.match(r.out, /foldrun report run-r2 get <agent>\/<path>/);
  assert.deepEqual(JSON.parse(json.out.slice(json.out.indexOf("{"))), FILES);
});

test("runs outputs says so when nothing was archived, and needs one run id", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/runs/run-b1/files": () => ({ runId: "run-b1", files: [], totalBytes: 0 }),
    "/api/workspaces/blog-desk/runs/run-gone/files": () => failing(404, { error: "run not found" }),
  });
  const none = await at(s.url, "runs", "outputs", "run-b1", "--to", "blog-desk");
  const gone = await at(s.url, "runs", "outputs", "run-gone", "--to", "blog-desk");
  const bare = await at(s.url, "runs", "outputs");
  s.close();
  assert.equal(none.code, 0, none.out);
  assert.match(none.out, /archived no files/);
  assert.notEqual(gone.code, 0);
  assert.match(gone.out, /not found/);
  assert.notEqual(bare.code, 0);
  assert.match(bare.out, /runs outputs <run-id>/);
});

test("runs --all on a platform from before paging refuses, instead of a list cut at 500", async () => {
  const s = await serve({
    "/api/workspaces": () => WORKSPACES,
    "/api/workspaces/blog-desk/runs": () => ({ runs: [] }),
    "/api/workspaces/rank-desk/runs": () => ({ runs: [] }),
  });
  const r = await at(s.url, "runs", "--all", "--json");
  s.close();
  assert.notEqual(r.code, 0);
  assert.match(r.out, /does not page runs yet/);
});

test("runs --json on an account with no workspaces is still the { runs, next } document", async () => {
  const s = await serve({ "/api/workspaces": () => ({ workspaces: [] }) });
  const r = await at(s.url, "runs", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(r.out.slice(r.out.search(/[[{]/))), { runs: [], next: null });
});
