// CLI commands. Kept separate from bin/ so the environment is set before the
// core is imported — single-workspace mode is read at module load.

import fs from "node:fs";
import path from "node:path";

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
};

// The published runtime, not a relative reach into a sibling directory. It was
// `../../core/index.ts` — which works only inside this repo, so `npx mdagent`
// installed a CLI that could not find its own runtime. Imported lazily so
// `--help` and argument errors never pay for loading it.
const core = async () => import("@mdagent/core");

// ---------------------------------------------------------------- init

async function init(workspace) {
  // The same definition the dashboard's "+ New workspace" uses — see
  // core/src/starter.ts for why it is not two lists.
  const { starterFiles, syncWorkspaceBundles } = await core();
  const files = starterFiles(path.basename(path.resolve(workspace)));

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
  // index.md declares no okf_version — so `mdagent init` produced a directory
  // of valid concepts that no consumer could tell the version of.
  syncWorkspaceBundles(workspace);
  console.log(`\n  ${c.green("created")} ${workspace}\n`);
  for (const { path: rel } of files) console.log(`    ${c.dim(rel)}`);
  console.log(`
  ${c.bold("Next")}
    mdagent check                 ${c.dim("validate it — costs nothing")}
    mdagent run publish           ${c.dim("run the flow")}
`);
  return 0;
}

// ---------------------------------------------------------------- check

async function check(workspace) {
  const {
    listAgents, listFlows, readBundle, conformanceIssues, listEvals, lintFlow,
    workspaceTools, libraryTools, checkFormatVersion,
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
  const flowNames = new Set(flows.map((f) => f.name));

  if (agents.length === 0) note("error", "agents/", "no agents — a workspace needs at least one");

  // What format does this workspace target?
  const agentsMd = path.join(workspace, "AGENTS.md");
  if (fs.existsSync(agentsMd)) {
    const m = fs.readFileSync(agentsMd, "utf8").match(/^mdagent_version:\s*["']?([\d.]+)/m);
    const { warning } = checkFormatVersion(m?.[1]);
    if (warning) note("warn", "AGENTS.md", warning);
  }

  for (const a of agents) {
    if (!a.description) note("warn", `agents/${a.name}`, "no description — other agents and people read it");
    for (const t of a.use) {
      if (!usable[t]) {
        note("error", `agents/${a.name}`, `use: [${t}] — no tools/${t}.md in this workspace or the account library`);
      }
    }
    for (const s of a.scripts ?? []) {
      // declared script tools must point at a file that exists
    }
  }

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
  const summary = `${agents.length} agents · ${flows.length} flows · ${evals.length} evals · ${Object.keys(tools).length} tools`;
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
      "  `mdagent check` works without either.",
  );
}

async function runTarget(target, flags) {
  if (!target) throw new Error("what should I run? try `mdagent run <agent>` or `mdagent run <flow>`");
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

export async function run(command, positional, flags, workspace) {
  switch (command) {
    case "init":
      return init(workspace);
    case "check":
      return check(workspace);
    case "run":
      return runTarget(positional[0], flags);
    case "eval":
      return runEvals(positional[0]);
    default:
      throw new Error(`unknown command "${command}" — try \`mdagent --help\``);
  }
}
