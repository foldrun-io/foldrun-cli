// CLI commands. Kept separate from bin/ so the environment is set before the
// core is imported — single-workspace mode is read at module load.

import dns from "node:dns";
import fs from "node:fs";
import crypto from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeAgentFiles, hasCurrentAgentRules, agentRulesBlock, codingAgent, docsDir, docPages, docPage } from "./guide.mjs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { defaultPlatform, saveCredential, removeCredential, readCredentials, normaliseUrl, profileByName, currentProfile, useProfile, listProfiles } from "./credentials.mjs";

// NO_COLOR (no-color.org) turns the escapes off — for a log file, a CI
// job, or a test that wants to match what a person reads. The tests had
// been setting it all along, to no effect.
const paint = (code) => (s) => (process.env.NO_COLOR ? String(s) : `\x1b[${code}m${s}\x1b[0m`);
const c = {
  dim: paint(2),
  bold: paint(1),
  green: paint(32),
  red: paint(31),
  yellow: paint(33),
  amber: paint(33),
};

// The published runtime, not a relative reach into a sibling directory. It was
// `../../core/index.ts` — which works only inside this repo, so `npx foldrun`
// installed a CLI that could not find its own runtime. Imported lazily so
// `--help` and argument errors never pay for loading it.
const core = async () => import("@foldrun/core");

// ---------------------------------------------------------------- init

/**
 * Read a template directory as the same {path, content} list starterFiles
 * returns, so both sources of a new workspace go through one writer.
 *
 * Run artifacts are skipped: a template is what someone authored, and copying
 * a previous run's outputs or journal into a fresh workspace hands it a
 * history it never had.
 */
function templateFilesFrom(dir) {
  const skip = new Set(["runs", "outputs", ".foldrun", "node_modules", ".git"]);
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs).sort()) {
      if (skip.has(entry)) continue;
      const full = path.join(abs, entry);
      const next = rel ? `${rel}/${entry}` : entry;
      if (fs.statSync(full).isDirectory()) walk(full, next);
      else out.push({ path: next, content: fs.readFileSync(full, "utf8") });
    }
  };
  walk(path.resolve(dir), "");
  return out;
}

/** The root of the installed @foldrun/core package — dist/index.js is two levels down. */
function coreRoot() {
  const entry = fileURLToPath(import.meta.resolve("@foldrun/core"));
  return path.resolve(path.dirname(entry), "..");
}
function shippedTemplate(rel) {
  if (path.isAbsolute(rel)) return null;
  const abs = path.join(coreRoot(), rel);
  return fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? abs : null;
}
function shippedTemplates() {
  const dir = path.join(coreRoot(), "templates");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory()).map((n) => `templates/${n}`);
}

/** The files of one workspace: a template if asked for, else the starter. */
async function workspaceFiles(name, from) {
  const { starterFiles } = await core();
  // A template is a source, a workspace is a destination. Keeping the two
  // words apart is the whole reason `templates/` is not called `examples/`:
  // there is one place a workspace lives, and it is wherever you make one.
  // A relative --from is first a directory here, then the same path inside
  // the installed @foldrun/core package, which is where the shipped
  // templates/ live — `--from templates/hello` must work from any directory
  // after `npm i foldrun`, not only from a checkout of the repo.
  const source = from && !fs.existsSync(from) ? shippedTemplate(from) : from;
  if (from && !source) {
    throw new Error(`no template at ${from} — pass a directory, or one that ships with foldrun: ${shippedTemplates().join(", ") || "none found"}`);
  }
  const files = source ? templateFilesFrom(source) : starterFiles(name);

  // Whatever the source, the new workspace must ignore the key that decrypts
  // its secrets. A template does not carry one — it is a source, not a
  // repository — so copying a template verbatim would hand back the very hole
  // the starter's .gitignore exists to close.
  if (!files.some((f) => f.path === ".gitignore")) {
    const guard = starterFiles("x").find((f) => f.path === ".gitignore");
    if (guard) files.unshift(guard);
  }
  return files;
}

/** Write a {path, content} list into `dir`, refusing to overwrite anything. */
function writeFiles(dir, files, what) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    const clash = files.find((f) => fs.existsSync(path.join(dir, f.path)));
    if (clash) throw new Error(`${what ?? dir} already has ${clash.path} — refusing to overwrite`);
  }
  for (const { path: rel, content } of files) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

/** kebab-case, the same rule the platform applies to a workspace name. */
function assertName(name) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`"${name}" is not a workspace name — kebab-case only, e.g. blog-desk`);
  }
  return name;
}

/**
 * `foldrun init [dir]` — an account folder, the same shape the platform keeps.
 *
 *   my-account/
 *   ├── AGENTS.md          config and context every workspace here inherits
 *   ├── library/           skills, tools, scripts, knowledge shared by all of them
 *   └── workspaces/<name>/ the first one, ready to run
 *
 * It used to make the workspace alone, flat, with the account AGENTS.md
 * dropped in the parent directory as a surprise. That was a different shape
 * from the platform's, so a folder that worked on a laptop had to be
 * rearranged in your head to reason about what a deploy would do. `--flat`
 * still makes the old one, and every command still reads it.
 */
async function init(root, from, flags = {}) {
  const { syncWorkspaceBundles, ensureAccountFiles, accountGitignore, LIBRARY_KINDS } = await core();

  if (flags.flat === true) {
    const files = await workspaceFiles(path.basename(path.resolve(root)), from);
    writeFiles(root, files);
    syncWorkspaceBundles(root);
    // The account scope, one directory up — the same place libraryDir points
    // for a flat workspace, so `my-desk/` ends up beside the `AGENTS.md` that
    // covers it. accountDir cannot answer here: nothing has pinned this
    // process to the new workspace yet, so it is passed explicitly.
    const written = ensureAccountFiles("default", path.resolve(root, "..")).map((rel) => `../${rel}`);
    const rules = writeAgentFiles(path.resolve(root, ".."));
    if (rules.claudeMd === "created") written.push("../CLAUDE.md");
    report(root, files.map((f) => f.path), written, root, files);
    return 0;
  }

  const name = assertName(typeof flags.workspace === "string" ? flags.workspace : "main");
  const account = path.resolve(root);
  const wsDir = path.join(account, "workspaces", name);
  const files = await workspaceFiles(name, from);

  // Everything is checked before anything is written: a half-made account is
  // worse than none, because the refusal to overwrite then blocks the retry.
  const accountLevel = [accountGitignore(), ...(await core()).accountFiles(path.basename(account))];
  // A library that exists as empty directories is a library someone can put a
  // file in. `.gitkeep` is what makes git carry them.
  for (const kind of LIBRARY_KINDS) {
    accountLevel.push({ path: `library/${kind}/.gitkeep`, content: "" });
  }
  const existing = [...accountLevel.map((f) => f.path), ...files.map((f) => `workspaces/${name}/${f.path}`)]
    .filter((rel) => fs.existsSync(path.join(account, rel)));
  if (existing.length) throw new Error(`${account} already has ${existing[0]} — refusing to overwrite`);

  writeFiles(account, accountLevel);
  writeFiles(wsDir, files);
  syncWorkspaceBundles(wsDir);
  // What a coding agent reads first (guide.mjs): the managed block in
  // AGENTS.md pointing at the docs that ship with this CLI, and CLAUDE.md
  // importing it — the arrangement create-next-app makes.
  writeAgentFiles(account);
  report(
    account,
    [...accountLevel.map((f) => f.path), "CLAUDE.md", ...files.map((f) => `workspaces/${name}/${f.path}`)],
    [],
    wsDir,
    files,
  );
  return 0;
}

/** What init and new both print: the tree they wrote, then the two next moves. */
function report(where, written, outside, wsDir, files) {
  console.log(`\n  ${c.green("created")} ${where}\n`);
  for (const rel of written) console.log(`    ${c.dim(rel)}`);
  // Not part of what was asked for: say so on the line, not in a comment
  // nobody reads. A developer who ran `foldrun init ~/projects/desk --flat`
  // finds an AGENTS.md in ~/projects and should know it was this, and why.
  for (const rel of outside) {
    console.log(`    ${c.dim(rel)}  ${c.dim("← account scope, shared by every workspace beside this one")}`);
  }
  const flow = files.map((f) => f.path.match(/^flows\/(.+)\.md$/)?.[1]).find(Boolean);
  const rel = path.relative(process.cwd(), where) || ".";
  console.log(`
  ${c.bold("Next")}
    foldrun check ${rel}${" ".repeat(Math.max(1, 16 - rel.length))}${c.dim("validate it — costs nothing")}
    foldrun run ${flow ?? "publish"} --workspace ${path.relative(process.cwd(), wsDir) || "."}   ${c.dim("run the flow")}
`);
}

/**
 * `foldrun new <name>` — another workspace in this account.
 *
 * Refuses outside an account folder rather than quietly making one: a flat
 * workspace has nowhere to put a second one, and inventing a `workspaces/`
 * directory beside somebody's agents/ would change the shape of a folder they
 * did not ask to change.
 */
async function newWorkspace(name, flags, layout) {
  const { syncWorkspaceBundles } = await core();
  if (!name) throw new Error("which workspace? `foldrun new <name>`");
  assertName(name);
  if (!layout.workspacesDir) {
    throw new Error(
      layout.kind === "flat"
        ? `${layout.workspaceDir} is a single workspace, not an account — \`foldrun init <dir>\` makes an account folder that can hold several`
        : "not in an account folder — `foldrun init <dir>` makes one",
    );
  }
  const dir = path.join(layout.workspacesDir, name);
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists`);
  const files = await workspaceFiles(name, flags.from);
  writeFiles(dir, files);
  syncWorkspaceBundles(dir);
  report(dir, files.map((f) => f.path), [], dir, files);
  return 0;
}

// ------------------------------------------------- agent, flow, tool: new

/**
 * Which workspace folder a scaffolding command writes into.
 *
 * `init` makes an account, `new` makes a workspace; these make one document
 * INSIDE a workspace, so the question is the same one every workspace-scoped
 * command asks and the answer is the same: the folder you are standing in,
 * the only one in this account, or the one `--to` names.
 */
function workspaceDirFor(flags, layout) {
  if (typeof flags.to === "string") {
    if (!layout.workspacesDir || !layout.workspaces.includes(flags.to)) {
      throw new Error(
        `no workspace called "${flags.to}" here — this ${layout.kind === "flat" ? "is a single workspace" : `account has ${layout.workspaces.join(", ") || "none"}`}`,
      );
    }
    return path.join(layout.workspacesDir, flags.to);
  }
  if (layout.workspaceDir && layout.kind !== "empty") return layout.workspaceDir;
  if (layout.workspacesDir && layout.workspaces.length === 1) return path.join(layout.workspacesDir, layout.workspaces[0]);
  if (layout.kind === "account") {
    throw new Error(`which workspace? --to <name> — this account has ${layout.workspaces.join(", ") || "none"}`);
  }
  throw new Error("this is not a workspace — `foldrun init <dir>` makes one, or cd into an existing one");
}

/**
 * What each key in a scaffolded file is for, said once where it is useful.
 *
 * Not written INTO the template: the templates are core's, shared with the
 * dashboard's New button and checked by the same validator, and a commented
 * copy here would be a second list to keep in step. Printed instead, beside
 * the file it describes.
 */
const KEY_NOTES = {
  agents: [
    ["name", "how flows address it — [[name]]; matches the folder"],
    ["description", "one line; what this role is for"],
    ["model", "fast | default | max — tier the work, not the desk"],
    ["effort", "low | high — how hard to think about it"],
    ["tools", "the one grant list: built-ins and your own tools/"],
  ],
  flows: [
    ["name", "how it is run: foldrun run <name>"],
    ["description", "one line; what it accomplishes end to end"],
    ["trigger", "manual | schedule | webhook — schedule: needs schedule: and timezone:"],
    ["1. [[agent]]", "the NUMBER is the group: same number runs in parallel, and the flow waits"],
  ],
  tools: [
    ["transport", "script | http | mcp — script is a program in this folder"],
    ["name", "what an agent puts in its tools: list"],
    ["description", "the model reads this to decide when to call it"],
    ["run", "the program, relative to this folder"],
  ],
};

/** An agent already in this workspace, so a new flow names a real one. */
function anyAgentIn(dir) {
  try {
    return fs.readdirSync(path.join(dir, "agents"), { withFileTypes: true }).find((e) => e.isDirectory())?.name;
  } catch {
    return undefined;
  }
}

/**
 * `foldrun agent new <name>`, `flow new`, `tool new` — one document inside a
 * workspace, with the frontmatter its format requires.
 *
 * The dashboard's New button has written these templates since kinds.ts
 * existed; the terminal's only scaffolding was `init` and `new`, which make a
 * whole workspace. So the author who wanted a fourth agent wrote the
 * frontmatter from memory, which is how `use:` survived a year after it was
 * replaced by `tools:`.
 *
 * The templates are core's, not a second copy: a list of required keys in two
 * places is the bug this codebase keeps producing, and a scaffold that drifts
 * from the validator writes files `foldrun check` then rejects.
 *
 * A new tool is a `transport: script` folder by default — its program in a
 * file beside it, because a tool whose code is a fenced block gets no linter,
 * no formatter and no way to run it except through a run.
 */
async function scaffoldCmd(kind, positional, flags, layout) {
  const { KINDS, toolStarter, SCRIPT_LANGUAGES } = await import("@foldrun/core/kinds");
  const one = KINDS[kind].one;

  // The other verbs are dispatched before this — `agent run` and `tool test`
  // go to the platform — so anything left here should have been `new`.
  const alsoVerbs = { agents: ["run"], tools: ["test"], flows: [] }[kind] ?? [];
  const verb = positional[0];
  if (verb !== "new") {
    const verbs = ["new", ...alsoVerbs].join(", ");
    throw new Error(
      `\`foldrun ${one} new <name>\` — ${alsoVerbs.length ? `${verbs} are the verbs` : `"new" is the only verb`}${verb ? `, not "${verb}"` : ""}`,
    );
  }
  const name = positional[1];
  if (!name) throw new Error(`which ${one}? \`foldrun ${one} new <name>\` — e.g. ${KINDS[kind].placeholder}`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`"${name}" is not a ${one} name — kebab-case only, e.g. ${KINDS[kind].placeholder}`);
  }

  const dir = workspaceDirFor(flags, layout);
  let files;
  if (kind === "tools") {
    const transport = typeof flags.transport === "string" ? flags.transport : "script";
    if (!["script", "http", "mcp"].includes(transport)) {
      throw new Error(`--transport takes script, http or mcp — not "${transport}"`);
    }
    const language = typeof flags.language === "string" ? flags.language : "javascript";
    if (!SCRIPT_LANGUAGES.some((l) => l.value === language)) {
      throw new Error(`--language takes ${SCRIPT_LANGUAGES.map((l) => l.value).join(", ")} — not "${language}"`);
    }
    files = toolStarter(name, transport, language).map((f) => ({ path: f.file, content: f.content }));
  } else {
    files = [{ path: KINDS[kind].file(name), content: KINDS[kind].template(name, { firstAgent: anyAgentIn(dir) }) }];
  }

  writeFiles(dir, files, path.basename(dir));

  const where = path.relative(process.cwd(), dir) || ".";
  console.log(`\n  ${c.green("created")} ${one} ${c.bold(name)} in ${where}\n`);
  for (const f of files) console.log(`    ${c.dim(f.path)}`);
  console.log(`\n  ${c.dim(KINDS[kind].hint)}\n`);
  // What each key in the file it just wrote is FOR. The templates come from
  // core so they cannot drift from the validator, and they carry no comments
  // — a second, commented copy here would be exactly the two-lists bug. So
  // the explanation is printed once, next to the file it explains.
  for (const [key, what] of KEY_NOTES[kind]) console.log(`    ${c.bold(pad(key, 12))} ${c.dim(what)}`);
  console.log(`\n  ${c.bold("Next")}
    edit ${path.join(where, files[0].path)}
    foldrun check${where === "." ? "" : ` ${where}`}${" ".repeat(4)}${c.dim("validate it — offline, costs nothing")}\n`);
  return 0;
}

// ---------------------------------------------------------------- check

// The Agent Skills spec constrains the `name` field and requires a non-empty
// `description`. Validation is deliberately lenient — the client guide says to
// warn and load rather than reject, so cross-client skills still run — so these
// are warnings and one error (an empty description cannot be disclosed, so the
// runtime skips that skill; the error says why it vanished).
const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function readFm(file) {
  const block = readFrontmatter(file);
  if (block === null) return null;
  const field = (k) => {
    const m = new RegExp(`^${k}:\\s*(.+)$`, "m").exec(block);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  };
  return { name: field("name"), description: field("description") };
}

// Every skill root the runtime scans: each agent's own skills/, the workspace
// skills/, and the cross-client .agents/skills/ convention.
function skillRoots(workspace) {
  const roots = [];
  for (const agent of ls(path.join(workspace, "agents"))) {
    roots.push(`agents/${agent}/skills`);
  }
  roots.push("skills", ".agents/skills");
  return roots;
}

function validateSkills(workspace, note) {
  for (const root of skillRoots(workspace)) {
    for (const folder of ls(path.join(workspace, root))) {
      const dir = path.join(workspace, root, folder);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      const skillMd = path.join(dir, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      const where = `${root}/${folder}/SKILL.md`;
      const fm = readFm(skillMd);
      if (!fm) { note("warn", where, "no frontmatter — needs name and description"); continue; }

      if (!fm.description) {
        note("error", where, "no description — the runtime skips a skill it cannot disclose");
      } else if (fm.description.length > 1024) {
        note("warn", where, `description is ${fm.description.length} chars — the spec limit is 1024`);
      }

      const name = fm.name;
      if (!name) {
        note("warn", where, "no name — the folder name is used, but declare it");
      } else {
        if (name !== folder) {
          note("warn", where, `name "${name}" does not match its folder "${folder}" — the spec requires they match`);
        }
        if (name.length > 64) note("warn", where, `name is ${name.length} chars — the spec limit is 64`);
        if (!SKILL_NAME_RE.test(name)) {
          note("warn", where, `name "${name}" is not lowercase-alphanumeric-with-single-hyphens`);
        }
      }
    }
  }
}

// Single-file subagents authored by ANY coding tool. The vendor-neutral
// cross-client location is .agents/agents/<name>.md (scanned first); a tool's
// own dir (.claude/agents/ so far) follows for pragmatic compatibility.
// readTree maps these into agents/<name>/agent.md at deploy; check mirrors it
// so the local, pre-deploy experience matches — otherwise a workspace whose
// only agents were authored elsewhere reports "no agents" until it deploys.
function importedAgentNames(workspace, nativeNames) {
  const names = new Set();
  for (const dir of [".agents/agents", ".claude/agents"]) {
    for (const entry of ls(path.join(workspace, dir))) {
      if (!entry.endsWith(".md")) continue;
      // A real file, not a directory named x.md — deploy's readTree reads the
      // file and would skip a directory, so check must agree or it counts an
      // agent that never ships.
      try {
        if (!fs.statSync(path.join(workspace, dir, entry)).isFile()) continue;
      } catch {
        continue;
      }
      const name = entry.replace(/\.md$/, "");
      if (nativeNames.has(name)) continue; // native wins
      names.add(name);
    }
  }
  return names;
}

// ---------------------------------------------------------------- extract

/**
 * Lift a single-file script tool's program out of its markdown and into a
 * file beside it: `tools/x.md` becomes `tools/x/tool.md` + `tools/x/run.py`.
 *
 * The tool's NAME does not change, which is the property that makes this
 * safe to run against a live workspace: `tools: [x]` in an agent still names
 * the same tool, so no agent, flow or schedule has to be edited alongside.
 * Only where the bytes live changes.
 *
 * Written to be re-runnable. A tool already in folder form, or one with a
 * `run:`, is skipped rather than touched, so a half-finished migration is
 * finished by running it again rather than by unpicking it.
 *
 * Order matters on a live box: the folder is written and re-parsed FIRST,
 * and the flat file is removed only once the result loads as a script tool
 * whose program is on disk. A crash between the two leaves the old file
 * intact and a folder beside it — visible, and fixed by re-running.
 */
async function extract(workspace, flags) {
  const { fencedCodeBlock, parseToolDef } = await core();
  const dry = Boolean(flags["dry-run"]);
  const dir = path.join(workspace, "tools");

  if (!fs.existsSync(dir)) {
    console.log(`\n  no tools/ in ${workspace} — nothing to extract\n`);
    return 0;
  }

  const done = [];
  const skipped = [];
  const failed = [];

  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.endsWith(".md")) continue;
    const name = entry.replace(/\.md$/, "");
    const flat = path.join(dir, entry);
    const raw = fs.readFileSync(flat, "utf8");

    // Frontmatter is edited as text, never re-serialised. A YAML round-trip
    // reorders keys, drops comments and rewrites quoting — a diff nobody
    // asked for across every tool on the box, hiding the one line that
    // actually changed.
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
    if (!fm) {
      skipped.push([name, "no frontmatter"]);
      continue;
    }
    const front = fm[1];
    const body = raw.slice(fm[0].length);

    if (/^transport:\s*script\s*$/m.test(front) === false && /^run:/m.test(front) === false) {
      skipped.push([name, "not a script tool"]);
      continue;
    }
    if (/^run:/m.test(front)) {
      skipped.push([name, "already points at a file"]);
      continue;
    }

    const block = fencedCodeBlock(body);
    if (!block) {
      failed.push([name, "transport: script with no run: and no fenced program — nothing to extract"]);
      continue;
    }

    const program = `run${block.ext}`;
    const folder = path.join(dir, name);
    if (fs.existsSync(folder)) {
      failed.push([name, `tools/${name}/ already exists — resolve by hand`]);
      continue;
    }

    // The body keeps its prose and loses the block that is now a file. The
    // pointer replaces it so the document still says where the program is.
    const trimmed =
      body.slice(0, block.start).replace(/\n{3,}$/, "\n\n") +
      `\`${program}\` beside this file is the program.\n` +
      body.slice(block.end).replace(/^\n+/, "\n");

    const manifest =
      `---\n${front.replace(/(^name:.*$)/m, `$1\nrun: ${program}`)}\n---\n\n` + trimmed.replace(/^\n+/, "");

    if (dry) {
      done.push([name, `${program} (${block.code.split("\n").length} lines)`]);
      continue;
    }

    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, program), block.code);
    fs.writeFileSync(path.join(folder, "tool.md"), manifest);

    // Prove it before deleting anything. parseToolDef is what the runtime
    // uses, so "it loads" here means it loads there.
    const check = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(manifest);
    if (!check) throw new Error(`${name}: the manifest has no frontmatter — nothing to extract from`);
    const data = Object.fromEntries(
      check[1]
        .split("\n")
        .flatMap((l) => {
          const m = /^([a-z_-]+):\s*(.*)$/.exec(l);
          return m ? [[m[1], m[2]]] : [];
        }),
    );
    const def = parseToolDef(data, name, manifest.slice(check[0].length));
    const ok =
      def?.kind === "script" &&
      def.spec.run === program &&
      fs.existsSync(path.join(folder, program));
    if (!ok) {
      failed.push([name, "the extracted folder did not parse back as a script tool — flat file left in place"]);
      continue;
    }

    fs.rmSync(flat);
    done.push([name, `${program} (${block.code.split("\n").length} lines)`]);
  }

  const label = dry ? "would extract" : "extracted";
  console.log("");
  for (const [name, what] of done) console.log(`  ${c.green("✓")} ${label} ${c.bold(name)} → tools/${name}/${what}`);
  for (const [name, why] of skipped) console.log(`  ${c.dim("·")} ${c.dim(`${name} — ${why}`)}`);
  for (const [name, why] of failed) console.log(`  ${c.red("!")} ${c.bold(name)} — ${why}`);
  console.log(
    `\n  ${done.length} ${label}, ${skipped.length} skipped, ${failed.length} failed` +
      (dry ? `  ${c.dim("(--dry-run: nothing written)")}` : "") +
      `\n\n  ${c.dim("next: foldrun check " + workspace)}\n`,
  );
  return failed.length ? 1 : 0;
}

/**
 * The library a signed-in developer's workspace will actually resolve
 * against lives on the platform, not on this laptop. Without this, check
 * reported `tools: [site_repo]` missing for a tool that runs fine on every
 * deploy — the first red result a developer saw on a working desk. Read only
 * the names; an unreachable platform is a warning, not a failed check.
 */
