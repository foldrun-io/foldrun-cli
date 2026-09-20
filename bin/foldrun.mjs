#!/usr/bin/env node
// foldrun — the open-source CLI.
//
// Local-first by design: every command here works on a plain folder with no
// account, no server and no network beyond the model call itself. That is the
// point. A framework whose free version is a crippled demo gets no adoption,
// and adoption is the only reason a hosted version has customers.
//
//   foldrun init  [dir]     scaffold an account: a library, and a workspace in it
//   foldrun check [dir]     validate it — no model calls, no cost
//   foldrun run   <target>  run an agent or a flow
//   foldrun eval  [name]    run evals
//   foldrun probe <model>   can this model hold a tool loop? (live check)
//   foldrun logs  [run-id]  recent runs, or one run's full event trail
//   foldrun runs            what has run lately, across the account
//   foldrun report <run-id> one run, whole: every step, what it cost, what it wrote
//   foldrun approvals       what is waiting for a person, anywhere in the account
//   foldrun approve <run-id>  release a waiting gate (asks first) — reject refuses it
//   foldrun stop  <run-id>  kill a run in flight
//   foldrun account        the account's own defaults — timezone, notify, budget, concurrency
//   foldrun schedule       every flow in the account that fires on a clock, and when it fires next
//   foldrun billing        the balance, and what the money went on
//   foldrun storage <verb>  ls / cat / get — what the agents produced, as opposed to what you wrote
//   foldrun secrets <verb>  set / ls / rm — the vault, from the terminal
//   foldrun new   <name>    another workspace in this account
//   foldrun agent new <name>  one more agent in this workspace — also flow new, tool new
//   foldrun agent run <name>  run one agent once on a platform, no flow
//   foldrun tool test <name>  exercise one tool alone — no model, no run
//   foldrun deploy [dir]    push this account — or one workspace — into an installation
//   foldrun pull            bring the platform's account down into this folder
//   foldrun status          what differs here from what is deployed
//   foldrun workspaces      what exists here, and there
//   foldrun invoke <flow>   start a flow on a running platform
//   foldrun source <verb>   ls / cat / put / mv / rm one workspace file on a platform
//   foldrun open  [page]    the dashboard for this workspace
//   foldrun login           sign this machine in from the browser
//   foldrun login <site>    a browser window to sign in to a site by hand; the session
//                           (cookies, storage, identity) is stored for an agent to wear
//   foldrun whoami          who the platform thinks this terminal is
//   foldrun doctor          what is between this terminal and the platform, checked
//   foldrun accounts        every account signed in here; `use <name>` switches
//   foldrun keys  <verb>    ls / create / revoke — the account's API keys
//
// `check` is the one to run in CI: it catches the mistakes that otherwise only
// show up as a confidently wrong answer at 3am.

import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Node warns about stripping types from a package without "type": "module".
// True, and not the user's problem — they asked to run an agent.
process.removeAllListeners("warning");
process.on("warning", () => {});

const [, , command, ...rest] = process.argv;

