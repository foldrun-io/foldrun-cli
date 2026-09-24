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

A run pod may reach the public internet, DNS, the egress proxy where its
credentials are filled in, and its own account's search and browser pods —
and nothing else. The policy denies every private range (RFC1918) and the
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

## Secrets

An agent names a secret in `secrets:`; the model never sees the value — it
sees that a tool exists and calls it. Secrets are never written into a
workspace, never in git, and reads of the vault return names, not values.

On a cluster the value does not enter the sandbox either. The worker keeps
it and the step sends its API and model requests through a per-step
**egress proxy** with `${NAME}` placeholders; the proxy fills each one for
the host it was granted to and forwards. A compromised script in the pod
reads its environment and finds the name, not the key. The one exception
is a script tool that needs the value in process (a browser seeding
cookies), which materialises the step's secrets into the sandbox and says
so in the trace — see [Secrets](secrets).

At rest, each account has its own encryption key; the account keys are
wrapped by one root key the platform holds. A stolen copy of an account's
secrets opens nothing without it.

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
role and cannot act as a named person.

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
