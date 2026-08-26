#!/usr/bin/env node
// foldrun — the open-source CLI.
//
// Local-first by design: every command here works on a plain folder with no
// account, no server and no network beyond the model call itself. That is the
// point. A framework whose free version is a crippled demo gets no adoption,
// and adoption is the only reason a hosted version has customers.
//
//   foldrun init  [dir]     scaffold a working workspace
//   foldrun check [dir]     validate it — no model calls, no cost
//   foldrun run   <target>  run an agent or a flow
//   foldrun eval  [name]    run evals
//   foldrun probe <model>   can this model hold a tool loop? (live check)
//   foldrun logs  [run-id]  recent runs, or one run's full event trail
//   foldrun secrets <verb>  set / ls / rm — the vault, from the terminal
//   foldrun deploy [dir]    push a workspace into an installation
//   foldrun invoke <flow>   start a flow on a running platform
//
// `check` is the one to run in CI: it catches the mistakes that otherwise only
// show up as a confidently wrong answer at 3am.

import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Node warns about stripping types from a package without "type": "module".
// True, and not the user's problem — they asked to run an agent.
process.removeAllListeners("warning");
process.on("warning", () => {});

const [, , command, ...rest] = process.argv;

const HELP = `foldrun — agents are markdown

  foldrun init [dir]        create a workspace you can run immediately
  foldrun check [dir]       validate agents, flows, tools, evals and knowledge
  foldrun run <target>      run an agent or flow (target: name, or flow:name)
  foldrun eval [name]       run one eval, or all of them
  foldrun probe <model>     live check: can this model hold a tool loop here?
  foldrun logs [run-id]     recent runs, or one run's full event trail
  foldrun secrets set NAME  store a secret (prompted, never echoed) — also ls, rm
  foldrun deploy [dir]      push a workspace into an installation
  foldrun invoke <flow>     start a flow on a running platform (--to <workspace>)
  foldrun --help

Options
  --workspace <dir>         the workspace folder (default: .)
  --from <template>         start from a shipped template, e.g. templates/hello
  --task "<text>"           the instruction for a manual run
  --follow                  logs: keep tailing a live run
  --value "<text>"          secrets set: skip the prompt (careful with shell history)
  --account                 secrets: account scope instead of the workspace's
  --wait                    invoke: hold on and print the result

Platform options (deploy, invoke, secrets)
  --to <workspace>          workspace on the platform (deploy default: folder name)
  --tenant <name>           account to deploy into (default: default, local only)
  --data <dir>              the installation's data directory
  --url <url>               a running platform (or FOLDRUN_URL)
  --token <key>             API key for --url (or FOLDRUN_TOKEN)
  --commit <sha>            deploy: record which commit this is
  --dry-run                 deploy: check and report, change nothing
  --force                   deploy: deploy even while runs are in flight

Nothing here needs an account. Set ANTHROPIC_API_KEY to run; init and check
work without one.`;

if (!command || command === "--help" || command === "-h") {
  console.log(HELP);
  process.exit(0);
}

// Flags first, so the workspace is known before anything loads the core:
// single-workspace mode is an environment decision, read at import time.
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i] ?? true;
  else positional.push(rest[i]);
}

// `deploy` is the one command that is not about a single folder: it reads a
// source directory and writes into an installation, which has accounts and
// many workspaces. Pinning FOLDRUN_WORKSPACE would collapse that layout to one
// folder and send every deploy to the same place.
const isDeploy = command === "deploy";

// `init` and `check` take a directory; `run` and `eval` take the name of a
// thing to run, so a directory there would be ambiguous — use --workspace.
const takesDir = command === "init" || command === "check";
const workspace = path.resolve(
  flags.workspace ?? (takesDir ? positional.shift() ?? "." : "."),
);
if (!isDeploy) process.env.FOLDRUN_WORKSPACE = workspace;

// Where the secrets, keys and run store live.
//
// A workspace on a laptop keeps them inside itself, in `.foldrun/`. But a
// workspace that belongs to an installation sits at
// `<data>/<tenant>/workspaces/<name>`, and its secrets belong to the tenant,
// two levels up — so pointing --workspace at one and defaulting to `.foldrun/`
// opened an empty store beside it. Every declared secret came back missing,
// and the error told you to add secrets that were already there.
//
// The layout says which case this is: a parent directory named `workspaces`
// only happens in an installation.
const parent = path.basename(path.dirname(workspace));
const installationRoot =
  parent === "workspaces" ? path.resolve(workspace, "..", "..", "..") : null;

if (isDeploy) {
  // The destination is an installation, so --data names it outright. Without
  // one, dataRoot()'s own default applies: data/ at the project root.
  if (flags.data) process.env.FOLDRUN_DATA = path.resolve(flags.data);
} else {
  process.env.FOLDRUN_DATA ??= installationRoot ?? path.join(workspace, ".foldrun");
}

const { run } = await import(path.join(HERE, "../src/commands.mjs"));

try {
  const code = await run(command, positional, flags, workspace);
  process.exit(code ?? 0);
} catch (err) {
  console.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
