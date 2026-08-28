// Guards against the one bug this codebase keeps producing.
//
// Four times in one day: a list of names existed in two places, one was
// updated, the other wasn't, and nothing errored — the UI just quietly lied.
//
//   WORKSPACE_DIRS      the file tree stopped showing knowledge/, evals/, state/
//   LIBRARY_KINDS       scripts sorted second in one list and last in every other
//   ACCOUNT_SEGMENTS    said "shared" after the route became "library", so
//                       /dashboard/library rendered a workspace that didn't exist
//
// A typecheck can't catch any of them: every version compiles. These tests read
// the actual source and assert the lists agree, so the next rename fails loudly
// in CI instead of silently in the interface.
//
//   node --test tests/consistency.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { ALL_KINDS, kindsAt, docKeyOf, docTypeOf, type Kind } from "../packages/core/src/kinds.ts";

import { WORKSPACE_DIRS, templateFiles, anchoredReason, accountFileSealed } from "../packages/core/src/store.ts";
import { starterFiles } from "../packages/core/src/starter.ts";
import { readAgentsMd } from "../packages/core/src/runner.ts";
import { LIBRARY_KINDS } from "../packages/core/src/library.ts";

const root = path.join(import.meta.dirname, "..");

/** Every file under `dir` matching `keep`. */
function walk(dir: string, keep: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      out.push(...walk(full, keep));
    } else if (keep(full)) out.push(full);
  }
  return out;
}

const read = (rel: string) => fs.readFileSync(path.join(import.meta.dirname, "..", rel), "utf8");

/** Pull a quoted string list out of source, e.g. `["a", "b"]`. */
function listIn(source: string, marker: string): string[] {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `could not find ${marker} — this test needs updating`);
  const open = source.indexOf("[", at);
  const close = source.indexOf("]", open);
  return [...source.slice(open, close).matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
}

test("every account-level directory is a known account segment", () => {
  const dir = path.join(import.meta.dirname, "..", "web/app/dashboard");
  const routes = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("["))
    .map((e) => e.name);

  const declared = new Set(listIn(read("web/components/sidebar.tsx"), "ACCOUNT_SEGMENTS"));

  for (const route of routes) {
    assert.ok(
      declared.has(route),
      `/dashboard/${route} exists but isn't in ACCOUNT_SEGMENTS — the sidebar will treat it ` +
        `as a workspace named "${route}" and render a nav that goes nowhere`,
    );
  }
});

test("the account library holds only nouns a workspace also has", () => {
  for (const kind of LIBRARY_KINDS) {
    assert.ok(
      (WORKSPACE_DIRS as readonly string[]).includes(kind),
      `library has "${kind}/" but a workspace doesn't — a shared thing with nowhere to be overridden`,
    );
  }
});

test("the library cannot hold anything that executes", () => {
  for (const executable of ["agents", "flows", "evals", "state"]) {
    assert.ok(
      !(LIBRARY_KINDS as readonly string[]).includes(executable),
      `"${executable}" is in LIBRARY_KINDS — nothing executes at account level, so it has no ` +
        `secrets scope, no confinement root and nowhere to write runs`,
    );
  }
});

