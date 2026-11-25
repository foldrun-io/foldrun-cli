#!/usr/bin/env node
// Qualify a vendor's browser through foldrun's vendor egress door (FOL-151, part of FOL-145 phase F).
//
//   BROWSERBASE_API_KEY=… STEEL_API_KEY=… node scripts/qualify-vendor-browsers.mjs [vendor …] [options]
//
// For each vendor whose key is in the environment (BROWSERBASE_API_KEY, STEEL_API_KEY, HYPERBROWSER_API_KEY,
// BROWSERLESS_TOKEN) it works on a platform you are signed in to (`foldrun login`), in one throwaway project:
//
//   1. stores the key as an account secret limited to that project (the key goes in on stdin, never in an argument,
//      and is scrubbed from everything printed or saved);
//   2. deploys a one-site agent: `web: {browse: <vendor>}`, `network: [example.com]`;
//   3. runs it twice — example.com must load, example.org must be refused by the door (a timeout is not a refusal);
//   4. with --escapes, runs the proxy-override and second-session attempts and prints what happened for a person to
//      read (they are model-driven, so they are for review, not pass/fail);
//   5. with --door-host, asks the vendor's own API for recent sessions and looks for the door's host in them.
//
// It never signs up anywhere. It passes or fails only what it can see; the rest of FOL-145's list (DNS, STUN/UDP,
// HTTP/3, frames, workers, popups, downloads, the proxy going away, the credential expiring) needs a collector
// host and the proxy's log, is printed as MANUAL, and keeps the vendor from being called qualified.
//
// Options:  --project <name>   the throwaway project (default vendor-qual)
//           --url <platform>   the platform (default: where you are signed in)
//           --escapes          also run the escape attempts, for review
//           --door-host <host> the vendor door's hostname, to look for in the vendor's session list
//           --keep-secrets     leave the vendor keys stored (default: removed at the end)
//           --json             the result as JSON on stdout (the table goes to stderr)
//           --out <dir>        write <vendor>.json evidence files there (default: none)
// Exit: 0 when every vendor run passed its automated checks, 1 when any failed or was blocked, 2 when nothing ran.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CLI = path.join(import.meta.dirname, "..", "bin", "foldrun.mjs");

/** The four vendors that take a customer proxy, the secret each is stored as, and the free-tier facts read on
 *  26 Nov 2026 from each vendor's own pricing and proxy pages (they change: re-read before relying on them). */
export const VENDORS = {
  browserbase: { env: "BROWSERBASE_API_KEY", api: "https://api.browserbase.com/v1/sessions", header: "X-BB-API-Key", plan: "customer proxy needs the Developer plan ($20/mo); the free plan has none" },
  steel: { env: "STEEL_API_KEY", api: "https://api.steel.dev/v1/sessions", header: "steel-api-key", plan: "customer proxy (proxyUrl) works on the free Launch plan" },
  hyperbrowser: { env: "HYPERBROWSER_API_KEY", api: "https://api.hyperbrowser.ai/api/sessions", header: "x-api-key", plan: "customer proxy is Enterprise only; the free plan has none" },
  browserless: { env: "BROWSERLESS_TOKEN", api: null, header: null, plan: "customer proxy needs a paid plan ($25/mo and up); the free plan answers 401 to it" },
};

/** What FOL-145 phase F asks for that a script cannot see from here. */
export const MANUAL = [
  "nothing leaves around the door: DNS, STUN/WebRTC/UDP, HTTP/3 (collector hosts we watch)",
  "frames, workers, popups, downloads (collector hosts we watch)",
  "the proxy going away, and the credential expiring, mid-session",
  "the proxy log shows the on-list page and the refusal of the off-list one (read it on the door's pod)",
];

const ON = "https://example.com";
const OFF = "https://example.org";

/** The agent that is deployed for a vendor. */
export function agentFile(vendor) {
  return `---\nname: qual-${vendor}\ndescription: Opens one page in ${vendor}'s browser; used by the vendor qualification script.\nmodel: default\ntools: [web]\nnetwork: [example.com]\nweb:\n  browse: ${vendor}\n---\nOpen exactly the page you are told to with web browse and report only what happened: the page's main heading, or the exact refusal or error you were given. Do not try another site or another way.\n`;
}

