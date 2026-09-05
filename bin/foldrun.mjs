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
//   foldrun open  [page]    the dashboard for this workspace
//   foldrun login           sign this machine in from the browser
//   foldrun whoami          who the platform thinks this terminal is
//   foldrun keys  <verb>    ls / create / revoke — the account's API keys
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

const HELP = `foldrun — agents are folders

  foldrun init [dir]        create a workspace you can run immediately
  foldrun check [dir]       validate agents, flows, tools, evals and knowledge
  foldrun extract [dir]     move single-file script tools into folders (tool.md + run.*)
  foldrun run <target>      run an agent or flow (target: name, or flow:name)
  foldrun eval [name]       run one eval, or all of them
  foldrun probe <model>     live check: can this model hold a tool loop here?
  foldrun logs [run-id]     recent runs, or one run's full event trail
  foldrun secrets set NAME  store a secret (prompted, never echoed) — also ls, rm
  foldrun deploy [dir]      push a workspace into an installation
  foldrun invoke <flow>     start a flow on a running platform (--to <workspace>)
  foldrun open [page]       the dashboard for this workspace, in the browser

Signing in
  foldrun login             sign this machine in from the browser (--token <key> to skip it)
  foldrun logout            forget this machine's key, and revoke it where allowed
  foldrun whoami            who you are on the platform: account, role, workspaces
  foldrun keys ls           the account's API keys — also create <label>, revoke <id>
  foldrun --help

Options
  --workspace <dir>         the workspace folder (default: .)
  --from <template>         start from a shipped template, e.g. templates/hello
  --task "<text>"           the instruction for a manual run
  --follow                  logs: keep tailing a live run (with --url: on the platform)
  --value "<text>"          secrets set: skip the prompt (careful with shell history)
  --account                 secrets: account scope instead of the workspace's
  --wait                    invoke: hold on and print the result
  --watch                   invoke: follow the run's trace here as it happens
  --print                   open: print the URL only
  --from <n>                invoke: start at step n; earlier steps are skipped
  --no-browser              login: print the address instead of opening it
  --role <r>                keys create: viewer, editor (default) or admin
  --for <workspace>         keys create: a deploy key for one workspace (--access read|write)

Platform options (deploy, invoke, secrets, logs, keys)
  --to <workspace>          workspace on the platform (deploy default: folder name)
  --tenant <name>           account to deploy into (default: default, local only)
  --data <dir>              the installation's data directory
  --url <url>               a running platform (or FOLDRUN_URL, or where you last signed in)
  --token <key>             API key for --url (or FOLDRUN_TOKEN, or the one from foldrun login)
  --local                   deploy: into the installation on this machine, even when signed in
  --commit <sha>            deploy: record which commit this is
  --dry-run                 deploy: check and report, change nothing
  --force                   deploy: deploy even while runs are in flight

Nothing here needs an account. Set ANTHROPIC_API_KEY to run; init and check
work without one. \`foldrun login\` is for the hosted platform, or your own.`;

if (!command || command === "--help" || command === "-h") {
  console.log(HELP);
  process.exit(0);
}

// Flags first, so the workspace is known before anything loads the core:
// single-workspace mode is an environment decision, read at import time.
// Flags that take no value. Without the list, `--account --value X` read
// `--value` as the account's argument and stored an empty secret; `--force
// ./dir` swallowed the directory. A flag followed by another flag is also
// boolean, so an unlisted switch at least does not eat its neighbour.
const BOOLEAN_FLAGS = new Set(["account", "follow", "force", "oauth2", "wait", "watch", "print", "dry-run", "help", "no-browser", "local"]);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith("--")) {
    positional.push(rest[i]);
    continue;
  }
  const name = rest[i].slice(2);
  const next = rest[i + 1];
  if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith("--")) flags[name] = true;
  else flags[name] = rest[++i];
}

// `deploy` is the one command that is not about a single folder: it reads a
// source directory and writes into an installation, which has accounts and
// many workspaces. Pinning FOLDRUN_WORKSPACE would collapse that layout to one
// folder and send every deploy to the same place.
const isDeploy = command === "deploy";

// `init` and `check` take a directory; `run` and `eval` take the name of a
// thing to run, so a directory there would be ambiguous — use --workspace.
const takesDir = command === "init" || command === "check" || command === "extract";
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