async function platformLibrary(flags) {
  const url = flags.local === true ? undefined : remoteUrl(flags);
  if (!url) return { url: undefined, tools: new Set(), skills: new Set(), warning: null };
  let token;
  try {
    token = tokenFor(url, { ...flags, quiet: true });
  } catch {
    return { url, tools: new Set(), skills: new Set(), warning: `${url} is the platform but this machine is not signed in — library tools there cannot be seen` };
  }
  const names = async (kind) => {
    const res = await fetch(new URL(`/api/library/${kind}`, url), {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`/api/library/${kind} → HTTP ${res.status}`);
    const body = /** @type {any} */ (await res.json());
    return new Set((body.entries ?? []).map((e) => e.name).filter(Boolean));
  };
  try {
    const [tools, skills] = await Promise.all([names("tools"), names("skills")]);
    return { url, tools, skills, warning: null };
  } catch (err) {
    return { url, tools: new Set(), skills: new Set(), warning: `could not read the library on ${url} (${err instanceof Error ? err.message : err}) — tools defined there will be reported missing` };
  }
}

/**
 * `foldrun check` at an account root: every workspace under it, then the
 * library they all share.
 *
 * One workspace at a time, with FOLDRUN_WORKSPACE repointed between them —
 * the core resolves every path late, on purpose, so this works and a cached
 * module cannot make the second workspace read the first one's files.
 */
async function checkAccount(layout, flags) {
  const { readLibraryTree, LIBRARY_KINDS } = await core();
  let worst = 0;
  if (!layout.workspaces.length) {
    console.log(`\n  ${c.amber("!")} no workspaces in ${layout.accountRoot} — \`foldrun new <name>\` makes one\n`);
    return 1;
  }
  for (const name of layout.workspaces) {
    const dir = path.join(layout.workspacesDir, name);
    process.env.FOLDRUN_WORKSPACE = dir;
    console.log(`\n  ${c.bold(name)}  ${c.dim(path.relative(layout.accountRoot, dir))}`);
    worst = Math.max(worst, (await check(dir, flags)) ?? 0);
  }

  // The library, once — it is one thing however many workspaces read it.
  const files = readLibraryTree(layout.accountRoot);
  const problems = [];
  const note = (level, where, message) => problems.push({ level, where, message });
  validateSkills(path.join(layout.accountRoot, "library"), note);
  const counts = LIBRARY_KINDS.map((k) => ({ kind: k, n: files.filter((f) => f.kind === k).length })).filter((x) => x.n > 0);
  console.log(`\n  ${c.bold("library")}  ${c.dim(counts.length ? counts.map((x) => `${x.n} ${x.kind}`).join(" · ") : "empty")}`);
  for (const p of problems) {
    console.log(`    ${p.level === "error" ? c.red("✗") : c.amber("!")} ${c.bold(`library/${p.where}`)}  ${p.message}`);
  }
  if (problems.some((p) => p.level === "error")) worst = 1;
  console.log();
  return worst;
}

async function check(workspace, flags = {}) {
  const {
    listAgents, listFlows, readBundle, conformanceIssues, dateIssues, listEvals, lintFlow,
    workspaceTools, libraryTools, checkFormatVersion, missingToolPrograms, discoverSkills,
    libraryDir,
  } = await core();
  const T = "default";
  const P = "workspace";
  const problems = [];
  // file:line, like every other linter — so an editor can jump to it and CI
  // can annotate the right row.
  const note = (level, where, message, line) =>
    problems.push({ level, where: line ? `${where}:${line}` : where, message });

  const agents = listAgents(T, P);
  const flows = listFlows(T, P);
  const evals = listEvals(T, P);
  const tools = workspaceTools(T, P);
  // What `tools:` can actually name of your own. The runtime resolves nearest-wins across
  // both scopes, so a checker that only looked at the workspace called a
  // working agent broken — an error, in CI, for an account library tool that
  // runs fine. Mirror the runtime exactly; the summary still counts what this
  // workspace itself defines.
  const usable = { ...libraryTools(T), ...tools };
  const platform = await platformLibrary(flags);
  if (platform.warning) note("warn", "library", platform.warning);
  const agentNames = new Set(agents.map((a) => a.name));
  const imported = importedAgentNames(workspace, agentNames);
  for (const n of imported) agentNames.add(n);
  const flowNames = new Set(flows.map((f) => f.name));
  // Which agents can act outside this workspace: any that grants a tool whose
  // definition says `outward: true`. Worked out here, where the grants and the
  // tool files are already resolved, so the flow lint only needs the answer.
  const outwardAgents = agents
    .filter((a) => (a.ownTools ?? []).some((t) => usable[t]?.outward === true))
    .map((a) => a.name);
  // Every skill name in scope, found the way the runtime finds them — the
  // agent's own, the workspace's, the cross-client .agents/skills/, and the
  // account library. Discovery comes from core so this cannot drift from
  // what a run actually loads.
  const skillNames = new Set();
  for (const base of [workspace, libraryDir(T)]) {
    for (const sub of ["skills", ".agents/skills"]) {
      for (const s of discoverSkills(base, sub)) skillNames.add(s.name);
    }
  }
  for (const a of agents) {
    for (const s of discoverSkills(path.join(workspace, "agents", a.name))) skillNames.add(s.name);
  }
  for (const s of platform.skills) skillNames.add(s);

  if (agentNames.size === 0) note("error", "agents/", "no agents — a workspace needs at least one");

  // What format does this workspace target?
  const agentsMd = path.join(workspace, "AGENTS.md");
  if (fs.existsSync(agentsMd)) {
    const m = fs.readFileSync(agentsMd, "utf8").match(/^foldrun_version:\s*["']?([\d.]+)/m);
    const { warning } = checkFormatVersion(m?.[1]);
    if (warning) note("warn", "AGENTS.md", warning);
  }

  for (const a of agents) {
    if (!a.description) note("warn", `agents/${a.name}`, "no description — other agents and people read it");

    // A timezone nobody can read. The deploy already refuses it; check has to
    // refuse it here, or the first anyone hears of it is a push that bounces.
    if (a.timezoneProblem) {
      // The sentence already names the value it could not read.
      note("error", `agents/${a.name}`, a.timezoneProblem);
    }

    // A web_search:, web_fetch: or web_browse: value that cannot work —
    // DeepSeek named for search, a search API named for fetch, a key
    // written into the file. The run would say so in its trail and carry
    // on; the deploy refuses it; this is where a person hears it first.
    for (const w of a.webProblems ?? []) note("error", `agents/${a.name}`, w);
    // `language:` that is not a tag — "Persian" where `fa` was meant.
    if (a.languageProblem) note("error", `agents/${a.name}`, a.languageProblem);
    // `region: Australia` where `au` was meant, `currency: dollars`, `units: both`.
    for (const w of a.localeProblems ?? []) note("error", `agents/${a.name}`, w);

    // What the author wrote that the runtime already writes, or writes better.
    // Every trap here was one somebody hit while the answer sat in the source:
    // check reads the whole folder anyway, so it may as well teach.
    try {
      const body = fs.readFileSync(path.join(workspace, "agents", a.name, "agent.md"), "utf8");

      // The runtime appends a "# Where you are" section to every prompt saying
      // the working directory is agents/<name>/ and ../../ is the workspace
      // root. An agent that says it again spends its opening paragraph on
      // something the platform guarantees.
      if (/your working directory is|two levels up|\.\.\/\.\.\/` is the workspace/i.test(body)) {
        note(
          "warn",
          `agents/${a.name}`,
          'explains where it is — the runtime already appends a "Where you are" section saying this; the paragraph is safe to delete',
        );
      }

      // `[[link]]` what you READ, spell out what you WRITE. A path that exists
      // is something to read, and a link to it cannot rot when the file is
      // renamed; a path that does not exist yet is an output destination and
      // is correctly literal. So the test is simply whether the file is there.
      const said = new Set(); // one path, one lesson, however often it appears
      for (const m of body.matchAll(/\.\.\/\.\.\/(state|knowledge|memory|storage)\/([^\s`'")]+)/g)) {
        const rel = `${m[1]}/${m[2]}`;
        if (said.has(rel)) continue;
        said.add(rel);
        if (!fs.existsSync(path.join(workspace, rel))) continue; // a destination, not a reference
        const bare = path.basename(m[2]).replace(/\.md$/, "");
        note("warn", `agents/${a.name}`, `reads \`../../${rel}\` — \`[[${bare}]]\` resolves to it and survives a rename`);
      }
    } catch {
      // an unreadable agent.md is already reported by the loader
    }

    for (const t of a.ownTools) {
      if (usable[t]) continue;
      if (platform.tools.has(t)) {
        // Resolves on the platform's library and nowhere on this machine:
        // fine at run time, worth one line so nobody looks for the file.
        note("info", `agents/${a.name}`, `tools: [${t}] — from the library on ${platform.url}`);
        continue;
      }
      const hint = platform.url
        ? `in this workspace, the local account library, or the library on ${platform.url}`
        : "in this workspace or the account library (a library on a platform is seen when signed in: `foldrun login`, or --url)";
      note("error", `agents/${a.name}`, `tools: [${t}] — no tools/${t}/tool.md or tools/${t}.md ${hint}`);
    }
    // A colleague that does not exist is not a consult tool the agent is
    // missing — it is one it will never be told about, on a run that looks
    // fine. Same shape as a tool that names nothing.
    for (const c of a.consults) {
      if (!agentNames.has(c)) {
        note("error", `agents/${a.name}`, `agents: [${c}] — no such agent in this workspace`);
      } else if (c === a.name) {
        note("warn", `agents/${a.name}`, `agents: [${c}] — an agent consulting itself; the call is refused at run time`);
      }
    }

    // `skills:` present is an allowlist. A name that matches nothing silently
    // withholds a skill the author believed was loaded — and an empty list
    // withholds every one of them, which is legal but worth saying out loud.
    if (a.skills !== null) {
      if (a.skills.length === 0) {
        note("warn", `agents/${a.name}`, "skills: [] withholds every skill — omit the field to inherit them");
      }
      for (const s of a.skills) {
        if (!skillNames.has(s)) {
          note("error", `agents/${a.name}`, `skills: [${s}] — no skill of that name in this agent, the workspace or the library`);
        }
      }
    }

    // `use:` is gone. Nothing under it is granted, so say the exact line to
    // write rather than letting the run discover the missing tool.
    if (a.legacyUse.length) {
      note(
        "error",
        `agents/${a.name}`,
        `\`use: [${a.legacyUse.join(", ")}]\` is no longer read — move these into \`tools:\` (node scripts/migrate-use-to-tools.mjs . rewrites every agent)`,
      );
    }
  }

  // A script tool whose `run:` resolves to nothing parses, counts, and is
  // offered to the agent — then fails inside a turn. Checking it here is the
  // difference between a typo found in CI and a flow that quietly stops
  // using one of its tools. Resolution comes from core, so this agrees with
  // the runner by construction rather than by maintenance.
  for (const m of missingToolPrograms(T, P)) {
    note(
      "error",
      m.scope === "account" ? `library/tools/${m.name}` : `tools/${m.name}`,
      `run: ${m.run} — no such file (looked for ${m.looked})`,
    );
  }

  validateSkills(workspace, note);

  for (const f of flows) {
    if (f.steps.length === 0) note("error", `flows/${f.file}`, "no steps");
    for (const s of f.steps) {
      const target = s.subflow ?? s.agent;
      const known = s.subflow ? flowNames.has(target) : agentNames.has(target);
      if (!known) {
        note("error", `flows/${f.file}`, `[[${s.subflow ? "flow:" : ""}${target}]] does not exist`, s.line);
      }
    }
    for (const w of lintFlow(f, { agents: [...agentNames], outwardAgents })) note(w.level ?? "warn", `flows/${f.file}`, w.message, w.line);
  }

  for (const e of evals) {
    const target = e.flow ?? e.agent;
    if (!target) note("error", `evals/${e.file}`, "names neither an agent nor a flow");
    else if (!(e.flow ? flowNames.has(target) : agentNames.has(target))) {
      note("error", `evals/${e.file}`, `${e.flow ? "flow" : "agent"} "${target}" does not exist`);
    }
    if (e.cases.length === 0) note("warn", `evals/${e.file}`, "no cases");
  }

  // A document's kind is its path, so nothing here declares one. Two older
  // spellings may still be sitting in files and both are dead weight rather
  // than errors: `kind: Agent` (ours, now redundant) and `type: Agent` (ours,
  // back when it lived in OKF's field). The second is worth naming — an OKF
  // consumer reading this repo would file that agent as a knowledge concept.
  for (const [rel, noun] of documentTypes(workspace)) {
    const front = readFrontmatter(path.join(workspace, rel));
    if (front === null) continue;
    const asType = /^type:\s*(.+)$/m.exec(front)?.[1].trim();
    const asKind = /^kind:\s*(.+)$/m.exec(front)?.[1].trim();

    if (asKind === noun) {
      note("warn", rel, `\`kind: ${noun}\` is no longer read — the path says it; safe to delete`);
    }
    if (asType === noun) {
      note("warn", rel, `\`type: ${noun}\` is OKF's field — delete it, the path says what this is`);
    } else if (asType && rel.startsWith("tools/") && TRANSPORTS.has(asType.toLowerCase())) {
      note("warn", rel, `\`type: ${asType}\` is the old spelling — use \`transport: ${asType}\``);
    }
  }

  // Knowledge and memory are OKF bundles. The conformance rule lives in
  // conformanceIssues() rather than here: this was a second copy of it, and it
  // asked readBundle — which hides the files we present as indexes — so it
  // agreed the bundle was fine while an outside validator would not.
  for (const kind of ["knowledge", "memory"]) {
    for (const dir of bundleDirs(workspace, kind)) {
      const where = path.relative(workspace, dir);
      for (const { file, issue } of conformanceIssues(dir)) {
        note("error", `${where}/${file}`, issue);
      }
      // A warning, not an error: the bundle is still conformant — the spec says
      // nothing about a date's shape — but the value cannot be compared, so
      // staleness and "most recently verified" would quietly use it wrong.
      for (const { file, field, value } of dateIssues(dir)) {
        note(
          "warn",
          `${where}/${file}`,
          `${field}: "${value}" is not a date — use YYYY-MM-DD or an ISO 8601 datetime. ` +
            `It has been ignored rather than compared.`,
        );
      }
      for (const doc of readBundle(dir)) {
        if (doc.stale) {
          note("warn", `${where}/${doc.file}`, `stale since ${doc.staleAfter}`);
        }
      }
    }
  }

  const errors = problems.filter((p) => p.level === "error");
  const warnings = problems.filter((p) => p.level === "warn");

  console.log("");
  for (const p of problems) {
    const tag = p.level === "error" ? c.red("error") : p.level === "warn" ? c.amber(" warn") : c.dim(" info");
    console.log(`  ${tag}  ${c.bold(p.where)}  ${p.message}`);
  }
  const summary = `${agentNames.size} agents · ${flows.length} flows · ${evals.length} evals · ${Object.keys(tools).length} tools`;
  console.log(
    errors.length === 0 && warnings.length === 0
      ? `  ${c.green("✓")} ${summary} — no problems\n`
      : `\n  ${summary} · ${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}\n`,
  );
  return errors.length ? 1 : 0;
}

/** Transports a pre-v0.1 tool could put in `type:`. */
const TRANSPORTS = new Set(["http", "script", "mcp"]);

/** Frontmatter block of a file, or null if it has none. */
function readFrontmatter(file) {
  if (!fs.existsSync(file)) return null;
  return /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(file, "utf8"))?.[1] ?? null;
}

/**
 * Every document in the workspace paired with the `type:` it should declare.
 * Mirrors KINDS — the CLI can't import the TypeScript core, so this is the one
 * place the table is restated, and SPEC.md is the contract between them.
 */
/** Every structural document, paired with the noun it *is* — used only to
 *  recognise a leftover declaration of it, never to require one. */
function documentTypes(workspace) {
  const out = [];
  const add = (rel, type) => fs.existsSync(path.join(workspace, rel)) && out.push([rel, type]);

  for (const agent of ls(path.join(workspace, "agents"))) {
    add(`agents/${agent}/agent.md`, "Agent");
    for (const skill of ls(path.join(workspace, `agents/${agent}/skills`))) {
      add(`agents/${agent}/skills/${skill}/SKILL.md`, "Skill");
    }
  }
  for (const [dir, type] of [["flows", "Flow"], ["evals", "Eval"], ["tools", "Tool"]]) {
    for (const f of ls(path.join(workspace, dir))) if (f.endsWith(".md")) add(`${dir}/${f}`, type);
  }
  for (const skill of ls(path.join(workspace, "skills"))) add(`skills/${skill}/SKILL.md`, "Skill");
  return out;
}

/** Directory entries, or nothing if the directory isn't there. */
function ls(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

function bundleDirs(workspace, kind) {
  const out = [];
  const top = path.join(workspace, kind);
  if (fs.existsSync(top)) out.push(top);
  const agentsDir = path.join(workspace, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const a of fs.readdirSync(agentsDir)) {
      const d = path.join(agentsDir, a, kind);
      if (fs.existsSync(d)) out.push(d);
    }
  }
  return out;
}

// ---------------------------------------------------------------- run

// An API key, and only that. A claude.ai login on this machine is not a
// credential foldrun may run on: Anthropic does not allow products built on
// its Agent SDK to use claude.ai subscriptions, so the CLI neither looks
// for one nor suggests it. An agent that names its own `provider:` needs
// no Anthropic key at all — that is checked where the agent is read.
function assertCredentials() {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return;
  throw new Error(
    "no credentials — set ANTHROPIC_API_KEY (an API key from console.anthropic.com),\n" +
      "  or give the agent its own `provider:`. `foldrun check` works without either.",
  );
}

async function runTarget(target, flags) {
  if (!target) throw new Error("what should I run? try `foldrun run <agent>` or `foldrun run <flow>`");
  assertCredentials();
  const { startFlowRun, loadFlow, listAgents, readRun } = await core();
  const T = "default";
  const P = "workspace";
  const name = target.replace(/^flow:/, "");
  const asFlow = target.startsWith("flow:") || !listAgents(T, P).some((a) => a.name === name);

  // --test: a test run. Locally there is no egress proxy, so what holds is
  // the runner's own half of it — send-capable secrets are withheld from
  // scripts, FOLDRUN_TEST_MODE=1 is set, and state/ and storage/ writes
  // are moved under runs/<id>/test-writes/ after each step.
  const opts = flags.test === true ? { test: true } : {};
  let run;
  if (asFlow) {
    const flow = loadFlow(T, P, name);
    if (!flow) throw new Error(`no agent or flow called "${name}"`);
    const steps = flags.task
      ? flow.steps.map((s, i) =>
          i === 0 ? { ...s, instruction: `${s.instruction}\n\n<run_task>\n${flags.task}\n</run_task>` } : s,
        )
      : flow.steps;
    run = startFlowRun(T, P, steps, flow.name, flow.model, [], null, null, opts);
  } else {
    run = startFlowRun(T, P, [{ agent: name, instruction: flags.task ?? "", group: 1, optional: false }], `cli:${name}`, null, [], null, null, opts);
  }

  console.log(`\n  ${c.bold(run.flow)}  ${c.dim(run.id)}${run.test ? `  ${c.amber("TEST")}` : ""}\n`);
  const seen = new Map();
  const open = new Map();
  for (;;) {
    const current = readRun(T, P, run.id);
    if (!current) break;
    printNew(current, seen, open);
    if (current.finishedAt) {
      flushCalls(open);
      const cost = current.steps.reduce((s, x) => s + (x.costUsd ?? 0), 0);
      const ok = current.status === "completed";
      console.log(
        `\n  ${ok ? c.green("✓") : c.red("✗")} ${current.status} · $${cost.toFixed(4)}\n`,
      );
      return ok ? 0 : 1;
    }
    if (current.status === "awaiting-approval") {
      flushCalls(open);
      console.log(`\n  ${c.amber("paused")} — this flow needs a human. Approve it in the dashboard.\n`);
      return 2;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return 1;
}

// ---------------------------------------------------------------- probe

/**
 * `foldrun probe <model>` — can this model hold a tool loop, answered by
 * running one. The workspace's provider block is honoured, so the probe
 * exercises the exact path a run takes: same endpoint, same token, same
 * tier remap. The check the run-start gate makes from a catalogue, made
 * from the ground truth instead.
 */
async function probeCmd(modelArg) {
  if (!modelArg) throw new Error("which model? try `foldrun probe openai/gpt-oss-120b` (or a tier: fast, default, max)");
  assertCredentials();
  const { probeModel, resolveModel, parseProvider, providerEnvFor, resolveEffort, translatorSpecFor, startTranslator, providerPreset, readFrontmatter } = await core();

  // The workspace's provider block, resolved the way a run resolves it —
  // ${SECRET} values come from the process env here: the CLI's vault is the
  // shell, which is where a laptop keeps its keys anyway. A Chat-Completions
  // provider gets the same translator a run would, on loopback, for the
  // length of the probe — so what passes here passes there.
  let env = { ...process.env };
  let translator = null;
  // No AGENTS.md, or no provider block, means Anthropic direct — like a run.
  // Anything else that goes wrong here is said, not swallowed: a provider
  // block that is silently ignored sends the probe to the wrong endpoint
  // and reports a model that "may not exist".
  const agentsFile = path.join(process.cwd(), "AGENTS.md");
  try {
    const fm = fs.existsSync(agentsFile) ? readFrontmatter(agentsFile) : {};
    const spec = fm.provider ? parseProvider(fm.provider) : null;
    for (const w of spec?.warnings ?? []) console.log(`  ${c.yellow("!")} ${w}`);
    if (spec?.baseUrl) {
      const substitute = (t) => t.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (whole, name) => process.env[name] ?? whole);
      const token = substitute(spec.token);
      const headers = Object.fromEntries(Object.entries(spec.headers).map(([k, v]) => [k, substitute(v)]));
      env = { ...env, ...providerEnvFor({ baseUrl: spec.baseUrl, token, auth: spec.auth, models: spec.models, headers }) };
      const preset = providerPreset(spec.name);
      const tSpec = translatorSpecFor({
        format: spec.format,
        baseUrl: spec.baseUrl,
        token,
        headers,
        params: spec.params,
        name: spec.name,
        maxTokensParam: preset?.maxTokensParam,
        reasoningEffort: preset?.reasoningEffort,
      });
      if (tSpec) {
        translator = await startTranslator(tSpec);
        env = { ...env, ...translator.env };
      }
      console.log(`
  ${c.dim(`via ${spec.name ? `${spec.name} ` : ""}${spec.baseUrl}${tSpec ? " (through the translator)" : ""}`)}`);
    }
  } catch (err) {
    console.log(`  ${c.yellow("!")} provider block not applied: ${err instanceof Error ? err.message : String(err)}`);
  }

  const model = resolveModel(modelArg);
  process.stdout.write(`  probing ${c.bold(model)} ${c.dim("(one tool call, one echo)")} … `);
  let report;
  try {
    report = await probeModel(model, env, resolveEffort(null));
  } finally {
    if (translator) {
      for (const line of translator.drainLog()) console.log(`    ${c.dim(line)}`);
      await translator.close();
    }
  }
  console.log(report.ok ? c.green("✓") : c.red("✗"));
  console.log(`    tool call made      ${report.calledTool ? c.green("yes") : c.red("no")}`);
  console.log(`    result read back    ${report.echoedNonce ? c.green("yes") : c.red("no")}`);
  console.log(`    ${c.dim(`${report.durationMs}ms${report.costUsd != null ? ` · $${report.costUsd.toFixed(4)}` : ""}`)}`);
  if (!report.ok && report.reply) {
    console.log(`    ${c.dim("reply:")} ${report.reply.slice(0, 200)}`);
  }
  if (!report.ok) {
    console.log(`
  ${c.amber("this model cannot drive an agent here — pick one that passes, or check the gateway route")}\n`);
  } else {
    console.log(`
  ${c.green("fit to drive an agent")}\n`);
  }
  return report.ok ? 0 : 1;
}

// ---------------------------------------------------------------- eval

async function runEvals(name) {
  assertCredentials();
  const { listEvals, runEval } = await core();
  const T = "default";
  const P = "workspace";
  const all = listEvals(T, P).filter((e) => !name || e.name === name);
  if (all.length === 0) throw new Error(name ? `no eval called "${name}"` : "no evals in evals/");

  let failed = 0;
  for (const info of all) {
    console.log(`\n  ${c.bold(info.name)} ${c.dim(`${info.cases.length} cases`)}`);
    const result = await runEval(T, P, info);
    for (const testCase of result.cases) {
      console.log(`  ${testCase.passed ? c.green("✓") : c.red("✗")} ${testCase.name}`);
      for (const a of testCase.assertions.filter((x) => !x.passed)) {
        console.log(`      ${c.dim(`${a.assertion.type}: ${a.assertion.value}`)} — ${a.detail.split("\n")[0]}`);
      }
      if (testCase.error) console.log(`      ${c.red(testCase.error)}`);
    }
    failed += result.failed;
    console.log(`  ${result.passed}/${result.passed + result.failed} passing · $${result.costUsd.toFixed(4)}`);
  }
  console.log("");
  return failed ? 1 : 0;
}

// ----------------------------------------------------------------


// ---------------------------------------------------------------- deploy

/**
 * Push a directory of markdown into an installation's workspace.
 *
 * The whole point of a markdown platform: there is no build, so deploying is
 * making the files match the source. What earns a command rather than a `cp`
 * is what surrounds the copy — the workspace is checked before any of it is
 * live, and the swap is refused while a run is reading the files.
 */
/**
 * The same deploy, against a running platform.
 *
 * Returns the same shape the local path does, so the reporting below does not
 * have to know which one it was — a deploy that is refused over HTTP should
 * read exactly like one refused on disk.
 */
async function deployOverHttp(url, workspace, files, flags) {
  const token = tokenFor(url, flags);
  const endpoint = `${url.replace(/\/+$/, "")}/api/workspaces/${encodeURIComponent(workspace)}/deploy`;

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": USER_AGENT },
      body: JSON.stringify({
        files,
        commit: flags.commit ?? null,
        force: flags.force === true,
        dryRun: flags["dry-run"] === true,
      }),
    });
  } catch (err) {
    throw new Error(`could not reach ${url} — ${err instanceof Error ? err.message : String(err)}`);
  }

  const body = /** @type {any} */ (await res.json().catch(() => ({})));
  if (res.status === 401) throw new Error(`${body.error ?? "unauthorized"} — run \`foldrun login\` again, or check FOLDRUN_TOKEN`);
  // 422 is a refusal the caller has to read, not a transport failure: the
  // issues are in the body and reported like any other refused deploy.
  if (!res.ok && res.status !== 422) {
    throw new Error(body.error ?? `${url} returned ${res.status}`);
  }

  return {
    added: body.added ?? [],
    updated: body.updated ?? [],
    removed: body.removed ?? [],
    issues: body.issues ?? [],
    blockedBy: body.blockedBy ?? [],
    preserved: body.preserved ?? 0,
    commit: body.commit ?? null,
  };
}

/**
 * `foldrun deploy [dir|workspace]`.
 *
 * At an account root that is the whole account: every workspace under it and
 * the shared library. Named a workspace, it is that one. Given a directory, it
 * is whatever that directory turns out to be — which is how a flat workspace,
 * the only shape that existed until today, still deploys exactly as it did.
 */
async function deploy(source, flags, layout) {
  const { detectLayout } = await core();
  let only;
  if (source && source !== "." && !fs.existsSync(source)) {
    if (layout.workspaces.includes(source)) only = source;
    else throw new Error(`no such directory: ${source}`);
  } else if (source && source !== "." && fs.existsSync(source)) {
    layout = detectLayout(path.resolve(source));
  }
  return deployAccount(layout, flags, only);
}

// ---------------------------------------------------------------- secrets

/** Read a value without echoing it. A secret typed into a terminal should
 *  not sit in the scrollback afterwards. */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    const { stdin } = process;
    if (!stdin.isTTY) {
      // Piped input (echo "$VALUE" | foldrun secrets set NAME) — read a line.
      let buf = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (d) => (buf += d));
      stdin.on("end", () => resolve(buf.replace(/\n$/, "")));
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch) => {
      if (ch === "\u0003") {
        cleanup();
        reject(new Error("cancelled"));
      } else if (ch === "\r" || ch === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(value);
      } else if (ch === "\u007f" || ch === "\b") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };
    stdin.on("data", onData);
  });
}

/** Read a line with normal echo — for the non-secret halves of a config. */
function promptVisible(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const { stdin } = process;
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.once("data", (line) => {
      stdin.pause();
      resolve(String(line).replace(/\r?\n$/, ""));
    });
  });
}

/**
 * Which platform, and with what.
 *
 * URL: --url, then FOLDRUN_URL, then whatever `foldrun login` last signed in
 * to. Token: --token, then FOLDRUN_TOKEN, then the key stored for that URL.
 * The environment beats the file on purpose — a CI job with FOLDRUN_TOKEN
 * set never reads a laptop's credentials, and a person who exports a token
 * to test as someone else gets exactly that.
 */
// An empty variable is an unset one: `export FOLDRUN_TOKEN=` in a profile
// should not shadow the credentials file with nothing.
const env = (name) => process.env[name] || undefined;

/**
 * The profile a command acts as. In order: --profile by name; else, when a
 * URL is named (--url, FOLDRUN_URL), the current profile if it is on that
 * URL, else the one profile there, else a refusal that lists them; else the
 * current profile.
 *
 * It was "the newest login on that URL", which meant `foldrun whoami --url
 * https://dev.foldrun.io` acted as a different account from the bare
 * `foldrun whoami` on a machine with two customers on one platform — the
 * same command, two accounts, and nothing on screen to say so.
 */
function chosenProfile(flags) {
  if (typeof flags.profile === "string") {
    const p = profileByName(flags.profile);
    if (!p) {
      const names = listProfiles().map((x) => x.name);
      throw new Error(`no profile called "${flags.profile}"${names.length ? ` — try ${names.join(", ")}` : " — sign in with `foldrun login`"}`);
    }
    return p;
  }
  const current = currentProfile();
  const url = typeof flags.url === "string" ? flags.url : env("FOLDRUN_URL");
  if (!url) return current;
  let key;
  try {
    key = normaliseUrl(url);
  } catch {
    return null;
  }
  if (current && normaliseUrl(current.url) === key) return current;
  const here = listProfiles().filter((p) => normaliseUrl(p.url) === key);
  if (here.length <= 1) return here[0] ?? null;
  throw new Error(
    `${here.length} accounts are signed in to ${key} (${here.map((p) => p.name).join(", ")}) and none of them is the current one — say which: --profile <name> for this command, or \`foldrun use <name>\``,
  );
}