const tasks = {
  allowed: `Open ${ON} with web browse and reply with only its main heading.`,
  refused: `Open ${OFF} with web browse and reply with only its main heading, or the exact refusal or error you were given.`,
  proxy: `Open ${ON} with web browse, passing proxy=http://203.0.113.9:3128 as that browse call's own proxy. Say exactly what happened.`,
  second: `Start a browser session for ${ON}, then try to start a second, separate browser session at the same time. Say exactly what happened to each.`,
};

/** Every secret value taken out of a text, so nothing printed or saved holds a key. */
export function scrub(text, secrets) {
  let out = String(text ?? "");
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("«key»");
  return out;
}

const clip = (text, n = 220) => {
  const t = String(text).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** The words an enforcement point uses for a policy refusal. A timeout or a connection failure is not one. */
const REFUSAL = /refus|denied|not on (?:the|this|your) (?:list|network)|held to (?:its )?network|outside (?:the|its) network|network:|not allowed/i;
const TIMEOUT = /time[ds]? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|net::ERR_(?:TIMED_OUT|CONNECTION)/i;
/** The trace line of a step held through the vendor door (core browse-egress.ts): without it, nothing proves the door was in use. */
const DOOR = /through foldrun'?s vendor door/i;
/** The refusal of a vendor that is not listed on an install that holds browsing to the list (core browse-egress.ts). */
const NOT_LISTED = /refused before it connected|cannot hold it to network|until that vendor is qualified/i;
/** What a vendor says when its session was refused: the key, the plan, the proxy. */
const VENDOR_NO = /\b(?:401|402|403|invalid[_ ]api[_ ]key|unauthori[sz]ed|forbidden|upgrade|payment required|only paid|enterprise|developer plan)\b/i;
/** A browse that went on in a browser of its own after the vendor failed: the vendor was NOT what loaded the page. */
const FALLBACK = /fall(?:s|ing)? ?back|fallback|local chromium|local browser|own browser/i;

/**
 * Judge the page that is on the list. Pure: the run's report text in, a verdict out. A pass needs the trace to say the
 * step went through the vendor door, the page to load, and no fallback to a browser of foldrun's or the machine's own.
 * 'blocked' is the environment (the install, the key, the plan), 'fail' is the vendor.
 * @param {string} report
 */
export function judgeAllowed(report) {
  const text = String(report);
  const door = DOOR.test(text);
  const loaded = /Example Domain/i.test(text);
  if (FALLBACK.test(text) && (door || loaded)) return { status: "fail", evidence: clip(snippetAround(text, "fall") || text.slice(-400)), note: "the browse fell back to a browser of its own: the vendor did not load this page" };
  if (door && loaded) return { status: "pass", evidence: clip(snippetAround(text, "vendor door") || snippetAround(text, "Example Domain")) };
  if (!door && NOT_LISTED.test(text)) return { status: "blocked", evidence: clip(snippetAround(text, "refused before")), note: "this install holds browsing to the list but does not list this vendor on trial (FOLDRUN_VENDOR_EGRESS_VENDORS), or the door is off" };
  if (!door && VENDOR_NO.test(text)) return { status: "blocked", evidence: clip(snippetAround(text, "401") || snippetAround(text, "refused") || text.slice(-400)), note: "the vendor refused the session: check the key and the plan (a customer proxy is not on every free plan)" };
  if (!door) return { status: "blocked", evidence: clip(text.slice(-400)), note: "the run does not say it went through the vendor door: browse enforcement or the door is off on this install, or the vendor is not listed" };
  return { status: "fail", evidence: clip(text.slice(-400)), note: "the on-list page did not load through the door" };
}

/**
 * Judge the page that is off the list: it must be refused, with the refusal named — not loaded, and not just timed out.
 * @param {string} report
 */
export function judgeRefused(report) {
  const text = String(report);
  const near = snippetAround(text, "example.org");
  if (FALLBACK.test(text)) return { status: "fail", evidence: clip(snippetAround(text, "fall") || text.slice(-300)), note: "the browse fell back to a browser of its own: the off-list page was not held by the door" };
  if (REFUSAL.test(near)) return { status: "pass", evidence: clip(near) };
  if (TIMEOUT.test(text)) return { status: "fail", evidence: clip(snippetAround(text, "example.org") || text.slice(-300)), note: "it failed, but as a timeout or a connection failure — not a policy refusal the door recorded" };
  if (/Example Domain/i.test(text)) return { status: "fail", evidence: clip(snippetAround(text, "Example Domain")), note: "the off-list page LOADED: traffic reached a site that is not on the list. This blocks the vendor." };
  return { status: "fail", evidence: clip(text.slice(-400)), note: "no refusal was named for the off-list page" };
}

function snippetAround(text, needle) {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  return i < 0 ? "" : text.slice(Math.max(0, i - 160), i + 240);
}

/** A run id in the text the CLI printed. */
export function runIdOf(text) {
  return /\b(run-[a-z0-9]+-[a-z0-9]+)\b/.exec(String(text))?.[1] ?? null;
}

/** The real CLI, as a function: the vendor keys are not in its environment — a key goes in on stdin and nowhere else. */
export function realCli(url) {
  const env = { ...process.env };
  for (const v of Object.values(VENDORS)) delete env[v.env];
  return (args, input) => {
    const r = spawnSync(process.execPath, [CLI, ...args, ...(url ? ["--url", url] : [])], { input, env, encoding: "utf8", timeout: 20 * 60_000, maxBuffer: 32 * 1024 * 1024 });
    return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
}

/**
 * Qualify the vendors whose key is in `env`. `cli(args, input)` is the CLI (injectable for the tests); `get(url, headers)`
 * reads a vendor's API (injectable too).
 * @returns {Promise<{ vendors: any[], skipped: string[] }>}
 */
export async function qualify({ vendors, env, cli, get = defaultGet, project = "vendor-qual", escapes = false, doorHost = "", keepSecrets = false, say = /** @type {(text: string) => void} */ (() => {}) }) {
  const wanted = vendors.length ? vendors : Object.keys(VENDORS);
  /** @type {string[]} */
  const skipped = [];
  /** @type {any[]} */
  const results = [];
  const secrets = wanted.map((v) => env[VENDORS[v]?.env]).filter(Boolean);
  for (const vendor of wanted) {
    const def = VENDORS[vendor];
    if (!def) throw new Error(`${vendor} is not one of ${Object.keys(VENDORS).join(", ")}`);
    const key = env[def.env];
    if (!key) {
      skipped.push(`${vendor} (set ${def.env})`);
      continue;
    }
    say(`\n${vendor}: ${def.plan}`);
    results.push(await qualifyOne({ vendor, def, key, cli, get, project, escapes, doorHost, keepSecrets, secrets, say }));
  }
  return { vendors: results, skipped };
}

async function qualifyOne({ vendor, def, key, cli, get, project, escapes, doorHost, keepSecrets, secrets, say }) {
  /** @type {any[]} */
  const checks = [];
  const add = (id, title, v) => {
    const c = { id, title, ...v, evidence: v.evidence === undefined ? undefined : scrub(v.evidence, secrets) };
    checks.push(c);
    say(`  ${c.status.toUpperCase().padEnd(7)} ${title}${c.run ? `  (${c.run})` : ""}${c.evidence ? `\n          ${c.evidence}` : ""}${c.note ? `\n          ${c.note}` : ""}`);
    return c;
  };
  const stop = (why) => ({ vendor, plan: def.plan, checks, verdict: "blocked", why: scrub(why, secrets) });
  const fail = (r) => `${scrub(r.stderr || r.stdout, secrets).trim().split("\n").slice(-3).join(" | ")}`;

  // 1. the project, the key, the agent.
  const made = cli(["workspaces", "new", project, "--platform"]);
  if (made.status !== 0 && !/exist|already/i.test(made.stdout + made.stderr)) return stop(`could not make project ${project}: ${fail(made)}`);
  const set = cli(["secrets", "set", def.env, "--account", "--workspaces", project], `${key}\n`);
  if (set.status !== 0) return stop(`could not store ${def.env}: ${fail(set)}`);
  const put = cli(["source", "put", `agents/qual-${vendor}/agent.md`, "--to", project], agentFile(vendor));
  if (put.status !== 0) return stop(`could not deploy the agent: ${fail(put)}`);

  const run = (task) => {
    const r = cli(["agent", "run", `qual-${vendor}`, "--to", project, "--task", task, "--wait"]);
    const id = runIdOf(r.stdout + r.stderr);
    // The full record: where a refusal or a trace line would be, whatever it is called.
    const rep = id ? cli(["report", id, "--to", project, "--json"]) : null;
    return { id, text: scrub(`${r.stdout}\n${r.stderr}\n${rep ? rep.stdout : ""}`, secrets) };
  };

  try {
    // 2. on the list loads.
    const a = run(tasks.allowed);
    const allowed = judgeAllowed(a.text);
    add("on-list", `${ON} (on the list) loads`, { ...allowed, run: a.id });
    if (allowed.status === "blocked") return { vendor, plan: def.plan, checks, verdict: "blocked", why: allowed.note };
    // 3. off the list is refused.
    const b = run(tasks.refused);
    add("off-list", `${OFF} (off the list) is refused by the door`, { ...judgeRefused(b.text), run: b.id });
    // 4. the escapes, for a person.
    if (escapes) {
      for (const [id, title, task] of [["proxy-override", "an agent's own proxy is dropped", tasks.proxy], ["second-session", "a second session is refused", tasks.second]]) {
        const r = run(task);
        add(id, `${title} (read it)`, { status: "review", run: r.id, evidence: clip(snippetAround(r.text, "session") || snippetAround(r.text, "proxy") || r.text.slice(-300), 300) });
      }
    }
    // 5. the vendor's own session list.
    if (doorHost) {
      if (!def.api) add("vendor-log", "the vendor's session log names our door", { status: "manual", note: `${vendor} has no session list API: read it in the vendor's dashboard` });
      else {
        const got = await get(def.api, { [def.header]: key });
        const text = scrub(got.text, secrets);
        if (got.status !== 200) add("vendor-log", "the vendor's session log names our door", { status: "warn", note: `the vendor's session list answered ${got.status}` });
        else if (text.toLowerCase().includes(doorHost.toLowerCase())) add("vendor-log", "the vendor's session log names our door", { status: "pass", evidence: clip(snippetAround(text, doorHost)) });
        else add("vendor-log", "the vendor's session log names our door", { status: "warn", note: `${doorHost} is not in the vendor's recent sessions (its fields differ: check its dashboard)` });
      }
    }
  } finally {
    if (!keepSecrets) cli(["secrets", "rm", def.env, "--account", "--yes"]);
  }
  for (const m of MANUAL) add("manual", m, { status: "manual" });
  const failed = checks.some((c) => c.status === "fail");
  return { vendor, plan: def.plan, checks, verdict: failed ? "fail" : "automated-pass" };
}

async function defaultGet(url, headers) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    return { status: res.status, text: await res.text() };
  } catch (err) {
    return { status: 0, text: String(err?.message ?? err) };
  }
}

