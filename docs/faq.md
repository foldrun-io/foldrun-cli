# FAQ

**Is this a framework?** No. There is nothing to import. An agent is a folder,
a flow is a numbered list in a markdown file, and the CLI or the platform
reads them. You can write a working workspace in an editor with no
dependency installed.

**Do I need an account to try it?** No. `npm install -g foldrun`, a model key,
and `foldrun init` gives you a workspace that runs on your machine. The
account is for running it somewhere that is not your laptop, on a schedule,
with a team.

**Which models does it use?** Whatever you point it at. `model:` takes a
tier — `fast`, `default`, `max` — and the platform resolves the tier to a
model. Bring your own key for any provider that speaks the Anthropic or the
Chat Completions API, per account or per workspace, and the platform bills
you nothing for those tokens. See [Providers](providers).

**Can agents reach the internet?** Yes — the public internet, as themselves,
with the secrets they were granted. Not private networks, not the cloud
metadata endpoint, not the platform's own API or database.

**Can an agent change my website / my CRM / my repository?** Only if its
file names a tool that can, and the reference pattern is to give that tool
only to the step after a human gate. An agent with no tool that writes cannot
write, whatever it is told.

**What stops a runaway?** Three caps — per run, per workspace per month, per
account per month — and the stop button, which destroys the sandbox. A
step with no `timeout:` runs until it finishes; that is deliberate, and the
caps are the ceiling.

**How do I know what happened while I was asleep?** The run's headline: the
first line of the last step's reply, which is the runs-list row and the
subject of the notification. Ask your agents to open with a verdict and the
inbox becomes a status board.

**Can two flows write to the same repository?** Yes, and they should not do
it in the same hour. Give each writer its own day, or chain one after the
other with `trigger: flow`.

**I use Claude Code. Does that help?** A subagent at
`.claude/agents/<name>.md` deploys as a foldrun agent with no conversion.
The scaffolded `CLAUDE.md` tells your editor the layout.

**Where is my data?** In your workspace's folder, as files — on your machine,
or on the hosted platform's data volume — and its blobs in the
file store. Nothing is hidden in a database only the platform can read, and
a deploy never touches what an agent learned or a run recorded.

**Can I run it on my own hardware?** The CLI and runtime, yes — that is
what they are for, and they are open source. The platform itself is hosted
only. See [Running it yourself](self-hosting).