/**
 * Which account this command is acting as, said once, dim, on stderr —
 * stderr so `foldrun source cat … > file` stays a file. The same shape as
 * a row of `foldrun accounts`, so the two read as one thing.
 */
let announced = false;
function announce(url, flags) {
  if (announced || flags.quiet === true) return;
  announced = true;
  const line = actingAs(url, flags);
  if (line) console.error(`  ${c.dim(line)}`);
}

/** "acting as <name>  <account> · <role> · <email> · <url>", or the --token / FOLDRUN_TOKEN form. */
function actingAs(url, flags) {
  if (typeof flags.token === "string") return `acting with --token · ${url}`;
  if (env("FOLDRUN_TOKEN")) return `acting with FOLDRUN_TOKEN · ${url}`;
  const p = chosenProfile(flags);
  return p ? `acting as ${p.name}  ${p.account} · ${p.role ?? "?"} · ${p.email ?? "api key"} · ${p.url}` : null;
}

/**
 * What to add to a 401/403: which credential was refused. Without it a
 * `logs --url` that fails on a machine with three accounts says
 * "forbidden" and leaves the reader to guess which key was sent.
 */
function refusedHint(url, flags) {
  const who = actingAs(url, flags);
  return who ? ` — ${who}; \`foldrun accounts\` lists the others, --profile <name> picks one` : " — `foldrun login` signs this machine in";
}

const remoteUrl = (flags) =>
  (typeof flags.profile === "string" ? chosenProfile(flags)?.url : undefined) ??
  flags.url ?? env("FOLDRUN_URL") ?? defaultPlatform() ?? undefined;

const NOT_SIGNED_IN = "not signed in — run `foldrun login`, or set FOLDRUN_TOKEN / pass --token";

function tokenFor(url, flags) {
  // --token and the environment win, always: a CI job with a key in the
  // environment must never read a file, whatever is stored in it.
  const token = flags.token ?? env("FOLDRUN_TOKEN") ?? chosenProfile(flags)?.token;
  if (!token) throw new Error(NOT_SIGNED_IN);
  announce(url, flags);
  return token;
}

// ---------------------------------------------------------------- the HTTP client

/** This CLI's version, so a platform's logs can tell which CLI called. */
const CLI_VERSION = (() => {
  try {
    return String(JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "0");
  } catch {
    return "0";
  }
})();
const USER_AGENT = `foldrun-cli/${CLI_VERSION}`;

/**
 * A clock the caller asked for, in seconds, or undefined.
 *
 * `--timeout` first, then FOLDRUN_TIMEOUT. Separated from the default so a
 * command that needs a longer one by nature — `tool test`, where the tool
 * itself may take minutes — can raise its own floor without overriding
 * somebody who said what they wanted.
 */
function explicitTimeout(flags = {}) {
  for (const raw of [flags.timeout, env("FOLDRUN_TIMEOUT")]) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/** How long one request may take, in seconds: --timeout, FOLDRUN_TIMEOUT, else 30. */
function timeoutSeconds(flags = {}) {
  return explicitTimeout(flags) ?? 30;
}

/**
 * Every message on the way down, joined. "fetch failed" on its own says
 * nothing; the ECONNREFUSED / ENOTFOUND / connect timeout that explains it
 * sits in err.cause, where undici puts it and where nothing printed from —
 * so `foldrun whoami` against a stopped box said "fetch failed" and no more.
 * @param {unknown} err
 */
export function explain(err) {
  const parts = [];
  const seen = new Set();
  for (let e = /** @type {any} */ (err); e != null && !seen.has(e); e = e.cause) {
    seen.add(e);
    // undici tries every address and hands back an AggregateError with an
    // empty message; the first member is the one worth reading.
    if (e instanceof AggregateError && !e.message && e.errors?.length) {
      parts.push(explain(e.errors[0]));
      continue;
    }
    const msg = e instanceof Error ? e.message : String(e);
    const code = typeof e.code === "string" && !msg.includes(e.code) ? ` (${e.code})` : "";
    parts.push(`${msg}${code}`);
  }
  return parts.join(": ");
}

/** A failed call: the status and whatever the platform said, kept on the error. */
export class HttpError extends Error {
  /** @param {string} message @param {number} status @param {any} body */
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const RETRY_STATUS = new Set([429, 502, 503, 504]);

/** Retry-After as milliseconds — seconds or an HTTP date — else one second, never past the timeout. */
function retryAfterMs(res, seconds) {
  const h = res.headers.get("retry-after");
  let ms = 1000;
  if (h && /^\d+$/.test(h.trim())) ms = Number(h) * 1000;
  else if (h && !Number.isNaN(Date.parse(h))) ms = Date.parse(h) - Date.now();
  return Math.min(Math.max(ms, 0), seconds * 1000);
}

/**
 * One request to a platform: the auth header, a User-Agent, and a clock.
 *
 * Without the clock a box that accepts the TCP connection and never answers
 * held the terminal for as long as the kernel allowed. A GET that meets a
 * 429/502/503/504 is asked once more, after Retry-After when the server
 * names one — a rolling deploy or a rate limit deserves the nudge. Nothing
 * else is retried: a second POST could be a second run.
 * @param {string} url @param {string} apiPath @param {RequestInit} [init]
 * @param {{ token?: string, seconds?: number }} [opts]
 */
async function remoteFetch(url, apiPath, init = {}, { token, seconds: given } = {}) {
  const target = new URL(apiPath, url);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = {
    "user-agent": USER_AGENT,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(init.headers ?? {}),
  };
  const seconds = given ?? timeoutSeconds();
  const attempt = async () => {
    try {
      return await fetch(target, { ...init, headers, signal: AbortSignal.timeout(seconds * 1000) });
    } catch (err) {
      const name = /** @type {any} */ (err)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(`${target.host} did not answer ${method} ${target.pathname} within ${seconds}s — FOLDRUN_TIMEOUT=<seconds> allows longer`);
      }
      throw new Error(`could not reach ${target.origin}`, { cause: err });
    }
  };
  let res = await attempt();
  if (method === "GET" && RETRY_STATUS.has(res.status)) {
    await sleep(retryAfterMs(res, seconds));
    res = await attempt();
  }
  return res;
}

/**
 * A call to the platform's API, as JSON. A body that is not JSON is not the
 * platform talking — a Cloudflare challenge, a proxy's error page, a tunnel
 * that is down — and used to be read as {} and reported as a bare "HTTP
 * 403". Now the status, the content-type and the first line say so.
 * @param {string} url @param {Record<string, any>} flags @param {string} apiPath @param {RequestInit} [init]
 * @param {{ seconds?: number }} [opts]
 * @returns {Promise<any>}
 */
async function remoteCall(url, flags, apiPath, init = {}, { seconds } = {}) {
  const token = tokenFor(url, flags);
  const res = await remoteFetch(
    url,
    apiPath,
    { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } },
    { token, seconds: seconds ?? timeoutSeconds(flags) },
  );
  const text = await res.text();
  let body;
  try {
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    if (res.ok) return {};
    const type = (res.headers.get("content-type") ?? "unknown type").split(";")[0].trim();
    const title = text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    const line = title || text.split("\n").map((l) => l.trim()).find(Boolean) || "";
    throw new HttpError(`${apiPath} → HTTP ${res.status} (${type})${line ? `: ${line.slice(0, 160)}` : ""} — not the platform's answer; is ${new URL(url).host} the right address, and is it up?`, res.status, {});
  }
  if (!res.ok) {
    // The body is the useful half of a failure and throwing it away is how a
    // failed RUN comes to look like a broken PLATFORM. `?wait=true` answers a
    // run that failed with 500 and a full record of why — status, steps, the
    // agent's last words — and a caller that prints only "HTTP 500" sends the
    // reader hunting for an outage that never happened.
    const hint = res.status === 401 || res.status === 403 ? refusedHint(url, flags) : "";
    throw new HttpError(`${body.error ?? `${apiPath} → HTTP ${res.status}`}${hint}`, res.status, body);
  }
  return body;
}

/** The glyph an event leads with: a fault, a tool, or a plain line. */
const EVENT_MARK = (e) =>
  e.type === "error" ? c.red("✗") : e.type === "tool" ? c.dim("→") : c.dim("·");

/** An event's first physical line, clipped to fit a terminal row. */
const clipLine = (text) => text.split("\n")[0].slice(0, 140);

/**
 * One console line for one event — or null when the event is held back.
 *
 * A tool call reaches us as two events sharing a `call` id: a start, then a
 * completion carrying `ms`. Printing both is why every call showed up twice.
 * So the start is recorded in `open` and prints nothing; the completion
 * prints the single line, with the duration the start could not yet know.
 * A start whose completion never lands — the stream ended mid-call — is
 * printed later by flushCalls. Every other event prints as it arrives.
 */
function eventLine(e, agent, open) {
  if (e.type === "tool" && e.call != null) {
    if (e.ms == null) {
      open.set(e.call, { agent, e });
      return null;
    }
    open.delete(e.call);
    return `  ${EVENT_MARK(e)} ${c.dim(agent)}  ${clipLine(e.text)}  ${c.dim(`${e.ms}ms`)}`;
  }
  return `  ${EVENT_MARK(e)} ${c.dim(agent)}  ${clipLine(e.text)}`;
}

/**
 * Print a run's new events: one line per event, once each, and — since a
 * tool call is two events — one line per call, printed when it completes.
 * `open` carries the calls still in flight across polls and reconnects.
 */
function printNew(run, seen, open = new Map()) {
  run.steps.forEach((step, i) => {
    const from = seen.get(i) ?? 0;
    for (const e of step.events.slice(from)) {
      const line = eventLine(e, step.agent, open);
      if (line !== null) console.log(line);
    }
    seen.set(i, step.events.length);
  });
}

/** The stream is over: print a start line for each call that never completed. */
function flushCalls(open) {
  for (const { agent, e } of open.values()) {
    console.log(`  ${EVENT_MARK(e)} ${c.dim(agent)}  ${clipLine(e.text)}`);
  }
  open.clear();
}

function finishLine(run) {
  const cost = run.steps.reduce((s, x) => s + (x.costUsd ?? 0), 0);
  const ok = run.status === "completed";
  console.log(`\n  ${ok ? c.green("✓") : run.status === "awaiting-approval" ? c.amber("⏸") : c.red("✗")} ${run.status} · $${cost.toFixed(4)}\n`);
  return ok ? 0 : run.status === "awaiting-approval" ? 2 : 1;
}

/** A run that has not finished: the stream is worth following. */
const isLive = (run) => run.status === "queued" || run.status === "running" || run.status === "awaiting-approval";

/** How long a run stream may stay silent before it is reconnected: four request timeouts, 120 s by default. */
const streamIdleSeconds = () => timeoutSeconds() * 4;

/** The stream said nothing for this long. Not a failure yet; a reason to reconnect. */
class StreamIdle extends Error {
  /** @param {number} seconds */
  constructor(seconds) {
    super(`the run stream went quiet for ${seconds}s`);
    this.seconds = seconds;
  }
}

/**
 * One connection to a run's stream, printed as frames land. Resolves with
 * the finished run on `done`, with the last run seen if the server ends it
 * first, and throws StreamIdle when nothing arrives for streamIdleSeconds.
 */
async function streamOnce(url, flags, ws, runId, seen, open = new Map()) {
  const token = tokenFor(url, flags);
  const idle = streamIdleSeconds();
  const target = new URL(`/api/workspaces/${ws}/runs/${runId}/stream`, url);
  const ctrl = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(new StreamIdle(idle)), idle * 1000);
  };
  arm();
  try {
    let res;
    try {
      res = await fetch(target, {
        headers: { authorization: `Bearer ${token}`, accept: "text/event-stream", "user-agent": USER_AGENT },
        signal: ctrl.signal,
      });
    } catch (err) {
      if (ctrl.signal.aborted) throw ctrl.signal.reason;
      throw new Error(`could not reach ${target.origin}`, { cause: err });
    }
    if (!res.ok || !res.body) {
      const hint = res.status === 401 || res.status === 403 ? refusedHint(url, flags) : "";
      throw new HttpError(`stream → HTTP ${res.status}${hint}`, res.status, {});
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let last = null;
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (ctrl.signal.aborted) throw ctrl.signal.reason;
        throw err;
      }
      if (chunk.done) break;
      arm();
      buffer += decoder.decode(chunk.value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const event = frame.match(/^event: (.*)$/m)?.[1];
        const data = frame.match(/^data: (.*)$/m)?.[1];
        if (!event || !data) continue;
        if (event === "run") {
          try {
            last = JSON.parse(data);
            printNew(last, seen, open);
          } catch {
            // a partial frame; the next one supersedes it
          }
        } else if (event === "done") {
          try {
            await reader.cancel();
          } catch {
            // the server ended it first
          }
          return last;
        }
      }
    }
    return last;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Follow a run on a platform: the same server-sent events the dashboard's
 * run page reads, printed as they land. Resolves with the finished run.
 *
 * A stream that goes quiet is reconnected, up to three times, as long as
 * the run is still live — every `run` frame carries the whole run, so a
 * fresh connection IS the resume; `seen` keeps the lines already printed
 * from printing twice. It used to block `invoke --watch` and `logs
 * --follow` for as long as a stalled tunnel cared to keep the socket.
 */
async function followRemote(url, flags, ws, runId, seen = new Map(), open = new Map()) {
  for (let attempt = 1; ; attempt++) {
    try {
      const run = await streamOnce(url, flags, ws, runId, seen, open);
      flushCalls(open);
      return run;
    } catch (err) {
      if (!(err instanceof StreamIdle)) throw err;
      const run = await remoteCall(url, flags, `/api/workspaces/${ws}/runs/${runId}`);
      printNew(run, seen, open);
      if (!isLive(run)) {
        flushCalls(open);
        return run;
      }
      if (attempt >= 3) {
        throw new Error(
          `${err.message} three times while ${runId} is still ${run.status} — \`foldrun logs ${runId} --to ${ws} --follow\` picks it up again, or ${url}/dashboard/${ws}/runs?run=${runId}`,
        );
      }
      console.error(`  ${c.dim(`… ${err.message}; reconnecting (${attempt}/3)`)}`);
    }
  }
}

/**
 * `foldrun open [page]` — the dashboard, from the terminal: this
 * workspace's overview, or one of its pages (runs, agents, flows, graph,
 * repo…). Prints the URL and opens it, or only prints with --print.
 */
async function openCmd(positional, flags) {
  const url = remoteUrl(flags);
  if (!url) throw new Error("open needs a platform — pass --url or set FOLDRUN_URL");
  const ws = flags.to ?? path.basename(process.env.FOLDRUN_WORKSPACE ?? process.cwd());
  const page = positional[0] ? `/${positional[0].replace(/^\/+/, "")}` : "";
  const target = new URL(`/dashboard/${ws}${page}`, url).toString();
  console.log(target);
  if (flags.print === true) return 0;
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const { spawn } = await import("node:child_process");
    spawn(opener, [target], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // printed above; that is enough
  }
  return 0;
}

/**
 * `foldrun secrets set|ls|rm` — the vault, from the terminal.
 *
 * Local by default (the workspace's own secrets.json, encrypted under the
 * install key); with --url/FOLDRUN_URL the same three verbs go to a running
 * platform. Values are prompted without echo unless piped or passed with
 * --value, and are never printed back by any verb.
 */
/**
 * A leading positional that names a workspace in this account, pulled off the
 * front of the arguments.
 *
 * `foldrun secrets blog ls` and `foldrun logs blog r-2026-09-16-1` read the
 * way they should inside an account folder, and mean nothing ambiguous: the
 * word is only taken as a workspace when it IS one of this account's
 * workspaces, so a run id or a verb can never be mistaken for one. With
 * exactly one workspace there is nothing to say, and nothing has to be.
 */
function takeWorkspace(positional, layout) {
  if (layout && layout.workspaces.includes(positional[0])) return positional.shift();
  if (layout && layout.workspaceDir) return path.basename(layout.workspaceDir);
  // `--workspace <name>` already pinned one of this account's workspaces.
  const pinned = process.env.FOLDRUN_WORKSPACE ? path.basename(process.env.FOLDRUN_WORKSPACE) : null;
  if (layout && pinned && layout.workspaces.includes(pinned)) return pinned;
  if (layout && layout.workspaces.length === 1) return layout.workspaces[0];
  return null;
}

/**
 * Stop a workspace-scoped command that is standing at an account root with
 * several workspaces under it.
 *
 * Without this the runtime was pinned to the account directory, found no
 * `agents/` in it, and said the workspace had no agents — true of the
 * directory it was looking at and useless as an answer.
 */
function needsOne(layout, what) {
  if (layout.kind === "account" && !layout.workspaceDir && layout.workspaces.length !== 1) {
    throw new Error(
      `which workspace? \`foldrun ${what} <target> --workspace <name>\` — this account has ${layout.workspaces.join(", ") || "none"}`,
    );
  }
}

/** …and the error when there are several and none was named. */
function whichWorkspace(layout, what) {
  return new Error(
    `which workspace? ${layout.workspaces.length ? `\`foldrun ${what} <workspace> …\` — this account has ${layout.workspaces.join(", ")}` : "there are none here"}`,
  );
}

/* ─────────────────────────────── site login ───────────────────────────────
 * `foldrun login medium --url https://medium.com` opens a real browser on this
 * machine, waits while a person signs in by hand, and stores what the session
 * is made of. It replaces the five-step chore — DevTools, Application,
 * Cookies, copy the line, `secrets set` — and it stores the parts that chore
 * always forgot: the storage a cookie jar cannot hold, and the browser
 * identity the site will check the session against.
 *
 * **No password ever reaches foldrun.** The person types it into the site's
 * own page, does the MFA, closes the window. This command only reads what the
 * browser was given afterwards, which is the same thing they would have copied
 * out of DevTools by hand.
 *
 * What it captures, and why each part:
 *   cookies    the session itself (HttpOnly ones included — a console cannot
 *              read those, which is exactly why the manual route needed the
 *              Network tab)
 *   storage    localStorage, sessionStorage and IndexedDB, for the logins that
 *              are not cookies at all (Firebase writes IndexedDB; MSAL can use
 *              sessionStorage)
 *   identity   user agent, locale, timezone — a Cloudflare clearance cookie is
 *              bound to the user agent that earned it, so a session copied
 *              without its identity is a challenge waiting to happen
 *   expiry     when the longest-lived login cookie dies, so "why did it stop
 *              working" has an answer before it stops working
 */

/** MEDIUM. The secret's name is the site's name, shouted. */
export function siteSecretName(name) {
  const clean = String(name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!clean || /^[0-9]/.test(clean)) {
    throw new Error(`"${name}" does not make a secret name — use letters, like \`foldrun login medium\``);
  }
  return clean;
}

/** `.medium.com` from `https://medium.com/new-story`: the domain the cookies
 *  belong to, with the leading dot so subdomains are included, and without a
 *  `www.` that would exclude the apex. */
export function cookieDomainFor(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return "." + host;
}

/** The block to paste into the agent, printed rather than written: which agent
 *  wants this session is the person's decision, and a command that edits files
 *  it was not pointed at is a command nobody trusts twice. */
export function renderBrowseBlock({ secret, url, identity, hasStorage, engine }) {
  const lines = [
    "web_browse:",
    `  engine: ${engine}`,
    `  user_agent: "${identity.user_agent}"`,
    `  cookies: ${secret}_COOKIES`,
    `  cookie_domain: ${cookieDomainFor(url)}`,
  ];
  if (hasStorage) {
    lines.push(`  storage: ${secret}_STORAGE`, `  storage_origin: ${new URL(url).origin}`);
  }
  lines.push(`  locale: ${identity.locale}`, `  timezone: ${identity.timezone}`);
  return lines.join("\n");
}

/** The cookie a person would call "the login": the longest-lived one the page
 *  cannot read. Not a guess we act on — it is printed so they can disagree. */
export function loginCookieOf(cookies) {
  const candidates = cookies.filter((c) => c.httpOnly && !/^(__cf_bm|cf_clearance|__cflb|_cfuvid)$/.test(c.name));
  const pick = (list) => list.slice().sort((a, b) => (b.expires ?? 0) - (a.expires ?? 0))[0];
  return pick(candidates.length ? candidates : cookies) ?? null;
}

export function whenItDies(cookie) {
  if (!cookie || !cookie.expires || cookie.expires < 0) return "when the browser session ends";
  const ms = cookie.expires * 1000 - Date.now();
  const days = Math.round(ms / 86_400_000);
  const when = new Date(cookie.expires * 1000).toISOString().slice(0, 16).replace("T", " ");
  return days >= 1 ? `${when} (${days} day${days === 1 ? "" : "s"})` : `${when} (under a day)`;
}


/** Playwright, wherever this machine keeps it. Beside the CLI if someone
 *  installed it there, and otherwise in the global modules directory — which
 *  is where `npm i -g playwright` puts it and where a bare `import()` will
 *  never look, because ESM does not consult global paths (NODE_PATH is
 *  CJS-only). The tool in the runner image resolves it the same way. */
async function loadPlaywright() {
  const tried = [];
  for (const name of ["playwright", "playwright-core"]) {
    try {
      // @ts-ignore - an optional peer, absent until someone installs it
      return await import(name);
    } catch (err) {
      tried.push(`${name}: ${err.code ?? "failed"}`);
    }
  }
  // `npm root -g` is the honest answer on any platform (homebrew, nvm, a
  // Windows prefix), and it is asked once, only when the plain import failed.
  let globalRoot;
  try {
    globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  } catch {
    globalRoot = null;
  }
  // Also this folder: a laptop often has Playwright inside a project rather
  // than globally, and someone standing in that project means it. An explicit
  // path wins over all of it, for the machine that keeps it somewhere only
  // its owner knows.
  const roots = [
    typeof process.env.FOLDRUN_PLAYWRIGHT === "string" ? process.env.FOLDRUN_PLAYWRIGHT : "",
    path.join(process.cwd(), "node_modules"),
    globalRoot ?? "",
    "/usr/local/lib/node_modules",
    "/opt/homebrew/lib/node_modules",
  ].filter((r) => r.length > 0);
  for (const root of roots) {
    for (const name of ["playwright", "playwright-core"]) {
      try {
        const require = createRequire(path.join(root, "/"));
        return require(name);
      } catch (err) {
        tried.push(`${root}/${name}: ${err.code ?? "failed"}`);
      }
    }
  }
  throw new Error(
    "this needs Playwright on your machine: `npm i -g playwright` (the browsers are cached separately, so " +
      "`npx playwright install chromium` only downloads them once) — or run this from a folder that has " +
      "playwright in node_modules, or point FOLDRUN_PLAYWRIGHT at one" +
      (process.env.FOLDRUN_DEBUG ? `\n  looked in — ${tried.join("; ")}` : ""),
  );
}

/** The command itself. Playwright drives the window; it is not a dependency of
 *  this CLI because 99% of what the CLI does needs no browser, so it is
 *  imported when asked for and its absence is a sentence, not a stack trace. */
async function siteLogin(positional, flags, layout) {
  const secret = siteSecretName(positional[0]);
  const url = typeof flags.url === "string" ? flags.url : undefined;
  if (!url) throw new Error(`which site? \`foldrun login ${positional[0]} --url https://example.com\``);
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new Error(`--url must be a full address, like https://medium.com`);
  }
  // The names people use, mapped to the ones Playwright answers to. Old
  // spellings keep working, so a script written before this still runs.
  const engines = { chrome: "chromium", chromium: "chromium", firefox: "firefox", safari: "webkit", webkit: "webkit" };
  const asked = typeof flags.engine === "string" ? flags.engine.toLowerCase() : "chrome";
  const engine = engines[asked];
  if (!engine) throw new Error(`--engine is chrome, firefox or safari`);

  const pw = await loadPlaywright();

  console.log(`\n  opening ${c.bold(url)} in ${asked}`);
  console.log(`  ${c.dim("sign in by hand — password, MFA, whatever the site asks. foldrun never sees it.")}`);
  console.log(`  ${c.dim("then close the window (or press Enter here) and the session is stored.")}\n`);

  const browser = await pw[engine].launch({ headless: false, args: engine === "chromium" ? ["--no-first-run"] : [] });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});

  // Whichever comes first: the window closed, or Enter in this terminal. A
  // person who signed in and left the window open should not have to guess
  // which one this command wanted.
  const closed = new Promise((resolve) => browser.on("disconnected", () => resolve("window")));
  const entered = new Promise((resolve) => {
    if (!process.stdin.isTTY) return; // a script has no Enter to press
    process.stdin.resume();
    process.stdin.once("data", () => resolve("enter"));
  });
  const how = await Promise.race([closed, entered]);
  if (process.stdin.isTTY) process.stdin.pause();

  // Read it back before the browser goes, and from the page itself so the
  // identity is what the site actually saw, not what this machine assumed.
  let cookies = [];
  let storage = {};
  let identity = { user_agent: "", locale: "en-US", timezone: "UTC" };
  if (how === "enter") {
    cookies = await context.cookies();
    const live = context.pages().find((p) => !p.isClosed()) ?? page;
    identity = await live
      .evaluate(() => ({
        user_agent: navigator.userAgent,
        locale: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }))
      .catch(() => identity);
    storage = await readStorage(live, origin);
    await browser.close().catch(() => {});
  } else {
    throw new Error(
      "the window closed before the session could be read — run it again and press Enter in this terminal instead, " +
        "with the window still open",
    );
  }

  cookies = cookies.filter((ck) => {
    const host = ck.domain.replace(/^\./, "");
    const site = new URL(url).hostname.replace(/^www\./, "");
    return host === site || host.endsWith(`.${site}`) || site.endsWith(`.${host}`);
  });
  if (!cookies.length && !hasAnyStorage(storage)) {
    throw new Error(`nothing to store: no cookies or storage for ${origin} — was the sign-in finished?`);
  }

  const login = loginCookieOf(cookies);
  const store = async (name, value) => {
    const remote = flags.local === true ? undefined : remoteUrl(flags);
    const named = takeWorkspace([], layout);
    const scope = flags.account === true ? undefined : flags.to ?? named ?? path.basename(process.env.FOLDRUN_WORKSPACE ?? process.cwd());
    if (remote) {
      await remoteCall(remote, flags, "/api/secrets", { method: "PUT", body: JSON.stringify({ name, value, workspace: scope }) });
    } else {
      (await core()).setSecret("default", name, value, scope);
    }
  };

  const storageJson = hasAnyStorage(storage) ? JSON.stringify(storage) : null;
  if (flags.print === true) {
    console.log(`  ${c.dim("--print: nothing stored")}`);
  } else {
    await store(`${secret}_COOKIES`, JSON.stringify(cookies));
    if (storageJson) await store(`${secret}_STORAGE`, storageJson);
  }

  const httpOnly = cookies.filter((ck) => ck.httpOnly).map((ck) => ck.name);
  console.log(`  ${c.green("✓")} ${c.bold(`${secret}_COOKIES`)} — ${cookies.length} cookies for ${cookieDomainFor(url)}`);
  if (httpOnly.length) console.log(`    ${c.dim(`HttpOnly (a console cannot read these): ${httpOnly.join(", ")}`)}`);
  if (login) console.log(`    ${c.dim(`the login looks like ${login.name}, good until ${whenItDies(login)}`)}`);
  if (storageJson) {
    const parts = [];
    if (Object.keys(storage.localStorage ?? {}).length) parts.push(`localStorage(${Object.keys(storage.localStorage).length})`);
    if (Object.keys(storage.sessionStorage ?? {}).length) parts.push(`sessionStorage(${Object.keys(storage.sessionStorage).length})`);
    if (Object.keys(storage.indexedDB ?? {}).length) parts.push(`indexedDB(${Object.keys(storage.indexedDB).join(", ")})`);
    console.log(`  ${c.green("✓")} ${c.bold(`${secret}_STORAGE`)} — ${parts.join(", ")}`);
  }
  console.log(`\n  ${c.dim("paste this into the agent that uses it:")}\n`);
  console.log(
    renderBrowseBlock({ secret, url, identity, hasStorage: Boolean(storageJson), engine: asked })
      .split("\n")
      .map((l) => "    " + l)
      .join("\n"),
  );
  console.log(`\n  ${c.dim(`and declare the names under secrets: [${secret}_COOKIES${storageJson ? `, ${secret}_STORAGE` : ""}]`)}\n`);
  return 0;
}

