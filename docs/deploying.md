# Deploying

A workspace deploys by pushing files. Two doors, one mechanism: `foldrun
deploy` from a folder, or `git push` to the remote every workspace has.
Both are checked before anything goes live, both refuse to swap files under
a run in flight, and neither touches what the platform owns.

## From a folder

```sh
foldrun login                            # once per machine: approve in the browser
foldrun check                            # first, always — it costs nothing
foldrun deploy                           # this folder → the workspace named after it
foldrun deploy --to leads --commit $(git rev-parse HEAD)
```

In CI there is no browser: set `FOLDRUN_URL` and `FOLDRUN_TOKEN` (a key from
Settings → API keys, or `foldrun keys create`) and the same commands run.

## From git

Every workspace is a git remote:

```sh
git clone https://foldrun:<api-key>@app.example.com/git/<account>/<workspace>.git
# edit, commit
git push origin main                     # deploys, and runs the evals
```

Any username, an API key as the password. A **deploy key** — minted for one
workspace, read or write, with `foldrun keys create ci --for <workspace>
--access write` or on the Settings page — is what a CI job or a contractor
should hold; it is refused on every other workspace and on every other route.

Push a branch other than `main` and you get a **preview**: a workspace named
`<workspace>-preview-<branch>` deployed from that branch, with its evals run
there, its schedules never fired, and its source's secrets. Deleting the
branch deletes it.

## What a deploy checks

The tree is validated the way `foldrun check` validates it — a step naming an
agent that does not exist, a tool that resolves to nothing, a knowledge
concept with no `type:` — and a push with issues is refused with the list.
Git says so at push time; the workspace on disk is unchanged.

## What a deploy never touches

`runs/`, `state/`, `secrets.json`, and any memory an agent wrote that the
push does not mention. A deploy that reverted what an agent learned would
make every run a little dumber, and a deploy that reset a cursor would make
the next run redo a fortnight.

## Runs in flight

A push while a run is in flight — including one parked at an approval gate
— is **accepted but not applied**. Git warns at push time, and the platform
applies it the moment those runs finish. Swapping files under a running flow
would mean step 3 reads agents step 1 never saw. `foldrun deploy --force`
overrides that when you mean it.

## History and rollback

Every change to a workspace is a revision — a push, a dashboard edit, an
agent's memory write — with who, when, and a diff, on the workspace's
History page and at `/api/workspaces/<ws>/history`. A deploy's revision id
is its commit.

A rollback is a deploy of an earlier ref (`POST …/repo {action: deploy, ref}`
or the History page), and it lands as a **new commit on `main`** — history
moves forward, never rewrites.

## Mirroring

A workspace can mirror to a repository you host — GitHub, GitLab — over
https with a token held as the `MIRROR_TOKEN` secret. The platform's remote
stays the mechanism; the mirror is the copy you read elsewhere.
