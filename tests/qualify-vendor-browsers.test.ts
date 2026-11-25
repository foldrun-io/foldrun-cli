// FOL-151: the vendor qualification script, with a CLI that answers from a script — no platform, no vendor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { qualify, judgeAllowed, judgeRefused, scrub, runIdOf, agentFile, VENDORS } from "../scripts/qualify-vendor-browsers.mjs";

// Built at run time: a key-shaped literal in a test file is what the secret scanner is for.
const KEY = ["fake", "vendor", "credential", "0123456789"].join("-");
type Call = { args: string[]; input?: string };

/** A CLI whose `report` answers by which page the run was asked for. */
function fakeCli(answers: { allowed: string; refused: string }, calls: Call[] = []) {
  let n = 0;
  const runs = new Map<string, string>();
  const cli = (args: string[], input?: string) => {
    calls.push({ args, input });
    if (args[0] === "agent" && args[1] === "run") {
      const id = `run-m${++n}-abcd`;
      runs.set(id, args.join(" ").includes("example.org") ? answers.refused : answers.allowed);
      return { status: 0, stdout: `${id} started\n`, stderr: "" };
    }
    if (args[0] === "report") return { status: 0, stdout: JSON.stringify({ id: args[1], steps: [{ output: runs.get(args[1]) }] }), stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  return { cli, calls };
}

const DOOR = "enforced — through foldrun's vendor door: Steel's browser runs on the vendor's machines";
const PASS = { allowed: `${DOOR}. Heading: Example Domain`, refused: "refused: example.org is not on the list (network: [example.com]) — held by the vendor door" };

test("both pages behave: the vendor passes its automated checks, with run ids, the manual items listed, and nothing else claimed", async () => {
  const f = fakeCli(PASS);
  const r = await qualify({ vendors: ["steel"], env: { STEEL_API_KEY: KEY }, cli: f.cli });
  const v = r.vendors[0];
  assert.equal(v.verdict, "automated-pass");
  assert.deepEqual(v.checks.filter((c: any) => c.id !== "manual").map((c: any) => [c.id, c.status]), [["on-list", "pass"], ["off-list", "pass"]]);
  assert.ok(v.checks.filter((c: any) => c.id === "manual").length >= 4, "the DNS/STUN/UDP/HTTP3, frames/workers/popups/downloads, outage/expiry and proxy-log items stay manual");
  assert.match(v.checks[0].run, /^run-/);
});

test("the key goes in on stdin once and never into an argument, an output or an evidence line; the secret is removed at the end", async () => {
  const f = fakeCli({ ...PASS, allowed: `${PASS.allowed} ${KEY}` });
  const said: string[] = [];
  const r = await qualify({ vendors: ["steel"], env: { STEEL_API_KEY: KEY }, cli: f.cli, say: (t: string) => said.push(t) });
  const set = f.calls.filter((c) => c.args[0] === "secrets" && c.args[1] === "set");
  assert.equal(set.length, 1);
  assert.equal(set[0].input, `${KEY}\n`);
  assert.ok(!f.calls.some((c) => c.args.join(" ").includes(KEY)), "no argument holds the key");
  assert.ok(!JSON.stringify(r).includes(KEY) && !said.join("\n").includes(KEY), "nothing printed or saved holds the key");
  assert.deepEqual(f.calls.at(-1)?.args.slice(0, 3), ["secrets", "rm", "STEEL_API_KEY"], "removed last");
  const kept = fakeCli(PASS);
  await qualify({ vendors: ["steel"], env: { STEEL_API_KEY: KEY }, cli: kept.cli, keepSecrets: true });
  assert.ok(!kept.calls.some((c) => c.args[1] === "rm"), "--keep-secrets leaves it");
});

test("an off-list page that LOADS fails the vendor, and says so", async () => {
  const r = await qualify({ vendors: ["steel"], env: { STEEL_API_KEY: KEY }, cli: fakeCli({ allowed: PASS.allowed, refused: "Example Domain" }).cli });
  const off = r.vendors[0].checks.find((c: any) => c.id === "off-list");
  assert.equal(off.status, "fail");
  assert.match(off.note, /LOADED/);
  assert.equal(r.vendors[0].verdict, "fail");
});

test("a timeout is not a refusal", () => {
  const j = judgeRefused("navigating to https://example.org failed: ETIMEDOUT");
  assert.equal(j.status, "fail");
  assert.match(String(j.note), /timeout/i);
  assert.equal(judgeRefused("example.org: refused — not on the list").status, "pass");
  assert.equal(judgeRefused("something else entirely").status, "fail");
});

test("an install that does not list the vendor is 'blocked' with the platform's own words, stops before the off-list page, and the key is still removed", async () => {
  const f = fakeCli({ allowed: "browse: refused before it connected — this step's network: trusted is enforced, and Browserbase browses from its own network, and foldrun cannot hold it to network: until that vendor is qualified (FOL-110 phase 4)", refused: "" });
  const r = await qualify({ vendors: ["browserbase"], env: { BROWSERBASE_API_KEY: KEY }, cli: f.cli });
  assert.equal(r.vendors[0].verdict, "blocked");
  assert.match(r.vendors[0].why, /does not list this vendor|FOLDRUN_VENDOR_EGRESS_VENDORS/);
  assert.equal(f.calls.filter((c) => c.args[1] === "run").length, 1, "one run, not two");
  assert.ok(f.calls.some((c) => c.args[1] === "rm"), "the key is removed even so");
});

test("what dev really answered on 25 Nov to a fake key — the vendor's 401, then a fall back to a local browser, no door line — is 'blocked' on the key, never a pass; a fallback that LOADED the page fails", () => {
  const real = "The page didn't load through Steel. Steel refused the request with a 401 error: `invalid_api_key`, \"Invalid Steel API key.\" The browse call ran in a local chromium fallback instead.";
  const j = judgeAllowed(real);
  assert.equal(j.status, "blocked");
  assert.match(String(j.note), /key|plan/);
  const loadedLocally = judgeAllowed("Steel refused the request (401), so the browse ran in a local chromium fallback instead. Heading: Example Domain");
  assert.equal(loadedLocally.status, "fail", "a page a local browser loaded is not the vendor's");
  assert.match(String(loadedLocally.note), /fell back/);
});

test("a page that loads without the vendor-door line is not a pass: nothing says the door was used", () => {
  const j = judgeAllowed("Heading: Example Domain");
  assert.equal(j.status, "blocked");
  assert.match(String(j.note), /vendor door/);
  assert.equal(judgeAllowed(`${DOOR}. It fell back to a local browser and showed Example Domain.`).status, "fail");
  assert.equal(judgeRefused("it fell back to a local browser; example.org loaded: Example Domain").status, "fail");
});

test("a vendor with no key is skipped and named; an unknown vendor is refused", async () => {
  const f = fakeCli(PASS);
  const r = await qualify({ vendors: [], env: { STEEL_API_KEY: KEY }, cli: f.cli });
  assert.deepEqual(r.vendors.map((v: any) => v.vendor), ["steel"]);
  assert.equal(r.skipped.length, 3);
  assert.match(r.skipped.join(" "), /BROWSERBASE_API_KEY[\s\S]*HYPERBROWSER_API_KEY[\s\S]*BROWSERLESS_TOKEN|HYPERBROWSER_API_KEY|BROWSERLESS_TOKEN/);
  await assert.rejects(qualify({ vendors: ["brightdata"], env: {}, cli: f.cli }), /not one of/);
});

test("--door-host: a vendor's session list that names the door passes; one that does not is a warning, and Browserless says to read its dashboard", async () => {
  const run = (list: string, vendor = "steel", env: Record<string, string> = { STEEL_API_KEY: KEY }) =>
    qualify({ vendors: [vendor], env, cli: fakeCli(PASS).cli, doorHost: "vendor-egress.example.com", get: async () => ({ status: 200, text: list }) });
  assert.equal((await run('{"sessions":[{"proxy":"https://vendor-egress.example.com:443"}]}')).vendors[0].checks.find((c: any) => c.id === "vendor-log").status, "pass");
  assert.equal((await run('{"sessions":[]}')).vendors[0].checks.find((c: any) => c.id === "vendor-log").status, "warn");
  assert.equal((await run("", "browserless", { BROWSERLESS_TOKEN: KEY })).vendors[0].checks.find((c: any) => c.id === "vendor-log").status, "manual");
});

test("--escapes adds the two attempts for review; they never fail a vendor", async () => {
  const r = await qualify({ vendors: ["steel"], env: { STEEL_API_KEY: KEY }, cli: fakeCli(PASS).cli, escapes: true });
  const review = r.vendors[0].checks.filter((c: any) => c.status === "review");
  assert.deepEqual(review.map((c: any) => c.id), ["proxy-override", "second-session"]);
  assert.equal(r.vendors[0].verdict, "automated-pass");
});

test("helpers: the agent is held to one site and names the vendor; scrub, runIdOf, judgeAllowed", () => {
  const a = agentFile("steel");
  assert.match(a, /network: \[example\.com\]/);
  assert.match(a, /browse: steel/);
  assert.equal(scrub(`a ${KEY} b`, [KEY]), "a «key» b");
  assert.equal(runIdOf("started run-mx12-ab34 now"), "run-mx12-ab34");
  assert.equal(judgeAllowed(`${DOOR} Example Domain`).status, "pass");
  assert.equal(judgeAllowed(`${DOOR}, but it did not load`).status, "fail");
  assert.deepEqual(Object.keys(VENDORS), ["browserbase", "steel", "hyperbrowser", "browserless"]);
});