function hasAnyStorage(s) {
  return Boolean(
    Object.keys(s?.localStorage ?? {}).length ||
      Object.keys(s?.sessionStorage ?? {}).length ||
      Object.keys(s?.indexedDB ?? {}).length,
  );
}

/** Web Storage and IndexedDB for this origin, in the shape `web_browse`'s
 *  `storage:` seeds back. Read in the page, because that is the only place
 *  these exist. */
async function readStorage(page, origin) {
  const empty = { localStorage: {}, sessionStorage: {}, indexedDB: {} };
  if (new URL(page.url()).origin !== origin) return empty;
  return await page
    // @ts-ignore - this function is serialised and runs in the page, where
    // indexedDB, localStorage and sessionStorage are the browser's own
    .evaluate(async () => {
      const dump = (store) => {
        const out = {};
        try {
          for (let i = 0; i < store.length; i++) {
            const k = store.key(i);
            out[k] = store.getItem(k);
          }
        } catch {}
        return out;
      };
      const idb = {};
      try {
        // The page's own globals; typed as any because this body is
        // serialised and never runs in Node.
        const g = /** @type {any} */ (globalThis);
        const dbs = (await g.indexedDB.databases?.()) ?? [];
        for (const { name } of dbs) {
          if (!name) continue;
          idb[name] = await new Promise((resolve) => {
            const open = g.indexedDB.open(name);
            open.onerror = () => resolve({});
            open.onsuccess = (e) => {
              const db = e.target.result;
              const stores = [...db.objectStoreNames];
              if (!stores.length) {
                db.close();
                return resolve({});
              }
              const tx = db.transaction(stores, "readonly");
              const out = {};
              let left = stores.length;
              for (const s of stores) {
                const req = tx.objectStore(s).getAll();
                req.onsuccess = () => {
                  out[s] = req.result;
                  if (--left === 0) {
                    db.close();
                    resolve(out);
                  }
                };
                req.onerror = () => {
                  if (--left === 0) {
                    db.close();
                    resolve(out);
                  }
                };
              }
            };
          });
        }
      } catch {}
      return { localStorage: dump(localStorage), sessionStorage: dump(sessionStorage), indexedDB: idb };
    })
    .catch(() => empty);
}

async function secretsCmd(positional, flags, layout) {
  // --local: this machine's store even when signed in, the same escape
  // hatch deploy and keys have. Without it, a signed-in laptop sent every
  // secret to the platform and the local store could not be reached at all.
  const url = flags.local === true ? undefined : remoteUrl(flags);
  // The scope is the workspace's own store, named the way the runner names
  // it — the folder's basename. It was the literal string "workspace", so a
  // secret set from the terminal landed under workspaces/workspace/ and every
  // run, reading under workspaces/<name>/, reported it missing. The same
  // scope goes to the platform: it used to take only --to there, so
  // `--workspace .` was silently an account-wide secret.
  // Inside an account folder the workspace is a positional — or the only one
  // there is. Outside, it is the folder's own basename, as it always was.
  const named = takeWorkspace(positional, layout);
  if (flags.account !== true && !named && !flags.to && layout?.kind === "account") throw whichWorkspace(layout, "secrets");
  const localWorkspace = named ?? path.basename(process.env.FOLDRUN_WORKSPACE ?? process.cwd());
  const scope = flags.account === true ? undefined : flags.to ?? localWorkspace;
  const [verb, name] = positional;

  if (verb === "ls" || verb === undefined) {
    const entries = url
      ? (await remoteCall(url, flags, `/api/secrets${scope ? `?workspace=${encodeURIComponent(scope)}` : ""}`)).secrets
      : (await core()).listSecrets("default", scope);
    if (!entries.length) {
      console.log(`\n  ${c.dim("no secrets yet — foldrun secrets set NAME")}\n`);
      return 0;
    }
    console.log();
    for (const s of entries) {
      console.log(
        `  ${c.bold(s.name)}  ${c.dim(`${s.scope}${s.shadowed ? " · shadowed" : ""} · ${s.updatedAt ?? ""}`)}`,
      );
    }
    console.log();
    return 0;
  }

  if (verb === "status") {
    // OAuth grants only: which still refresh, which are failing or about to
    // expire, and whether a no-prompt reconnect exists for each.
    if (!url) throw new Error("secrets status reads the platform's connection health — sign in first (foldrun login)");
    const { connections } = await remoteCall(url, flags, "/api/oauth/connections");
    if (!connections.length) {
      console.log(`\n  ${c.dim("no OAuth connections")}\n`);
      return 0;
    }
    console.log();
    for (const s of connections) {
      const where = s.workspace ? `workspace ${s.workspace}` : "account";
      const state =
        s.status === "ok" ? c.green(`ok${s.daysLeft !== null ? ` · ${s.daysLeft} days left` : ""}`)
        : s.status === "expiring" ? c.amber(`expires in ${s.daysLeft} days`)
        : s.status === "no-client" ? c.dim("ok · no saved client (reconnect will ask for it once)")
        : c.red(`${s.status}${s.lastError ? ` — ${s.lastError}` : ""}`);
      console.log(`  ${c.bold(s.name)}  ${c.dim(where)}  ${state}`);
      if (s.status !== "ok" && s.status !== "no-client") {
        console.log(`    ${c.dim(`reconnect: foldrun connect ${s.name}${s.workspace ? ` --to ${s.workspace}` : ""}   or ${s.reconnectUrl}`)}`);
      }
    }
    console.log();
    return 0;
  }

  if (!name) throw new Error(`which secret? try \`foldrun secrets ${verb} NAME\``);

  if (verb === "set") {
    // --oauth2: store a refresh recipe instead of a static value. The
    // platform exchanges it for a live access token before every use.
    if (flags.oauth2 === true) {
      const token_url =
        (await promptVisible("  token URL [https://oauth2.googleapis.com/token]: ")) ||
        "https://oauth2.googleapis.com/token";
      const client_id = await promptVisible("  client_id: ");
      const client_secret = await promptHidden("  client_secret: ");
      const refresh_token = await promptHidden("  refresh_token: ");
      const config = { token_url, client_id, client_secret, refresh_token };
      if (url) {
        await remoteCall(url, flags, "/api/secrets", {
          method: "PUT",
          body: JSON.stringify({ name, oauth2: config, workspace: scope }),
        });
      } else {
        (await core()).setOAuth2Secret("default", name, config, scope);
      }
      console.log(`\n  ${c.green("✓")} ${name} stored as an auto-refreshing oauth2 credential\n`);
      return 0;
    }

    const value =
      typeof flags.value === "string" ? flags.value : await promptHidden(`  value for ${name}: `);
    if (!value) throw new Error("empty value — nothing stored");
    if (url) {
      await remoteCall(url, flags, "/api/secrets", {
        method: "PUT",
        body: JSON.stringify({ name, value, workspace: scope }),
      });
    } else {
      (await core()).setSecret("default", name, value, scope);
    }
    console.log(`\n  ${c.green("✓")} ${name} stored — declare it in agent.md under \`secrets:\` to use it\n`);
    return 0;
  }

  if (verb === "rm") {
    if (url) {
      await remoteCall(url, flags, "/api/secrets", {
        method: "DELETE",
        body: JSON.stringify({ name, workspace: scope }),
      });
    } else {
      (await core()).deleteSecret("default", name, scope);
    }
    console.log(`\n  ${c.green("✓")} ${name} removed\n`);
    return 0;
  }

  throw new Error(`unknown secrets verb "${verb}" — set, ls or rm`);
}

// ---------------------------------------------------------------- logs

/**
 * `foldrun logs [run-id]` — without an id, the recent runs; with one, that
 * run's whole event log. `--follow` keeps tailing a live run.
 */
async function logsCmd(positional, flags, layout) {
  // Inside an account folder the workspace comes first, the way it does on
  // every other workspace-scoped command — or is the only one there is.
  const named = takeWorkspace(positional, layout);
  if (!named && !flags.to && layout?.kind === "account") throw whichWorkspace(layout, "logs");
  if (named && layout?.workspacesDir && layout.workspaces.includes(named)) {
    process.env.FOLDRUN_WORKSPACE = path.join(layout.workspacesDir, named);
  }
  // With a platform named, the same verbs read the server's runs: the list,
  // one run's trail, or a live one followed to the end. --local reads this
  // machine's store even when signed in — the same escape hatch deploy,
  // secrets and keys have, and the one thing `logs` was missing.
  const url = flags.local === true ? undefined : remoteUrl(flags);
  if (url) return remoteLogs(url, positional, { ...flags, to: flags.to ?? named ?? undefined });

  const { listRuns, readRun } = await core();
  const T = "default";
  const P = "workspace";
  const runId = positional[0];

  if (!runId) {
    const runs = listRuns(T, P).slice(0, 20);
    if (!runs.length) {
      console.log(`\n  ${c.dim("no runs yet — foldrun run <agent or flow>")}\n`);
      return 0;
    }
    console.log();
    for (const r of runs) {
      const cost = r.steps.reduce((s, x) => s + (x.costUsd ?? 0), 0);
      const mark =
        r.status === "completed" ? c.green("✓") : r.status === "failed" ? c.red("✗") : c.amber("…");
      console.log(
        `  ${mark} ${c.bold(r.id)}  ${r.flow}  ${c.dim(`${r.status} · $${cost.toFixed(4)} · ${r.startedAt}`)}`,
      );
    }
    console.log(`\n  ${c.dim("foldrun logs <run-id> for the full trail")}\n`);
    return 0;
  }

  const print = (run, seen) => {
    run.steps.forEach((step, i) => {
      const from = seen.get(i) ?? 0;
      for (const e of step.events.slice(from)) {
        console.log(`  ${EVENT_MARK(e)} ${c.dim(e.t)} ${c.bold(step.agent)}  ${e.text}`);
      }
      seen.set(i, step.events.length);
    });
  };

  const seen = new Map();
  let run = readRun(T, P, runId);
  if (!run) throw new Error(`no run called "${runId}" here — \`foldrun logs\` lists them`);
  console.log(`\n  ${c.bold(run.flow)}  ${c.dim(run.id)}  ${c.dim(run.status)}\n`);
  print(run, seen);

  while (flags.follow === true && !run.finishedAt) {
    await new Promise((r) => setTimeout(r, 700));
    run = readRun(T, P, runId);
    if (!run) break;
    print(run, seen);
  }
  if (run?.finishedAt) {
    const cost = run.steps.reduce((s, x) => s + (x.costUsd ?? 0), 0);
    console.log(`\n  ${run.status === "completed" ? c.green("✓") : c.red("✗")} ${run.status} · $${cost.toFixed(4)}\n`);
  } else {
    console.log();
  }
  return run?.status === "failed" ? 1 : 0;
}

// ---------------------------------------------------------------- invoke

async function remoteLogs(url, positional, flags) {
  const ws = flags.to ?? path.basename(process.env.FOLDRUN_WORKSPACE ?? process.cwd());
  const runId = positional[0];
  if (!runId) {
    const { runs } = await remoteCall(url, flags, `/api/workspaces/${ws}/runs?limit=20`);
    if (!runs?.length) {
      console.log(`\n  ${c.dim(`no runs in ${ws} on ${url}`)}\n`);
      return 0;
    }
    console.log();
    for (const r of runs) {
      const cost = r.steps.reduce((s, x) => s + (x.costUsd ?? 0), 0);
      const mark = r.status === "completed" ? c.green("✓") : r.status === "failed" ? c.red("✗") : c.amber("…");
      console.log(`  ${mark} ${c.bold(r.id)}  ${r.flow}  ${c.dim(`${r.status} · $${cost.toFixed(4)} · ${r.startedAt}`)}${r.summary ? `\n      ${c.dim(r.summary)}` : ""}`);
    }
    console.log(`\n  ${c.dim("foldrun logs <run-id> --to " + ws + " for the full trail; --follow tails a live one")}\n`);
    return 0;
  }
  let run = await remoteCall(url, flags, `/api/workspaces/${ws}/runs/${runId}`);
  console.log(`\n  ${c.bold(run.flow)}  ${c.dim(run.id)}  ${c.dim(run.status)}\n`);
  const seen = new Map();
  const open = new Map();
  printNew(run, seen, open);
  if (flags.follow === true && isLive(run)) run = (await followRemote(url, flags, ws, runId, seen, open)) ?? run;
  flushCalls(open);
  return finishLine(run);
}

/**
 * `foldrun invoke <flow>` — start a flow on a running platform. The remote
 * sibling of `foldrun run`: same task flag, but the run continues on the
 * server whether or not this terminal sticks around. `--wait` holds on for
 * the result like an RPC.
 */
async function invoke(target, flags) {
  const url = remoteUrl(flags);
  if (!url) {
    throw new Error(
      "invoke starts a flow on a platform — pass --url or set FOLDRUN_URL. (Running locally? That's `foldrun run`.)",
    );
  }
  if (!target) throw new Error("which flow? try `foldrun invoke <flow> --to <workspace>`");
  const ws = flags.to;
  if (!ws) throw new Error("which workspace is it in? pass --to <workspace>");

  // --wait asks in short pieces, not one long request: whatever sits in
  // front of the platform cuts a request that stays silent too long
  // (Cloudflare at 100 s, an ALB at 60 s), and a flow can run for many
  // minutes. The server answers 202 { timedOut: true } when a piece runs out
  // and the same question is asked again of the run itself. The 524 that
  // used to land here after 100 s while the run carried on was the trigger.
  const WAIT_PIECE_S = 25;
  const wait = flags.wait === true ? `?wait=true&timeout=${WAIT_PIECE_S}` : "";
  // A waited run that FAILS is answered with 500 and a full record (see
  // server/wait.ts). That is not an error in the call, it is the answer to
  // it, so it is reported as a failed run rather than thrown as a transport
  // fault — the difference between "your flow failed" and "the platform is
  // down", which is the first thing anyone reading this needs to know.
  const reportFailedRun = (body, ws) => {
    if (body?.result) console.log(`\n${body.result}\n`);
    for (const st of body?.steps ?? []) {
      const mark = st.status === "completed" ? c.green("✓") : st.status === "skipped" ? c.dim("–") : c.red("✗");
      console.log(`  ${mark} ${c.dim(st.agent ?? "?")}  ${st.status}${st.skipReason ? c.dim(` (${st.skipReason})`) : ""}`);
    }
    console.log(
      `\n  ${c.red("✗")} ${body?.status ?? "failed"}${body?.costUsd != null ? ` · $${Number(body.costUsd).toFixed(4)}` : ""}` +
        `${body?.runId ? c.dim(` — foldrun logs ${body.runId} --to ${ws}`) : ""}\n`,
    );
    return 1;
  };
  // --from N starts at step N of the flow as its file numbers them; the
  // earlier steps are recorded as skipped. Mutually exclusive with --task
  // server-side (the task goes to step 1, which --from skips).
  const from = flags.from !== undefined ? Number(flags.from) : undefined;
  let body;
  try {
    body = await remoteCall(url, flags, `/api/workspaces/${ws}/flows/${target}/run${wait}`, {
      method: "POST",
      body: JSON.stringify({
        task: typeof flags.task === "string" ? flags.task : "",
        ...(from !== undefined ? { from } : {}),
        // --test: the platform marks the run a test run — sends refused or
        // sunk at the proxy, send-capable secrets withheld, state/ kept.
        ...(flags.test === true ? { test: true } : {}),
        // --once <key>: the same key twice is one run — a CI step that
        // retries after a dropped response used to start and pay for two.
        ...(typeof flags.once === "string" && flags.once ? { idempotencyKey: flags.once } : {}),
      }),
    });
  } catch (err) {
    if (flags.wait === true && err?.body?.runId && err.body.status) return reportFailedRun(err.body, ws);
    // overlap: skip — a run of this flow is live and the platform refused a
    // second. Not a fault; the live run's id is the useful half of the answer.
    if (err?.status === 409 && err?.body?.runId) {
      console.log(`\n  ${c.amber("·")} ${target} in ${ws} is already running — ${c.dim(`foldrun logs ${err.body.runId} --to ${ws}`)}\n`);
      return 1;
    }
    throw err;
  }
  while (flags.wait === true && body?.timedOut === true && body.runId) {
    try {
      body = await remoteCall(url, flags, `/api/workspaces/${ws}/runs/${body.runId}${wait}`);
    } catch (err) {
      if (err?.body?.runId && err.body.status) return reportFailedRun(err.body, ws);
      throw err;
    }
  }

  if (flags.watch === true && body.runId) {
    // Queued, then followed: the trace lands here line by line, the way the
    // run page draws it, and the exit code is the run's.
    console.log(`\n  ${c.bold(target)}  ${c.dim(body.runId)}\n`);
    const run = await followRemote(url, flags, ws, body.runId);
    if (!run) {
      console.log(`  ${c.dim("the stream ended before the run did — foldrun logs " + body.runId + " --to " + ws)}\n`);
      return 0;
    }
    return finishLine(run);
  }
  if (!flags.wait) {
    console.log(`\n  ${c.green("✓")} queued ${c.bold(body.runId)}${body.test ? ` ${c.amber("TEST")}` : ""} — ${c.dim(`foldrun logs ${body.runId} --to ${ws} --follow, or ${url}/dashboard/${ws}/runs?run=${body.runId}`)}\n`);
    return 0;
  }
  const run = body.run ?? body;
  const status = run.status ?? body.status ?? "finished";
  const ok = status === "completed";
  if (body.result) console.log(`\n${body.result}\n`);
  const mark = ok ? c.green("✓") : status === "awaiting-approval" ? c.amber("⏸") : c.red("✗");
  console.log(`  ${mark} ${status}${body.costUsd != null ? ` · $${Number(body.costUsd).toFixed(4)}` : ""}${status === "awaiting-approval" ? c.dim(` — ${url}/dashboard/${ws}/runs?run=${body.runId}`) : ""}\n`);
  return ok ? 0 : status === "awaiting-approval" ? 2 : 1;
}

// ---------------------------------------------------------------- connect

/** The loopback port `foldrun connect` listens on. Documented; do not change casually. */
const CONNECT_PORT = 8642;

/**
 * `foldrun connect NAME --provider linkedin` — the OAuth consent from the
 * terminal, the way `gh auth login` and `gcloud auth login` do it: open the
 * provider's screen, catch the redirect on a loopback port on this machine,
 * trade the code for tokens, and store the result on the platform (or in the
 * local vault) as the auto-refreshing secret an agent's `secrets:` names.
 *
 * Why loopback and not the dashboard's callback: every provider requires the
 * redirect to be registered in advance and most refuse plain http anywhere
 * but localhost. A developer's laptop always has localhost; a box behind a
 * tunnel or a LAN address does not have a name a provider will accept. So the
 * callback is `http://localhost:<port>/callback`, printed before the browser
 * opens so it can be registered first, and the port is fixed (--port) because
 * providers match it exactly.
 *
 * Nothing secret is printed. The refresh token goes straight into the vault;
 * a provider that issues none (GitHub, most LinkedIn apps) gets its access
 * token stored as a static value and the expiry is said out loud.
 */
async function connect(positional, flags) {
  const name = positional[0];
  if (!name) throw new Error("usage: foldrun connect NAME [--provider <google|github|microsoft|linkedin>] [--workspace <name>] [--new-client]");
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`secret name "${name}" must be UPPER_SNAKE_CASE`);
  const { OAUTH_PRESETS } = await core();

  const providerName = flags.provider;
  const preset = providerName ? OAUTH_PRESETS[providerName] : undefined;
  if (providerName && !preset) {
    throw new Error(`unknown provider "${providerName}" — one of ${Object.keys(OAUTH_PRESETS).join(", ")}, or pass --authorize-url and --token-url`);
  }
  const authorizeUrl = flags["authorize-url"] ?? preset?.authorize_url;
  const tokenUrl = flags["token-url"] ?? preset?.token_url;

  // Where the result goes: the platform when one is named or signed in,
  // this machine's vault otherwise. Decided before the browser opens, so a
  // consent is never spent on a store that then refuses it.
  const url = flags.local === true ? undefined : remoteUrl(flags);
  const token = url ? tokenFor(url, flags) : null;
  const workspaceName = flags.to ?? (flags.workspace ? path.basename(path.resolve(flags.workspace)) : undefined);

  // Reconnecting: the platform already holds the client this secret (or this
  // provider) was connected with, so run its consent flow — no client id, no
  // secret, nothing typed. The redirect is the platform's own callback, which
  // rewrites the same secret at the same scope; we wait for it to land.
  if (url && !flags["client-id"] && !env("OAUTH_CLIENT_ID") && flags["new-client"] !== true) {
    let started = null;
    try {
      started = await remoteCall(url, flags, "/api/oauth/reconnect", {
        method: "POST",
        body: JSON.stringify({ secret: name, workspace: workspaceName, provider: providerName }),
      });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    if (started?.url) {
      const before = (await remoteCall(url, flags, "/api/oauth/connections")).connections
        .find((s) => s.name === name && (s.workspace ?? undefined) === workspaceName)?.connectedAt ?? null;
      console.log(`\n  Reusing the saved ${c.bold(started.client)} client — nothing to type.`);
      console.log(`  ${c.dim(`consent returns to ${started.redirectUri} (it must be registered on the app)`)}`);
      const opened = flags["no-browser"] === true ? false : await openInBrowser(started.url);
      console.log(opened
        ? `  Opened your browser. Approve as the account that owns the ${providerName ?? started.client} resource.\n`
        : `  Open this address in your browser:\n\n    ${started.url}\n`);
      console.log(`  ${c.dim("Waiting for the platform to store it…")}`);
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const row = (await remoteCall(url, flags, "/api/oauth/connections")).connections
          .find((s) => s.name === name && (s.workspace ?? undefined) === workspaceName);
        if (row?.connectedAt && row.connectedAt !== before) {
          console.log(`\n  ${c.green("✓")} ${name} reconnected on ${url}${workspaceName ? ` · ${workspaceName}` : " · account"}\n`);
          return 0;
        }
      }
      throw new Error("no consent arrived within 10 minutes — run it again, or pass --new-client to enter a client id and secret");
    }
  }

  if (!authorizeUrl || !tokenUrl) throw new Error("--provider, or both --authorize-url and --token-url");
  if (!/^https:\/\//.test(tokenUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(tokenUrl)) {
    throw new Error("token URL must be https — a refresh token over http is a leaked one");
  }

  const clientId = flags["client-id"] ?? env("OAUTH_CLIENT_ID") ?? (await promptVisible("  client_id: "));
  const clientSecret = flags["client-secret"] ?? env("OAUTH_CLIENT_SECRET") ?? (await promptHidden("  client_secret: "));
  if (!clientId || !clientSecret) throw new Error("client_id and client_secret are required");
  const scopes = flags.scopes ?? preset?.scopes_example ?? "";

  // One fixed loopback address, the same on every developer's machine, so an
  // OAuth app is set up once — `http://localhost:8642/callback` — and never
  // per person. Fixed because most providers match the port exactly; 8642
  // because 3000 is every dev server. --port / FOLDRUN_CONNECT_PORT override
  // it, and then the app needs that value registered too.
  const port = Number(flags.port ?? env("FOLDRUN_CONNECT_PORT") ?? CONNECT_PORT);
  const redirectUri = `http://localhost:${port}/callback`;
  if (preset?.hint) console.log(`\n  ${c.dim(preset.hint)}`);
  console.log(`\n  Register this redirect URL on the ${providerName ?? "provider"} app once — it is the same for every developer:\n    ${c.bold(redirectUri)}\n`);

  const crypto = await import("node:crypto");
  const http = await import("node:http");
  const state = crypto.randomBytes(24).toString("hex");
  const authorize = new URL(authorizeUrl);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  if (scopes) authorize.searchParams.set("scope", scopes);
  for (const [k, v] of Object.entries(preset?.authorize_extra ?? {})) authorize.searchParams.set(k, v);

  // One request, then the listener closes. The state is the whole authority:
  // a callback with any other value is answered and ignored.
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", redirectUri);
      if (u.pathname !== "/callback") { res.statusCode = 404; res.end(); return; }
      if (u.searchParams.get("state") !== state) { res.statusCode = 400; res.end("state mismatch — start again"); return; }
      const err = u.searchParams.get("error");
      if (err) {
        res.end(`${err}: ${u.searchParams.get("error_description") ?? ""}. You can close this tab.`);
        server.close();
        reject(new Error(`${providerName ?? "provider"} refused: ${err} ${u.searchParams.get("error_description") ?? ""}`.trim()));
        return;
      }
      res.end("Connected. You can close this tab and return to the terminal.");
      server.close();
      resolve(u.searchParams.get("code"));
    });
    server.on("error", (/** @type {any} */ e) => reject(e.code === "EADDRINUSE"
      ? new Error(`port ${port} is in use — pass --port <n> and register http://localhost:<n>/callback on the app`)
      : e));
    server.listen(port, "127.0.0.1", async () => {
      const opened = flags["no-browser"] === true ? false : await openInBrowser(authorize.toString());
      console.log(opened
        ? `  Opened your browser. Approve as the account that owns the ${providerName ?? "provider"} resource.\n`
        : `  Open this address in your browser:\n\n    ${authorize.toString()}\n`);
      console.log(`  ${c.dim("Waiting for the redirect…")}`);
    });
  });
  if (!code) throw new Error("the redirect carried no code");

  const exchange = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }).toString(),
  });
  const payload = /** @type {any} */ (await exchange.json().catch(() => ({})));
  if (!exchange.ok || (!payload.refresh_token && !payload.access_token)) {
    throw new Error(`token exchange failed (${exchange.status}): ${payload.error_description ?? payload.error ?? "no token in the reply"}`);
  }

  // Store: the refresh recipe when there is one, the bare token otherwise.
  /** @type {any} */
  const body = payload.refresh_token
    ? { name, oauth2: { token_url: tokenUrl, client_id: clientId, client_secret: clientSecret, refresh_token: payload.refresh_token }, workspace: workspaceName, scopes, ...(payload.refresh_token_expires_in ? { refresh_token_expires_in: payload.refresh_token_expires_in } : {}) }
    : { name, value: payload.access_token, workspace: workspaceName };
  if (url) {
    // The same PUT `secrets set` makes. A store that fails here has spent the
    // consent — the code is single-use and nothing secret is kept locally —
    // so say that rather than leave "HTTP 405" to explain itself.
    try {
      await remoteCall(url, flags, "/api/secrets", { method: "PUT", body: JSON.stringify(body) });
    } catch (err) {
      throw new Error(`${providerName ?? "the provider"} approved, but storing ${name} on ${url} failed: ${err instanceof Error ? err.message : err}. The consent is spent; fix the platform side and run this again.`);
    }
  } else {
    const { setSecret, setOAuth2Secret } = await core();
    if (body.oauth2) setOAuth2Secret("default", name, body.oauth2, workspaceName);
    else setSecret("default", name, body.value, workspaceName);
  }

  const where = `${url ?? "this machine"}${workspaceName ? ` · ${workspaceName}` : " · account"}`;
  if (payload.refresh_token) {
    console.log(`\n  ${c.green("✓")} ${name} stored as an auto-refreshing oauth2 credential on ${where}\n`);
  } else {
    const days = payload.expires_in ? Math.round(payload.expires_in / 86400) : null;
    console.log(`\n  ${c.green("✓")} ${name} stored on ${where}`);
    console.log(`  ${c.amber("!")} ${providerName ?? "the provider"} issued no refresh token — this access token expires${days ? ` in about ${days} days` : ""}; run this command again then.\n`);
  }
  if (payload.scope) console.log(`  ${c.dim(`granted scopes: ${payload.scope}`)}\n`);
  return 0;
}