test("noun order is the same in the library, the asset pages and the sidebar", () => {
  // The assets page derives its list from KINDS rather than restating it, so
  // the order under test is the table's own.
  const page = read("web/app/dashboard/[workspace]/assets/page.tsx");
  assert.match(page, /const KINDS = kindsAt\("workspace"\)/,
    "the assets page has gone back to hand-listing its nouns");
  const assetKinds = kindsAt("workspace").filter(
    (k) => k !== "agents" && k !== "flows" && k !== "evals",
  );

  // Order, not just membership. Sorting both sides before comparing is what
  // let the real drift through: scripts sat second in LIBRARY_KINDS and last
  // everywhere else, and a set comparison called that identical.
  assert.deepEqual(
    [...LIBRARY_KINDS],
    assetKinds,
    "the account library lists the nouns in a different order than the asset pages",
  );

  // The sidebar links each noun by ?kind=, so its order is readable from
  // source. It navigates every kind except scripts: a script tool carries
  // its own code inside its folder, so code is material a tool holds rather
  // than a shelf anyone picks from. The directory still exists and still
  // works — it just isn't a decision, so it isn't a door.
  const navigated = assetKinds.filter((k) => k !== "scripts");
  const sidebar = read("web/components/sidebar.tsx");
  const navOrder = [...sidebar.matchAll(/kind=([a-z]+)\$\{accountQuery\}/g)].map((m) => m[1]);
  assert.ok(
    !navOrder.includes("scripts"),
    "scripts is not a shelf any more — a tool folder holds its own code",
  );
  assert.deepEqual(
    navOrder.slice(0, navigated.length),
    navigated,
    "the sidebar lists the nouns in a different order than the asset pages",
  );
});

test("the file tree lists every workspace directory", () => {
  // The tree filters by WORKSPACE_DIRS rather than its own copy — this asserts
  // it still does, since the copy is exactly what went stale before.
  const store = read("packages/core/src/store.ts");
  assert.match(
    store,
    /new RegExp\(`\^\(\$\{WORKSPACE_DIRS\.join\("\|"\)\}\)\//,
    "listWorkspaceFiles has stopped deriving its allowlist from WORKSPACE_DIRS",
  );
});

test("reserved OKF filenames are never treated as concepts", () => {
  const okf = read("packages/core/src/okf.ts");
  for (const reserved of ["index.md", "log.md"]) {
    assert.match(
      okf,
      new RegExp(`RESERVED[\\s\\S]{0,120}${reserved.replace(".", "\\.")}`),
      `${reserved} must be reserved — the spec forbids using it for a concept document`,
    );
  }
});

test("KINDS is the only place a kind is declared", () => {
  // Every noun the product has must come from packages/core/src/kinds.ts. A
  // hand-kept second list is how a kind gets a menu entry with no page, or a
  // creation button that writes a file nothing reads. This test fails the
  // moment someone types the list out again.
  const offenders: string[] = [];
  const files = walk(path.join(root, "web"), (f) => /\.tsx?$/.test(f) && !f.includes("node_modules"));

  for (const file of files) {
    if (file.endsWith("kinds.ts")) continue;
    const src = fs.readFileSync(file, "utf8");
    // A literal array naming three or more kinds is a copy of the table.
    for (const m of src.matchAll(/\[((?:\s*"[a-z]+"\s*,){2,}\s*"[a-z]+"\s*)\]/g)) {
      const items = m[1].split(",").map((s) => s.trim().replace(/"/g, ""));
      const known = items.filter((i) => (ALL_KINDS as readonly string[]).includes(i));
      if (known.length >= 3 && known.length === items.length) {
        offenders.push(`${path.relative(root, file)}: [${items.join(", ")}]`);
      }
    }
  }

  assert.deepEqual(offenders, [], `derive these from KINDS instead:\n${offenders.join("\n")}`);
});

test("a structural document never declares what it is", () => {
  // Its path already says it, and every reader resolves by path. A field
  // restating that is derived data next to its source, free to disagree with
  // it — and `type:` in particular is OKF's, where one of our nouns would be
  // read as a knowledge concept by anything else consuming this repo.
  const bad: string[] = [];
  const data = path.join(root, "data/default");
  const nouns = new Set(["Agent", "Flow", "Eval", "Skill", "Tool"]);

  for (const file of walk(data, (f) => f.endsWith(".md"))) {
    const base = path.basename(file);
    if (base === "index.md" || base === "log.md") continue; // OKF-reserved

    const rel = path.relative(data, file);
    const structural =
      base === "agent.md" ||
      base === "SKILL.md" ||
      /(^|\/)(flows|evals|tools)\//.test(rel);
    if (!structural) continue;

    const front = fs.readFileSync(file, "utf8").split("---")[1] ?? "";
    const declaredKind = /^kind:\s*(.+)$/m.exec(front)?.[1].trim();
    const declaredType = /^type:\s*(.+)$/m.exec(front)?.[1].trim();
    if (declaredKind) bad.push(`${rel}: kind: ${declaredKind} — the path says this`);
    if (declaredType && nouns.has(declaredType)) {
      bad.push(`${rel}: type: ${declaredType} — that is OKF's field`);
    }
  }

  assert.deepEqual(bad, []);
});

