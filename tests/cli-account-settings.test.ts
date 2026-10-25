// `foldrun account` — the account's own defaults, read and set.
//
// The timezone was set with a raw PATCH the day this was written. The thing
// worth pinning is the merge: the platform replaces the whole notify block,
// so setting an email without reading the current events first would drop
// them silently, which is the failure mode of every "replaces whole" key.
//
//   node --test tests/cli-account-settings.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const defaults: any = {
  timezone: "Australia/Sydney",
  budget: null,
  concurrency: null,
  notify: { email: "marketing@example.test", events: ["failed", "awaiting-approval"] },
};

/** A fake account whose PATCH merges the way the platform's does. */
function account(start = defaults) {
  let state: any = { ...start };
  return {
    routes: {
      "GET /api/account": () => ({ defaults: state }),
      "PATCH /api/account": (body: string) => {
        state = { ...state, ...JSON.parse(body) };
        return { ok: true, defaults: state };
      },
    },
    get state() {
      return state;
    },
  };
}

test("account with no verb prints every default, and what is unset", async () => {
  const a = account({ ...defaults, notify: null });
  const s = await serve(a.routes);
  const r = await at(s.url, "account");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /timezone\s+Australia\/Sydney/);
  assert.match(r.out, /nobody is told anything/);
  assert.match(r.out, /no cap/);
  assert.match(r.out, /the plan's number/);
});

test("set timezone patches just that key, and prints what it now is", async () => {
  const a = account();
  const s = await serve(a.routes);
  const r = await at(s.url, "account", "set", "timezone", "UTC");
  s.close();
  assert.equal(r.code, 0, r.out);
  const patch = s.seen.find((x) => x.method === "PATCH")!;
  assert.deepEqual(JSON.parse(patch.body), { timezone: "UTC" });
  assert.match(r.out, /timezone set/);
});

test("set notify email keeps the events that were already there", async () => {
  const a = account();
  const s = await serve(a.routes);
  const r = await at(s.url, "account", "set", "notify", "email", "ops@example.test");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "PATCH")!.body), {
    notify: { email: "ops@example.test", events: ["failed", "awaiting-approval"] },
  });
});

test("set notify url keeps the email beside it — the block is replaced whole", async () => {
  const a = account();
  const s = await serve(a.routes);
  const r = await at(s.url, "account", "set", "notify", "url", "https://hooks.example.test/x", "--events", "failed,completed");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen.find((x) => x.method === "PATCH")!.body), {
    notify: { url: "https://hooks.example.test/x", email: "marketing@example.test", events: ["failed", "completed"] },
  });
});

test("an event name the platform does not know is refused before the PATCH", async () => {
  const a = account();
  const s = await serve(a.routes);
  const r = await at(s.url, "account", "set", "notify", "email", "ops@example.test", "--events", "exploded");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /--events takes failed, awaiting-approval, completed/);
  assert.equal(s.seen.filter((x) => x.method === "PATCH").length, 0);
});

test("budget and concurrency go through, and clear sends null", async () => {
  const a = account();
  const s = await serve(a.routes);
  assert.equal((await at(s.url, "account", "set", "budget", "60/day")).code, 0);
  assert.equal((await at(s.url, "account", "set", "concurrency", "4")).code, 0);
  assert.equal((await at(s.url, "account", "clear", "budget")).code, 0);
  s.close();
  const patches = s.seen.filter((x) => x.method === "PATCH").map((x) => JSON.parse(x.body));
  assert.deepEqual(patches, [{ budget: "60/day" }, { concurrency: 4 }, { budget: null }]);
});

test("deploy_block (FOL-58): set sends the mode, an unknown one is refused before any request", async () => {
  const a = account();
  const s = await serve(a.routes);
  const ok = await at(s.url, "account", "set", "deploy_block", "secrets");
  const bad = await at(s.url, "account", "set", "deploy_block", "strict");
  s.close();
  assert.equal(ok.code, 0, ok.out);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /deploy_block is none, secrets or security/);
  assert.deepEqual(s.seen.filter((x) => x.method === "PATCH").map((x) => JSON.parse(x.body)), [{ deploy_block: "secrets" }]);
});