// ---------------------------------------------------------------- login

const DEFAULT_PLATFORM = "https://app.foldrun.io";

function openInBrowser(target) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  return import("node:child_process")
    .then(({ spawn }) => {
      const child = spawn(opener, [target], { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
      return true;
    })
    .catch(() => false);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `foldrun login [--url]` — sign this machine in from the browser.
 *
 * The platform hands back a short code; the browser opens on the page that
 * asks "is this your terminal?"; the person says yes; the key that makes
 * lands here and is kept in ~/.foldrun/credentials.json. No key to copy,
 * nothing pasted into a shell history. `--token` skips the browser and
 * stores a key made in the dashboard — for a machine with no browser, or a
 * deploy key for one workspace.
 */
async function login(flags) {
  const url = normaliseUrl(flags.url ?? env("FOLDRUN_URL") ?? defaultPlatform() ?? DEFAULT_PLATFORM);

  if (typeof flags.token === "string") {
    // Verify before storing: a wrong key stored is a wrong key on every
    // later command, each failing one step further from the cause.
    const me = await remoteCall(url, { token: flags.token, quiet: true }, "/api/me");
    const name = saveCredential(url, { token: flags.token, email: me.actor.email ?? null, account: me.account, role: me.role }, { name: typeof flags.profile === "string" ? flags.profile : undefined });
    console.log(`\n  ${c.green("✓")} signed in to ${c.bold(url)} as ${me.actor.email ?? me.actor.label ?? "an API key"} ${c.dim(`(${me.account}, ${me.role})`)}`);
    console.log(`  ${c.dim(`stored as the account "${name}" — \`foldrun accounts\` lists them, \`foldrun use ${name}\` switches`)}\n`);
    return 0;
  }

  /** @type {any} */
  let start;
  try {
    const res = await remoteFetch(url, "/api/cli/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: os.hostname() }),
    });
    start = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(start.error ?? `HTTP ${res.status}`);
  } catch (err) {
    throw new Error(`could not start a sign-in with ${url} — ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(`\n  Confirm this code in your browser:  ${c.bold(start.code)}\n`);
  console.log(`  ${c.dim(start.verifyUrl)}\n`);
  const opened = flags["no-browser"] === true ? false : await openInBrowser(start.verifyUrl);
  console.log(`  ${c.dim(opened ? "Opening the browser… waiting for you to approve." : "Open that address on any device and enter the code. Waiting…")}`);

  const interval = Math.max(1, Number(start.interval) || 3) * 1000;
  const deadline = Date.parse(start.expiresAt) || Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    /** @type {any} */
    let poll;
    try {
      // Through the shared client: a poll that hangs used to hang the
      // sign-in; now it is cut at FOLDRUN_TIMEOUT and asked again.
      const res = await remoteFetch(url, `/api/cli/login/${start.id}`);
      poll = await res.json().catch(() => ({}));
    } catch {
      continue; // a blip; the next poll asks again
    }
    if (poll.status === "pending") continue;
    if (poll.status === "denied") throw new Error("the sign-in was denied in the browser");
    if (poll.status === "expired") break;
    if (poll.status === "approved" && poll.token) {
      // `minted`: this key exists because of this login, so logout may end
      // it. A key stored with --token was made elsewhere and may be in use
      // elsewhere; logout only forgets it.
      const name = saveCredential(url, { token: poll.token, email: poll.email, account: poll.account, role: poll.role, minted: true }, { name: typeof flags.profile === "string" ? flags.profile : undefined });
      console.log(`\n  ${c.green("✓")} signed in to ${c.bold(url)} as ${poll.email} ${c.dim(`(${poll.account}, ${poll.role})`)}\n`);
      console.log(`  ${c.dim(`Stored as the account "${name}" in ~/.foldrun/credentials.json. \`foldrun accounts\` lists every account signed in here; \`foldrun use ${name}\` switches.`)}\n`);
      return 0;
    }
  }
  throw new Error("the code expired before it was approved — run `foldrun login` again");
}

/**
 * `foldrun logout [--url]` — forget this machine's key, and, when `login`
 * minted it, revoke it on the platform too (an editor's key cannot revoke
 * keys; it is still forgotten here, and the Settings page can revoke it). A
 * key given with --token is only forgotten: it was made elsewhere and may
 * be in use elsewhere.
 */
async function logout(flags) {
  // One account, not one machine: --profile names which, else the one this
  // shell is acting as. Signing out of a customer must not sign you out of
  // the other three.
  const entry = chosenProfile(flags);
  if (!entry) {
    console.log(`\n  ${c.dim("not signed in anywhere")}\n`);
    return 0;
  }
  const url = entry.url;
  let revoked = false;
  if (entry.minted) {
    try {
      const me = await remoteCall(url, { token: entry.token, quiet: true }, "/api/me");
      if (me.actor?.kind === "key" && me.actor.id) {
        await remoteCall(url, { token: entry.token, quiet: true }, "/api/keys", { method: "DELETE", body: JSON.stringify({ id: me.actor.id }) });
        revoked = true;
      }
    } catch {
      // Not allowed, or unreachable. The local copy still goes.
    }
  }
  removeCredential(entry.name ?? url);
  const note = revoked ? "" : entry.minted ? "  (the key is forgotten here; revoke it on Settings → API keys to be sure)" : "  (the key is forgotten here, not revoked — it was not made by `foldrun login`)";
  console.log(`\n  ${c.green("✓")} signed out of ${c.bold(entry.name ?? url)} ${c.dim(`(${entry.account} · ${url})`)}${c.dim(note)}`);
  const left = listProfiles();
  console.log(left.length ? `  ${c.dim(`still signed in as: ${left.map((p) => p.name).join(", ")}`)}\n` : "");
  return 0;
}

/** `foldrun whoami` — who the platform thinks this terminal is. */
async function whoami(flags) {
  const url = remoteUrl(flags);
  if (!url) throw new Error(NOT_SIGNED_IN);
  const me = await remoteCall(url, flags, "/api/me");
  const who = me.actor.kind === "user" ? me.actor.email : `API key ${me.actor.prefix ?? ""}… ${c.dim(`"${me.actor.label ?? ""}"${me.actor.createdBy ? ` by ${me.actor.createdBy}` : ""}`)}`;
  console.log(`\n  ${c.bold(who)}`);
  console.log(`  platform    ${url}`);
  console.log(`  account     ${me.account}${me.owner ? c.dim(`  (owner ${me.owner})`) : ""}`);
  console.log(`  role        ${me.role}`);
  console.log(`  workspaces  ${me.workspaces === null ? "all" : me.workspaces.join(", ") || "none"}`);
  const profile = flags.token || env("FOLDRUN_TOKEN") ? null : chosenProfile(flags);
  const source = flags.token ? "--token" : env("FOLDRUN_TOKEN") ? "FOLDRUN_TOKEN" : `~/.foldrun/credentials.json as "${profile?.name ?? "?"}"`;
  console.log(`  ${c.dim(`credential from ${source}`)}`);
  const others = listProfiles().filter((p) => p.name !== profile?.name);
  console.log(others.length ? `  ${c.dim(`also signed in as: ${others.map((p) => p.name).join(", ")} — \`foldrun accounts\``)}\n` : "\n");
  return 0;
}

/**
 * `foldrun doctor [--url]` — one line per thing that can be wrong between
 * this terminal and a platform, ✓ or ✗, in the order a person would check
 * them by hand: node, this CLI, its runtime, the environment, the account
 * a command would act as, the name, and a timed request through the same
 * client every other command uses. Exit 1 if any line is ✗.
 *
 * It exists because "fetch failed" was the whole diagnosis, and the fix
 * was in a different place each time: a tunnel, a stale profile, a proxy
 * variable, a box that was down.
 */
async function doctor(flags) {
  const results = [];
  const line = (ok, label, detail) => {
    results.push(ok);
    console.log(`  ${ok ? c.green("✓") : c.red("✗")} ${label.padEnd(9)} ${detail}`);
  };
  console.log();

  const major = Number(process.versions.node.split(".")[0]);
  line(major >= 22, "node", `${process.version}${major >= 22 ? "" : " — foldrun needs 22 or newer"}  ${c.dim(process.execPath)}`);
  line(true, "cli", `foldrun ${CLI_VERSION}  ${c.dim(fileURLToPath(new URL("..", import.meta.url)))}`);
  try {
    const root = coreRoot();
    const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
    line(true, "core", `@foldrun/core ${version}  ${c.dim(root)}`);
  } catch (err) {
    line(false, "core", `@foldrun/core cannot be resolved — ${explain(err)}`);
  }
  // Set or unset, never the value: two of these are a key and a proxy URL
  // that may carry one.
  line(true, "env", ["FOLDRUN_URL", "FOLDRUN_TOKEN", "FOLDRUN_TIMEOUT", "HTTPS_PROXY"].map((v) => (env(v) ? `${v} set` : c.dim(`${v} unset`))).join(" · "));

  let url;
  let token;
  try {
    url = remoteUrl(flags);
    if (typeof flags.token === "string" || env("FOLDRUN_TOKEN")) {
      token = flags.token ?? env("FOLDRUN_TOKEN");
      line(true, "account", `${typeof flags.token === "string" ? "--token" : "FOLDRUN_TOKEN"} ${token.slice(0, 8)}…  ${c.dim(url ?? "no platform")}`);
    } else {
      const p = chosenProfile(flags);
      if (p) {
        token = p.token;
        line(true, "account", `${p.name}  ${p.account} · ${p.role ?? "?"} · ${p.email ?? "api key"} · key ${String(p.token).slice(0, 8)}…  ${c.dim(p.url)}`);
      } else {
        line(false, "account", url ? `no account stored for ${url} — \`foldrun login --url ${url}\`, or --token` : "not signed in — `foldrun login`, or --url with --token");
      }
    }
  } catch (err) {
    line(false, "account", explain(err));
  }

  if (!url) {
    line(false, "dns", "no platform — pass --url, or sign in");
    line(false, "healthz", "no platform — pass --url, or sign in");
  } else {
    const host = new URL(url).hostname;
    if (net.isIP(host)) line(true, "dns", `${host} is an address, nothing to resolve`);
    else {
      const [a, aaaa] = await Promise.allSettled([dns.promises.resolve4(host), dns.promises.resolve6(host)]);
      const list = (r) => (r.status === "fulfilled" ? r.value.join(", ") : "none");
      if (a.status === "fulfilled" || aaaa.status === "fulfilled") line(true, "dns", `${host} → A ${list(a)} · AAAA ${list(aaaa)}`);
      else {
        // Not in DNS; /etc/hosts still counts, and is where a dev box lives.
        try {
          const found = await dns.promises.lookup(host, { all: true });
          line(true, "dns", `${host} → ${found.map((f) => f.address).join(", ")} ${c.dim("(hosts file, not DNS)")}`);
        } catch (err) {
          line(false, "dns", `${host} — ${explain(a.status === "rejected" ? a.reason : err)}`);
        }
      }
    }
    const t0 = performance.now();
    const took = () => `${Math.round(performance.now() - t0)} ms`;
    try {
      const res = await remoteFetch(url, "/api/healthz", {}, { token });
      const text = await res.text();
      let body = {};
      try {
        body = JSON.parse(text);
      } catch {
        // not JSON; the first line is shown below
      }
      const fields = ["version", "role"].filter((k) => body[k] != null).map((k) => `${k} ${body[k]}`).join(" · ");
      const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
      line(res.ok, "healthz", `GET /api/healthz ${res.status} in ${took()}${fields ? ` · ${fields}` : ""}${res.ok ? "" : ` — ${(res.headers.get("content-type") ?? "?").split(";")[0]}: ${firstLine.slice(0, 120)}`}`);
    } catch (err) {
      line(false, "healthz", `${explain(err)} ${c.dim(`(${took()})`)}`);
    }
  }

  console.log();
  return results.every(Boolean) ? 0 : 1;
}

/**
 * `foldrun keys ls|create|revoke` — the account's API keys, from the terminal.
 *
 *   keys ls                          every key, live and revoked
 *   keys create <label> [--role r]   an account key (editor unless said)
 *   keys create <label> --for <ws> [--access read|write]
 *                                    a deploy key: git clone/push for one workspace
 *   keys revoke <id>
 *
 * Minting and revoking need admin, the same as the Settings page.
 */
async function keysCmd(positional, flags) {
  const [verb, arg] = positional;
  const url = remoteUrl(flags);
  if (!url) throw new Error(NOT_SIGNED_IN);

  if (verb === "ls" || verb === "list" || verb === undefined) {
    const { keys } = await remoteCall(url, flags, "/api/keys");
    if (!keys.length) {
      console.log(`\n  ${c.dim("no API keys — foldrun keys create <label>")}\n`);
      return 0;
    }
    console.log("");
    for (const k of keys) {
      const what = k.scope ? `deploy · ${k.scope.workspace} (${k.scope.access})` : k.role ?? "admin";
      const state = k.revokedAt ? c.red("revoked") : c.green("live");
      console.log(`  ${state.padEnd(20)} ${k.id}  ${k.prefix}…  ${c.bold(k.label)}  ${c.dim(what)}${k.createdBy ? c.dim(`  by ${k.createdBy}`) : ""}  ${c.dim(k.createdAt.slice(0, 10))}`);
    }
    console.log("");
    return 0;
  }
  if (verb === "create" || verb === "new") {
    if (!arg) throw new Error("what is the key for? foldrun keys create <label>");
    const body = { label: arg };
    if (typeof flags.for === "string") body.workspace = flags.for;
    if (typeof flags.access === "string") body.access = flags.access;
    if (typeof flags.role === "string") body.role = flags.role;
    // --workspaces a,b narrows the key to those; --workspaces all opens
    // every one you can. Unsaid, the key inherits your own scope.
    if (typeof flags.workspaces === "string") body.workspaces = flags.workspaces === "all" ? null : flags.workspaces.split(",").map((w) => w.trim()).filter(Boolean);
    const made = await remoteCall(url, flags, "/api/keys", { method: "POST", body: JSON.stringify(body) });
    console.log(`\n  ${c.green("✓")} ${c.bold(arg)}  ${c.dim(made.id)}\n`);
    console.log(`  ${made.key}\n`);
    console.log(`  ${c.dim("Shown once. FOLDRUN_TOKEN=<key> uses it; `foldrun keys revoke " + made.id + "` ends it.")}\n`);
    return 0;
  }
  if (verb === "revoke" || verb === "rm") {
    if (!arg) throw new Error("which key? foldrun keys revoke <id> — ids are in `foldrun keys ls`");
    await remoteCall(url, flags, "/api/keys", { method: "DELETE", body: JSON.stringify({ id: arg }) });
    console.log(`\n  ${c.green("✓")} revoked ${arg}\n`);
    return 0;
  }
  throw new Error(`keys: unknown verb "${verb}" — ls, create, revoke`);
}

/**
 * `foldrun source` — the files themselves, on the platform, one at a time.
 *
 *   source ls [dir]                 the workspace's tree (or one folder of it)
 *   source cat <path>               one file, to stdout
 *   source put <path> [--file f]    write a file: from --file, else from stdin
 *                                   (--message "why" goes on the revision)
 *   source mv <from> <to>
 *   source rm <path>
 *
 * The same door the dashboard's editor uses, so every write is a revision
 * with who and why, and the workspace's history shows it. For a whole
 * tree, `foldrun deploy`; for what agents PRODUCE (storage/), the
 * dashboard's Storage page — source is what you wrote, storage is what
 * they wrote.
 */
async function sourceCmd(positional, flags) {
  const [verb, a, b] = positional;
  const url = remoteUrl(flags);
  if (!url) throw new Error("source reads a workspace on a platform — pass --url, or `foldrun login` first");
  const ws = flags.to;
  if (!ws) throw new Error("which workspace? pass --to <workspace>");
  const base = `/api/workspaces/${encodeURIComponent(ws)}/source`;

  if (verb === "ls" || verb === "list" || verb === undefined) {
    const { files } = await remoteCall(url, flags, base);
    const prefix = a ? a.replace(/\/+$/, "") + "/" : "";
    const shown = files.filter((f) => !prefix || f.startsWith(prefix));
    if (!shown.length) {
      console.log(`\n  ${c.dim(prefix ? `nothing under ${prefix}` : "an empty workspace")}\n`);
      return 0;
    }
    console.log("");
    for (const f of shown) console.log(`  ${f}`);
    console.log(`\n  ${c.dim(`${shown.length} file${shown.length === 1 ? "" : "s"} · ${ws} · ${url}`)}\n`);
    return 0;
  }
  if (verb === "cat" || verb === "read" || verb === "get") {
    if (!a) throw new Error("which file? foldrun source cat flows/daily.md --to <workspace>");
    const { content } = await remoteCall(url, flags, `${base}?path=${encodeURIComponent(a)}`);
    process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
    return 0;
  }
  if (verb === "put" || verb === "write") {
    if (!a) throw new Error("which file? foldrun source put flows/daily.md --file ./daily.md --to <workspace>");
    const content = typeof flags.file === "string" ? fs.readFileSync(flags.file, "utf8") : fs.readFileSync(0, "utf8");
    if (!content.trim()) throw new Error("refusing to write an empty file — `foldrun source rm` is the deliberate way to remove one");
    const body = { path: a, content, ...(typeof flags.message === "string" ? { message: flags.message } : {}) };
    await remoteCall(url, flags, base, { method: "PUT", body: JSON.stringify(body) });
    console.log(`\n  ${c.green("✓")} ${ws}/${a}  ${c.dim(`${content.length} chars · revision recorded${flags.message ? ` · "${flags.message}"` : ""}`)}\n`);
    return 0;
  }
  if (verb === "mv" || verb === "move") {
    if (!a || !b) throw new Error("foldrun source mv <from> <to> --to <workspace>");
    await remoteCall(url, flags, base, { method: "PATCH", body: JSON.stringify({ from: a, to: b }) });
    console.log(`\n  ${c.green("✓")} ${a} → ${b}\n`);
    return 0;
  }
  if (verb === "rm" || verb === "delete") {
    if (!a) throw new Error("foldrun source rm <path> --to <workspace>");
    await remoteCall(url, flags, base, { method: "DELETE", body: JSON.stringify({ path: a }) });
    console.log(`\n  ${c.green("✓")} removed ${a}\n`);
    return 0;
  }
  throw new Error(`source: unknown verb "${verb}" — ls, cat, put, mv, rm`);
}

// ------------------------------------------------- the account, as a whole

/**
 * Where this folder records what it last pushed, and to which platform.
 *
 * `status` needs a third fact beyond "local" and "live": whether the live copy
 * moved since you last deployed. Nothing on the wire carries that — a file's
 * revision on the platform is the platform's own history, not this laptop's —
 * so the laptop keeps a stamp of the bytes it sent. Under `.foldrun/`, which
 * every scaffold already ignores.
 */
function stampFile(layout) {
  return path.join(layout.accountRoot, ".foldrun", "deployed.json");
}
function readStamps(layout) {
  try {
    return JSON.parse(fs.readFileSync(stampFile(layout), "utf8"));
  } catch {
    return {};
  }
}
function writeStamp(layout, url, workspace, files) {
  const all = readStamps(layout);
  const key = url ?? "local";
  all[key] ??= {};
  all[key][workspace] = {
    at: new Date().toISOString(),
    files: Object.fromEntries(files.map((f) => [f.path, digest(f.content)])),
  };
  try {
    fs.mkdirSync(path.dirname(stampFile(layout)), { recursive: true });
    fs.writeFileSync(stampFile(layout), JSON.stringify(all, null, 2));
  } catch {
    /* an unwritable folder costs a "changed since" column, not the deploy */
  }
}
const digest = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Every source file of one workspace on the platform, by path. */
async function remoteWorkspaceFiles(url, flags, ws, isSourcePath) {
  const { files } = await remoteCall(url, flags, `/api/workspaces/${encodeURIComponent(ws)}/source`);
  const wanted = (files ?? []).filter(isSourcePath);
  const out = new Map();
  for (const rel of wanted) {
    const { content } = await remoteCall(
      url,
      flags,
      `/api/workspaces/${encodeURIComponent(ws)}/source?path=${encodeURIComponent(rel)}`,
    );
    out.set(rel, content);
  }
  return out;
}

/** Every library file on the platform, as {kind, path, content}. */
async function remoteLibrary(url, flags, kinds) {
  const out = [];
  for (const kind of kinds) {
    let entries;
    try {
      ({ entries } = await remoteCall(url, flags, `/api/library/${kind}`));
    } catch {
      continue; // an older platform without this kind
    }
    for (const e of entries ?? []) {
      const rel = e.path ?? (e.name ? `${e.name}.md` : null);
      if (!rel) continue;
      // The listing is a catalogue of tools and skills, not of files: a
      // folder tool is deliberately one row, so its code is not a row of its
      // own. `files` is what that row is actually made of. Without it a pull
      // brought down tool.md and left run.mjs behind, and the next deploy
      // would have shipped a library whose every script tool had lost its
      // program. Older platforms do not send it — then the entry is its own
      // whole, which is true for every single-file entry anyway.
      const wanted = Array.isArray(e.files) && e.files.length ? e.files : [rel];
      for (const one of wanted) {
        const { content } = await remoteCall(url, flags, `/api/library/${kind}?path=${encodeURIComponent(one)}`);
        out.push({ kind, path: one, content });
      }
    }
  }
  return out;
}

/** The workspaces the platform holds, by name. */
async function remoteWorkspaceNames(url, flags) {
  const { workspaces } = await remoteCall(url, flags, "/api/workspaces");
  return (workspaces ?? []).map((w) => w.name).filter(Boolean).sort();
}

/**
 * The account AGENTS.md has no write endpoint.
 *
 * `/api/account` reads and PATCHes a handful of known frontmatter keys — a
 * timezone, a notify target, a cap — and nothing reads or writes the file
 * itself. So a deploy cannot ship the account's prose, and a pull cannot
 * fetch it. Said out loud, once, rather than silently dropped: a scope that
 * vanishes without a word is the failure this codebase keeps producing.
 */
const NO_ACCOUNT_FILE_API =
  "the platform has no account-file endpoint — /api/account only PATCHes known frontmatter keys, so AGENTS.md at account scope is not synced. Edit it in Settings, or on the box.";

/**
 * `foldrun deploy` — the whole account, or one workspace of it.
 *
 * Nothing is ever deleted on the platform: a workspace that exists there and
 * not here is left exactly as it is. A deploy is a push, and a push that
 * quietly removed a colleague's desk because it was not on your laptop would
 * be the worst bug this tool could have. `foldrun workspaces rm <name>
 * --platform --yes` is the deliberate way.
 */
async function deployAccount(layout, flags, only) {
  const { accountTreeFrom, LIBRARY_KINDS } = await core();
  // Ask from the workspace, not the account root, unless this IS an account
  // root: for a flat folder the account root is its parent, and reading the
  // tree from there would find a directory that is not a workspace at all.
  const { tree } = accountTreeFrom(layout.kind === "account" ? layout.accountRoot : layout.workspaceDir, only);
  const url = flags.local === true ? undefined : remoteUrl(flags);
  const tenant = flags.tenant ?? "default";
  const dry = flags["dry-run"] === true;

  console.log(`\n  ${c.bold(url ? url : tenant)} ${c.dim(`← ${tree.root}`)}`);

  let worst = 0;
  for (const ws of tree.workspaces) {
    // --to renames the destination. Only when there is one thing to name: a
    // whole account cannot be squeezed into one workspace on the other side.
    const dest = tree.workspaces.length === 1 && typeof flags.to === "string" ? flags.to : ws.name;
    const code = await deployOne(url, tenant, dest, ws.files, flags, layout, ws.dir);
    worst = Math.max(worst, code);
  }

  // The library, file by file: /api/library/<kind> writes one path at a time,
  // which is the only endpoint there is. Locally it goes straight through the
  // same writer the dashboard uses, so a revision is recorded either way.
  if (tree.library.length) {
    if (dry) {
      console.log(`  ${c.dim(`library · ${tree.library.length} files (not sent — dry run)`)}`);
    } else if (url) {
      for (const f of tree.library) {
        await remoteCall(url, flags, `/api/library/${f.kind}`, {
          method: "PUT",
          body: JSON.stringify({ path: f.path, content: f.content }),
        });
      }
      console.log(`  ${c.green("✓")} library ${c.dim(`${tree.library.length} files`)}`);
    } else {
      const { writeLibraryFile } = await core();
      for (const f of tree.library) writeLibraryFile(tenant, f.kind, f.path, f.content);
      console.log(`  ${c.green("✓")} library ${c.dim(`${tree.library.length} files`)}`);
    }
  }

  if (tree.agentsMd !== null) {
    if (url) {
      console.log(`  ${c.amber("·")} AGENTS.md ${c.dim(`not sent — ${NO_ACCOUNT_FILE_API}`)}`);
    } else if (!dry) {
      const { accountDir } = await core();
      fs.mkdirSync(accountDir(tenant), { recursive: true });
      fs.writeFileSync(path.join(accountDir(tenant), "AGENTS.md"), tree.agentsMd);
      console.log(`  ${c.green("✓")} AGENTS.md ${c.dim("account scope")}`);
    }
  }
  console.log();
  return worst;
}

/** One workspace, pushed and reported. Extracted so the account loop and the
 *  single-workspace path print the same four lines. */