test("KINDS only claims a noun where OKF asks for one", () => {
  for (const kind of ALL_KINDS) {
    const key = docKeyOf(kind);
    const noun = docTypeOf(kind);
    assert.ok(key === null || key === "type", `${kind} declares in "${key}" — only OKF's type remains`);
    assert.equal(
      noun === null,
      key === null,
      `${kind} must have a noun exactly when it has a field to put it in`,
    );
    if (key === "type") {
      assert.ok(kind === "memory" || kind === "knowledge", `${kind} is not an OKF bundle`);
    }
  }
});

test("there is exactly one way to create something", () => {
  // Creation drifted into four components — and the workspace one built the
  // file's *content* in the browser, so a skill made by the dashboard and a
  // skill made by `foldrun init` were different files. Everything that makes
  // a thing must go through CreateForm.
  const offenders: string[] = [];

  for (const file of walk(path.join(root, "web"), (f) => /\.tsx$/.test(f))) {
    if (file.endsWith("create.tsx")) continue;
    const src = fs.readFileSync(file, "utf8");
    // A POST whose body *leads* with a name is a creation form. Leading is
    // the signature: connect-style calls (OAuth start) also carry a name,
    // as a parameter among others — those order their body accordingly.
    if (/method:\s*"POST"/.test(src) && /JSON\.stringify\(\{\s*name/.test(src)) {
      offenders.push(path.relative(root, file));
    }
  }

  assert.deepEqual(offenders, [], `these create things outside CreateForm:\n${offenders.join("\n")}`);
});

test("no server component passes a function as a prop", () => {
  // Twice now: a prop typed `(x) => Y` compiles, renders on the server, and
  // throws "Functions cannot be passed directly to Client Components" at the
  // user. The typechecker cannot see it, so this reads the source instead.
  //
  // Catches literal arrows and function expressions only — `prop={someFn}` is
  // indistinguishable from `prop={someValue}` without type information, so a
  // named function passed this way still gets through.
  const offenders: string[] = [];

  for (const file of walk(path.join(root, "web"), (f) => /\.tsx$/.test(f))) {
    const src = fs.readFileSync(file, "utf8");
    if (/^\s*["']use client["']/m.test(src.slice(0, 200))) continue; // client: fine

    for (const re of [/=\{\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g, /=\{\s*function\b/g]) {
      for (const m of src.matchAll(re)) {
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${path.relative(root, file)}:${line}  ${m[0].trim()}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `server components can't hand functions to client components:\n${offenders.join("\n")}`,
  );
});

test("the starter workspace is defined once", () => {
  // `foldrun init` and the dashboard's "+ New workspace" each had their own
  // copy. They drifted to different flow names and different file sets, and
  // when structural documents moved to `kind:` only one copy was migrated —
  // so every workspace made from the dashboard was born in the old format.
  const marker = "agents/researcher/agent.md";
  const owners: string[] = [];

  for (const dir of ["packages", "web"]) {
    for (const file of walk(path.join(root, dir), (f) => /\.(ts|tsx|mjs|js)$/.test(f))) {
      const rel = path.relative(root, file);
      if (rel.includes("/dist/") || rel.endsWith(".test.ts")) continue;
      if (fs.readFileSync(file, "utf8").includes(marker)) owners.push(rel);
    }
  }

  assert.deepEqual(
    owners,
    ["packages/core/src/starter.ts"],
    `the starter workspace must live in starter.ts alone, found in:\n${owners.join("\n")}`,
  );
});

test("both callers scaffold the same workspace, minus what only a laptop keeps", () => {
  // The hosted scaffold is the starter with local-disk concerns removed:
  // .gitignore guards a clone's secrets, and the hosted store never keeps
  // secrets in the tree. Everything else must stay byte-identical, or the
  // dashboard's New button and `foldrun init` drift apart again.
  const starter = starterFiles("demo");
  const hosted = templateFiles("demo");
  const localOnly = starter.filter((f) => !hosted.some((h) => h.path === f.path));
  assert.deepEqual(localOnly.map((f) => f.path), [".gitignore"]);
  assert.deepEqual(hosted, starter.filter((f) => f.path !== ".gitignore"));
});

test("the starter workspace obeys the rules it ships", () => {
  // A scaffold that writes fields its own checker warns about is the bug this
  // guards: it happened once already, when the dashboard kept emitting the old
  // spelling after the CLI had moved on.
  const bad: string[] = [];

  for (const { path: rel, content } of starterFiles("demo")) {
    const front = content.split("---")[1] ?? "";
    const isOkf = rel.startsWith("knowledge/") || rel.startsWith("memory/");

    if (/^kind:/m.test(front)) bad.push(`${rel}: declares kind: — the path says it`);
    if (!isOkf && /^type:/m.test(front)) bad.push(`${rel}: declares type: — that is OKF's field`);
    if (isOkf && !/^type:/m.test(front)) bad.push(`${rel}: an OKF concept with no type:`);
  }

  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- UI system

// The rules the UI audit established, guarded the same way the data lists
// are: read the source, refuse the drift.

const WEB = path.join(import.meta.dirname, "..", "web");

function dashboardPages(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") out.push(full);
    }
  };
  walk(path.join(WEB, "app/dashboard"));
  return out;
}

test("content pages share one width; only editors and file trees go wide", () => {
  const wideAllowed = ["[workspace]/edit", "library/edit", "library/files", "graph"];
  const offenders: string[] = [];
  for (const page of dashboardPages()) {
    const rel = path.relative(path.join(WEB, "app/dashboard"), page);
    const src = fs.readFileSync(page, "utf8");
    const widths = [...src.matchAll(/mx-auto (max-w-\w+)/g)].map((m) => m[1]);
    for (const w of widths) {
      if (w !== "max-w-5xl" && !wideAllowed.some((a) => rel.includes(a))) {
        offenders.push(`${rel}: ${w}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "pages jumped width — max-w-5xl is the standard");
});

test("no component rolls its own dark primary button", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") walk(full);
      else if (entry.name.endsWith(".tsx") && !full.endsWith("components/ui.tsx")) {
        if (/bg-gray-900 px-/.test(fs.readFileSync(full, "utf8"))) {
          offenders.push(path.relative(WEB, full));
        }
      }
    }
  };
  walk(path.join(WEB, "app"));
  walk(path.join(WEB, "components"));
  assert.deepEqual(offenders, [], "a primary button outside buttonClass() is a fork of the design system");
});

test("nothing asks for confirmation through the browser", () => {
  // window.confirm renders with the *origin* as its title, so a destructive
  // action announces itself as "192.168.1.140 says" — indistinguishable from
  // the scam warnings people are trained to dismiss. It also cannot name the
  // dangerous button or show what is about to be deleted. useConfirm() can.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") walk(full);
      else if (entry.name.endsWith(".tsx")) {
        const src = fs.readFileSync(full, "utf8");
        if (/\bwindow\.confirm\(/.test(src)) offenders.push(path.relative(WEB, full));
      }
    }
  };
  walk(path.join(WEB, "app"));
  walk(path.join(WEB, "components"));
  assert.deepEqual(offenders, [], "use useConfirm() from components/confirm.tsx");
});

test("every workspace subpage reaches up through WorkspaceHeader", () => {
  const subpages = ["agents", "flows", "runs", "evals", "assets", "storage", "settings"];
  for (const p of subpages) {
    const src = fs.readFileSync(path.join(WEB, `app/dashboard/[workspace]/${p}/page.tsx`), "utf8");
    assert.ok(src.includes("WorkspaceHeader"), `${p} hand-rolls its header`);
    assert.ok(!src.includes("← Workspaces"), `${p} still points at the account list`);
  }
});

test("an anchored file explains itself instead of failing generically", () => {
  // Location is meaning here, so a refusal has to name the reason: "not an
  // editable path" is true of AGENTS.md and teaches nothing about why.
  for (const [rel, expect] of [
    ["AGENTS.md", /workspace's own identity/],
    ["agents/writer/agent.md", /because of where it sits/],
    ["skills/plain-english/SKILL.md", /names its skill/],
    ["tools/browser/tool.md", /names its tool/],
    ["knowledge/index.md", /generated from the files around it/],
    ["agents/writer/memory/log.md", /generated from the files around it/],
  ] as const) {
    const why = anchoredReason(rel);
    assert.ok(why, `${rel} should be anchored`);
    assert.match(why!, expect);
  }
  // Everything else moves freely.
  for (const rel of ["knowledge/sources.md", "flows/publish.md", "tools/email.md"]) {
    assert.equal(anchoredReason(rel), null, `${rel} should move`);
  }
});

test("the tree's refusals are the server's refusals, word for word", () => {
  // The tree cannot import store.ts (it reads disk), so it mirrors these
  // sentences. A mirror that drifts is worse than no mirror: the gesture
  // would be refused by one and allowed by the other.
  const tree = read("web/components/file-tree.tsx");
  for (const phrase of [
    "is the workspace's own identity",
    "because of where it sits",
    "names its skill",
    "names its tool",
    "generated from the files around it",
    "is its folder's identity",
  ]) {
    assert.ok(tree.includes(phrase), `file-tree.tsx is missing: ${phrase}`);
  }
});

// The account file tree is a faithful walk of the account directory, not a
// curated view of it. A tree that silently differs from the filesystem teaches
// the filesystem wrong — which is why the vault and the ledger are LISTED and
// then refused by name, rather than hidden and wondered about.
test("the vault and the ledger are sealed, and authored files are not", () => {
  const sealed = ["secrets.json", "ledger.jsonl", "oauth-clients.json", "billed/2026-08.json"];
  for (const p of sealed) {
    assert.ok(accountFileSealed(p), `${p} must not be servable`);
  }
  const open = [
    "AGENTS.md",
    "library/tools/browser.md",
    "workspaces/blog-desk/agents/writer/agent.md",
    "storage/blog-desk/index.json",
  ];
  for (const p of open) {
    assert.equal(accountFileSealed(p), null, `${p} is authored and should open`);
  }
  // A workspace's own vault and its run history are sealed the same way.
  assert.ok(accountFileSealed("workspaces/blog-desk/secrets.json"));
  assert.ok(accountFileSealed("workspaces/blog-desk/runs/run-x.json"));
});

test("a pre-rename mdagent_version is migrated, not tolerated", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-rename-"));
  fs.writeFileSync(
    path.join(dir, "AGENTS.md"),
    '---\nmdagent_version: "0.1"\nprovider: anthropic\n---\n\nShared context.\n',
  );

  const read = readAgentsMd(dir);
  assert.equal(read?.data.foldrun_version, "0.1", "the reader sees one spelling");
  assert.equal(read?.data.mdagent_version, undefined, "and only one");
  assert.match(
    fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"),
    /^foldrun_version: "0\.1"$/m,
    "the file itself was converted, so the old name retires",
  );
  assert.match(
    fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"),
    /^provider: anthropic$/m,
    "and nothing else about the file moved",
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- role split
//
// The production manifest runs the same image twice — a web tier that serves
// and a worker that drives runs — and the ONLY difference between them is
// FOLDRUN_ROLE. Everything else (the runner image, the size ceilings, all
// eleven secret references) is written out in both, which is exactly the bug
// this file exists to catch: a list in two places, one updated, the other not.
// A worker whose FOLDRUN_RUNNER_IMAGE lagged the web tier's would run every
// step on a stale runner and nothing would say so.

const manifest = () => {
  const docs = yaml.loadAll(read("infra/production/manifests/platform.yaml")) as any[];
  const byName = (kind: string, name: string) =>
    docs.find((d) => d && d.kind === kind && d.metadata?.name === name);
  return { docs, byName };
};

const envOf = (deploy: any) => {
  const env = deploy.spec.template.spec.containers[0].env as any[];
  return new Map(env.map((e) => [e.name, JSON.stringify(e.value ?? e.valueFrom)]));
};

test("web and worker differ by FOLDRUN_ROLE and nothing else", () => {
  const { byName } = manifest();
  const web = envOf(byName("Deployment", "foldrun-web"));
  const worker = envOf(byName("Deployment", "foldrun-worker"));

  assert.equal(web.get("FOLDRUN_ROLE"), JSON.stringify("web"));
  assert.equal(worker.get("FOLDRUN_ROLE"), JSON.stringify("worker"));

  const keys = new Set([...web.keys(), ...worker.keys()]);
  keys.delete("FOLDRUN_ROLE");
  for (const k of keys) {
    assert.equal(
      web.get(k),
      worker.get(k),
      `${k} differs between the web and worker tiers — they run the same image and must agree`,
    );
  }
});

test("exactly one worker, and the Service never routes to it", () => {
  const { byName } = manifest();
  const worker = byName("Deployment", "foldrun-worker");
  const web = byName("Deployment", "foldrun-web");
  const svc = byName("Service", "foldrun");

  // Two workers driving one queue is the failure the worker lease exists to
  // stop. The manifest agrees with the lease rather than leaning on it.
  assert.equal(worker.spec.replicas, 1, "a second worker would double-drive every run");
  assert.equal(worker.spec.strategy.type, "Recreate", "two workers must not overlap during a roll");

  // The whole point of the split: rolling the web tier leaves a server up.
  assert.ok(web.spec.replicas >= 2, "one web replica still has a gap with nothing serving");
  assert.equal(web.spec.strategy.type, "RollingUpdate");

  assert.deepEqual(svc.spec.selector, web.spec.template.metadata.labels);
  assert.notDeepEqual(
    svc.spec.selector,
    worker.spec.template.metadata.labels,
    "dashboard traffic on the worker would compete with driving runs",
  );
});

test("only the worker may create run pods", () => {
  const { byName, docs } = manifest();
  const worker = byName("Deployment", "foldrun-worker").spec.template.spec.serviceAccountName;
  const web = byName("Deployment", "foldrun-web").spec.template.spec.serviceAccountName;
  assert.notEqual(web, worker, "a serving replica has no business creating run pods");

  const bound = docs
    .filter((d) => d && d.kind === "RoleBinding")
    .flatMap((d) => (d.subjects ?? []).map((s: any) => s.name));
  assert.ok(bound.includes(worker), "the worker's account must hold the run-pod Role");
  assert.ok(!bound.includes(web), "the web account must hold no RBAC at all");
});

// ------------------------------------------------------- the grammar's docs
//
// A flow step accepts seventeen options, and they arrived one reasonable
// feature at a time. Four of them (`approve:`, `retry:`, `timeout:`,
// `verify:`) were shipped, parsed and clamped without ever reaching SPEC.md —
// found only by counting the parser against the prose. The help page's own
// header says "the consistency suite can't check that". It can.

/** Every option key the flow parser actually accepts. */
function parsedStepOptions(): string[] {
  const src = read("packages/core/src/store.ts");
  const keys = [...src.matchAll(/key === "([a-z-]+)"/g)].map((m) => m[1]);
  // `onfail` is spelled two ways at the parser; documenting one is enough.
  return [...new Set(keys)].filter((k) => k !== "onfail");
}

test("every step option the parser accepts is documented", () => {
  const options = parsedStepOptions();
  assert.ok(options.length >= 15, `expected the full option set, found ${options.length}`);

  const spec = read("SPEC.md");
  const help = read("web/app/dashboard/help/page.tsx");

  for (const key of options) {
    assert.ok(
      spec.includes(`\`${key}:`) || spec.includes(`${key}:`),
      `step option "${key}:" is parsed but absent from SPEC.md — the format spec has to name it`,
    );
    assert.ok(
      help.includes(`${key}:`),
      `step option "${key}:" is parsed but absent from the in-app help page`,
    );
  }
});

// The rename of files/ to storage/ reached the code and left the help page
// telling people to write [[files/leads.csv]] — a path that resolves only
// through the legacy alias. Docs that name a directory should name the one
// the code uses.
test("nothing a person reads still names the pre-rename files/", () => {
  // The help page was not the only place. The run-from-step dialog told people
  // their run would "lean on whatever they last left in files/", and the
  // scaling ADR — which now renders inside the app — said "files/ stays R2".
  // Anything a person reads should name the directory the code actually uses.
  const surfaces = [
    "web/app/dashboard/help/page.tsx",
    "web/app/dashboard/[workspace]/flows/flow-board.tsx",
    "docs/scaling-adr.md",
    "docs/grammar-adr.md",
    "SPEC.md",
    "README.md",
  ];
  const offenders: string[] = [];
  for (const rel of surfaces) {
    let src: string;
    try {
      src = read(rel);
    } catch {
      continue; // a doc that no longer exists is not a stale reference
    }
    for (const line of src.split("\n")) {
      // `files` as a bare word is fine ("the file store", "foldrun-files").
      // A PATH segment — files/ — is the thing that was renamed. Skip lines
      // that are explicitly about the legacy alias or the bucket name.
      if (!/(^|[^\w-])files\//.test(line)) continue;
      if (/legacy|LEGACY|foldrun-files|api\/|route/.test(line)) continue;
      offenders.push(`${rel}: ${line.trim().slice(0, 70)}`);
    }
  }
  assert.deepEqual(offenders, [], "files/ was renamed to storage/ — these still say files/");
});

// ------------------------------------------------- what agents are told to do
//
// The prompt tells every agent where to leave deliverables. harvestFiles reads
// exactly one directory. If those two disagree, a run writes its output to a
// place nothing collects and the Storage page stays empty — no error, no
// warning, the run reports success.
//
// That is not hypothetical: after files/ was renamed to storage/, the prompt
// still said `../../files/`. Nothing rescued it either, because
// materializeFiles always creates storage/ before the step, which makes
// adoptLegacyFilesDir's "move files/ into storage/" a no-op by harvest time.

test("agents are told to write where harvestFiles actually reads", () => {
  const runner = read("packages/core/src/runner.ts");
  const storage = read("packages/core/src/storage.ts");

  // The directory the store harvests from, taken from the source of truth.
  const dir = read("packages/core/src/store.ts").match(/export const STORAGE_DIR = "([^"]+)"/)?.[1];
  assert.ok(dir, "STORAGE_DIR should be a literal in store.ts");

  // Only the lines that tell an agent where DELIVERABLES go. Other
  // `../../x/` paths in the prompt (knowledge/, memory/) are read locations
  // and correctly point elsewhere.
  const told = runner
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .filter((l) => /deliverable|file store/i.test(l))
    .flatMap((l) => [...l.matchAll(/\.\.\/\.\.\/([a-z]+)\//g)].map((m) => m[1]))
    .filter((d) => d !== "outputs"); // outputs/ is working text, not delivered
  assert.ok(told.length > 0, "the prompt should name a deliverables directory");

  for (const named of new Set(told)) {
    assert.equal(
      named,
      dir,
      `the prompt tells agents to write to ../../${named}/ but the store harvests ${dir}/ — ` +
        `anything written there is silently never collected`,
    );
  }

  // And harvest really does read that constant rather than a literal.
  assert.match(
    storage,
    /harvestFiles[\s\S]{0,400}STORAGE_DIR/,
    "harvestFiles should read STORAGE_DIR, so this test compares against the real path",
  );
});
