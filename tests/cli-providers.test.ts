// `foldrun account providers` — the account's own model keys, and whether
// each still answers.
//
//   node --test tests/cli-providers.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const configured = [
  { provider: "openrouter", declaredIn: "rank-desk/agents/writer", model: "anthropic/claude-sonnet-4", format: "openai" },
  { provider: "groq", declaredIn: "blog-desk", model: "llama-3.3-70b", format: "openai" },
];
const checked = { checkedAt: "2026-09-24T01:00:00.000Z", results: [
  { provider: "openrouter", declaredIn: "rank-desk/agents/writer", model: "anthropic/claude-sonnet-4", ok: true, verdict: "ok", detail: "" },
  { provider: "groq", declaredIn: "blog-desk", model: "llama-3.3-70b", ok: false, verdict: "unauthorized", detail: "401 — the key was refused" },
] };

test("lists what would be checked, marks the last check's verdicts, and a dead key is a non-zero exit", async () => {
  const s = await serve({ "/api/account/providers": () => ({ configured, lastCheck: checked }) });
  const r = await at(s.url, "account", "providers");
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /✓ openrouter/);
  assert.match(r.out, /✗ groq.*unauthorized.*401/);
  assert.match(r.out, /1 not answering/);
});

test("never checked is said plainly, and --check asks the platform now", async () => {
  const s = await serve({
    "GET /api/account/providers": () => ({ configured, lastCheck: null }),
    "POST /api/account/providers": () => ({ ok: true, lastCheck: { ...checked, results: checked.results.map((x) => ({ ...x, ok: true, verdict: "ok" })) } }),
  });
  const quiet = await at(s.url, "account", "providers");
  assert.equal(quiet.code, 0, quiet.out);
  assert.match(quiet.out, /never checked yet/);
  const now = await at(s.url, "account", "providers", "--check");
  s.close();
  assert.equal(now.code, 0, now.out);
  assert.match(now.out, /all answering/);
  assert.ok(s.seen.some((x) => x.method === "POST"), "--check POSTs");
});

test("an account on the platform's own credential has nothing to check", async () => {
  const s = await serve({ "/api/account/providers": () => ({ configured: [], lastCheck: null }) });
  const r = await at(s.url, "account", "providers");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /platform's credential/);
});