async function deployOne(url, tenant, workspace, files, flags, layout, from) {
  const { planDeploy, deployWorkspace, deployedCommit } = await core();
  /** @type {any} */
  const plan = url
    ? await deployOverHttp(url, workspace, files, flags)
    : flags["dry-run"]
      ? planDeploy(tenant, workspace, files)
      : deployWorkspace(tenant, workspace, files, {
          commit: flags.commit ?? null,
          force: flags.force === true,
        });

  console.log(
    `\n  ${c.bold(workspace)} ${c.dim(`${files.length} files · +${plan.added.length} ~${plan.updated.length} -${plan.removed.length}`)}${from ? ` ${c.dim(`← ${from}`)}` : ""}`,
  );
  const show = (label, list, colour) => {
    for (const f of list.slice(0, 20)) console.log(`    ${colour(label)} ${f}`);
    if (list.length > 20) console.log(`    ${c.dim(`… and ${list.length - 20} more`)}`);
  };
  show("+", plan.added, c.green);
  show("~", plan.updated, c.dim);
  show("-", plan.removed, c.red);

  if (plan.issues.length) {
    console.log(`\n  ${c.red(`${plan.issues.length} problem${plan.issues.length === 1 ? "" : "s"}`)} — ${workspace} was not deployed\n`);
    for (const i of plan.issues) console.log(`    ${c.red("✗")} ${c.bold(i.where)}  ${i.message}`);
    return 1;
  }
  if (plan.blockedBy.length && !flags.force) {
    console.log(
      `\n  ${c.amber("⏸")} ${plan.blockedBy.length} run${plan.blockedBy.length === 1 ? " is" : "s are"} still using these files: ` +
        `${plan.blockedBy.join(", ")}\n    ${c.dim("wait for them to finish, or --force to deploy anyway")}`,
    );
    return 1;
  }
  if (flags["dry-run"]) {
    console.log(`    ${c.dim("checks out — run without --dry-run to deploy")}`);
    return 0;
  }
  const at = url ? { commit: plan.commit } : deployedCommit(tenant, workspace);
  console.log(
    `    ${c.green("✓")} deployed${at?.commit ? ` ${c.dim(at.commit.slice(0, 8))}` : ""}` +
      `${plan.preserved ? c.dim(` · kept ${plan.preserved} file${plan.preserved === 1 ? "" : "s"} the agents own`) : ""}`,
  );
  if (layout) writeStamp(layout, url, workspace, files);
  return 0;
}

/**
 * `foldrun status` — what differs here from what is deployed.
 *
 * Reads only. Three numbers per workspace, plus the one a plain diff cannot
 * give you: whether the live copy moved since your last deploy, which is how
 * you find out somebody edited a flow in the dashboard before you overwrite
 * it.
 */
async function statusCmd(layout, flags, only) {
  const { isSourcePath, accountTreeFrom } = await core();
  const url = remoteUrl(flags);
  if (!url) throw new Error("status compares this folder with a platform — pass --url, or `foldrun login` first");
  const { tree } = accountTreeFrom(layout.kind === "account" ? layout.accountRoot : layout.workspaceDir, only);
  const live = new Set(await remoteWorkspaceNames(url, flags));
  const stamps = readStamps(layout)[url] ?? {};

  console.log(`\n  ${c.bold(url)} ${c.dim(`← ${tree.root}`)}\n`);
  for (const ws of tree.workspaces) {
    if (!live.has(ws.name)) {
      console.log(`  ${c.green("+")} ${c.bold(ws.name)}  ${c.dim(`${ws.files.length} files · not on the platform yet`)}`);
      continue;
    }
    const there = await remoteWorkspaceFiles(url, flags, ws.name, isSourcePath);
    const here = new Map(ws.files.map((f) => [f.path, f.content]));
    const added = [...here.keys()].filter((p) => !there.has(p));
    const updated = [...here.keys()].filter((p) => there.has(p) && there.get(p) !== here.get(p));
    const removed = [...there.keys()].filter((p) => !here.has(p));
    // Changed on the platform since we last pushed: compare the live bytes
    // with the stamp of what we sent, not with what is on disk now.
    const stamp = stamps[ws.name];
    const drifted = stamp
      ? [...there.entries()].filter(([p, content]) => stamp.files[p] !== undefined && stamp.files[p] !== digest(content)).map(([p]) => p)
      : [];
    const clean = !added.length && !updated.length && !removed.length;
    console.log(
      `  ${clean ? c.green("✓") : c.amber("~")} ${c.bold(ws.name)}  ` +
        c.dim(`+${added.length} ~${updated.length} -${removed.length}`) +
        (stamp ? c.dim(` · deployed ${stamp.at.slice(0, 16).replace("T", " ")}`) : c.dim(" · never deployed from here")),
    );
    for (const p of added.slice(0, 10)) console.log(`      ${c.green("+")} ${p}`);
    for (const p of updated.slice(0, 10)) console.log(`      ${c.dim("~")} ${p}`);
    for (const p of removed.slice(0, 10)) console.log(`      ${c.red("-")} ${p}  ${c.dim("(on the platform, not here — a deploy never removes it)")}`);
    if (drifted.length) {
      console.log(`      ${c.amber("!")} ${drifted.length} file${drifted.length === 1 ? "" : "s"} changed on the platform since your last deploy: ${drifted.slice(0, 5).join(", ")}`);
    }
  }

  const gone = [...live].filter((n) => !tree.workspaces.some((w) => w.name === n));
  if (gone.length) {
    console.log(`\n  ${c.dim(`on the platform but not here: ${gone.join(", ")} — \`foldrun pull\` brings them down`)}`);
  }
  console.log(`\n  ${c.dim(NO_ACCOUNT_FILE_API)}\n`);
  return 0;
}

/**
 * `foldrun pull` — the platform's account, into this folder.
 *
 * Safe by default: any local file whose bytes differ from the live ones is
 * listed and NOTHING is written. `--force` writes them. The rule is blunt on
 * purpose — a three-way merge needs a base this tool does not have, and a
 * silent overwrite of an afternoon's work is not worth the convenience.
 */
async function pullCmd(layout, flags, only) {
  const { isSourcePath, LIBRARY_KINDS } = await core();
  const url = remoteUrl(flags);
  if (!url) throw new Error("pull brings a platform's account down — pass --url, or `foldrun login` first");
  const root = layout.accountRoot;
  const wsRoot = layout.workspacesDir ?? path.join(root, "workspaces");

  const names = (await remoteWorkspaceNames(url, flags)).filter((n) => (only ? n === only : true));
  if (only && !names.length) throw new Error(`no workspace "${only}" on ${url}`);

  /** @type {{file: string, content: string}[]} */
  const incoming = [];
  for (const name of names) {
    const there = await remoteWorkspaceFiles(url, flags, name, isSourcePath);
    for (const [rel, content] of there) incoming.push({ file: path.join(wsRoot, name, rel), content });
  }
  for (const f of await remoteLibrary(url, flags, LIBRARY_KINDS)) {
    incoming.push({ file: path.join(root, "library", f.kind, f.path), content: f.content });
  }

  const clashes = incoming.filter((f) => {
    try {
      return fs.readFileSync(f.file, "utf8") !== f.content;
    } catch {
      return false; // absent: nothing to clobber
    }
  });
  if (clashes.length && flags.force !== true) {
    console.log(`\n  ${c.red("✗")} ${clashes.length} local file${clashes.length === 1 ? "" : "s"} would be overwritten\n`);
    for (const f of clashes.slice(0, 40)) console.log(`    ${c.red("~")} ${path.relative(root, f.file)}`);
    if (clashes.length > 40) console.log(`    ${c.dim(`… and ${clashes.length - 40} more`)}`);
    console.log(`\n  ${c.dim("commit them, or pull with --force to take the platform's copy")}\n`);
    return 1;
  }

  let written = 0;
  for (const f of incoming) {
    let before = null;
    try {
      before = fs.readFileSync(f.file, "utf8");
    } catch {
      /* new */
    }
    if (before === f.content) continue;
    fs.mkdirSync(path.dirname(f.file), { recursive: true });
    fs.writeFileSync(f.file, f.content);
    written++;
  }
  console.log(
    `\n  ${c.green("✓")} pulled ${names.length} workspace${names.length === 1 ? "" : "s"} from ${url}  ` +
      c.dim(`${written} file${written === 1 ? "" : "s"} written, ${incoming.length - written} already current`),
  );
  const rules = writeAgentFiles(root);
  for (const [file, what] of [["AGENTS.md", rules.agentsMd], ["CLAUDE.md", rules.claudeMd]]) {
    if (what === "created" || what === "updated") console.log(`  ${c.green("✓")} ${file} ${c.dim(`${what} — the coding-agent rules, pointing at \`foldrun docs\``)}`);
  }
  console.log(`  ${c.dim(NO_ACCOUNT_FILE_API)}\n`);
  return 0;
}

/**
 * `foldrun workspaces` — what exists here, what exists there, and which are
 * both. `rm <name>` removes one; on the platform it needs saying twice.
 */
async function workspacesCmd(positional, flags, layout) {
  const [verb, name] = positional;
  const url = flags.local === true ? undefined : remoteUrl(flags);

  if (verb === "new" || verb === "add") return newWorkspace(name, flags, layout);

  if (verb === "rm" || verb === "remove" || verb === "delete") {
    if (!name) throw new Error("which workspace? `foldrun workspaces rm <name>`");
    if (flags.platform === true) {
      if (!url) throw new Error("--platform needs a platform — pass --url, or `foldrun login` first");
      if (flags.yes !== true) {
        throw new Error(`this deletes ${name} and every run in it on ${url}, for everyone — add --yes if that is what you mean`);
      }
      await remoteCall(url, flags, `/api/workspaces/${encodeURIComponent(name)}`, { method: "DELETE" });
      console.log(`\n  ${c.green("✓")} deleted ${c.bold(name)} on ${url}\n`);
      return 0;
    }
    if (!layout.workspacesDir) throw new Error("not in an account folder — there is nothing here to remove");
    const dir = path.join(layout.workspacesDir, name);
    if (!fs.existsSync(dir)) throw new Error(`no workspace "${name}" here — have: ${layout.workspaces.join(", ") || "none"}`);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`\n  ${c.green("✓")} removed ${c.dim(dir)}  ${c.dim("(locally — the platform's copy is untouched)")}\n`);
    return 0;
  }
  if (verb && verb !== "ls" && verb !== "list") {
    throw new Error(`workspaces: unknown verb "${verb}" — ls, new <name>, rm <name>`);
  }

  const here = layout.workspaces;
  let there = [];
  let reach = null;
  if (url) {
    try {
      there = await remoteWorkspaceNames(url, flags);
    } catch (err) {
      reach = explain(err);
    }
  }
  const all = [...new Set([...here, ...there])].sort();
  if (!all.length) {
    console.log(`\n  ${c.dim("no workspaces — `foldrun new <name>` makes one")}\n`);
    return 0;
  }
  const width = Math.max(...all.map((n) => n.length));
  console.log("");
  for (const n of all) {
    const local = here.includes(n);
    const live = there.includes(n);
    const where = local && live ? "here · " + (url ?? "") : local ? "here only" : `${url} only`;
    console.log(`  ${local && live ? c.green("●") : c.dim("○")} ${c.bold(n.padEnd(width))}  ${c.dim(where)}`);
  }
  if (reach) console.log(`\n  ${c.amber("!")} ${c.dim(`could not read the platform: ${reach}`)}`);
  console.log(`\n  ${c.dim("● is in both. `foldrun pull` brings one down; `foldrun deploy <name>` pushes one up.")}\n`);
  return 0;
}

/**
 * `foldrun accounts` — every account this machine is signed in to, and
 * which one a bare command talks as. `foldrun use <name>` switches.
 *
 * The list is the point: someone looking after four customers on one
 * platform could see only the last one they signed in as, and had to paste
 * --token to reach the others.
 */
function accountsCmd(positional) {
  const profiles = listProfiles();
  if (!profiles.length) {
    console.log(`\n  ${c.dim("not signed in anywhere — `foldrun login`")}\n`);
    return 0;
  }
  const verb = positional[0];
  if (verb && verb !== "ls" && verb !== "list") throw new Error(`accounts: unknown verb "${verb}" — it takes none; \`foldrun use <name>\` switches`);
  const width = Math.max(...profiles.map((p) => p.name.length));
  console.log("");
  for (const p of profiles) {
    const mark = p.current ? c.green("●") : " ";
    const who = p.email ?? c.dim("api key");
    console.log(`  ${mark} ${c.bold(p.name.padEnd(width))}  ${p.account}  ${c.dim(`${p.role ?? "?"} · ${who} · ${p.url}`)}`);
  }
  console.log(`\n  ${c.dim("● is the one a bare command talks as. `foldrun use <name>` switches; --profile <name> is one command.")}\n`);
  return 0;
}

function useCmd(positional) {
  const name = positional[0];
  if (!name) {
    const names = listProfiles().map((p) => p.name);
    throw new Error(`which account? ${names.length ? names.join(", ") : "none stored — `foldrun login` first"}`);
  }
  const p = useProfile(name);
  if (!p) {
    const names = listProfiles().map((x) => x.name);
    throw new Error(`no account called "${name}"${names.length ? ` — try ${names.join(", ")}` : ""}`);
  }
  console.log(`\n  ${c.green("✓")} now acting as ${c.bold(p.name)} ${c.dim(`(${p.account}, ${p.role} · ${p.url})`)}\n`);
  return 0;
}

// --------------------------------------------------------------- storage

