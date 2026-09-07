# Contributing

Thank you for looking. This is the command line for [foldrun](https://foldrun.io). It is a thin
front for [`@foldrun/core`](https://github.com/foldrun-io/foldrun-core),
which holds the format, the runner and the checks — a change to how an
agent *behaves* almost always belongs there, and a change here is about how
a person drives it: arguments, output, the shape of an error.

## Getting set up

```bash
git clone https://github.com/foldrun-io/foldrun-cli
cd foldrun-cli
npm install
npm test          # no network, no model calls
npm run e2e       # the slow one: real workspaces, still no model
```

Node 22 or newer. No model key is needed: every test that would call a model
uses the stub executor.

## What a good change looks like

- **A test that fails before it and passes after.** A CLI's contract is its
  output: what it prints, what it exits with, what it refuses. That is
  exactly what breaks silently.
- **A commit message that explains why.** Prose, not a convention. The
  changelog is drafted from these, so write the sentence you would want to
  read in six months when the behaviour surprises you. Say what was
  happening before, if something was.
- **Comments where the reason is not obvious from the code.** Especially:
  what you tried that did not work, and what a reader will be tempted to
  "simplify" back into a bug.

## What is deliberately not here

Some absences are decisions, not gaps:

- `check`, `run` and `eval` never leave your machine. Only `deploy`,
  `invoke`, `logs --url` and the sign-in commands talk to a platform.
- No timeouts a person did not write. A step runs until it finishes.

## Releasing

Maintainers only:

```bash
npm run release              # a preview: the version, the changelog entry
npm run release -- --yes     # write it, commit, tag
git push --follow-tags       # this publishes
```

The tag is what publishes; CI builds, tests and pushes to npm with
provenance. Nothing publishes from a laptop.