test("network_enforce: on/off become true/false, anything else is refused before any request", async () => {
  const a = account();
  const s = await serve(a.routes);
  const on = await at(s.url, "account", "set", "network_enforce", "on");
  const off = await at(s.url, "account", "set", "network_enforce", "off");
  const bad = await at(s.url, "account", "set", "network_enforce", "maybe");
  s.close();
  assert.equal(on.code, 0, on.out);
  assert.equal(off.code, 0, off.out);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /network_enforce is on or off/);
  assert.deepEqual(s.seen.filter((x) => x.method === "PATCH").map((x) => JSON.parse(x.body)), [{ network_enforce: true }, { network_enforce: false }]);
});

test("the platform's own complaint is what you read, not HTTP 400", async () => {
  const s = await serve({
    "GET /api/account": () => ({ defaults }),
    "PATCH /api/account": () => ({ __status: 400, body: { error: '"Mars/Olympus" is not an IANA time zone — Australia/Sydney, UTC, America/New_York' } }),
  });
  const r = await at(s.url, "account", "set", "timezone", "Mars/Olympus");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /is not an IANA time zone/);
});

test("a setting that is not one of the four says which four", async () => {
  const s = await serve(account().routes);
  const r = await at(s.url, "account", "set", "colour", "blue");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /timezone\|notify\|budget\|concurrency/);
});

test("account pause sends the reason; --stop asks, and with --yes sends stop: true; resume is a DELETE", async () => {
  const seen: { method: string; body: string }[] = [];
  const s = await serve({
    "POST /api/account/pause": (body: string) => {
      seen.push({ method: "POST", body });
      return { ok: true, paused: { at: "2026-10-21T04:00:00Z", by: "ana@example.test", scope: "account" }, stopped: ["desk/run-1"], failed: [] };
    },
    "DELETE /api/account/pause": () => {
      seen.push({ method: "DELETE", body: "" });
      return { ok: true, paused: null };
    },
  });
  const paused = await at(s.url, "account", "pause", "--reason", "bad prompt posting");
  const stopNoYes = await at(s.url, "account", "pause", "--stop");
  const stopped = await at(s.url, "account", "pause", "--stop", "--yes");
  const resumed = await at(s.url, "account", "resume");
  s.close();
  assert.equal(paused.code, 0, paused.out);
  assert.match(paused.out, /paused every workspace in the account/);
  assert.equal(stopNoYes.code, 1, "stopping runs needs a person, or --yes");
  assert.match(stopNoYes.out, /pass --yes/);
  assert.equal(stopped.code, 0, stopped.out);
  assert.match(stopped.out, /1 run\(s\) stopped/);
  assert.equal(resumed.code, 0, resumed.out);
  assert.match(resumed.out, /runs start again/);
  assert.deepEqual(seen.map((x) => [x.method, x.body ? JSON.parse(x.body) : null]), [
    ["POST", { reason: "bad prompt posting" }],
    ["POST", { stop: true }],
    ["DELETE", null],
  ]);
});

test("account with no verb shows the pause, and says nothing of it on a platform without the route", async () => {
  const a = account();
  const s = await serve({ ...a.routes, "GET /api/account/pause": () => ({ paused: null, account: { at: "2026-10-21T04:00:00Z", by: "ops", reason: "incident" }, workspaces: { desk: { at: "2026-10-20T00:00:00Z", by: "x" } } }) });
  const r = await at(s.url, "account");
  s.close();
  assert.match(r.out, /paused\s+2026-10-21 04:00 UTC by ops — incident/);
  assert.match(r.out, /on their own: desk/);
  const old = await serve(account().routes);
  const r2 = await at(old.url, "account");
  old.close();
  assert.equal(r2.code, 0, r2.out);
  assert.doesNotMatch(r2.out, /paused/);
});

test("pause --stop names a run it could not stop and exits 1", async () => {
  const s = await serve({
    "POST /api/workspaces/desk/pause": () => ({ ok: true, paused: { at: "2026-10-21T04:00:00Z", by: "x", scope: "workspace" }, stopped: [], failed: [{ workspace: "desk", runId: "run-9", error: "queue file is busy" }] }),
  });
  const r = await at(s.url, "workspace", "pause", "--stop", "--yes", "--to", "desk");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /desk\/run-9 not stopped — queue file is busy/);
});