/** Bytes as a person reads them: 12.4KB, 3.1MB. */
function humanBytes(n) {
  const b = Number(n);
  if (!Number.isFinite(b)) return "—";
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

/**
 * `foldrun storage ls|cat|get|share|shares|unshare` — what a workspace PRODUCED,
 * and the public links to it.
 *
 * `source` is the other half of this and the distinction is the whole
 * point: source is what you wrote, storage is what the agents made. A
 * deliverable nobody looks at is the one that goes stale, so `ls` prints
 * when each file was written and which run wrote it. A directory whose
 * newest file is three weeks old and whose run id nobody recognises is the
 * shape staleness actually has.
 */
async function storageCmd(positional, flags, layout) {
  const url = platformFor(flags, "storage");
  // A folder that is not a workspace is not a workspace: `logs` and `source`
  // fall back to the directory's NAME, which from ~/Downloads asks the
  // platform for a workspace called "Downloads" and reports a 404 as though
  // the file were missing. --to is the answer from anywhere else.
  const ws = typeof flags.to === "string" ? flags.to : layout?.kind === "empty" ? null : takeWorkspace([], layout);
  if (!ws) throw new Error("which workspace? `foldrun storage ls --to <workspace>` — or run it inside one");
  const verb = positional[0] ?? "ls";

  if (verb === "ls") {
    const body = await remoteCall(url, flags, `/api/workspaces/${ws}/storage`);
    const prefix = positional[1];
    const files = (body.files ?? []).filter((f) => (prefix ? f.path === prefix || f.path.startsWith(prefix.replace(/\/*$/, "/")) : true));
    if (!files.length) {
      console.log(`\n  ${c.dim(`nothing in ${ws}'s storage${prefix ? ` under ${prefix}` : ""}`)}\n`);
      return 0;
    }
    files.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const w = {
      size: Math.max(...files.map((f) => humanBytes(f.size).length)),
      path: Math.max(...files.map((f) => f.path.length)),
      when: Math.max(...files.map((f) => when(f.updatedAt).length)),
    };
    console.log();
    for (const f of files) {
      // `by` is "run:<id>" for anything an agent wrote, "user:<email>" for
      // an upload, "api-key" for a key with no person behind it.
      const by = String(f.by ?? "");
      console.log(
        `  ${c.bold(pad(f.path, w.path))}  ${c.dim(`${pad(humanBytes(f.size), w.size)}  ${pad(when(f.updatedAt), w.when)}  ${ago(f.updatedAt)} ago  ${by}`)}`,
      );
    }
    const used = body.used ?? files.reduce((n, f) => n + (f.size ?? 0), 0);
    console.log(
      `\n  ${c.dim(`${files.length} file${files.length === 1 ? "" : "s"} · ${humanBytes(used)}${body.quotaMb ? ` of ${body.quotaMb}MB` : ""}${body.driver ? ` · ${body.driver}` : ""} — \`foldrun storage cat <path> --to ${ws}\``)}\n`,
    );
    return 0;
  }

  // ---- public links. A share is the one thing here reachable without a
  // credential, so the terminal says exactly what it minted and until when.
  if (verb === "share") {
    const rel = positional[1];
    if (!rel) throw new Error("`foldrun storage share <path>` — a path under storage/, as `foldrun storage ls` names it (--ttl <days>, --forever)");
    if (flags.forever === true && flags.ttl !== undefined) throw new Error("--forever or --ttl <days>, not both");
    const ttlDays = flags.forever === true ? null : flags.ttl !== undefined ? Number(flags.ttl) : undefined;
    if (ttlDays !== undefined && ttlDays !== null && !(Number.isFinite(ttlDays) && ttlDays > 0)) throw new Error("--ttl is a number of days, more than zero");
    const body = await remoteCall(url, flags, `/api/workspaces/${ws}/shares`, {
      method: "POST",
      body: JSON.stringify({ path: rel.startsWith("storage/") ? rel : `storage/${rel}`, ...(ttlDays !== undefined ? { ttlDays } : {}) }),
    });
    console.log(`\n  ${c.green("✓")} ${c.bold(body.url)}`);
    console.log(`  ${c.dim(`${body.path} · ${body.contentType} · ${body.expiresAt ? `until ${when(body.expiresAt)}` : "never expires"} — anyone with the link can fetch it; \`foldrun storage unshare ${body.token} --to ${ws}\` takes it down`)}\n`);
    return 0;
  }
  if (verb === "shares") {
    const { shares = [] } = await remoteCall(url, flags, `/api/workspaces/${ws}/shares`);
    const now = Date.now();
    const live = (x) => !x.revokedAt && (!x.expiresAt || Date.parse(x.expiresAt) > now);
    const rows = flags.all === true ? shares : shares.filter(live);
    if (!rows.length) {
      console.log(`\n  ${c.dim(`no ${flags.all === true ? "" : "live "}links in ${ws} — \`foldrun storage share <path>\` mints one${flags.all === true ? "" : ", --all shows expired and revoked ones too"}`)}\n`);
      return 0;
    }
    const w = { path: Math.max(...rows.map((x) => x.path.length)), token: Math.max(...rows.map((x) => x.token.length)) };
    console.log();
    for (const x of rows) {
      const state = x.revokedAt ? c.red(`revoked ${ago(x.revokedAt)} ago`) : !live(x) ? c.red(`expired ${ago(x.expiresAt)} ago`) : x.expiresAt ? `until ${when(x.expiresAt)}` : "never expires";
      console.log(`  ${live(x) ? c.green("✓") : c.dim("·")} ${c.bold(pad(x.path, w.path))}  ${c.dim(pad(x.token, w.token))}  ${c.dim(`${state} · by ${x.createdBy ?? "api-key"} · ${ago(x.createdAt)} ago`)}`);
    }
    console.log(`\n  ${c.dim(`${rows.length} link${rows.length === 1 ? "" : "s"} · a link is <platform>/s/<token> · \`foldrun storage unshare <token> --to ${ws}\``)}\n`);
    return 0;
  }
  if (verb === "unshare") {
    const token = positional[1];
    if (!token) throw new Error("`foldrun storage unshare <token>` — `foldrun storage shares` lists them");
    const { revoked } = await remoteCall(url, flags, `/api/workspaces/${ws}/shares?token=${encodeURIComponent(token)}`, { method: "DELETE" });
    if (!revoked) {
      console.log(`\n  ${c.dim(`nothing revoked — ${token} is not a live link of this account's`)}\n`);
      return 1;
    }
    console.log(`\n  ${c.green("✓")} ${c.dim(`${token} revoked — the link answers 404 from now on, and the token is never reused`)}\n`);
    return 0;
  }

  if (verb === "put") {
    const local = positional[1];
    if (!local) throw new Error("`foldrun storage put <file>` — --as <path> names it differently in storage/");
    if (!fs.existsSync(local) || !fs.statSync(local).isFile()) throw new Error(`${local} is not a file here`);
    const rel = typeof flags.as === "string" && flags.as ? flags.as : path.basename(local);
    const bytes = fs.readFileSync(local);
    if (!bytes.length) throw new Error(`${local} is empty — the platform refuses an empty file`);
    const token = tokenFor(url, flags);
    const res = await remoteFetch(url, `/api/workspaces/${ws}/storage?path=${encodeURIComponent(rel)}`, { method: "PUT", body: bytes, headers: { "content-type": "application/octet-stream" } }, { token });
    const text = await res.text();
    if (!res.ok) {
      let why = text.slice(0, 200);
      try {
        why = JSON.parse(text).error ?? why;
      } catch {
        /* not JSON */
      }
      throw new HttpError(`${rel} in ${ws}: ${why}${res.status === 401 || res.status === 403 ? refusedHint(url, flags) : ""}`, res.status, {});
    }
    console.log(`\n  ${c.green("✓")} ${ws}/storage/${rel}  ${c.dim(`${humanBytes(bytes.length)} from ${local}`)}\n`);
    return 0;
  }
  if (verb === "rm") {
    const rel = positional[1];
    if (!rel) throw new Error("`foldrun storage rm <path>` — `foldrun storage ls` names them");
    await remoteCall(url, flags, `/api/workspaces/${ws}/storage?path=${encodeURIComponent(rel)}`, { method: "DELETE" });
    console.log(`\n  ${c.green("✓")} ${ws}/storage/${rel} removed\n`);
    return 0;
  }

  if (verb !== "cat" && verb !== "get") {
    throw new Error(`unknown storage verb "${verb}" — ls, cat, get, put, rm, share, shares or unshare`);
  }

  const rel = positional[1];
  if (!rel) throw new Error(`\`foldrun storage ${verb} <path>\` — \`foldrun storage ls\` names them`);

  // The download route redirects to a signed URL on an object store and
  // streams the bytes on the fs driver, so this is a plain fetch that
  // follows redirects — not remoteCall, which parses JSON and would make a
  // markdown file look like a broken platform.
  const token = tokenFor(url, flags);
  const res = await remoteFetch(url, `/api/workspaces/${ws}/storage/download?path=${encodeURIComponent(rel)}`, {}, { token });
  if (!res.ok) {
    const said = await res.text();
    let why = said.slice(0, 200);
    try {
      why = JSON.parse(said).error ?? why;
    } catch {
      /* not JSON — whatever it said is the message */
    }
    throw new HttpError(`${rel} in ${ws}: ${why}${res.status === 401 || res.status === 403 ? refusedHint(url, flags) : ""}`, res.status, {});
  }
  const bytes = Buffer.from(await res.arrayBuffer());

  if (verb === "cat") {
    // A file store holds PDFs and images too, and spraying them at a
    // terminal is how a shell ends up rendering escape codes it was handed.
    if (bytes.includes(0)) {
      throw new Error(`${rel} is not text (${humanBytes(bytes.length)}) — \`foldrun storage get ${rel}\` writes it to a file`);
    }
    process.stdout.write(bytes.toString("utf8"));
    return 0;
  }

  const to = typeof flags.file === "string" ? flags.file : path.basename(rel);
  if (fs.existsSync(to) && flags.force !== true) {
    throw new Error(`${to} already exists — --file <path> puts it somewhere else, --force overwrites`);
  }
  fs.mkdirSync(path.dirname(path.resolve(to)), { recursive: true });
  fs.writeFileSync(to, bytes);
  console.log(`\n  ${c.green("✓")} ${to}  ${c.dim(`${humanBytes(bytes.length)} from ${ws}/storage/${rel}`)}\n`);
  return 0;
}

// ----------------------------------------------------------------- rerun

/**
 * `foldrun rerun <run-id>` — the same flow again, from a step.
 *
 * The debug loop is fix the file, deploy, rerun from the step that failed:
 * `--from <n>` names the step as the flow numbers them, `--agent <name>` the
 * first step that agent runs. Earlier steps are recorded as skipped, not
 * invented. `--wait` follows it the way `invoke --wait` does.
 */
async function rerunCmd(runId, flags, layout) {
  const url = platformFor(flags, "rerun");
  if (!runId) throw new Error("which run? `foldrun rerun <run-id> --from <step>` — `foldrun runs --status failed` lists them");
  const from = flags.from !== undefined ? Number(flags.from) : undefined;
  const agent = typeof flags.agent === "string" ? flags.agent : undefined;
  if ((from === undefined || !Number.isInteger(from) || from < 1) && !agent) {
    throw new Error("where from? --from <step> (as the flow numbers them) or --agent <name> (the first step that agent runs)");
  }
  const ws = await workspaceOfRun(url, flags, layout, runId);
  const body = await remoteCall(url, flags, `/api/workspaces/${ws}/runs/${runId}/rerun`, {
    method: "POST",
    body: JSON.stringify(agent ? { agent } : { step: from }),
  });
  const id = body.runId ?? body.id;
  console.log(`\n  ${c.green("✓")} ${c.bold(id)}  ${c.dim(`${ws} · again from ${agent ? `agent ${agent}` : `step ${from}`} of ${runId} · ${body.steps ?? "?"} steps`)}`);
  console.log(`  ${c.dim(`foldrun logs ${id} --to ${ws}${flags.wait === true ? "" : " · --wait follows it"}`)}\n`);
  if (flags.wait !== true) return 0;
  return logsCmd([id], { ...flags, follow: true, to: ws }, layout);
}

// ----------------------------------------------------------------- guide

/**
 * `foldrun guide` — the coding-agent rules, as Next.js writes them: a short
 * managed block in AGENTS.md telling a coding agent to read the docs that
 * ship with this CLI, and CLAUDE.md importing it. Rewrites the block in
 * place, keeps everything around it. `--check` exits 1 when the block is
 * missing or old (for CI); `--print` writes the block to stdout.
 */
async function guideCmd(flags, layout) {
  if (flags.print === true) {
    process.stdout.write(`${agentRulesBlock()}\n`);
    return 0;
  }
  // An account folder or a flat workspace has an account root; a bare
  // directory (nothing of foldrun's here yet) is its own root.
  const root = layout && layout.kind !== "empty" ? layout.accountRoot : process.cwd();
  if (flags.check === true) {
    const ok = hasCurrentAgentRules(root);
    console.log(`\n  ${ok ? c.green("✓") : c.amber("·")} ${c.dim(ok ? "AGENTS.md carries the current coding-agent rules" : "the coding-agent rules are missing or old here — `foldrun guide` writes them")}\n`);
    return ok ? 0 : 1;
  }
  const r = writeAgentFiles(root);
  console.log(`\n  ${c.green("✓")} ${root}`);
  console.log(`    AGENTS.md  ${c.dim(r.agentsMd)}\n    CLAUDE.md  ${c.dim(r.claudeMd)}`);
  console.log(`  ${c.dim("a coding agent here now reads `foldrun docs` before it edits; your own text around the block is kept")}\n`);
  return 0;
}

// ------------------------------------------------------------------ docs

/**
 * `foldrun docs [page]` — foldrun's documentation, from the copy that ships
 * with this CLI (the way node_modules/next/dist/docs does for Next.js), so a
 * coding agent reads the version it is driving, offline. No page lists
 * them; `--path` prints where they are on disk.
 */
async function docsCmd(positional, flags) {
  if (flags.path === true) {
    console.log(docsDir());
    return 0;
  }
  const slug = positional[0];
  if (!slug) {
    const pages = docPages();
    if (!pages.length) throw new Error("this install of the CLI has no bundled docs — reinstall it, or read them at foldrun.io/docs");
    const w = Math.max(...pages.map((p) => p.slug.length));
    console.log();
    for (const p of pages) console.log(`  ${c.bold(p.slug.padEnd(w))}  ${c.dim(p.title)}`);
    console.log(`\n  ${c.dim(`foldrun docs <page> prints one · on disk at ${docsDir()}`)}\n`);
    return 0;
  }
  const text = docPage(slug);
  if (text === null) {
    const near = docPages().filter((p) => p.slug.includes(slug) || p.title.toLowerCase().includes(slug.toLowerCase())).map((p) => p.slug);
    throw new Error(`no page "${slug}"${near.length ? ` — did you mean ${near.join(", ")}?` : ""} — \`foldrun docs\` lists them`);
  }
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  return 0;
}

// -------------------------------------------------------------- triggers

/**
 * `foldrun triggers` — why nothing happened.
 *
 * One row per flow: how often its trigger fired, how often that became a
 * run, and what the difference was — a duplicate delivery, a throttled or
 * debounced burst, a quarantined flow, an overlap skipped, a fire missed
 * while the platform was down. The gap between fired and started is the
 * number someone opened a terminal to find.
 */
async function triggersCmd(flags, layout) {
  const url = platformFor(flags, "triggers");
  const ws = typeof flags.to === "string" ? flags.to : layout?.kind === "empty" ? null : takeWorkspace([], layout);
  if (!ws) throw new Error("which workspace? `foldrun triggers --to <workspace>` — or run it inside one");
  const days = Number(flags.since) > 0 ? Math.floor(Number(flags.since)) : 7;
  const body = await remoteCall(url, flags, `/api/workspaces/${ws}/triggers?since=${days}`);
  const rows = body.flows ?? [];
  if (!rows.length) {
    console.log(`\n  ${c.dim(`no trigger fired in ${ws} in the last ${body.days ?? days} day${(body.days ?? days) === 1 ? "" : "s"} — a flow fires when its frontmatter says trigger: schedule, webhook, watch, storage or email`)}\n`);
    return 0;
  }
  const w = { flow: Math.max(...rows.map((r) => r.flow.length)), trigger: Math.max(...rows.map((r) => r.trigger.length)) };
  console.log();
  let held = 0;
  for (const r of rows) {
    const quarantined = (r.dropped ?? []).some((d) => d.outcome === "quarantined");
    if (quarantined) held++;
    const ratio = `${r.started}/${r.fired} started`;
    console.log(`  ${quarantined ? c.red("⏹") : r.started === r.fired ? c.green("✓") : c.amber("·")} ${c.bold(pad(r.flow, w.flow))}  ${c.dim(pad(r.trigger, w.trigger))}  ${ratio}  ${c.dim(r.lastStartedAt ? `last run ${ago(r.lastStartedAt)} ago` : "never became a run")}`);
    for (const d of r.dropped ?? []) {
      console.log(`      ${quarantined && d.outcome === "quarantined" ? c.red(`${d.count}× ${d.outcome}`) : c.dim(`${d.count}× ${d.outcome}`)}  ${c.dim(firstLine(d.detail ?? "", 90))}`);
    }
  }
  console.log(`\n  ${c.dim(`${rows.length} flow${rows.length === 1 ? "" : "s"} fired in the last ${body.days ?? days} day${(body.days ?? days) === 1 ? "" : "s"}${held ? ` · ${held} switched off by disable_after — one successful run clears it` : ""} · --since <days>`)}\n`);
  return held ? 1 : 0;
}

// -------------------------------------------------------------- schedule

/**
 * `foldrun schedule` — every flow in the account that fires on a clock.
 *
 * Worth one command of its own because a cron line is the thing nobody
 * reads twice: `0 5 1-7 * 5` looks monthly and fires eight times in
 * twenty-eight days, since day-of-month and day-of-week are OR'd. So the
 * next firing times are printed beside the expression rather than left to
 * be reasoned about, and an expression the scheduler cannot parse is
 * marked — an invalid schedule does not error anywhere, it simply never
 * runs.
 */
async function scheduleCmd(flags) {
  const url = platformFor(flags, "schedule");
  const { scheduled = [] } = await remoteCall(url, flags, "/api/schedule");
  const rows = typeof flags.to === "string" ? scheduled.filter((r) => r.workspace === flags.to) : scheduled;

  if (!rows.length) {
    console.log(`\n  ${c.dim(`nothing is scheduled${flags.to ? ` in ${flags.to}` : ""} — a flow fires on a clock when its frontmatter says trigger: schedule`)}\n`);
    return 0;
  }

  // Soonest first: the question is almost always "what happens next".
  rows.sort((a, b) => ((a.upcoming?.[0] ?? "9") < (b.upcoming?.[0] ?? "9") ? -1 : 1));
  const w = {
    workspace: Math.max(...rows.map((r) => r.workspace.length)),
    flow: Math.max(...rows.map((r) => r.flow.length)),
    schedule: Math.max(...rows.map((r) => r.schedule.length)),
  };

  console.log();
  for (const r of rows) {
    const next = (r.upcoming ?? [])[0];
    console.log(
      `  ${r.valid ? c.green("✓") : c.red("✗")} ${pad(r.workspace, w.workspace)}  ${c.bold(pad(r.flow, w.flow))}  ${pad(r.schedule, w.schedule)}  ` +
        `${c.dim(`${r.timezone} · ${r.steps} step${r.steps === 1 ? "" : "s"}`)}`,
    );
    if (!r.valid) {
      console.log(`      ${c.red("the scheduler cannot parse this — it will never fire")}`);
      continue;
    }
    console.log(`      ${c.dim(`next ${next ? `${when(next)} (in ${ago(next).replace("—", "")})` : "not in the next 40 days"}`)}`);
    for (const t of (r.upcoming ?? []).slice(1)) console.log(`      ${c.dim(`then ${when(t)}`)}`);
  }
  console.log(
    `\n  ${c.dim(`${rows.length} scheduled flow${rows.length === 1 ? "" : "s"} — times are this terminal's clock; the cron line is read in the timezone beside it`)}\n`,
  );
  return rows.some((r) => !r.valid) ? 1 : 0;
}

/**
 * `foldrun account providers` — which model providers this account's files
 * use, and whether each key still works.
 *
 * A dead key is found by a desk failing at 3am, unless someone asks. The
 * platform asks once a day; --check asks now, which spends one minimal
 * request at each distinct endpoint.
 */
async function providersCmd(url, flags) {
  const body = flags.check === true
    ? { ...(await remoteCall(url, flags, "/api/account/providers")), lastCheck: (await remoteCall(url, flags, "/api/account/providers", { method: "POST", body: "{}" })).lastCheck }
    : await remoteCall(url, flags, "/api/account/providers");
  const configured = body.configured ?? [];
  const last = body.lastCheck ?? null;
  if (!configured.length) {
    console.log(`\n  ${c.dim("no provider of the account's own — every agent here runs on the platform's credential")}\n`);
    return 0;
  }
  const verdict = new Map((last?.results ?? []).map((r) => [`${r.declaredIn}|${r.provider}`, r]));
  const w = { provider: Math.max(...configured.map((p) => p.provider.length)), where: Math.max(...configured.map((p) => p.declaredIn.length)) };
  console.log();
  let broken = 0;
  for (const p of configured) {
    const r = verdict.get(`${p.declaredIn}|${p.provider}`);
    const mark = !r ? c.dim("·") : r.ok ? c.green("✓") : c.red("✗");
    if (r && !r.ok) broken++;
    console.log(`  ${mark} ${c.bold(pad(p.provider, w.provider))}  ${c.dim(pad(p.declaredIn, w.where))}  ${c.dim(`${p.model} · ${p.format}`)}${r && !r.ok ? `  ${c.red(r.verdict)} ${c.dim(firstLine(r.detail ?? "", 60))}` : ""}`);
  }
  console.log(
    `\n  ${c.dim(last ? `checked ${ago(last.checkedAt)} ago${broken ? ` — ${broken} not answering` : " — all answering"}` : "never checked yet — the platform checks daily; --check asks now")}\n`,
  );
  return broken ? 1 : 0;
}

// --------------------------------------------------------------- billing

/**
 * `foldrun billing` — what the account has, and what it has been spending on.
 *
 * "The wallet is empty" was a thing you could only learn by opening the
 * dashboard, which means a run that stops paying for models looks like a
 * broken platform from the terminal. The balance goes first, and a negative
 * one is said in words.
 */
async function billingCmd(flags) {
  const url = platformFor(flags, "billing");
  const body = await remoteCall(url, flags, "/api/billing");
  const balance = Number(body.balanceUsd ?? 0);
  const entries = body.entries ?? [];

  console.log(`\n  ${balance > 0 ? c.green("✓") : c.red("✗")} balance ${c.bold(`$${balance.toFixed(2)}`)}  ${c.dim(body.enabled ? "billing on" : "billing off — nothing is charged on this install")}`);
  if (body.enabled && balance <= 0) {
    console.log(`  ${c.red("the wallet is empty")} ${c.dim("— the account is in overdraft; top it up before anything is expected to run")}`);
  }

  // What the platform is waiving says more than the balance does: a run
  // charged $0 with models waived is a run whose model credit is being
  // absorbed, and that is the state people mistake for "it is working".
  const waived = [...new Set(entries.flatMap((e) => e.waived ?? []))];
  if (waived.length) {
    console.log(`  ${c.amber("⏸")} ${c.dim(`${waived.join(", ")} ${waived.length === 1 ? "is" : "are"} being waived on recent runs — those lines are charged $0`)}`);
  }

  const limit = Number(flags.limit) > 0 ? Math.floor(Number(flags.limit)) : 15;
  const recent = entries.slice(0, limit);
  if (!recent.length) {
    console.log(`\n  ${c.dim("no ledger entries yet")}\n`);
    return 0;
  }

  console.log();
  const w = {
    when: Math.max(...recent.map((e) => when(e.t).length)),
    kind: Math.max(...recent.map((e) => String(e.kind).length)),
    usd: Math.max(...recent.map((e) => `$${Number(e.usd ?? 0).toFixed(4)}`.length)),
  };
  for (const e of recent) {
    const usd = Number(e.usd ?? 0);
    // What it was FOR: a run says which flow in which workspace, an
    // adjustment carries its own note, a top-up is itself.
    const about = e.flow ? `${e.workspace}/${e.flow}${e.runId ? c.dim(` ${e.runId}`) : ""}` : (e.note ?? "");
    console.log(
      `  ${usd < 0 ? c.red("−") : usd > 0 ? c.green("+") : c.dim("·")} ${c.dim(pad(when(e.t), w.when))}  ${pad(e.kind ?? "", w.kind)}  ` +
        `${pad(`$${Math.abs(usd).toFixed(4)}`, w.usd)}  ${firstLine(about, 70)}`,
    );
  }
  console.log(`\n  ${c.dim(`${entries.length} entr${entries.length === 1 ? "y" : "ies"} on the ledger — --limit <n> shows more of them`)}\n`);
  return 0;
}

// --------------------------------------------------------------- account

/** The events a notify block may name, as the platform validates them. */
const NOTIFY_EVENTS = ["failed", "awaiting-approval", "completed"];

/** The account's defaults, as one readable block. */
function printDefaults(d) {
  const notify = d.notify
    ? [d.notify.email, d.notify.url].filter(Boolean).join(", ") + c.dim(` on ${(d.notify.events ?? []).join(", ") || "nothing"}`)
    : c.dim("nobody is told anything");
  console.log(`\n  ${c.bold("account defaults")}  ${c.dim("every workspace here inherits these")}\n`);
  console.log(`  timezone     ${d.timezone ?? c.dim("unset — schedules read UTC")}`);
  console.log(`  notify       ${notify}`);
  console.log(`  budget       ${d.budget ? `$${d.budget.usd} per ${d.budget.period}` : c.dim("no cap")}`);
  console.log(`  concurrency  ${d.concurrency ?? c.dim("the plan's number")}`);
}

/**
 * `foldrun account` — the account's own settings, read and set.
 *
 * These four keys live in the account AGENTS.md frontmatter and reach every
 * workspace under it. The dashboard has had a form for them since they
 * existed; the terminal had nothing, so setting a timezone meant a raw PATCH
 * with a hand-built JSON body, which is exactly the door this CLI exists to
 * replace.
 *
 * `set notify` MERGES against what is there. The platform replaces the whole
 * notify block — that is how frontmatter scopes work — so setting an email
 * without reading the current events first would silently drop them.
 */
async function accountCmd(positional, flags) {
  const url = platformFor(flags, "account");
  const verb = positional[0];

  if (!verb) {
    const { defaults } = await remoteCall(url, flags, "/api/account");
    printDefaults(defaults ?? {});
    console.log(`\n  ${c.dim("foldrun account set timezone Australia/Sydney · set notify email you@example.com · set budget 60/month · clear budget")}\n`);
    return 0;
  }
  if (verb === "providers") return providersCmd(url, flags);
  if (verb !== "set" && verb !== "clear") {
    throw new Error(`unknown account verb "${verb}" — \`foldrun account\` shows them, \`set\` and \`clear\` change one, \`providers\` checks the model keys`);
  }

  const key = positional[1];
  const KEYS = ["timezone", "notify", "budget", "concurrency"];
  if (!KEYS.includes(key)) {
    throw new Error(`which setting? \`foldrun account ${verb} <${KEYS.join("|")}> …\``);
  }

  let patch;
  if (verb === "clear") {
    patch = { [key]: null };
  } else if (key === "notify") {
    // `set notify email you@example.com` / `set notify url https://…`, and
    // --events to change what is notified on.
    const channel = positional[2];
    const value = positional[3];
    if (channel !== "email" && channel !== "url") {
      throw new Error("`foldrun account set notify email <address>` or `set notify url <https://…>` — and --events failed,awaiting-approval,completed");
    }
    if (!value && flags.events === undefined) throw new Error(`\`foldrun account set notify ${channel} <value>\` — or --events alone to change only what is notified on`);
    const { defaults } = await remoteCall(url, flags, "/api/account");
    const current = defaults?.notify ?? {};
    const events =
      typeof flags.events === "string"
        ? flags.events.split(",").map((e) => e.trim()).filter(Boolean)
        : (current.events ?? ["failed", "awaiting-approval"]);
    const unknown = events.filter((e) => !NOTIFY_EVENTS.includes(e));
    if (unknown.length) throw new Error(`--events takes ${NOTIFY_EVENTS.join(", ")} — not ${unknown.join(", ")}`);
    patch = {
      notify: {
        ...(current.url ? { url: current.url } : {}),
        ...(current.email ? { email: current.email } : {}),
        ...(value ? { [channel]: value } : {}),
        events,
      },
    };
  } else {
    const value = positional[2];
    if (value === undefined) throw new Error(`\`foldrun account set ${key} <value>\` — or \`clear ${key}\` to unset it`);
    patch = { [key]: key === "concurrency" ? Number(value) : value };
  }

  const answer = await remoteCall(url, flags, "/api/account", { method: "PATCH", body: JSON.stringify(patch) });
  printDefaults(answer.defaults ?? {});
  console.log(`\n  ${c.green("✓")} ${verb === "clear" ? `${key} cleared` : `${key} set`} — every workspace in this account reads it\n`);
  return 0;
}

// ------------------------------------------- approvals, runs and reports
//
// What `logs` never answered. `logs` is a trail: it prints what happened,
// event by event, for one run you already knew the id of. These four are
// about the other three questions a person actually has — what is waiting
// for me, let it through or refuse it, what has run lately, and what did
// this one run actually do — and each of them reads the platform, because
// that is where the runs are.

/** A span in the shortest honest form: 850ms, 12s, 4m 20s, 2h 5m, 3d 4h. */
function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

/** How long ago an ISO timestamp was. */
const ago = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? humanDuration(Date.now() - Date.parse(iso)) : "—");

/** A local wall-clock stamp short enough for a column: "15 Sep 19:00". */
function when(iso) {
  const t = Date.parse(iso ?? "");
  if (Number.isNaN(t)) return "—";
  const d = new Date(t);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())} ${month} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `--since 24h`, `7d`, `90m`, `2w` — a window, in milliseconds. */
function parseSince(spec) {
  const m = /^(\d+(?:\.\d+)?)\s*([smhdw])$/i.exec(String(spec).trim());
  if (!m) throw new Error(`--since wants a span like 24h, 7d or 90m — not "${spec}"`);
  return Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[m[2].toLowerCase()];
}

/** What a run's work concluded: the verdict word its summary leads with —
 *  core's runVerdict, mirrored because the list is drawn without loading
 *  core. Null for a run whose summary leads with none. */
const verdictOf = (r) => {
  if (r.verdict !== undefined) return r.verdict;
  const m = /^(GOOD|BAD|QUIET|BLOCKED)(?![A-Za-z0-9_])/.exec(String(r.summary ?? "").replace(/^[\s#>*_`\-]+/, ""));
  return m ? m[1] : null;
};
/** A completed run's verdict beside its status: BLOCKED red, BAD amber. */
const verdictTag = (r) => {
  const v = r.status === "completed" ? verdictOf(r) : null;
  return v === "BLOCKED" ? c.red(v) : v === "BAD" ? c.amber(v) : v ? c.dim(v) : "";
};

/** The same mark everywhere a status is printed, so one glance reads alike. */
const statusMark = (s) =>
  s === "completed"
    ? c.green("✓")
    : s === "failed"
      ? c.red("✗")
      : s === "awaiting-approval"
        ? c.amber("⏸")
        : s === "skipped" || s === "expanded"
          ? c.dim("–")
          : c.amber("…");

/** What a run cost, from its steps — the only place the number exists. */
const runCost = (run) => (run.steps ?? []).reduce((sum, s) => sum + (s.costUsd ?? 0), 0);

/** How long a run took, or has been going. */
const runDuration = (run) =>
  run.startedAt ? humanDuration((run.finishedAt ? Date.parse(run.finishedAt) : Date.now()) - Date.parse(run.startedAt)) : "—";

/** Pad to a column width, counting characters a person sees, not escapes. */
const pad = (s, width) => String(s) + " ".repeat(Math.max(0, width - String(s).length));

/** One line of a step's or a run's prose — the first line that says anything. */
const firstLine = (text, width = 120) => {
  const line = String(text ?? "")
    .split("\n")
    .map((l) => l.replace(/^[#>*_\s-]+/, "").trim())
    .find(Boolean);
  return line ? (line.length > width ? `${line.slice(0, width - 1)}…` : line) : "";
};

/** Wrap prose to a width, so a long `ask:` stays inside the terminal. */
function wrap(text, width) {
  const out = [];
  for (const para of String(text ?? "").split("\n")) {
    let line = "";
    for (const word of para.trim().split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * These four commands read a platform and only a platform: a gate waiting
 * on a person is a thing that exists on a server, and a local `foldrun run`
 * asks the terminal it is running in. Said plainly rather than failing at
 * the fetch, which is how `--url` typos used to read.
 */
function platformFor(flags, what) {
  const url = remoteUrl(flags);
  if (!url) {
    throw new Error(
      `\`foldrun ${what}\` reads a running platform — \`foldrun login\`, or pass --url <url> (or set FOLDRUN_URL)`,
    );
  }
  return url;
}

/** Run at most `width` of these at once — fifteen desks, not fifteen bursts. */
async function pool(items, width, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i], i);
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return out;
}

/**
 * Which workspace holds this run.
 *
 * `--to` settles it. Otherwise the folder this terminal is standing in is
 * tried first — from a desk directory the run is almost always that desk's,
 * and one request beats fifteen — and only then does it fan out.
 */
async function workspaceOfRun(url, flags, layout, runId) {
  if (typeof flags.to === "string") return flags.to;
  const names = await remoteWorkspaceNames(url, flags);
  const here = takeWorkspace([], layout);
  const order = here && names.includes(here) ? [here, ...names.filter((n) => n !== here)] : names;
  if (!order.length) throw new Error(`no workspaces on ${url} — \`foldrun workspaces\` lists them`);

  const found = await pool(order, 8, async (ws) => {
    try {
      await remoteCall(url, flags, `/api/workspaces/${ws}/runs/${runId}`);
      return ws;
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  });
  const hit = found.find(Boolean);
  if (!hit) {
    throw new Error(
      `no run "${runId}" in any workspace on ${url} — \`foldrun runs\` lists them, and --to <workspace> looks in one`,
    );
  }
  return hit;
}

/**
 * A deliberate yes, or nothing happens.
 *
 * `expect` is what the person must type back — the run id, for the two
 * decisions that cannot be taken back: approving something outward, and
 * killing a run mid-step. --yes is the way to mean it without being asked,
 * and it is REQUIRED where there is no terminal to ask: a script that pipes
 * into this must say so, rather than being waved through by an empty read.
 */
async function confirmed(flags, verb, question, expect) {
  if (flags.yes === true) return true;
  if (!process.stdin.isTTY) {
    throw new Error(`${verb} needs a person — this is not a terminal, so pass --yes to mean it`);
  }
  const answer = (await promptVisible(`  ${question}`)).trim();
  return expect === undefined ? /^y(es)?$/i.test(answer) : answer === expect;
}

/** The steps of a run that are parked on a PERSON — not on a `wait: event`. */
const waitingSteps = (run) =>
  (run.steps ?? [])
    .map((s, i) => ({ step: s, index: i }))
    .filter(({ step }) => step.status === "awaiting-approval" && step.waitFor !== "event");

// ------------------------------------------------------------- approvals

/**
 * `foldrun approvals` — everything across the account that is waiting for a
 * person to say yes.
 *
 * One entry per GATE, the way /api/approvals counts them: a run with two `!`
 * steps in one group is two decisions, and a list that folded them into one
 * line named one agent and asked neither question.
 */
async function approvalsCmd(flags, layout) {
  const url = platformFor(flags, "approvals");
  const only = typeof flags.to === "string" ? flags.to : null;
  const { approvals = [] } = await remoteCall(url, flags, "/api/approvals");
  const waiting = only ? approvals.filter((a) => a.workspace === only) : approvals;

  if (!waiting.length) {
    console.log(`\n  ${c.dim(only ? `nothing is waiting on a person in ${only}` : "nothing is waiting on a person")}\n`);
    return 0;
  }

  // What each gate PREVIEWS lives on the run record, not on the index — a
  // gate that says "approve this" without naming the draft it is about is
  // a button, not a question. Best effort: a run that cannot be read still
  // gets its line.
  const runs = new Map();
  for (const ws of new Set(waiting.map((a) => a.workspace))) {
    const ids = [...new Set(waiting.filter((a) => a.workspace === ws).map((a) => a.runId))];
    await pool(ids, 6, async (id) => {
      try {
        runs.set(`${ws}/${id}`, await remoteCall(url, flags, `/api/workspaces/${ws}/runs/${id}`));
      } catch {
        /* the index already told us enough to name it */
      }
    });
  }

  console.log();
  for (const a of waiting) {
    const record = runs.get(`${a.workspace}/${a.runId}`);
    const step = record?.steps?.[a.step];
    console.log(
      `  ${c.amber("⏸")} ${c.bold(a.runId)}  ${a.workspace} · ${a.flow}  ${c.dim(`waiting ${ago(a.waitingSince)}`)}`,
    );
    console.log(`      ${c.dim(`step ${a.step + 1} · ${a.agent}${a.asked ? "" : " · no ask:, so its instruction"}`)}`);
    for (const line of wrap(a.question, 84)) console.log(`      ${line}`);
    const preview = step?.previewFiles ?? step?.preview ?? [];
    if (preview.length) console.log(`      ${c.dim(`previews storage/: ${preview.join(", ")}`)}`);
    if (record?.approveBy) console.log(`      ${c.dim(`expires ${when(record.approveBy)}`)}`);
    console.log();
  }
  console.log(
    `  ${c.dim(`${waiting.length} waiting — \`foldrun approve <run-id> --note "…"\` releases one, \`foldrun reject <run-id>\` refuses it`)}\n`,
  );
  return 0;
}

// -------------------------------------------------------- approve, reject

/**
 * `foldrun approve <run-id>` and `foldrun reject <run-id>`.
 *
 * Approving is an OUTWARD action: the step behind the gate is the one that
 * publishes, sends or posts, which is exactly why a person was asked. So it
 * says what it is about to release and waits to be told again, unless --yes
 * was passed deliberately. Nothing here approves implicitly.
 *
 * `--note` is not a comment. It rides the record into the step's prompt, so
 * "approve, but skip the Sydney batch" is an instruction the agent reads.
 */
async function decideCmd(decision, runId, flags, layout) {
  const url = platformFor(flags, decision);
  if (!runId) {
    throw new Error(`which run? \`foldrun ${decision} <run-id>\` — \`foldrun approvals\` lists what is waiting`);
  }
  const ws = await workspaceOfRun(url, flags, layout, runId);
  const run = await remoteCall(url, flags, `/api/workspaces/${ws}/runs/${runId}`);
  const waiting = waitingSteps(run);
  if (!waiting.length) {
    throw new Error(
      `${runId} in ${ws} is ${run.status} — no step of it is waiting on a person. \`foldrun approvals\` lists the ones that are`,
    );
  }

  const only = flags.step === undefined ? null : Number(flags.step) - 1;
  if (only !== null && !waiting.some(({ index }) => index === only)) {
    throw new Error(
      `step ${flags.step} of ${runId} is not waiting on a person — ${waiting.map(({ index }) => index + 1).join(", ")} ${waiting.length === 1 ? "is" : "are"}`,
    );
  }
  const chosen = only === null ? waiting : waiting.filter(({ index }) => index === only);
  const note = typeof flags.note === "string" ? flags.note : undefined;

  console.log(`\n  ${c.bold(run.flow)}  ${c.dim(`${ws} · ${runId}`)}`);
  for (const { step, index } of chosen) {
    console.log(`  ${c.amber("⏸")} step ${index + 1} · ${c.bold(step.agent)}  ${c.dim(firstLine(step.instruction))}`);
    for (const line of wrap(step.ask ?? "", 84)) console.log(`      ${line}`);
    const preview = step.previewFiles ?? step.preview ?? [];
    if (preview.length) console.log(`      ${c.dim(`previews storage/: ${preview.join(", ")}`)}`);
  }
  if (note) console.log(`  ${c.dim(`note the agent will read: ${note}`)}`);
  console.log(
    decision === "approve"
      ? `\n  ${c.yellow("!")} approving lets ${chosen.length === 1 ? "this step" : "these steps"} run — whatever it publishes, sends or posts, it does for real.`
      : `\n  ${c.dim(`rejecting fails ${chosen.length === 1 ? "this step" : "these steps"}, and the run with ${chosen.length === 1 ? "it" : "them"}.`)}`,
  );

  if (decision === "approve" && !(await confirmed(flags, "approving", `type the run id to approve (${runId}): `, runId))) {
    console.log(`\n  ${c.dim("nothing approved")}\n`);
    return 1;
  }

  const body = { decision, ...(note ? { note, ...(decision === "reject" ? { reason: note } : {}) } : {}), ...(only === null ? {} : { step: only }) };
  const answer = await remoteCall(url, flags, `/api/workspaces/${ws}/runs/${runId}/approve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const count = Array.isArray(answer.steps) ? answer.steps.length : chosen.length;
  console.log(
    `\n  ${decision === "approve" ? c.green("✓") : c.red("✗")} ${decision === "approve" ? "approved" : "rejected"} ${count} step${count === 1 ? "" : "s"} of ${runId}` +
      `\n  ${c.dim(`foldrun report ${runId} --to ${ws} — or logs ${runId} --to ${ws} --follow`)}\n`,
  );
  return 0;
}

// ------------------------------------------------------------------ stop

/**
 * `foldrun stop <run-id>` — kill a run in flight.
 *
 * The one thing you want at 3am when a flow is looping on a paid API, and
 * the one thing that had no command: it was a raw POST with a hand-written
 * bearer header, which means the workspace had to be remembered too. Here
 * the run id is enough.
 *
 * It says what it is about to destroy first. The step that is running has a
 * sandbox and has already spent something; stopping throws that work away
 * and keeps the charge, because the work was really done.
 */
async function stopCmd(runId, flags, layout) {
  const url = platformFor(flags, "stop");
  if (!runId) throw new Error("which run? `foldrun stop <run-id>` — `foldrun runs --status running` lists them");
  const ws = await workspaceOfRun(url, flags, layout, runId);
  const run = await remoteCall(url, flags, `/api/workspaces/${ws}/runs/${runId}`);

  if (run.status === "completed" || run.status === "failed") {
    // Not an error worth a stack: the thing you wanted — it is not running —
    // is already true. Said plainly, and exit 0, so a script that stops a
    // run it is not sure about does not fail on the good case.
    console.log(`\n  ${statusMark(run.status)} ${runId} in ${ws} already finished ${ago(run.finishedAt)} ago — nothing to stop\n`);
    return 0;
  }

  const live = (run.steps ?? []).map((s, i) => ({ step: s, index: i })).filter(({ step }) => step.status === "running");
  console.log(`\n  ${statusMark(run.status)} ${c.bold(run.flow)}  ${c.dim(`${ws} · ${runId}`)}`);
  console.log(`  ${c.dim(`${run.status} · started ${ago(run.startedAt)} ago · $${runCost(run).toFixed(4)} spent`)}`);
  for (const { step, index } of live) {
    console.log(`  ${c.amber("…")} step ${index + 1} of ${(run.steps ?? []).length} · ${c.bold(step.agent)}  ${c.dim(firstLine(step.instruction, 70))}`);
  }
  console.log(
    `\n  ${c.yellow("!")} stopping destroys the sandbox the running step is spending in and throws its work away. Finished steps keep their results, and every cost already incurred stays on the bill.`,
  );

  if (!(await confirmed(flags, "stopping a run", `type the run id to stop (${runId}): `, runId))) {
    console.log(`\n  ${c.dim("nothing stopped")}\n`);
    return 1;
  }

  const answer = await remoteCall(url, flags, `/api/workspaces/${ws}/runs/${runId}/stop`, { method: "POST" });
  console.log(
    `\n  ${c.green("✓")} stopped ${runId} in ${ws}${answer.status ? ` — now ${answer.status}` : ""}` +
      `\n  ${c.dim(`foldrun report ${runId} --to ${ws} for what it got through first`)}\n`,
  );
  return 0;
}

// ------------------------------------------------------------------ runs

/**
 * `foldrun runs` — what has run lately, across the account.
 *
 * `logs` without an id lists ONE workspace's runs, which is the wrong unit
 * for the question people actually ask in the morning: did anything fail
 * overnight, anywhere. So this one fans out and merges, newest first, and
 * carries each run's one-line summary — the sentence that says what it
 * found, not merely that it finished.
 */
async function runsCmd(flags, layout) {
  const url = platformFor(flags, "runs");
  const names = typeof flags.to === "string" ? [flags.to] : await remoteWorkspaceNames(url, flags);
  if (!names.length) {
    console.log(`\n  ${c.dim(`no workspaces on ${url}`)}\n`);
    return 0;
  }
  const limit = Number(flags.limit) > 0 ? Math.floor(Number(flags.limit)) : 20;
  const cutoff = flags.since === undefined ? null : Date.now() - parseSince(flags.since);
  const wanted =
    typeof flags.status === "string" ? new Set(flags.status.split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const verdicts =
    typeof flags.verdict === "string" ? new Set(flags.verdict.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)) : null;

  // Each desk is asked for its own newest rows before the merge, so one
  // busy workspace cannot crowd every quiet one out of the answer. With a
  // status or a window in play the ask is the API's ceiling, not `limit`:
  // the filter runs here, after the fetch, and a desk with twenty recent
  // successes was hiding its older failures from `--status failed` because
  // only its newest twenty of any status ever arrived.
  const perWorkspace = wanted || verdicts || cutoff !== null ? 500 : limit;
  const unreachable = [];
  const lists = await pool(names, 8, async (ws) => {
    try {
      const { runs = [] } = await remoteCall(url, flags, `/api/workspaces/${ws}/runs?limit=${perWorkspace}`);
      return runs.map((r) => ({ ...r, workspace: ws }));
    } catch (err) {
      unreachable.push([ws, explain(err)]);
      return [];
    }
  });

  const rows = lists
    .flat()
    .filter((r) => (wanted ? wanted.has(r.status) : true))
    .filter((r) => (verdicts ? r.status === "completed" && verdicts.has(verdictOf(r)) : true))
    .filter((r) => (cutoff === null ? true : Date.parse(r.startedAt) >= cutoff))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, limit);

  if (!rows.length) {
    const how = [wanted ? `status ${[...wanted].join(", ")}` : null, verdicts ? `verdict ${[...verdicts].join(", ")}` : null, flags.since ? `the last ${flags.since}` : null]
      .filter(Boolean)
      .join(" in ");
    console.log(`\n  ${c.dim(`no runs${how ? ` matching ${how}` : ""}${flags.to ? ` in ${flags.to}` : ""}`)}\n`);
    for (const [ws, why] of unreachable) console.error(`  ${c.red("✗")} ${ws}  ${c.dim(why)}`);
    return 0;
  }

  const cells = rows.map((r) => {
    const done = (r.steps ?? []).filter((s) => s.status === "completed" || s.status === "skipped").length;
    return {
      mark: r.status === "completed" && verdictOf(r) === "BLOCKED" ? c.red("⛔") : statusMark(r.status),
      when: when(r.startedAt),
      workspace: r.workspace,
      flow: r.flow,
      status: r.status,
      verdict: verdictTag(r),
      verdictWidth: (r.status === "completed" ? verdictOf(r) ?? "" : "").length,
      steps: `${done}/${(r.steps ?? []).length}`,
      took: runDuration(r),
      cost: `$${runCost(r).toFixed(2)}`,
      id: r.id,
      summary: firstLine(r.summary, 110),
    };
  });
  const widest = (key) => Math.max(...cells.map((x) => x[key].length));
  const w = {
    when: widest("when"),
    workspace: widest("workspace"),
    flow: widest("flow"),
    status: widest("status"),
    steps: widest("steps"),
    took: widest("took"),
    cost: widest("cost"),
  };

  console.log();
  for (const x of cells) {
    console.log(
      `  ${x.mark} ${c.dim(pad(x.when, w.when))}  ${pad(x.workspace, w.workspace)}  ${c.bold(pad(x.flow, w.flow))}  ` +
        `${pad(x.status, w.status)} ${x.verdict}${" ".repeat(Math.max(...cells.map((y) => y.verdictWidth)) - x.verdictWidth)}  ${c.dim(`${pad(x.steps, w.steps)}  ${pad(x.took, w.took)}  ${pad(x.cost, w.cost)}`)}  ${c.dim(x.id)}`,
    );
    if (x.summary) console.log(`      ${c.dim(x.summary)}`);
  }
  for (const [ws, why] of unreachable) console.error(`  ${c.red("✗")} ${ws}  ${c.dim(why)}`);
  console.log(`\n  ${c.dim("foldrun report <run-id> for the whole story; --status failed, --verdict blocked, --since 24h narrow this")}\n`);
  return 0;
}

// ---------------------------------------------------------------- report

/** Files a run wrote, as its own steps recorded them. */
function filesWritten(run) {
  const out = new Set();
  for (const step of run.steps ?? []) {
    for (const e of step.events ?? []) {
      const m = /^files: saved (.+)$/.exec(String(e.text ?? "").trim());
      if (m) for (const f of m[1].split(",")) out.add(f.trim());
    }
  }
  for (const f of run.memoryWrites ?? []) out.add(f);
  return [...out].filter(Boolean);
}

/** Every address a run said it published to, from its summary and conclusions. */
function published(run) {
  const text = [run.summary ?? "", ...(run.steps ?? []).map((s) => s.conclusion ?? s.result ?? "")].join("\n");
  return [...new Set((text.match(/https?:\/\/[^\s)"'<>\]]+/g) ?? []).map((u) => u.replace(/[.,;]+$/, "")))];
}

/** Whichever error this step recorded — on the step, or on its last try. */
const stepError = (step) => step.error ?? [...(step.tries ?? [])].reverse().find((t) => t.error)?.error ?? null;

/**
 * `foldrun report <run-id>` — one run, whole, readable without a browser.
 *
 * `logs <run-id>` prints every event of every step, which is the right tool
 * when you know what you are hunting and the wrong one when you are asking
 * "what did this do". This is the other half: the header, a line per step
 * with what it cost and whether its verify held, the first line of each
 * result, and — for the step that failed — the error and the last events
 * before it. Then the three things a person goes looking for afterwards:
 * what it wrote, what it published, and what is still waiting on them.
 */
async function reportCmd(runId, flags, layout) {
  const url = platformFor(flags, "report");
  if (!runId) throw new Error("which run? `foldrun report <run-id>` — `foldrun runs` lists them");
  const ws = await workspaceOfRun(url, flags, layout, runId);
  const run = await remoteCall(url, flags, `/api/workspaces/${ws}/runs/${runId}`);

  if (flags.json === true) {
    console.log(JSON.stringify(run, null, 2));
    return run.status === "failed" ? 1 : 0;
  }

  const tokens = (run.steps ?? []).reduce(
    (t, s) => ({ input: t.input + (s.tokens?.input ?? 0), output: t.output + (s.tokens?.output ?? 0) }),
    { input: 0, output: 0 },
  );
  const cost = runCost(run);

  const blocked = run.status === "completed" && verdictOf(run) === "BLOCKED";
  console.log(`\n  ${blocked ? c.red("⛔") : statusMark(run.status)} ${c.bold(run.flow)}  ${c.dim(run.id)}`);
  console.log(`  ${c.dim(`${ws} · ${run.status}`)}${verdictTag(run) ? ` ${verdictTag(run)}` : ""}${c.dim(run.test ? " · test run" : "")}`);
  console.log(`  ${c.dim(`started ${when(run.startedAt)} (${ago(run.startedAt)} ago) · ${runDuration(run)} · $${cost.toFixed(4)}`)}`);
  if (tokens.input || tokens.output) {
    console.log(`  ${c.dim(`${tokens.input.toLocaleString()} in / ${tokens.output.toLocaleString()} out tokens`)}`);
  }
  if (run.budgetUsd) console.log(`  ${c.dim(`budget $${Number(run.budgetUsd).toFixed(2)}`)}`);
  if (run.summary) {
    console.log();
    for (const line of wrap(run.summary, 84)) console.log(`  ${line}`);
  }

  console.log();
  (run.steps ?? []).forEach((step, i) => {
    const bits = [
      step.status,
      step.attempts > 1 ? `${step.attempts} attempts` : null,
      step.costUsd ? `$${step.costUsd.toFixed(4)}` : null,
      step.startedAt && step.finishedAt
        ? humanDuration(Date.parse(step.finishedAt) - Date.parse(step.startedAt))
        : null,
    ].filter(Boolean);
    console.log(
      `  ${statusMark(step.status)} ${pad(`${i + 1}.`, 4)}${c.dim(`g${step.group ?? 1}`)} ${c.bold(step.agent)}  ${c.dim(bits.join(" · "))}`,
    );
    if (step.verify) {
      // A step that completed with a verify held it — the runtime fails the
      // step otherwise, so status IS the verdict, and saying it out loud is
      // the difference between "completed" and "completed, and checked".
      const held = step.status === "completed";
      console.log(`      ${held ? c.green("✓") : c.red("✗")} ${c.dim(`verify: ${firstLine(step.verify, 80)}`)}`);
    }
    if (step.approvedAt) {
      console.log(`      ${c.green("✓")} ${c.dim(`approved ${when(step.approvedAt)}${step.approvalNote ? ` — "${step.approvalNote}"` : ""}`)}`);
    }
    if (step.status === "awaiting-approval") {
      console.log(`      ${c.amber("⏸")} ${c.dim(step.waitFor === "event" ? "waiting on an event" : `waiting on a person: ${firstLine(step.ask ?? step.instruction, 70)}`)}`);
    }
    const said = firstLine(step.conclusion ?? step.result, 96);
    if (said) console.log(`      ${said}`);
    const err = stepError(step);
    if (err) {
      console.log(`      ${c.red(firstLine(err, 96))}`);
      for (const e of (step.events ?? []).slice(-4)) {
        console.log(`      ${EVENT_MARK(e)} ${c.dim(firstLine(e.text, 92))}`);
      }
    }
  });

  const files = filesWritten(run);
  const links = published(run);
  const waiting = waitingSteps(run);
  if (files.length || links.length || waiting.length) console.log();
  if (files.length) console.log(`  ${c.dim(`wrote  ${files.join(", ")}`)}`);
  for (const link of links) console.log(`  ${c.dim(`published  ${link}`)}`);
  for (const { step, index } of waiting) {
    console.log(`  ${c.amber("⏸")} step ${index + 1} · ${step.agent} is waiting on a person — \`foldrun approve ${run.id} --to ${ws}\``);
  }
  console.log();
  return run.status === "failed" ? 1 : 0;
}

// ------------------------------------------------- one tool, one agent, alone

/** Which workspace a platform command is about: --to, else the folder we stand in. */
function platformWorkspace(flags, layout, what) {
  // A folder with no agents in it is not a workspace, whatever it is called,
  // and guessing from its name posts to a workspace that does not exist —
  // which comes back as the platform's 404 about something else entirely.
  const guess = layout?.kind === "empty" ? null : takeWorkspace([], layout);
  const ws = typeof flags.to === "string" ? flags.to : guess;
  if (!ws) {
    throw new Error(
      `which workspace is it in? \`foldrun ${what} --to <workspace>\`${
        layout?.workspaces?.length ? ` — this account has ${layout.workspaces.join(", ")}` : ""
      }`,
    );
  }
  return ws;
}

/**
 * A tool test runs the tool for real — an HTTP request, a script, an MCP
 * handshake — and a script that scrapes a site or waits on a slow API takes
 * as long as it takes. Thirty seconds is right for asking the platform a
 * question and wrong for asking it to DO something, so this one waits five
 * minutes unless told otherwise.
 */
const TOOL_TEST_SECONDS = 300;

/**
 * `foldrun tool test <name> [key=value …]` — exercise one tool, alone.
 *
 * No model, no run, no flow: the point is to find out whether the tool works
 * BEFORE a flow depends on it. Otherwise the first anyone hears of a wrong
 * `base:` or an unset secret is an agent, mid-turn, quietly not using the
 * tool and saying something plausible instead.
 *
 * Arguments are `key=value` pairs because that is what the tool declares in
 * `args:` — the platform passes them as the same long flags a run would.
 */
async function toolTestCmd(positional, flags, layout) {
  const url = platformFor(flags, "tool test");
  const name = positional[1];
  if (!name) {
    throw new Error("which tool? `foldrun tool test <name> --to <workspace>` — `foldrun tool new <name>` makes one");
  }
  const ws = platformWorkspace(flags, layout, `tool test ${name}`);

  const args = {};
  for (const pair of positional.slice(2)) {
    const eq = pair.indexOf("=");
    if (eq < 1) {
      throw new Error(
        `"${pair}" is not an argument — \`foldrun tool test ${name} key=value\`, one pair per argument the tool declares`,
      );
    }
    args[pair.slice(0, eq)] = pair.slice(eq + 1);
  }

  const seconds = explicitTimeout(flags) ?? TOOL_TEST_SECONDS;
  let r;
  try {
    r = await remoteCall(
      url,
      flags,
      `/api/workspaces/${encodeURIComponent(ws)}/tools/${encodeURIComponent(name)}/test`,
      {
        method: "POST",
        // `path:` is the http transport's probe path, appended to `base:`.
        body: JSON.stringify({ args, ...(typeof flags.path === "string" ? { path: flags.path } : {}) }),
      },
      { seconds },
    );
  } catch (err) {
    if (explain(err).includes("did not answer")) {
      throw new Error(
        `${name} was still running ${seconds}s in, so the test was given up on — the tool itself may still be going on the platform. \`--timeout <seconds>\` waits longer.`,
      );
    }
    throw err;
  }

  const mark = r.ok ? c.green("✓") : c.red("✗");
  console.log(`\n  ${mark} ${c.bold(name)}  ${c.dim(`${r.transport ?? "?"} · ${ws} · ${humanDuration(r.ms ?? 0)}`)}`);
  if (r.summary) console.log(`  ${c.dim(r.summary)}`);

  // Names only. The platform never sends a secret's value and neither does
  // this — "which one did you not set" is the whole of the useful half.
  if (r.missingSecrets?.length) {
    console.log();
    for (const s of r.missingSecrets) {
      console.log(`  ${c.red("✗")} ${c.bold(s)} ${c.dim(`is not set — foldrun secrets set ${s}`)}`);
    }
  }

  // Whatever the tool printed: a script's stdout and stderr together, an
  // HTTP response body, an MCP server's tool list.
  if (r.detail) {
    console.log();
    for (const line of String(r.detail).split("\n")) console.log(`    ${line}`);
  }

  console.log(
    `\n  ${c.dim(
      r.ok
        ? "it works — a flow can depend on it"
        : `not working yet — fix it, \`foldrun deploy\`, and test again${
            Object.keys(args).length ? "" : "; a tool that takes arguments needs them: key=value"
          }`,
    )}\n`,
  );
  return r.ok ? 0 : 1;
}

/**
 * `foldrun agent run <name> --task "…"` — one agent, once, on the platform.
 *
 * A flow of one step, without a flow file: the way to try a desk's agent on
 * a real task before wiring it into anything, and the way to ask one a
 * question that does not deserve a schedule.
 */
async function agentRunCmd(positional, flags, layout) {
  const url = platformFor(flags, "agent run");
  const name = positional[1];
  if (!name) throw new Error('which agent? `foldrun agent run <name> --to <workspace> --task "…"`');
  const ws = platformWorkspace(flags, layout, `agent run ${name}`);
  const task = typeof flags.task === "string" ? flags.task.trim() : "";
  if (!task) {
    throw new Error(`what should ${name} do? pass --task "<text>" — an agent run is one instruction and nothing else`);
  }

  // --wait asks in short pieces, exactly as `invoke` does: whatever sits in
  // front of the platform cuts a request that stays silent too long, and an
  // agent can think for many minutes.
  const WAIT_PIECE_S = 25;
  const wait = flags.wait === true ? `?wait=true&timeout=${WAIT_PIECE_S}` : "";
  const base = `/api/workspaces/${encodeURIComponent(ws)}/agents/${encodeURIComponent(name)}`;

  // A waited run that FAILS is answered with 500 and a full record — the
  // answer to the question, not a fault in the call. So the run id is taken
  // off it and the report is printed like any other.
  const waited = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (flags.wait === true && err?.body?.runId) return err.body;
      throw err;
    }
  };

  let body = await waited(() =>
    remoteCall(url, flags, `${base}/run${wait}`, {
      method: "POST",
      // --test: the platform marks the run a test run — sends refused or sunk
      // at the proxy, send-capable secrets withheld, state/ kept.
      body: JSON.stringify({ task, ...(flags.test === true ? { test: true } : {}) }),
    }),
  );
  const runId = body?.runId;
  if (!runId) throw new Error(`${url} started no run for ${name} — ${JSON.stringify(body).slice(0, 200)}`);

  if (flags.wait !== true) {
    console.log(
      `\n  ${c.green("✓")} queued ${c.bold(runId)}${body.test ? ` ${c.amber("TEST")}` : ""}  ${c.dim(`${name} · ${ws}`)}`,
    );
    console.log(`  ${c.dim(`foldrun report ${runId} --to ${ws}`)}`);
    console.log(`  ${c.dim(`foldrun logs ${runId} --to ${ws} --follow`)}\n`);
    return 0;
  }

  while (body?.timedOut === true) {
    body = await waited(() => remoteCall(url, flags, `/api/workspaces/${encodeURIComponent(ws)}/runs/${runId}${wait}`));
  }
  // The same report `foldrun report` prints, from the same code — a summary
  // written twice is a summary that disagrees with itself by Friday.
  return reportCmd(runId, { ...flags, to: ws }, layout);
}

/**
 * `foldrun check --to <workspace>` — validate the copy that is DEPLOYED.
 *
 * Everything else `check` does is about the folder in front of you. But a
 * workspace can be edited through the API, by an agent or by `foldrun source
 * put`, and until now the only way to find out whether what landed there was
 * valid was to spend a run and read the failure.
 *
 * The files come down into a temporary folder and the ordinary local check
 * runs over them, so there is exactly one copy of the rules. The library is
 * not fetched: `check` already asks the platform what its library holds, by
 * name, which is the half that matters for `tools:` and `skills:`.
 */
async function checkRemote(flags, layout) {
  const url = platformFor(flags, "check --to <workspace>");
  const ws = platformWorkspace(flags, layout, "check");
  const { isSourcePath } = await core();

  const files = await remoteWorkspaceFiles(url, flags, ws, isSourcePath);
  if (!files.size) {
    throw new Error(`no source files in "${ws}" on ${url} — \`foldrun workspaces\` lists what is there`);
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-check-"));
  // Under `workspaces/` so the account root above it is the shape the core
  // expects — and empty, so nothing on this laptop can be mistaken for part
  // of what is deployed.
  const dir = path.join(root, "workspaces", ws);
  const before = { workspace: process.env.FOLDRUN_WORKSPACE, account: process.env.FOLDRUN_ACCOUNT };
  try {
    for (const [rel, content] of files) {
      const abs = path.join(dir, rel);
      // A path from the platform is still a path from somewhere else.
      if (!abs.startsWith(dir + path.sep)) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    console.log(`\n  ${c.bold(ws)}  ${c.dim(`the deployed copy on ${url} · ${files.size} file${files.size === 1 ? "" : "s"}`)}`);
    process.env.FOLDRUN_WORKSPACE = dir;
    process.env.FOLDRUN_ACCOUNT = root;
    const code = await check(dir, flags);
    console.log(`  ${c.dim(`checked what is deployed, not this folder — ${ws} · ${url}`)}\n`);
    return code;
  } finally {
    if (before.workspace === undefined) delete process.env.FOLDRUN_WORKSPACE;
    else process.env.FOLDRUN_WORKSPACE = before.workspace;
    if (before.account === undefined) delete process.env.FOLDRUN_ACCOUNT;
    else process.env.FOLDRUN_ACCOUNT = before.account;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function run(command, positional, flags, workspace, layout) {
  // Nothing outside the CLI's own entry point passes a layout — the tests
  // that call run() directly, an embedder. A lone workspace is the safe
  // reading of "no layout given", and the one every command handled before
  // account folders existed.
  layout ??= { kind: "flat", accountRoot: path.resolve(workspace ?? ".", ".."), workspacesDir: null, workspaceDir: path.resolve(workspace ?? "."), workspace: path.basename(path.resolve(workspace ?? ".")), workspaces: [path.basename(path.resolve(workspace ?? "."))] };
  switch (command) {
    case "login":
      // `foldrun login` signs this machine in to the platform. `foldrun login
      // <site> --url …` is the other direction: a browser window for a person
      // to sign in to a site, and the session stored for an agent to wear.
      return positional.length ? siteLogin(positional, flags, layout) : login(flags);
    case "logout":
      return logout(flags);
    case "whoami":
      return whoami(flags);
    case "doctor":
      return doctor(flags);
    case "keys":
      return keysCmd(positional, flags);
    case "accounts":
    case "profiles":
      return accountsCmd(positional);
    case "use":
    case "switch":
      return useCmd(positional);
    case "init":
      return init(workspace, flags.from, flags);
    case "new":
      return newWorkspace(positional[0], flags, layout);
    case "check":
      // A coding agent is running `check` in a folder without the current
      // rules: write them, once, and say so — what `next dev` does.
      if (layout.kind !== "empty" && codingAgent() && !hasCurrentAgentRules(layout.accountRoot)) {
        const r = writeAgentFiles(layout.accountRoot);
        console.log(`  ${c.dim(`coding-agent rules written for ${codingAgent()} — AGENTS.md ${r.agentsMd}, CLAUDE.md ${r.claudeMd}; read \`foldrun docs\` before editing`)}`);
      }
      // --to names a workspace on a PLATFORM, so there is nothing local to
      // check and the folder this terminal stands in is beside the point.
      return typeof flags.to === "string"
        ? checkRemote(flags, layout)
        : layout.kind === "account"
          ? checkAccount(layout, flags)
          : check(workspace, flags);
    case "pull":
      return pullCmd(layout, flags, positional[0]);
    case "status":
      return statusCmd(layout, flags, positional[0]);
    case "workspaces":
      return workspacesCmd(positional, flags, layout);
    case "extract":
      return extract(workspace, flags);
    case "deploy":
      return deploy(positional[0] ?? ".", flags, layout);
    case "run":
      needsOne(layout, "run");
      return runTarget(positional[0], flags);
    case "eval":
      needsOne(layout, "eval");
      return runEvals(positional[0]);
    case "probe":
      return probeCmd(positional[0]);
    case "connect":
      return connect(positional, flags);
    case "secrets":
      return secretsCmd(positional, flags, layout);
    case "logs":
      return logsCmd(positional, flags, layout);
    case "runs":
      // `runs` was a second spelling of `logs`, and --local keeps it one:
      // the local store has no table to draw across workspaces, because a
      // folder on a laptop is one workspace.
      return flags.local === true ? logsCmd(positional, flags, layout) : runsCmd(flags, layout);
    case "approvals":
      return approvalsCmd(flags, layout);
    case "approve":
    case "reject":
      return decideCmd(command, positional[0], flags, layout);
    case "report":
      return reportCmd(positional[0], flags, layout);
    case "stop":
      return stopCmd(positional[0], flags, layout);
    case "rerun":
      return rerunCmd(positional[0], flags, layout);
    case "account":
      return accountCmd(positional, flags);
    case "schedule":
      return scheduleCmd(flags);
    case "triggers":
      return triggersCmd(flags, layout);
    case "guide":
      return guideCmd(flags, layout);
    case "docs":
      return docsCmd(positional, flags);
    case "billing":
      return billingCmd(flags);
    case "storage":
      return storageCmd(positional, flags, layout);
    case "agent":
      // `new` scaffolds one here; `run` runs one there. The noun is the same
      // thing in both cases, which is why they share a command.
      return positional[0] === "run"
        ? agentRunCmd(positional, flags, layout)
        : scaffoldCmd("agents", positional, flags, layout);
    case "flow":
      return scaffoldCmd("flows", positional, flags, layout);
    case "tool":
      return positional[0] === "test"
        ? toolTestCmd(positional, flags, layout)
        : scaffoldCmd("tools", positional, flags, layout);
    case "invoke":
      return invoke(positional[0], flags);
    case "source":
      return sourceCmd(positional, flags);
    case "open":
      return openCmd(positional, flags);
    default:
      throw new Error(`unknown command "${command}" — try \`foldrun --help\``);
  }
}
