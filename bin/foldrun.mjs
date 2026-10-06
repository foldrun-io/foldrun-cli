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
//   foldrun triggers       why nothing ran: fired vs started per flow, and each reason
//   foldrun webhooks <verb> deliveries / redeliver <id> — the notify: webhooks a workspace sent, and each attempt
//   foldrun notifications  what mail you get, per category — set <category> on|off
//   foldrun flags          the feature flags for this account — on or off, and why (read-only)
//   foldrun backups        how the account is backed up, its snapshots — request a restore from one, requests lists them
//   foldrun team           who is in the account, their roles and workspaces (read-only)
//   foldrun restore <ws>   a workspace's source back to a point in its history (shows the change, asks)
//   foldrun onboarding     the account's getting-started steps, the next one first
//   foldrun billing        the balance, and what the money went on — credit <usd> on an install without Stripe
//   foldrun gallery        the tools the platform ships to every account — list, pull, upgrade <tool>
//   foldrun storage <verb>  ls / cat / get / put / rm / share / shares / unshare — what the agents produced, and public links to it
//   foldrun runtimes        the environments a workspace's agents need, and whether each is built
//   foldrun secrets <verb>  set / ls / rm — the vault, from the terminal
//   foldrun new   <name>    another workspace in this account
//   foldrun agent new <name>  one more agent in this workspace — also flow new, tool new (--platform: in the deployed one)
//   foldrun agent ls        the agents deployed in a workspace — also flow ls
//   foldrun eval new <name> a new eval in a deployed workspace
//   foldrun agent run <name>  run one agent once on a platform, no flow
//   foldrun tool test <name>  exercise one tool alone — no model, no run
//   foldrun deploy [dir]    push this account — or one workspace — into an installation
//   foldrun pull            bring the platform's account down into this folder
//   foldrun status          what differs here from what is deployed — --platform [--history]: is the platform up
//   foldrun workspaces      what exists here, and there — show <name>, new <name> --platform
//   foldrun invoke <flow>   start a flow on a running platform
//   foldrun source <verb>   ls / cat / put / new / mv / rm one workspace file on a platform
//   foldrun open  [page]    the dashboard for this workspace
//   foldrun login           sign this machine in from the browser
//   foldrun login <site>    a browser window to sign in to a site by hand; the session
//                           (cookies, storage, identity) is stored for an agent to wear
//   foldrun whoami          who the platform thinks this terminal is
//   foldrun doctor          what is between this terminal and the platform, checked
//   foldrun accounts        every account signed in here; `use <name>` switches
//   foldrun keys  <verb>    ls / create / revoke — the account's API keys
//   foldrun library <verb>  ls / cat / put / new / rm — the account's shared shelf on the platform
//   foldrun find  <words>   search the account the way the dashboard's ⌘K does
//   foldrun changelog       what each release of the platform changed
//   foldrun preferences     your own settings on the platform — the theme
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

// `foldrun --version`: the package's own number and nothing else — no core,
// no network, no account. Before every import below, so it stays instant.
// `foldrun version` is the long form that also asks the platform.
if (command === "--version" || command === "-v") {
  try {
    console.log(`foldrun ${JSON.parse(fs.readFileSync(path.join(HERE, "../package.json"), "utf8")).version}`);
  } catch {
    console.log("foldrun (unknown version)");
  }
  process.exit(0);
}