const HELP = `foldrun — agents are just folders

  foldrun init [dir]        create an account folder: AGENTS.md, library/ and workspaces/<name>
  foldrun new <name>        another workspace in this account
  foldrun agent new <name>  one more agent in this workspace (--to <workspace> in an account)
  foldrun flow new <name>   one more flow — its first step names an agent you already have
  foldrun tool new <name>   one more tool: a folder with its program beside it (--transport, --language)
  foldrun check [dir]       validate every workspace here, and the shared library
  foldrun check --to <ws>   validate the DEPLOYED copy instead — fetched from the platform, checked here
  foldrun agent run <name>  run one agent once on the platform (--task "…", --to, --wait, --test)
  foldrun tool test <name>  exercise one tool alone, no model and no run (key=value args, --to)
  foldrun extract [dir]     move single-file script tools into folders (tool.md + run.*)
  foldrun run <target>      run an agent or flow (target: name, or flow:name)
  foldrun eval [name]       run one eval, or all of them
  foldrun probe <model>     live check: can this model hold a tool loop here?
  foldrun logs [run-id]     recent runs, or one run's full event trail
  foldrun runs              what has run lately, across the account — --status, --since, --to, --limit
  foldrun report <run-id>   one run, whole: header, every step, what it wrote and what is still waiting
  foldrun approvals         every gate waiting on a person, with its question (--to <workspace> for one)
  foldrun approve <run-id>  release a waiting gate — asks first, --yes means it, --note "…" steers the step
  foldrun reject <run-id>   refuse one, with --note as the reason
  foldrun stop <run-id>     kill a run in flight — asks first, --yes means it
  foldrun schedule          every flow that fires on a clock, its cron line and the next times (--to <workspace>)
  foldrun storage <verb>    what a workspace produced: ls [prefix], cat <path>, get <path> (--to <workspace>)
  foldrun billing           the account's balance and its recent ledger entries (--limit <n>)
  foldrun account           the account's defaults — also set <key> <value>, clear <key> (singular; accounts lists logins)
  foldrun secrets set NAME  store a secret (prompted, never echoed) — also ls, rm, status
  foldrun connect NAME      OAuth sign-in from the terminal, stored as an auto-refreshing secret
  foldrun deploy [dir]      push the whole account, or deploy <workspace> for one of them
  foldrun pull [workspace]  bring the platform's account down here (refuses to clobber; --force overrides)
  foldrun status [workspace]  per workspace: what is added, changed or gone since the last deploy
  foldrun workspaces        what exists here and on the platform — also rm <name> (--platform --yes)
  foldrun invoke <flow>     start a flow on a running platform (--to <workspace>)
  foldrun source <verb>     the files on a platform, one at a time: ls, cat <path>, put <path>, mv, rm (--to <workspace>)
  foldrun open [page]       the dashboard for this workspace, in the browser

Signing in
  foldrun login             sign this machine in from the browser (--token <key> to skip it)
  foldrun login <site> --url <address>
                            open a browser, sign in to that site by hand, and store the
                            session: cookies, storage and the browser identity it needs
  foldrun logout            forget this machine's key, and revoke it where allowed
  foldrun whoami            who you are on the platform: account, role, workspaces
  foldrun doctor            check the path to the platform: node, CLI, account, DNS, a timed /api/healthz
  foldrun accounts          every account signed in on this machine, and which one is active
  foldrun use <name>        act as one of them from here on
  foldrun keys ls           the account's API keys — also create <label>, revoke <id>
  foldrun --help

Options
  --workspace <dir>         the workspace folder (default: .) — on init, the first workspace's name
  --flat                    init: the old single-folder shape, no account around it
  --from <template>         start from a shipped template, e.g. templates/hello
  --transport <k>           tool new: script (default), http or mcp
  --language <l>            tool new: the script's language — javascript, python, bash
  --task "<text>"           the instruction for a manual run
  --test                    run, invoke: a test run — nothing outward, state/ untouched, receipts on the run page
  --follow                  logs: keep tailing a live run (with --url: on the platform)
  --status <s>              runs: only these statuses, comma-separated (failed, completed, awaiting-approval…)
  --since <span>            runs: only runs started within 24h, 7d, 90m, 2w
  --step <n>                approve, reject: decide only that step; default is every step that is waiting
  --note "<text>"           approve, reject: guidance the agent reads — or the reason for a refusal
  --yes                     approve, stop: skip the confirmation, deliberately
  --json                    report: the raw run record instead of the report
  --events <a,b>            account set notify: failed, awaiting-approval, completed
  --limit <n>               runs, billing: how many rows
  --value "<text>"          secrets set: skip the prompt (careful with shell history)
  --file <path>             source put: the local file to send (default: stdin); storage get: where to write it
  --message "<why>"         source put: recorded on the file's revision
  --account                 secrets: account scope instead of the workspace's
  --wait                    invoke, agent run: hold on and print the result
  --path <p>                tool test: the path an http tool should probe, appended to its base:
  --watch                   invoke: follow the run's trace here as it happens
  --print                   open: print the URL only
  --from <n>                invoke: start at step n; earlier steps are skipped
  --no-browser              login, connect: print the address instead of opening it
  --provider <name>         connect: google, github, microsoft or linkedin (fills the URLs)
  --scopes "<a b c>"        connect: space-separated scopes (default: the provider's example)
  --client-id / --client-secret  connect: the OAuth app (prompted if omitted; secret never echoed)
  --port <n>                connect: loopback port for the redirect (default 8642 — register http://localhost:8642/callback on the app)
  --authorize-url / --token-url  connect: a provider with no preset
  --role <r>                keys create: viewer, editor (default) or admin
  --for <workspace>         keys create: a deploy key for one workspace (--access read|write)

Platform options (deploy, invoke, secrets, logs, keys)
  --to <workspace>          workspace on the platform (deploy default: folder name)
  --tenant <name>           account to deploy into (default: default, local only)
  --data <dir>              the installation's data directory
  --url <url>               a running platform (or FOLDRUN_URL, or where you last signed in)
  --token <key>             API key for --url (or FOLDRUN_TOKEN, or the one from foldrun login)
  --timeout <s>             seconds one request may take (or FOLDRUN_TIMEOUT; default 30, tool test 300)
  FOLDRUN_TIMEOUT=<s>       seconds one request to the platform may take (default 30)
  --profile <name>          act as one stored account for this command (see foldrun accounts)
  --local                   deploy: into the installation on this machine, even when signed in
  --commit <sha>            deploy: record which commit this is
  --dry-run                 deploy: check and report, change nothing
  --force                   deploy: deploy even while runs are in flight; pull, storage get: overwrite local files
  --platform --yes          workspaces rm: delete it on the platform, deliberately

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
const BOOLEAN_FLAGS = new Set(["account", "follow", "force", "oauth2", "wait", "watch", "print", "dry-run", "help", "no-browser", "local", "test", "flat", "yes", "platform", "json"]);
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

// Commands that are about an ACCOUNT, not one folder: they read or write the
// account AGENTS.md, the shared library and several workspaces at once, so
// pinning FOLDRUN_WORKSPACE would collapse the layout to one of them.
// `deploy` has always been in this set — it writes into an installation,
// which has accounts and many workspaces.
const ACCOUNT_WIDE = new Set(["deploy", "pull", "status", "workspaces", "new"]);

// `init` and `check` take a directory; `run` and `eval` take the name of a
// thing to run, so a directory there would be ambiguous — use --workspace.
const takesDir = command === "init" || command === "check" || command === "extract";
// For `init` the flag names the first WORKSPACE, not a directory — the
// directory it makes is the account. A value that looks like a path is still
// read as one, so `foldrun init --workspace ./desk` keeps working.
const flagIsName =
  command === "init" &&
  typeof flags.workspace === "string" &&
  !flags.workspace.includes(path.sep) &&
  !flags.workspace.includes("/") &&
  !fs.existsSync(flags.workspace);
const here = path.resolve(
  (flagIsName ? undefined : flags.workspace) ?? (takesDir ? positional.shift() ?? "." : "."),
);

// Which shape is this? One helper in the core answers, so `check`, `deploy`,
// `status` and the runtime's own account scope cannot drift apart.
const { detectLayout, installationDataRoot } = await import("@foldrun/core/layout");
const layout = detectLayout(here);
const byName =
  typeof flags.workspace === "string" && layout.workspacesDir && layout.workspaces.includes(flags.workspace)
    ? path.join(layout.workspacesDir, flags.workspace)
    : null;

/**
 * The workspace directory this command should act on.
 *
 * At an account root with exactly one workspace there is nothing to ask about
 * — that is the one. With several, a command that needs one says so itself,
 * by name, rather than picking.
 */
function pinned() {
  // `--workspace blog-desk` inside an account names one of its workspaces, not
  // a directory relative to here. Only when it IS one of them, so a path that
  // happens to look like a name still resolves as a path.
  if (byName) return byName;
  if (layout.workspaceDir && layout.kind !== "empty") return layout.workspaceDir;
  if (layout.kind === "account" && layout.workspacesDir && layout.workspaces.length === 1) {
    return path.join(layout.workspacesDir, layout.workspaces[0]);
  }
  if (layout.kind === "empty") return here;
  return null;
}

const workspace = pinned() ?? here;
if (!ACCOUNT_WIDE.has(command)) process.env.FOLDRUN_WORKSPACE = workspace;
// The account scope, decided once here and honoured by the core's
// singleAccountRoot — so `library/` beside `workspaces/` is what an agent's
// skills:, tools: and scripts: resolve against, exactly as it is on the
// platform.
process.env.FOLDRUN_ACCOUNT ??= layout.accountRoot;

// Where the secrets, keys and run store live.
//
// An account on a laptop keeps them at its own root, in `.foldrun/`, so every
// workspace under it shares one vault — the way workspaces in an account share
// one vault on the platform. A flat workspace keeps them inside itself, which
// is where they have always been.
//
// A workspace that belongs to an INSTALLATION is a third case: it sits at
// `<data>/<tenant>/workspaces/<name>`, and its secrets belong to the tenant,
// two levels up — so pointing --workspace at one and defaulting to `.foldrun/`
// opened an empty store beside it. Every declared secret came back missing,
// and the error told you to add secrets that were already there. The shape
// alone cannot tell an installation from an account folder (they are the same
// shape); the installation's key file at the data root can.
const installationRoot = installationDataRoot(layout.accountRoot);

if (command === "deploy") {
  // The destination is an installation, so --data names it outright. Without
  // one, dataRoot()'s own default applies: data/ at the project root.
  if (flags.data) process.env.FOLDRUN_DATA = path.resolve(flags.data);
} else {
  process.env.FOLDRUN_DATA ??=
    installationRoot ??
    (layout.kind === "flat" || layout.kind === "empty"
      ? path.join(workspace, ".foldrun")
      : path.join(layout.accountRoot, ".foldrun"));
}

const { run, explain } = await import(path.join(HERE, "../src/commands.mjs"));

try {
  const code = await run(command, positional, flags, workspace, layout);
  process.exit(code ?? 0);
} catch (err) {
  // The whole chain, not the top: "fetch failed" is the top, and the
  // ECONNREFUSED underneath it is the part that says what to do.
  console.error(`\n  ${explain(err)}\n`);
  process.exit(1);
}