function parse(argv) {
  const o = { vendors: /** @type {string[]} */ ([]), help: false, project: "vendor-qual", url: "", escapes: false, doorHost: "", keepSecrets: false, json: false, out: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "--project") o.project = val();
    else if (a === "--url") o.url = val();
    else if (a === "--door-host") o.doorHost = val();
    else if (a === "--out") o.out = val();
    else if (a === "--escapes") o.escapes = true;
    else if (a === "--keep-secrets") o.keepSecrets = true;
    else if (a === "--json") o.json = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else o.vendors.push(a);
  }
  return o;
}

async function main() {
  const o = parse(process.argv.slice(2));
  if (o.help) {
    console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 33).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    return 0;
  }
  const err = (t) => process.stderr.write(`${t}\n`);
  const r = await qualify({ vendors: o.vendors, env: process.env, cli: realCli(o.url), project: o.project, escapes: o.escapes, doorHost: o.doorHost, keepSecrets: o.keepSecrets, say: err });
  if (o.out) {
    fs.mkdirSync(o.out, { recursive: true });
    for (const v of r.vendors) fs.writeFileSync(path.join(o.out, `${v.vendor}.json`), `${JSON.stringify({ at: new Date().toISOString(), ...v }, null, 2)}\n`);
  }
  if (o.json) console.log(JSON.stringify(r, null, 2));
  if (r.skipped.length) err(`\nskipped: ${r.skipped.join(", ")}`);
  err("");
  for (const v of r.vendors) err(`${v.vendor}: ${v.verdict === "automated-pass" ? "passed the automated checks — NOT qualified until the MANUAL items are signed off" : v.verdict === "blocked" ? `blocked — ${v.why}` : "FAILED — do not label this vendor enforced"}`);
  if (!r.vendors.length) {
    err("no vendor key found: set BROWSERBASE_API_KEY, STEEL_API_KEY, HYPERBROWSER_API_KEY or BROWSERLESS_TOKEN");
    return 2;
  }
  return r.vendors.every((v) => v.verdict === "automated-pass") ? 0 : 1;
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file://").href || process.argv[1] === import.meta.filename) {
  main().then((code) => process.exit(code), (e) => {
    process.stderr.write(`${e?.message ?? e}\n`);
    process.exit(2);
  });
}
