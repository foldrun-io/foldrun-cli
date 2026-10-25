# Deploying

A workspace deploys by sending its files: `foldrun deploy` from a folder,
from your laptop or from CI. Every deploy is checked before anything goes
live, refuses to swap files under a run in flight, and never touches what
the platform owns.

## From a folder

```sh
foldrun login                            # once per machine: approve in the browser
foldrun check                            # first, always — it costs nothing
foldrun deploy                           # this folder → the workspace named after it
foldrun deploy --to leads --commit $(git rev-parse HEAD)
```

In CI there is no browser: set `FOLDRUN_URL` and `FOLDRUN_TOKEN` (a key from
Settings → API keys, or `foldrun keys create`) and the same commands run. A
key for CI should open the one workspace it deploys:
`foldrun keys create ci --workspaces leads`.

`--commit` records which commit of your own repository the files came from;
the workspace page and its History show it.

## Your own GitHub or GitLab

Keep the folder in your own repository and deploy it from CI with the
commands above. A connected app — a push to your main branch deploys,
other branches become previews, a check on every commit — is coming, for
GitHub first, then GitLab. Until 17 October 2026 every workspace was also a
git remote on the platform, with deploy keys, branch previews, a mirror and
a GitHub push webhook; those went, and history moved to the platform's own
snapshots (below).

## What a deploy checks

The tree is validated the way `foldrun check` validates it — a step naming an
agent that does not exist, a tool that resolves to nothing, a knowledge
concept with no `type:` — and a deploy with issues is refused with the list.
The workspace on disk is unchanged.

## What a deploy never touches

`runs/`, `state/`, `secrets.json`, and any memory an agent wrote that the
deploy does not mention. A deploy that reverted what an agent learned would
make every run a little dumber, and a deploy that reset a cursor would make
the next run redo a fortnight.

## Runs in flight

A deploy while a run is in flight — including one parked at an approval gate
— is refused, saying which runs hold it. Swapping files under a running flow
would mean step 3 reads agents step 1 never saw. `foldrun deploy --force`
overrides that when you mean it.

## History and rollback

Every change to a workspace is a revision — a deploy, a dashboard edit, an
import — with who, when and a diff, on the workspace's History page and at
`/api/workspaces/<ws>/history`. Every revision also keeps a snapshot of the
whole source as it stood just after it: the platform's own deploy history,
so rolling back never needs a repository.

A rollback is **Roll back to this** on a History row, or
`foldrun restore <ws> --to <revision|time|age>`, and it lands as a **new
revision** — history moves forward, never rewrites. **Preview** beside it
shows first what it would change, add and remove, with diffs, and any run in
flight that would hold it — the restore dry run
(`POST …/restore {to, dryRun: true}`), which is the same operation. See
[Backups and restore](backups-and-restore).
