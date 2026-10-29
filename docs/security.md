# Security

The platform runs code it did not write, on behalf of people who may be
wrong about what it will do, next to other people's data. Everything in its
design follows from taking that seriously. This page is what an agent can
and cannot do, and why.

## Where a step runs

Every step executes in its own sandbox, created for it and destroyed after
it: a hardened container on a single box, a **gVisor** pod on a cluster.
The sandbox holds a copy of the agent's folder and nothing else — not the
platform's filesystem, not the vault, not another workspace. When the step
ends, its files copy back through a filter, and the sandbox is gone.

Startup is under a second warm, so this is not the latency it sounds like;
it is the boundary that lets one account's agent and another's share a
machine.

## What the network allows

A run pod may reach DNS, the egress proxy where its credentials are filled
in, and — for an agent whose [network](network) is `open` — the public
internet and its own account's search and browser pods; nothing else. An
agent that is `trusted` or `none` (the default for one that does not read
the web) reaches the internet only through the egress proxy, which holds
its list of sites per connection; where it is enforced
(`network_enforce: true` in the account's or workspace's `AGENTS.md`, or
`FOLDRUN_NETWORK_ENFORCE=1` on the install) its pod has no other route, and no way to the
account's browser or search pods. The policy denies every private range (RFC1918) and the
cloud metadata endpoint — the address that, on a cloud host, hands out the
machine's own credentials. It cannot reach the platform's API, its
database, its object store, or another account's pods. Workspace files
come and go through presigned URLs, so no bucket credential is ever in a
pod. A [test run](runs#test-runs) is denied the internet and the browser
pod as well, at the network, so an outward call from a script fails closed
whatever the script does.

The CNI that enforces this is Cilium. Two things follow
from that for anyone writing a rule: a pod is matched by its identity —
its labels — never by an address range, so an `ipBlock` on the pod CIDR
admits nothing and every in-cluster rule is a selector; and a deny beats
every allow, which is how a test run keeps every ordinary allow and loses
the internet. Hubble records every flow and every drop, which is where a
"why can't this step reach X" question is answered.

What a run reaches on the internet, it reaches as itself. A tool that calls
a third party does so with the secret the agent was granted, and nothing
about the platform.

## What the file tools allow

An agent's built-in Read, Write, Edit, Glob and Grep are confined to its
workspace: its own folder, the workspace's shared directories, and the
account library read-only. A path outside — an invented `/tmp/…`, an
absolute path, a directory a tool cloned outside the workspace — is refused
with a message naming the path the agent probably meant. Three more things
stay off limits inside the workspace: the secrets file, the run journal,
and the generated index of a knowledge bundle.

Refusals are counted per step and shown on the run page. Each one is a
wasted turn; a prompt that names the exact path brings the count to zero.

**A run does not change its own configuration or code.** What a step
writes to `AGENTS.md`, `agents/`, `flows/`, `tools/`, `hooks/`, `skills/`,
`evals/` or `scripts/` is not kept: the workspace keeps its own copy, and
the run page lists each such path under "Not kept". A prompt injection
cannot widen what later runs may do. Data comes back as before — `state/`,
`storage/`, `memory/`, `knowledge/`. The one exception is a step a person
approved before it ran (`!` or `approve: true`): the person read what it
would do, so its changes to configuration and code are kept, and listed
on the trail as "kept with approval". That is how an approved fix lands.

## Secrets

An agent names a secret in `secrets:`; the model never sees the value — it
sees that a tool exists and calls it. Secrets are never written into a
workspace, never in git, and reads of the vault return names, not values.

On a cluster the value does not enter the sandbox either. The worker keeps
it and the step sends its API and model requests through a per-step
**egress proxy** with `${NAME}` placeholders; the proxy fills each one for
the host it was granted to and forwards. A compromised script in the pod
reads its environment and finds the name, not the key. The exception is a
step whose script tools or Bash need the value in process (a browser seeding
cookies), which materialises its secrets into the sandbox and says so in the
trace — unless the secret is [bound to sites](secrets#bound-to-sites): a bound
secret never enters a sandbox, because the proxy fills it for those sites
whatever program sent the request.

At rest, each account has its own encryption key; the account keys are
wrapped by one root key the platform holds. A stolen copy of an account's
secrets opens nothing without it.

The egress proxy can run without that root key
([`FOLDRUN_EGRESS_MINIMAL_BOOT`](environment)). It is then given only what it
uses, each derived from the root key for that one purpose: the public half
of the key the worker signs every step's lease with, the key of the
certificate authority it signs bound sites with, and the key that seals the
identity signing keys. A lease is sealed under the step's own token, which
the lease store never holds, so the proxy opens a step's credentials only
when that step presents its token — and a lease nobody but the worker could
have signed is refused.

Backups are encrypted before they leave the server. The nightly archive —
every workspace, run record and the database — and the server's key file
are encrypted with age to a public key whose private half is not on the
server, so a copy of the backup bucket opens nothing; the job refuses to run
rather than ship anything unencrypted. See [Backups and restore](backups-and-restore).

Wherever a step's children run on the host itself rather than in a sandbox
— a script tool, a `verify:` shell, the model's own Bash tool on a laptop
or the host executor, a tool test in the dashboard — they start from an
allowlisted environment, never the platform's own: `PATH`, `HOME`, the
locale, the clock, proxy settings, `NODE_*`, the run's `FOLDRUN_RUN_*`
identifiers, and the secrets the agent declared, by name. The root key,
the datastore and mail credentials are not in it. A run container needs
none of this: its environment is the boundary, assembled from the same
rule before it starts.

A run's record is scrubbed the same way its events are: a secret quoted in
a step's reply, its conclusion or an `output: json` value is written as
`[redacted:NAME]`. Every hook and approval token derives from the vault's
own key, created the first time anything asks — never from a constant.

## Capability is structural

A step can do only what its agent's file grants: the tools it names, the
secrets it names, the colleagues it may consult. An agent with no tool that
writes cannot write, whatever it is told or tricked into. This is the
platform's answer to prompt injection: not a paragraph asking the model to
be careful, but a file in which the dangerous thing is absent.

The pattern that follows from it, and that the reference desks use: the
tool that *proposes* a change and the tool that *applies* it are two tools,
and only the step after a human gate holds the second.

## Gates and the record

A `!` on a step parks the run for a person, and the run cannot proceed
without a decision that is recorded — by whom, through which door, with
what note. An emailed approve link decides **one step, once**: its token
is bound to that step, expires (the flow's `approve_within:`, else a week),
and — when the mail went to a named approver — decides as that person, so
a forwarded link cannot walk past `approvers:`. Only a digest of a used
token is kept, and a key rotation kills every old link. Share links are 24 random
bytes; every failed fetch is the same 404.

Every write to a workspace is a revision with an author; every sign-in, key
use and role change is in the audit log; every step's tool calls, script
runs and refusals are in the run's events. A run can be reconstructed from
its record.

## People

Four roles, least privilege by route, one owner. See
[Team and access](team-and-access). Sessions are revocable; API keys carry a
role, can be given an end and rotated, show when they were last used, and
cannot act as a named person. The account's
[audit log](team-and-access#audit-log) records who did what — secrets by
name only — for the owner and admins to read or export. Support can view an
account only [read-only, for thirty minutes, with a reason the customer
reads](team-and-access#support-access).

Signing in, in particular:

- a password reset or change, two-step sign-in turned on or off, and a new
  API key each send a notice to the person's address;
- signing out ends the session on the server, not just in the browser;
- a two-step code works once; replacing a second factor means turning it
  off first, which needs the password and a code;
- the sign-in forms refuse a request from another site, and `?next=` only
  ever leads to a page on the same site;
- `foldrun login` asks you to type the code your terminal shows — a link
  with the code in it, sent by someone else, cannot sign their machine in
  as you;
- before the first sign-up, a self-hosted install's setup token guards key
  minting as it guards sign-up;
- only the account's owner can set the account's `RESEND_API_KEY` and
  `EMAIL_FROM`, because that sender carries everyone's reset links;
- a member or key limited to some workspaces cannot change what every
  workspace shares — the library, the account's AGENTS.md defaults, its
  model provider, its OAuth apps — nor people who work outside its
  workspaces.

Frontmatter is YAML only: a file opened with `---js` (which some parsers
run as code) is refused.

## The dashboard in your browser

Every page is sent with an enforced Content-Security-Policy: scripts run
only with that response's own nonce (a fresh one per request) or when one of
those scripts loads them, and nothing is loaded from another site. Plugins,
framing by another site, a changed `<base>` and forms posting elsewhere are
refused. Pages are not cacheable, and also carry `X-Frame-Options: DENY`,
`nosniff`, COOP and CORP. HTML and SVG you store are never rendered on the
dashboard's origin. A self-hosted install can switch the policy to
report-only with `FOLDRUN_CSP` ([Environment](environment)).

## Your terminal

The CLI prints what a platform sends it — agents' replies, logs, files,
release notes, errors — and a terminal obeys escape sequences hidden in
text: it can move the cursor and overwrite a line, clear the screen, retitle
the window, write your clipboard, or show a link that goes somewhere else.
So nothing the CLI prints carries them. The only ones that get through are
the CLI's own colours, and every other control character but newline and
tab is removed, on a terminal and through a pipe alike. Content you asked for
byte for byte — `foldrun source cat`, `storage cat`, `library cat`, a
download or CSV to stdout, `api spec` — is exact when it goes into a file or
another program, and filtered like everything else when it lands on a
screen. `--json` is exact too: JSON writes control characters as escapes.

## What is still yours to think about

- A model reading a web page reads whatever is on it. Give the agent the
  narrowest tools its job needs, and put a gate before anything irreversible.
- A tool with write access to a third party — your repository, your CRM —
  is a write. Scope the credential to what the tool must do.
- Bring-your-own-key credentials are yours; the platform stores them sealed
  and hands them to your steps, and never sees the bill.
- The CLI on your machine runs steps as you, in your workspace, unless
  `FOLDRUN_RUN_ISOLATION=container` is set. That is your laptop and your
  call. See [Running it yourself](self-hosting).

## Reporting a vulnerability

Write to **hello@foldrun.io** with "security" in the subject. Do not open a
public issue. The same address is in `/.well-known/security.txt` on
foldrun.io and on the platform. Scope, what we will not pursue you for, and
the response targets are on the
[security page](https://foldrun.io/security/#report).

## Subprocessors and the DPA

The vendors that process customer data for the hosted platform — and the
integrations that only run when *you* configure them with your own key —
are listed at [foldrun.io/subprocessors](https://foldrun.io/subprocessors/).
A data processing agreement is drafted at
[foldrun.io/dpa](https://foldrun.io/dpa/); it is under legal review and not
yet offered for signature.

Whether the platform is up, and any incident, is on the status page — see
[Status and incidents](status).