const HELP = `foldrun — agents are just folders

  foldrun init [dir]        create an account folder: AGENTS.md, library/ and workspaces/<name>
  foldrun new <name>        another workspace in this account — blank (--starter for the example researcher, writer and flow)
  foldrun agent new <name>  one more agent in this workspace (--to <workspace> in an account)
  foldrun agent new <name> --platform  make it in the DEPLOYED workspace, as the dashboard's New agent does (--to, --description, --model)
  foldrun flow new <name>   one more flow — its first step names an agent you already have
  foldrun flow new <name> --platform  make it in the deployed workspace from a shape (--pattern pipeline|review-loop|fan-out|debate|router, --to)
  foldrun tool new <name>   one more tool: a folder with its program beside it (--transport, --language; --platform in the deployed workspace, --template <gallery entry>)
  foldrun agent ls          the agents deployed in a workspace: model, description (--to, --json) — flow ls the flows and how each fires
  foldrun check [dir]       validate every workspace here, and the shared library
  foldrun check --to <ws>   validate the DEPLOYED copy instead — fetched from the platform, checked here
  foldrun agent run <name>  run one agent once on the platform (--task "…", --to, --wait, --test)
  foldrun agent link <agent>  add to its team, in its frontmatter: --subagent <worker>, --consult <agent> or --can-ask (--description for a worker with none)
  foldrun agent unlink <agent>  take one away: --subagent <name>, --consult <name> or --can-ask
  foldrun agent import <workspace>/<agent>  copy an agent you already have in another workspace into this one — its agent.md, own skills and scripts, not its memory (--as <name>, --workspace <name>; --to <ws> on the platform)
  foldrun agent import --list  what could be imported into a deployed workspace: every other workspace you can read, and its agents (--to, --json)
  foldrun flow add <flow> <pattern>  one canvas block as a markdown edit: chain, parallel, router, fan-out, loop, approval, ask, wait, rescue, subflow — diff shown, checked, --dry-run
  foldrun flow rm-step <flow> --step <n|agent>  delete one step (its options too); groups renumber, agent file untouched — says what else changes, diff, checked, asks (--yes), --dry-run
  foldrun flow dup-step <flow> --step <n|agent>  copy one step (marker and options) directly under it, in parallel with it — diff, checked, --dry-run
  foldrun flow show <flow>  the flow as the canvas draws it: trigger, groups, step chips, each agent's team, check problems in place
  foldrun flow run <flow>   start a flow on the platform — the same command as invoke
  foldrun flow rotate-hook <flow>  a new webhook URL for a flow; the old one stops at once — asks first, --yes means it
  foldrun flow set <flow> --step <n|agent> key=value …  the step editor: model, effort, retry, timeout, verify, when, case, else, loop, until, each, max, limits, instruction (key= clears) — diff, checked, --dry-run
  foldrun flow trigger <flow> manual|webhook|schedule  the trigger picker (--schedule "<cron>", --timezone <zone>) — diff, checked, --dry-run
  foldrun flow move-step <flow> --step <n|agent>  drag a card: --group <g> runs it beside group g, --after <g> gives it its own group after g (0 = first) — diff, checked, --dry-run
  foldrun flow copy-step <flow> --step <n|agent>[,<n>…]  the steps' markdown on stdout, as the canvas's Copy
  foldrun flow paste <flow>  step markdown from stdin or --file in as new groups (--after <g>, default last) or beside one (--group <g>) — diff, checked, --dry-run
  foldrun flow draft "<what it should do>"  Draft with AI on the platform (--to; --flow <name> redrafts one): shows the files and the check, saves on yes (--yes, --dry-run)
  foldrun tool test <name>  exercise one tool alone, no model and no run (key=value args, --to)
  foldrun extract [dir]     move single-file script tools into folders (tool.md + run.*)
  foldrun run <target>      run an agent or flow HERE (target: name, or flow:name) — on the platform: flow run / invoke a flow, agent run one agent
  foldrun eval [name]       run one eval, or all of them (--to <workspace>: the deployed evals, run on the platform)
  foldrun eval new <name>   a new eval in the deployed workspace, its agent the first one there — edit its cases, then eval <name> --to (--to)
  foldrun promote <run-id>  keep a finished run as a regression case in evals/ (--eval <name>, --expect "contains: …" repeatable, --case <name>)
  foldrun probe <model>     live check: can this model hold a tool loop here?
  foldrun logs [run-id]     recent runs in one workspace, or one run's full event trail (--local: this machine's)
  foldrun runs              what has run lately, across the account — --status, --verdict, --since, --to, --limit (--local prints exactly what logs --local prints)
  foldrun runs rm <run-id>  delete a run's record and archived outputs; a live one is stopped first — asks first, --yes means it
  foldrun report <run-id>   one run, whole: header, every step, what it wrote and what is still waiting
  foldrun report <run-id> get <agent>/<path>  download a file the run archived from that agent's outputs/ (--file <path>|-, --force)
  foldrun report <run-id> live  the live browser view: which agents have a frame; --agent <name> saves the newest as a JPEG (--file <path>|-)
  foldrun approvals         every gate waiting on a person, with its question (--to <workspace> for one)
  foldrun approve <run-id>  release a waiting gate — asks first, --yes means it, --note "…" steers the step; --payload releases a wait: event step
  foldrun reject <run-id>   refuse one, with --note as the reason
  foldrun stop <run-id>     kill a run in flight — asks first, --yes means it
  foldrun stop --status running [--since 2h] [--until 1h] [--flow f]  every run a filter matches (runs/bulk): lists them, asks, stops only those (--dry-run, --to)
  foldrun answer <run-id> "…"  answer the question an agent is asking mid-step (--option <n> picks a choice)
  foldrun message <run-id> "…" say something to a running agent — it hears it after its next tool call
  foldrun rerun <run-id>    run it again from a step (--from <n>) or from an agent's step (--agent <name>); --wait
  foldrun rerun --status failed [--since 24h] [--until 2h] [--flow f]  rerun every run a filter matches, from --from <n> (default 1) — lists, asks (--dry-run, --to)
  foldrun observe           where the account fails, retries and spends, per workspace (--to <workspace> in full, --since <days>, --json)
  foldrun usage             what the account consumed, and what it was charged week by week (--days <n>, --json)
  foldrun schedule          every flow that fires on a clock, its cron line and the next times (--to <workspace>)
  foldrun schedule tick     fire whatever is due now — Settings' "Run scheduler now"
  foldrun guide             write the coding-agent rules: a block in AGENTS.md and CLAUDE.md importing it (--check, --print)
  foldrun docs [page]       foldrun's docs, from the copy this CLI ships — what a coding agent should read (--path)
  foldrun triggers          why nothing ran: per flow, fired vs started and every reason (--since <days>, --to <workspace>)
  foldrun storage <verb>    what a workspace produced: ls [prefix], cat <path> (--preview: a PDF, sheet, deck or zip as text), get <path>, put <file|folder>... (--into <folder/>, --as <path> for one file), rm <path> — and share <path> (--ttl <days>, --forever), shares (--all), unshare <token>
  foldrun runtimes          the environments a deployed workspace's agents need (python, pip and npm packages) and whether each is built — failed ones with the installer's error (--wait holds on while any is building)
  foldrun billing           the account's balance and its recent ledger entries (--limit <n>)
  foldrun billing statement [YYYY-MM]  a month of the ledger (--csv for the file, --file <path> to save it)
  foldrun billing wallet    burn, runway, auto top-up — also set auto-top-up --threshold <usd> --amount <usd> | off, set email <address>
  foldrun billing details   who invoices are made out to — also set --name "…" --abn … --address "line1, city, state, postcode, AU" --email …
  foldrun billing portal    a link to Stripe's billing portal (owner only)
  foldrun billing plans     the plans, which one the account is on and this cycle's credits — also plan <id>, plan cancel, plan resume (asks first)
  foldrun billing top-up <usd>  Stripe's checkout page for adding credit (owner only; --no-browser prints it)
  foldrun billing card      Stripe's page for saving a card for auto top-up (owner only)
  foldrun billing credit <usd>  put credit on the balance by hand (--note "…") — only on an install without Stripe (self-hosted, dev); refused once billing is live
  foldrun gallery           the platform's built-in tools (web) and whether you keep your own copy — also pull (a copy for offline runs), upgrade <tool>
  foldrun account           the account's defaults — also set <key> <value>, clear <key>, providers (--check) (singular; accounts lists logins)
  foldrun account export    everything the platform holds about the account as one JSON file (owner only; --file <path>, --force)
  foldrun account model     the account's own model key — set <provider> --key <api key> (--key - reads stdin; custom --base-url --format), remove
  foldrun workspace         one deployed workspace's settings (--to) — also set <name|description|timezone|budget|notify> <value>, clear <key>
  foldrun workspace vocabulary  the names the dashboard's editor completes in a workspace: agents, flows, skills, tools, secrets, scripts, types, documents (--to, --json)
  foldrun notify test       send one test notification from a workspace and say what happened (--to <workspace>)
  foldrun webhooks deliveries  the notify: webhooks a workspace sent, newest first — status, attempts, last answer (--failed, --status <s>, --event <e>, --limit, --offset, --to)
  foldrun webhooks redeliver <id>  send one delivery again now, same X-Foldrun-Delivery id; exits 1 when refused (--to)
  foldrun notifications     what mail you get, category by category, and which are always sent (--json)
  foldrun notifications set <category> on|off  turn one off or back on — account-wide, or --to <workspace> for run-alerts and approvals
  foldrun flags             the feature flags for this account: each on or off, and why — set for this account, for every account, a staged rollout, or the default (--json). Read-only: the platform's super admin changes them
  foldrun history [path]    every change to a deployed workspace, newest first (--id <revision> for its diff, --limit, --to)
  foldrun history restore <path> --id <revision>  put one file back as that revision left it, as a new revision — diff, asks (--yes, --dry-run, --to)
  foldrun repo ls           a workspace's branches and tags — also diff <branch>, deploy <ref>, merge <branch> (both ask first), rm-branch <branch>, mirror <git-url|off>, mirror-now (--to)
  foldrun restore <ws> --to <commit|time|3d>  put a workspace's source back as it was then — shows the change, asks for the name typed back (--dry-run: the diff only, --yes)
  foldrun backups           how the account is backed up (encrypted?), when it last was, the snapshots it is in — also request --what runs|state|storage|everything --at "<when>" [--to <ws>] [--note]
  foldrun backups requests  every restore asked of the platform team, and where each stands (--json)
  foldrun secrets set NAME  store a secret (prompted, never echoed) — also ls, rm, status; --kind file|ssh|api|service-account|m2m for the other shapes
  foldrun secrets clients   the OAuth clients saved on the platform — also add <name> (--provider or --authorize-url/--token-url, --client-id, --scopes), rm <name>
  foldrun connect NAME      OAuth sign-in from the terminal, stored as an auto-refreshing secret — --client <saved> runs it from a saved client through the platform
  foldrun deploy [dir]      push the whole account, or deploy <workspace> for one of them
  foldrun pull [workspace]  bring the platform's account down here (refuses to clobber; --force overrides)
  foldrun export [workspace]  a deployed workspace as a .zip — agents, flows, tools, skills, scripts, evals, knowledge; never memory, state or secret values (--flow <name> or --agent <name> for one, with what it needs; --file <path>|-, --force)
  foldrun import <file.zip>  take a package in: shows what it adds, would replace and still needs, then asks (--to <workspace>; a new name makes a workspace; --dry-run, --overwrite, --yes, --json)
  foldrun status [workspace]  per workspace: what is added, changed or gone since the last deploy
  foldrun status --platform  is the platform up: each component, and any incident or maintenance posted (--json)
  foldrun status --platform --history  uptime per component per day and the incidents in the window, as the status page's bars (--days 1-90, default 90; --json)
  foldrun workspaces        what exists here and on the platform — also rm <name> (--platform --yes)
  foldrun workspaces show <name>  what is deployed in one: its agents, flows and how each fires, its files by folder (--json)
  foldrun workspaces new <name> --platform  make it on the platform: blank (an AGENTS.md), or --starter for the example researcher, writer and flow
  foldrun workspaces demo   make the demo pipeline workspace on the platform — "Try the demo pipeline"
  foldrun library           the account's shared library on the platform: ls [skills|tools|scripts|knowledge|memory], cat <kind>/<path>, put <kind>/<path> (--file, else stdin), rm <kind>/<path> (asks)
  foldrun library new <kind>/<name>  a new one from the platform's template, as the Library page's New (--template <transport or gallery entry>, --language)
  foldrun find <words>      search the account as the dashboard's ⌘K does: workspaces, agents, flows, tools, skills, knowledge, memory, runs (--json)
  foldrun invoke <flow>     start a flow on a running platform (--to <workspace>; --once <key> so a retry never starts a second run; --tag <t> repeatable)
  foldrun source <verb>     the files on a platform, one at a time: ls, cat <path>, put <path>, mv, rm (--to <workspace>)
  foldrun source new <kind> <name>  the dashboard's New for any document — tools, knowledge, memory, skills, scripts (agents, flows, evals too): the platform writes the template (--agent <a> inside one agent, --template, --language, --to)
  foldrun open [page]       the dashboard for this workspace, in the browser
  foldrun api spec          the platform's OpenAPI 3.1 document (GET /api/openapi.json) — stdout, or --out <file>
  foldrun api version       the API version this account's requests get, the versions served, the rate limits — also pin <YYYY-MM-DD>, unpin (admin; --json)
  foldrun changelog         the platform's release notes, newest first: features, fixes, docs (--limit <n>, --json)
  foldrun version           this CLI's version, its core's, and the platform's: release, API version, component shas — warns when the platform ships a newer CLI (--json)

Signing in
  foldrun login             sign this machine in from the browser (--token <key> to skip it)
  foldrun login <site> --url <address>
                            open a browser, sign in to that site by hand, and store the
                            session: cookies, storage and the browser identity it needs
  foldrun logout            forget this machine's key, and revoke it where allowed
  foldrun whoami            who you are on the platform: account, role, workspaces
  foldrun team              who is in the account: role, the workspaces each may open, when they joined (--json). Read-only: invites, roles, removal and transfer are a signed-in person's, in Settings → Team
  foldrun onboarding        the account's getting-started steps, done or not, the next one first (--json)
  foldrun preferences       your own settings on the platform — the theme; set theme system|light|dark (a key acts for whoever minted it)
  foldrun doctor            check the path to the platform: node, CLI, model credential, account, DNS, a timed /api/healthz
  foldrun accounts          every account signed in on this machine, and which one is active
  foldrun use <name>        act as one of them from here on
  foldrun keys ls           the account's API keys: created, last used, expires, scope — also create <label> [--expires 90d], rotate <id> [--grace 1h], revoke <id>
  foldrun audit             the account's audit log, newest first: sign-ins, keys, invites, secrets by name, deploys, support views (--since 7d, --action, --actor, --to, --all, --csv)
  foldrun --version         this CLI's version, offline (\`foldrun version\` also asks the platform)
  foldrun --help            everything; \`foldrun <command> --help\`, \`-h\` or \`foldrun help <command>\` for one (never runs it)

Options
  --workspace <dir>         the workspace folder (default: .) — on init, the first workspace's name
  --flat                    init: the old single-folder shape, no account around it
  --from <template>         init: start from a shipped template, e.g. templates/hello (new takes it too)
  --starter                 new, workspaces new: include the example researcher, writer and publish flow (a new workspace is blank)
  --transport <k>           tool new: script (default), http or mcp
  --language <l>            tool new, source new, library new: the script's language — javascript, python, bash
  --task "<text>"           the instruction for a manual run
  --test                    run, invoke: a test run — nothing outward, state/ untouched, receipts on the run page
  --follow                  logs: keep tailing a live run (with --url: on the platform)
  --status <s>              runs, stop, rerun: only these statuses, comma-separated (failed, completed, awaiting-approval…)
  --since <span>            runs, stop, rerun: only runs started within 24h, 7d, 90m, 2w
  --since <span>            audit: entries from 24h, 7d, 30d ago, or a date (default 7d); --until <date> ends the window
  --action <a>              audit: one action (apikey.created) or a family (apikey, secret, member, support)
  --actor <who>             audit: one person or key — an email, key:<label>, support:<email>
  --since <days>            observe, triggers: the window in days (observe default 30, triggers 7)
  --until <span|date>       stop, rerun (bulk): only runs started before then — 2h ago, or a date
  --verdict <v>             runs: only completed runs whose summary leads with it — good, bad, quiet, blocked (comma-separated)
  --flow <name>             export: that flow and everything it runs; stop, rerun: only that flow's runs; flow add: the other flow a subflow step runs; flow draft: the existing flow to redraft
  --agent <name>            export: that agent and what it grants; flow add: the agent a chain, parallel or router step runs; rerun: from the first step that agent runs; report live: whose browser frame; source new: the agent the document belongs to
  --instruction "<text>"    flow add: what a new step (chain, parallel, router) is told to do
  --after <n>               flow add, flow move-step, flow paste: put the new group after the nth (0 = first); --before <n> before it (flow add); default last
  --group <n>               flow add, flow move-step, flow paste: the group a step joins, in parallel
  --step <n|agent>          flow add, flow rm-step, flow dup-step, flow set, flow move-step, flow copy-step: the step a pattern goes on (or is deleted, copied, edited, moved) — its place in the file (1 = the first) or the agent it runs
  --cases <V=agent,…>       flow add: a router's branches, e.g. BUG=bugs,DOCS=docs; --else <agent> when none matches
  --each <e>                flow add: lines, items or "rows of <path>"; --max <n> caps it (1-20)
  --loop <n>                flow add: extra cycles, 1-5 (default 3); --until <MARKER> ends it (default APPROVED); --judge "<claim>" adds verify: judge:
  --question "<text>"       flow add: the ask a person gets before the step; answer: which question of several (its id)
  --wait <span|event>       flow add: 90s, 30m, 4h, 3d or event
  --on-fail <agent>         flow add: who takes the step over when it fails
  --off                     flow add: take the pattern off the step instead (fan-out, loop, approval, ask, wait, rescue)
  --schedule "<cron>"       flow trigger: the cron line a schedule fires on (5 fields, or @daily); --timezone <zone> the zone it is read in
  --kind <k>                secrets set: file (--file <path>), ssh (--host, --user, --port, --key-file or a prompted password), api (--base-url, --header "Name: value" repeatable), service-account (--file <key.json>, --scopes), m2m (--token-url, --client-id, --scopes; secret prompted)
  --client <name>           connect: run the consent from that OAuth client saved on the platform (secrets clients lists them)
  --subagent <name>         agent link, agent unlink: a worker it delegates to (subagents:)
  --consult <name>          agent link, agent unlink: a colleague it asks (agents:)
  --can-ask                 agent link, agent unlink: ask in its tools — it may ask you mid-step
  --description "<text>"    agent link: what a --subagent is for, when its file has no description:; agent new --platform: its one line
  --model <tier>            agent new --platform: fast, default or max
  --pattern <p>             flow new --platform: pipeline (default), review-loop, fan-out, debate or router
  --template <t>            tool new --platform, source new, library new: a transport (script, http, mcp) or a gallery entry to start from
  --list                    agent import: list what could be imported, import nothing
  --history                 status --platform: the daily uptime and incidents, not just now
  --eval <name>             promote: the eval file to write to (default <target>-regressions)
  --expect "<line>"         promote: an assertion in eval syntax (contains: …, judge: …) — repeatable
  --case <name>             promote: the case's name
  --tag <t>                 invoke, flow run: a label on the run — repeatable, sent as tags
  --inputs <set>            invoke, flow run: the task is a saved input set (evals/<flow>-inputs.md, or an eval case for the flow)
  --preview                 storage cat: the platform reads the file and prints what is in it
  --csv                     billing statement: the CSV file instead of the table
  --csv                     audit: the log as CSV, for an auditor (--file <path> to save it)
  --threshold / --amount    billing wallet set: auto top-up refills --amount (5-500 USD) when the balance falls below --threshold
  --name / --abn / --address / --email  billing details set: the invoice's legal name, ABN, "line1, city, state, postcode, AU", receipt email
  --days <n>                usage: the window the charges cover (default 56); status --platform --history: 1-90 (default 90)
  --id <revision>           history: one revision in full, as diffs
  --engine <e>              login: (with a site) the browser to sign in with — chrome (default: real Google Chrome, Chromium when it is not installed), chromium, firefox or safari
  --new-client              connect: enter a new OAuth client even when one is saved for the secret
  --step <n>                approve, reject: decide only that step; default is every step that is waiting
  --payload <json|text|@f>  approve: release a step waiting on wait: event with this body, recorded as you
  --note "<text>"           approve, reject: guidance the agent reads — or the reason for a refusal; billing credit: the ledger line's note
  --yes                     approve, stop, rerun (bulk), flow rotate-hook, flow draft, history restore, restore <ws>, import, billing plan, repo, workspace set name, and every rm/revoke/unshare: skip the confirmation, deliberately (required with no terminal)
  --json                    report: the raw run record instead of the report; observe, usage, api version, changelog, find, preferences, workspace vocabulary, flags, workspaces show, agent ls, flow ls, agent import --list, backups requests, team: the raw document; version: {cli, core, platform}
  --events <a,b>            account set notify: failed, awaiting-approval, completed
  --failed                  webhooks deliveries: only the ones that gave up
  --limit <n>               runs, billing, history, changelog: how many rows
  --value "<text>"          secrets set: skip the prompt (careful with shell history)
  --out <file>              api spec: where to write the OpenAPI document (default: stdout)
  --file <path>             source put, library put, flow paste: the local file to send (default: stdin); secrets set --kind file|service-account: the file it holds; storage get, report get, report live, account export, export, billing statement: where to write it (- for stdout)
  --message "<why>"         source put: recorded on the file's revision
  --account                 secrets: account scope instead of the workspace's
  --wait                    invoke, agent run: hold on and print the result
  --path <p>                tool test: the path an http tool should probe, appended to its base:
  --watch                   invoke: follow the run's trace here as it happens
  --print                   open: print the URL only
  --from <n>                invoke, flow run, rerun: start at step n; earlier steps are recorded as skipped (a bulk rerun defaults to 1)
  --no-browser              login, connect, billing top-up/card/plan: print the address instead of opening it
  --provider <name>         connect: google, github, microsoft or linkedin (fills the URLs)
  --scopes "<a b c>"        connect: space-separated scopes (default: the provider's example)
  --client-id / --client-secret  connect: the OAuth app (prompted if omitted; secret never echoed)
  --port <n>                connect: loopback port for the redirect (default 8642 — register http://localhost:8642/callback on the app)
  --authorize-url / --token-url  connect: a provider with no preset
  --role <r>                keys create: viewer, editor (default) or admin
  --for <workspace>         keys create: a deploy key for one workspace (--access read|write)
  --expires <span>          keys create: when it stops working — 30d, 90d, 365d or never (default never)
  --grace <span>            keys rotate: keep the old key working for 1h or 24h while you swap the new one in (default 0: revoked now)

Platform options (deploy, invoke, secrets, logs, keys)
  --to <workspace>          workspace on the platform (deploy default: folder name); flow add/show, agent link: edit or show the deployed copy instead of this folder; restore <ws>: the commit, date or age to put it back to (3d, 2026-09-28T14:00)
  --tenant <name>           account to deploy into (default: default, local only)
  --data <dir>              the installation's data directory
  --url <url>               a running platform (or FOLDRUN_URL, or where you last signed in)
  --token <key>             API key for --url (or FOLDRUN_TOKEN, or the one from foldrun login)
  --timeout <s>             seconds one request may take (or FOLDRUN_TIMEOUT; default 30, tool test 300)
  FOLDRUN_TIMEOUT=<s>       seconds one request to the platform may take (default 30)
  --profile <name>          act as one stored account for this command (see foldrun accounts)
  --quiet                   leave out the dim "acting as …" line a platform command prints on stderr
  --local                   deploy: into the installation on this machine, even when signed in
  --commit <sha>            deploy: record which commit this is
  --overwrite               import: replace files the workspace already has with different text (refused otherwise)
  --dry-run                 deploy: check and report, change nothing; flow add, flow set, flow trigger, flow move-step, flow paste, flow draft, history restore, agent link, agent unlink: show the diff, write nothing; restore <ws>: the diff only, restore nothing; import: the preview only, write nothing; stop, rerun (bulk): list what matches, touch nothing
  --no-runtimes             deploy: do not wait for the workspace's environments to be built
  --force                   deploy: deploy even while runs are in flight; pull, storage get: overwrite local files
  --yes                     deploy: allow deleting files this folder no longer has (asked otherwise; required with no terminal)
  --platform --yes          workspaces rm: delete it on the platform, deliberately
  --platform                workspaces new, agent new, flow new, tool new: make it on the platform, not in this folder

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
const BOOLEAN_FLAGS = new Set(["account", "follow", "force", "oauth2", "wait", "watch", "print", "dry-run", "help", "no-browser", "local", "test", "flat", "yes", "platform", "json", "forever", "all", "check", "new-client", "quiet", "off", "can-ask", "preview", "csv", "failed", "starter", "history", "list"]);
// Flags said more than once collect into a list: `--tag a --tag b`.
const REPEATABLE = new Set(["tag", "expect", "header"]);
// `--wait` is a switch everywhere but `flow add <flow> wait`, where it takes
// a span: `--wait 30m`, `--wait event`. Only a value that reads as one is
// taken, so `invoke x --wait` and friends are as they were.
const WAIT_VALUE = /^(\d+(\.\d+)?\s*[smhd]|event)$/i;
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith("--")) {
    positional.push(rest[i]);
    continue;
  }
  const name = rest[i].slice(2);
  const next = rest[i + 1];
  let value;
  if (name === "wait" && next !== undefined && WAIT_VALUE.test(next)) value = rest[++i];
  else if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith("--")) value = true;
  else value = rest[++i];
  if (REPEATABLE.has(name) && typeof value === "string") flags[name] = [...(Array.isArray(flags[name]) ? flags[name] : []), value];
  else flags[name] = value;
}

// Help, before anything runs. `foldrun deploy --help` used to parse --help
// into a flag nothing read and then DEPLOY (2026-09-30, to the wrong account).
// --help or -h anywhere, or `foldrun help <command>`, prints that command's
// lines and exits 0 — no platform is contacted, no file is touched.
if (flags.help === true || rest.includes("-h") || command === "help") {
  const which = command === "help" ? positional[0] : command;
  console.log(helpFor(which));
  process.exit(0);
}

/** The lines of HELP about one command: its `foldrun <command>` usage lines
 *  and the options whose description names it. The whole text when nothing
 *  matches or none was named. */
function helpFor(which) {
  if (!which) return HELP;
  const esc = which.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const usage = new RegExp(`^\\s*foldrun ${esc}(\\s|$)`);
  // An option's text is clauses split by ";", each "<commands>: what it
  // does there". Only the part before a clause's first colon names
  // commands, as a comma list — "approve, reject: …" names approve too.
  // Matching anywhere up to a colon let prose in the text name a command:
  // secrets' --kind reads "api (--base-url, --header "Name: value"…" and
  // showed under `api --help`.
  const item = new RegExp(`^${esc}(\\s|$)`);
  const names = (text) =>
    text.split(";").some((clause) => {
      const colon = clause.indexOf(":");
      return colon > 0 && clause.slice(0, colon).split(",").some((x) => item.test(x.trim()));
    });
  const lines = HELP.split("\n");
  const own = lines.filter((l) => usage.test(l));
  const opts = lines.filter((l) => /^\s*--/.test(l) && names(l.replace(/^\s*--\S+(\s+(\/\s+)?--\S+)*(\s"?<[^>]+>"?)?\s+/, "")));
  if (!own.length && !opts.length) return HELP;
  return ["", ...own, ...(opts.length ? ["", "Options:", ...opts] : []), "", "`foldrun --help` for everything."].join("\n");
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