test("account telemetry: set sends otlp and the secret-named header; test reports what the collector said", async () => {
  const seen: string[] = [];
  const s = await serve({
    "PATCH /api/account": (body: string) => { seen.push(body); return { ok: true, defaults: { telemetry: { endpoint: "https://otel.example.com/v1/traces", headers: {} } } }; },
    "POST /api/account/telemetry/test": () => ({ ok: false, error: "the vault has no OTEL_TOKEN — foldrun secrets set OTEL_TOKEN", endpoint: "https://otel.example.com/v1/traces" }),
  });
  const set = await at(s.url, "account", "telemetry", "set", "https://otel.example.com/v1/traces", "--header", "authorization=${OTEL_TOKEN}");
  const t = await at(s.url, "account", "telemetry", "test");
  const clear = await at(s.url, "account", "telemetry", "clear");
  s.close();
  assert.equal(set.code, 0, set.out);
  assert.deepEqual(JSON.parse(seen[0]!), { telemetry: { otlp: "https://otel.example.com/v1/traces", headers: { authorization: "${OTEL_TOKEN}" } } });
  assert.equal(t.code, 1);
  assert.match(t.out, /not delivered .* foldrun secrets set OTEL_TOKEN/);
  assert.equal(clear.code, 0);
  assert.deepEqual(JSON.parse(seen[1]!), { telemetry: null });
});

const JOBS_VIEW = {
  jobs: [
    { name: "governance", title: "Governance", what: "who answers for it", fields: [{ key: "owner", account: "ops@acme.io", combine: "workspace replaces", writable: true }, { key: "deploy_block", account: null, combine: "workspace replaces", writable: true }, { key: "priority", account: null, combine: "account only", writable: false }] },
    { name: "guardrail", title: "Guardrail", what: "what it may reach", fields: [{ key: "limits", account: { repeat: 5 }, combine: "per key", writable: false }] },
    { name: "observability", title: "Observability", what: "who is told", fields: [{ key: "alerts", account: { failure_rate: "30%" }, combine: "workspace replaces", writable: true }, { key: "notify", account: null, combine: "workspace replaces", writable: true }] },
    { name: "evaluation", title: "Evaluation", what: "how it is judged", fields: [{ key: "judge", account: null, combine: "per field", writable: true }] },
  ],
};

test("foldrun jobs prints the four jobs and what each has set", async () => {
  const s = await serve({ "GET /api/account/jobs": () => JOBS_VIEW });
  const r = await at(s.url, "jobs");
  s.close();
  assert.equal(r.code, 0, r.out);
  for (const h of ["Governance", "Guardrail", "Observability", "Evaluation"]) assert.match(r.out, new RegExp(h));
  assert.match(r.out, /owner\s+ops@acme\.io/);
  assert.match(r.out, /limits\s+\{repeat: 5\}/);
  assert.match(r.out, /judge\s+unset/);
});

