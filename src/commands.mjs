// CLI commands. Kept separate from bin/ so the environment is set before the
// core is imported — single-workspace mode is read at module load.

import fs from "node:fs";
import path from "node:path";

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
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

async function init(workspace, from) {
  // The same definition the dashboard's "+ New workspace" uses — see
  // core/src/starter.ts for why it is not two lists.
  const { starterFiles, syncWorkspaceBundles, ensureAccountFiles } = await core();

  // A template is a source, a workspace is a destination. Keeping the two
  // words apart is the whole reason `templates/` is not called `examples/`:
  // there is one place a workspace lives, and it is wherever you make one.
  if (from && !fs.existsSync(from)) {
    throw new Error(`no template at ${from} — pass a directory, e.g. --from templates/hello`);
  }
  const files = from
    ? templateFilesFrom(from)
    : starterFiles(path.basename(path.resolve(workspace)));

  // Whatever the source, the new workspace must ignore the key that decrypts
  // its secrets. A template does not carry one — it is a source, not a
  // repository — so copying a template verbatim would hand back the very hole
  // the starter's .gitignore exists to close.
  if (!files.some((f) => f.path === ".gitignore")) {
    const guard = starterFiles("x").find((f) => f.path === ".gitignore");
    if (guard) files.unshift(guard);
  }

  if (fs.existsSync(workspace) && fs.readdirSync(workspace).length > 0) {
    const clashes = files.filter((f) => fs.existsSync(path.join(workspace, f.path)));
    if (clashes.length) {
      throw new Error(`${workspace} already has ${clashes[0].path} — refusing to overwrite`);
    }
  }
  for (const { path: rel, content } of files) {
    const file = path.join(workspace, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  // knowledge/ and memory/ are OKF bundles, and a bundle without its root
  // index.md declares no okf_version — so `foldrun init` produced a directory
  // of valid concepts that no consumer could tell the version of.
  syncWorkspaceBundles(workspace);

  // The account scope, one directory up — the same place libraryDir points on
  // a laptop, so `my-desk/` ends up beside the `AGENTS.md` and `library/` that
  // cover it. accountDir cannot answer here: nothing has pinned this process
  // to the new workspace yet, so it is passed explicitly. Listed below with a
  // `../` prefix because init writing outside its target should be visible,
  // not discovered later.
  const account = path.resolve(workspace, "..");
  const accountWritten = ensureAccountFiles("default", account).map((rel) => `../${rel}`);

  console.log(`\n  ${c.green("created")} ${workspace}\n`);
  for (const { path: rel } of files) console.log(`    ${c.dim(rel)}`);
  for (const rel of accountWritten) console.log(`    ${c.dim(rel)}`);
  const flow = files
    .map((f) => f.path.match(/^flows\/(.+)\.md$/)?.[1])
    .find(Boolean);
  console.log(`
  ${c.bold("Next")}
    foldrun check ${workspace}${" ".repeat(Math.max(1, 16 - workspace.length))}${c.dim("validate it — costs nothing")}
    foldrun run ${flow ?? "publish"} --workspace ${workspace}   ${c.dim("run the flow")}
`);
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
 * safe to run against a live workspace: `use: [x]` in an agent still names
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
    const data = Object.fromEntries(
      check[1]
        .split("\n")
        .map((l) => /^([a-z_-]+):\s*(.*)$/.exec(l))
        .filter(Boolean)
        .map((m) => [m[1], m[2]]),
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

async function check(workspace) {
  const {
    listAgents, listFlows, readBundle, conformanceIssues, dateIssues, listEvals, lintFlow,
    workspaceTools, libraryTools, checkFormatVersion, missingToolPrograms,
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
  // What `use:` can actually name. The runtime resolves nearest-wins across
  // both scopes, so a checker that only looked at the workspace called a
  // working agent broken — an error, in CI, for an account library tool that
  // runs fine. Mirror the runtime exactly; the summary still counts what this
  // workspace itself defines.
  const usable = { ...libraryTools(T), ...tools };
  const agentNames = new Set(agents.map((a) => a.name));
  const imported = importedAgentNames(workspace, agentNames);
  for (const n of imported) agentNames.add(n);
  const flowNames = new Set(flows.map((f) => f.name));

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

    for (const t of a.use) {
      if (!usable[t]) {
        note(
          "error",
          `agents/${a.name}`,
          `use: [${t}] — no tools/${t}/tool.md or tools/${t}.md in this workspace or the account library`,
        );
      }
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
    for (const w of lintFlow(f)) note("warn", `flows/${f.file}`, w.message, w.line);
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
    const tag = p.level === "error" ? c.red("error") : c.amber(" warn");
    console.log(`  ${tag}  ${c.bold(p.where)}  ${p.message}`);
  }
  const summary = `${agentNames.size} agents · ${flows.length} flows · ${evals.length} evals · ${Object.keys(tools).length} tools`;
  console.log(
    problems.length === 0
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

/**
 * Credentials come from ANTHROPIC_API_KEY or, more often on a laptop, from an
 * existing Claude Code login. Requiring the key outright would lock out anyone
 * already authenticated — a bad first run for the most likely user.
 */
function assertCredentials() {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return;
  const home = process.env.HOME ?? "";
  if (home && fs.existsSync(path.join(home, ".claude"))) return; // Claude Code login
  throw new Error(
    "no credentials — set ANTHROPIC_API_KEY, or log in with Claude Code.\n" +
      "  `foldrun check` works without either.",
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

  let run;
  if (asFlow) {
    const flow = loadFlow(T, P, name);
    if (!flow) throw new Error(`no agent or flow called "${name}"`);
    const steps = flags.task
      ? flow.steps.map((s, i) =>
          i === 0 ? { ...s, instruction: `${s.instruction}\n\n<run_task>\n${flags.task}\n</run_task>` } : s,
        )
      : flow.steps;
    run = startFlowRun(T, P, steps, flow.name, flow.model);
  } else {
    run = startFlowRun(T, P, [{ agent: name, instruction: flags.task ?? "", group: 1, optional: false }], `cli:${name}`);
  }

  console.log(`\n  ${c.bold(run.flow)}  ${c.dim(run.id)}\n`);
  const seen = new Map();
  for (;;) {
    const current = readRun(T, P, run.id);
    if (!current) break;
    current.steps.forEach((step, i) => {
      const from = seen.get(i) ?? 0;
      for (const e of step.events.slice(from)) {
        const mark = e.type === "error" ? c.red("✗") : e.type === "tool" ? c.dim("→") : c.dim("·");
        console.log(`  ${mark} ${c.dim(step.agent)}  ${e.text.split("\n")[0].slice(0, 140)}`);
      }
      seen.set(i, step.events.length);
    });
    if (current.finishedAt) {
      const cost = current.steps.reduce((s, x) => s + (x.costUsd ?? 0), 0);
      const ok = current.status === "completed";
      console.log(
        `\n  ${ok ? c.green("✓") : c.red("✗")} ${current.status} · $${cost.toFixed(4)}\n`,
      );
      return ok ? 0 : 1;
    }
    if (current.status === "awaiting-approval") {
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
  const { probeModel, resolveModel, parseProvider, providerEnvFor, resolveEffort, translatorSpecFor, startTranslator, providerPreset } = await core();

  // The workspace's provider block, resolved the way a run resolves it —
  // ${SECRET} values come from the process env here: the CLI's vault is the
  // shell, which is where a laptop keeps its keys anyway. A Chat-Completions
  // provider gets the same translator a run would, on loopback, for the
  // length of the probe — so what passes here passes there.
  let env = { ...process.env };
  let translator = null;
  try {
    const matter = (await import("gray-matter")).default;
    const fm = matter(fs.readFileSync(path.join(process.cwd(), "AGENTS.md"), "utf8")).data;
    const spec = parseProvider(fm.provider);
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
  } catch {
    // no AGENTS.md, or no provider block — Anthropic direct, like a run
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
  const token = flags.token ?? process.env.FOLDRUN_TOKEN;
  if (!token) {
    throw new Error(
      "deploying to a server needs an API key — set FOLDRUN_TOKEN, or pass --token.\n" +
        "  Create one in the dashboard under Settings → API keys.",
    );
  }
  const endpoint = `${url.replace(/\/+$/, "")}/api/workspaces/${encodeURIComponent(workspace)}/deploy`;

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
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

  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error(`${body.error ?? "unauthorized"} — check FOLDRUN_TOKEN`);
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

async function deploy(source, flags) {
  const { readTree, planDeploy, deployWorkspace, deployedCommit } = await core();

  if (!fs.existsSync(source)) throw new Error(`no such directory: ${source}`);
  const workspace = flags.to ?? path.basename(path.resolve(source));
  const tenant = flags.tenant ?? "default";

  const files = readTree(source);

  // Two destinations, one command. Without --url the workspace is written
  // straight to the installation on this machine; with one it is POSTed to a
  // running platform, which is what a laptop or a CI job does.
  const url = flags.url ?? process.env.FOLDRUN_URL;
  const plan = url
    ? await deployOverHttp(url, workspace, files, flags)
    : flags["dry-run"]
      ? planDeploy(tenant, workspace, files)
      : deployWorkspace(tenant, workspace, files, {
          commit: flags.commit ?? null,
          force: flags.force === true,
        });

  console.log(
    `\n  ${c.bold(url ? `${url} ${workspace}` : `${tenant}/${workspace}`)} ` +
      `${c.dim(`← ${path.resolve(source)}`)}`,
  );
  console.log(
    `  ${c.dim(`${files.length} files · +${plan.added.length} ~${plan.updated.length} -${plan.removed.length}`)}\n`,
  );

  const show = (label, list, colour) => {
    for (const f of list.slice(0, 20)) console.log(`    ${colour(label)} ${f}`);
    if (list.length > 20) console.log(`    ${c.dim(`… and ${list.length - 20} more`)}`);
  };
  show("+", plan.added, c.green);
  show("~", plan.updated, c.dim);
  show("-", plan.removed, c.red);

  if (plan.issues.length) {
    console.log(`\n  ${c.red(`${plan.issues.length} problem${plan.issues.length === 1 ? "" : "s"}`)} — nothing was deployed\n`);
    for (const i of plan.issues) console.log(`    ${c.red("✗")} ${c.bold(i.where)}  ${i.message}`);
    console.log();
    return 1;
  }

  if (plan.blockedBy.length && !flags.force) {
    console.log(
      `\n  ${c.amber("⏸")} ${plan.blockedBy.length} run${plan.blockedBy.length === 1 ? " is" : "s are"} still using these files: ` +
        `${plan.blockedBy.join(", ")}\n    ${c.dim("wait for them to finish, or --force to deploy anyway")}\n`,
    );
    return 1;
  }

  if (flags["dry-run"]) {
    console.log(`\n  ${c.dim("checks out — run without --dry-run to deploy")}\n`);
    return 0;
  }

  const at = url ? { commit: plan.commit } : deployedCommit(tenant, workspace);
  console.log(
    `\n  ${c.green("✓")} deployed${at?.commit ? ` ${c.dim(at.commit.slice(0, 8))}` : ""}` +
      `${plan.preserved ? c.dim(` · kept ${plan.preserved} file${plan.preserved === 1 ? "" : "s"} the agents own`) : ""}\n`,
  );
  return 0;
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

const remoteUrl = (flags) => flags.url ?? process.env.FOLDRUN_URL;

async function remoteCall(url, flags, apiPath, init = {}) {
  const token = flags.token ?? process.env.FOLDRUN_TOKEN;
  if (!token) throw new Error("no API key — pass --token or set FOLDRUN_TOKEN");
  const res = await fetch(new URL(apiPath, url), {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${apiPath} → HTTP ${res.status}`);
  return body;
}

/**
 * `foldrun secrets set|ls|rm` — the vault, from the terminal.
 *
 * Local by default (the workspace's own secrets.json, encrypted under the
 * install key); with --url/FOLDRUN_URL the same three verbs go to a running
 * platform. Values are prompted without echo unless piped or passed with
 * --value, and are never printed back by any verb.
 */
async function secretsCmd(positional, flags) {
  const [verb, name] = positional;
  const url = remoteUrl(flags);
  const scope = flags.account === true ? undefined : flags.to ?? "workspace";

  if (verb === "ls" || verb === undefined) {
    const entries = url
      ? (await remoteCall(url, flags, `/api/secrets${flags.to ? `?workspace=${flags.to}` : ""}`)).secrets
      : (await core()).listSecrets("default", "workspace");
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
          body: JSON.stringify({ name, oauth2: config, workspace: flags.to }),
        });
      } else {
        (await core()).setOAuth2Secret("default", name, config, scope === undefined ? undefined : "workspace");
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
        body: JSON.stringify({ name, value, workspace: flags.to }),
      });
    } else {
      (await core()).setSecret("default", name, value, scope === undefined ? undefined : "workspace");
    }
    console.log(`\n  ${c.green("✓")} ${name} stored — declare it in agent.md under \`secrets:\` to use it\n`);
    return 0;
  }

  if (verb === "rm") {
    if (url) {
      await remoteCall(url, flags, "/api/secrets", {
        method: "DELETE",
        body: JSON.stringify({ name, workspace: flags.to }),
      });
    } else {
      (await core()).deleteSecret("default", name, scope === undefined ? undefined : "workspace");
    }
    console.log(`\n  ${c.green("✓")} ${name} removed\n`);
    return 0;
  }

  throw new Error(`unknown secrets verb "${verb}" — set, ls or rm`);
}

// ---------------------------------------------------------------- logs

const EVENT_MARK = (e) =>
  e.type === "error" ? c.red("✗") : e.type === "tool" ? c.dim("→") : c.dim("·");

/**
 * `foldrun logs [run-id]` — without an id, the recent runs; with one, that
 * run's whole event log. `--follow` keeps tailing a live run.
 */
async function logsCmd(positional, flags) {
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

  const wait = flags.wait === true ? "?wait=true" : "";
  // --from N starts at step N of the flow as its file numbers them; the
  // earlier steps are recorded as skipped. Mutually exclusive with --task
  // server-side (the task goes to step 1, which --from skips).
  const from = flags.from !== undefined ? Number(flags.from) : undefined;
  const body = await remoteCall(url, flags, `/api/workspaces/${ws}/flows/${target}/run${wait}`, {
    method: "POST",
    body: JSON.stringify({
      task: typeof flags.task === "string" ? flags.task : "",
      ...(from !== undefined ? { from } : {}),
    }),
  });

  if (!flags.wait) {
    console.log(`\n  ${c.green("✓")} queued ${c.bold(body.runId)} — ${c.dim(`foldrun logs on the server, or ${url}/dashboard`)}\n`);
    return 0;
  }
  const run = body.run ?? body;
  const ok = (run.status ?? body.status) === "completed";
  if (body.result) console.log(`\n${body.result}\n`);
  console.log(`  ${ok ? c.green("✓") : c.red("✗")} ${run.status ?? body.status ?? "finished"}${body.costUsd != null ? ` · $${Number(body.costUsd).toFixed(4)}` : ""}\n`);
  return ok ? 0 : 1;
}

export async function run(command, positional, flags, workspace) {
  switch (command) {
    case "init":
      return init(workspace, flags.from);
    case "check":
      return check(workspace);
    case "extract":
      return extract(workspace, flags);
    case "deploy":
      return deploy(positional[0] ?? ".", flags);
    case "run":
      return runTarget(positional[0], flags);
    case "eval":
      return runEvals(positional[0]);
    case "probe":
      return probeCmd(positional[0]);
    case "secrets":
      return secretsCmd(positional, flags);
    case "logs":
      return logsCmd(positional, flags);
    case "invoke":
      return invoke(positional[0], flags);
    default:
      throw new Error(`unknown command "${command}" — try \`foldrun --help\``);
  }
}