test("foldrun jobs --to: the workspace's value, the account's, and how they combine", async () => {
  const view = { jobs: JOBS_VIEW.jobs.map((j) => ({ ...j, fields: j.fields.map((f) => ({ ...f, workspace: f.key === "owner" ? "desk-lead" : null })) })) };
  const s = await serve({ "GET /api/account/jobs": () => view });
  const r = await at(s.url, "jobs", "--to", "desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /owner\s+desk-lead\s+account: ops@acme\.io\s+· workspace replaces/);
  assert.match(r.out, /limits\s+unset\s+account: \{repeat: 5\}\s+· per key/);
});

test("account set <job>.<field>: checked against the map, sent as the field; a wrong job names the right one", async () => {
  const seen: string[] = [];
  const s = await serve({
    "GET /api/account/jobs": () => JOBS_VIEW,
    "PATCH /api/account": (body: string) => { seen.push(body); return { ok: true, defaults: {} }; },
  });
  const ok = await at(s.url, "account", "set", "governance.deploy_block", "secrets");
  const wrong = await at(s.url, "account", "set", "guardrail.owner", "x");
  const merged = await at(s.url, "account", "set", "observability.alerts", "stale_days", "30");
  s.close();
  assert.equal(ok.code, 0, ok.out);
  assert.equal(wrong.code, 1);
  assert.match(wrong.out, /owner is a governance setting, not a guardrail one — `governance\.owner`/);
  assert.equal(merged.code, 0, merged.out);
  assert.deepEqual(seen.map((b) => JSON.parse(b)), [{ deploy_block: "secrets" }, { alerts: { failure_rate: "30%", stale_days: 30 } }]);
});

test("a field the server says this scope cannot write is refused before the PATCH, naming the file", async () => {
  const seen: string[] = [];
  const s = await serve({
    "GET /api/account/jobs": () => JOBS_VIEW,
    "PATCH /api/account": (body: string) => { seen.push(body); return { ok: true, defaults: {} }; },
  });
  const r = await at(s.url, "account", "set", "governance.priority", "high");
  s.close();
  assert.equal(r.code, 1);
  assert.match(r.out, /governance\.priority is not set from here — write `priority:` in the account's AGENTS\.md/);
  assert.equal(seen.length, 0);
});

test("a workspace's own alerts stay its own: the last threshold off leaves {}, new_host off is false", async () => {
  const seen: string[] = [];
  const view = { jobs: JOBS_VIEW.jobs.map((j) => ({ ...j, fields: j.fields.map((f) => (f.key === "alerts" ? { ...f, workspace: { stale_days: 30 } } : { ...f, workspace: null })) })) };
  const s = await serve({
    "GET /api/account/jobs": () => view,
    "PATCH /api/workspaces/desk": (body: string) => { seen.push(body); return { ok: true }; },
  });
  const off = await at(s.url, "workspace", "set", "alerts", "stale_days", "off", "--to", "desk");
  const host = await at(s.url, "workspace", "set", "alerts", "new_host", "off", "--to", "desk");
  s.close();
  assert.equal(off.code, 0, off.out);
  assert.equal(host.code, 0, host.out);
  assert.deepEqual(seen.map((b) => JSON.parse(b)), [{ alerts: {} }, { alerts: { stale_days: 30, new_host: false } }]);
  // Editing another threshold keeps the opt-out.
  const seen2: string[] = [];
  const optedOut = { jobs: JOBS_VIEW.jobs.map((j) => ({ ...j, fields: j.fields.map((f) => (f.key === "alerts" ? { ...f, workspace: { new_host: false } } : { ...f, workspace: null })) })) };
  const s2 = await serve({ "GET /api/account/jobs": () => optedOut, "PATCH /api/workspaces/desk": (body: string) => { seen2.push(body); return { ok: true }; } });
  const more = await at(s2.url, "workspace", "set", "alerts", "stale_days", "14", "--to", "desk");
  s2.close();
  assert.equal(more.code, 0, more.out);
  assert.deepEqual(JSON.parse(seen2[0]!), { alerts: { new_host: false, stale_days: 14 } });
});

test("observability.telemetry: clear sends null; set names the telemetry verb", async () => {
  const seen: string[] = [];
  const view = { jobs: JOBS_VIEW.jobs.map((j) => (j.name === "observability" ? { ...j, fields: [...j.fields, { key: "telemetry", account: { otlp: "https://o.example.com" }, combine: "workspace replaces", writable: true }] } : j)) };
  const s = await serve({
    "GET /api/account/jobs": () => view,
    "PATCH /api/account": (body: string) => { seen.push(body); return { ok: true, defaults: {} }; },
  });
  const clear = await at(s.url, "account", "clear", "observability.telemetry");
  const set = await at(s.url, "account", "set", "observability.telemetry", "https://x");
  s.close();
  assert.equal(clear.code, 0, clear.out);
  assert.deepEqual(seen.map((b) => JSON.parse(b)), [{ telemetry: null }]);
  assert.equal(set.code, 1);
  assert.match(set.out, /foldrun account telemetry set <otlp-url>/);
});
