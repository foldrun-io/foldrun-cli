# Versions and releases

The hosted platform deploys itself whenever its code changes — there is no
release train and nobody decides "this is a release". Every deploy that comes
up healthy is one, and gets a name.

## The scheme

```
v2026.10.01.3
 │    │  │  └─ the third deploy that day
 │    │  └──── day   (UTC)
 │    └─────── month
 └──────────── year
```

CalVer with a daily counter, not semver. A box that ships every push to main
would have a bot bumping a patch number forever, and the numbers would mean
nothing; a date says when, and sorts. A rollback redeploys an older version
under its own name — `v2026.09.30.2` deployed again is still `v2026.09.30.2`.

Behind each name are the commits of the parts that make up the platform —
`core` (the runtime), `platform` (queue, worker, storage, billing), `web` (the
dashboard and the API), `docs` and `infra` — recorded when it was deployed.
The `foldrun` CLI and `@foldrun/core` on npm are packages a person publishes,
and keep ordinary semver (`0.6.0`).

## Where to see it

| Where | What |
|---|---|
| The sidebar's foot | `foldrun v2026.10.01.3`, linking to What's new |
| **What's new** (`/dashboard/whats-new`) | every recent release, newest first, with what changed in each — grouped Features, Fixes, Docs and Other |
| **Settings → About** | the version, when it was released, the API version, and each component's commit |
| `GET /api/version` | the same as JSON, no key needed — see the [API reference](api#versions) |
| `GET /api/changelog` | the release notes as JSON, with a key |
| Any `/api` response | the `X-Foldrun-Version`, `X-Foldrun-Api` and `X-Foldrun-Cli` headers |
| `foldrun version` | this CLI, its core, and the platform it talks to |

An open dashboard tab checks every few minutes, and when you come back to it,
whether the platform has moved on. If it has, a small notice offers a reload
and a link to What's new. It never reloads by itself.

## Release notes

The deploy writes them: for each release, the commits between the version
before and this one, in every part, grouped from what each commit says —
Features, Fixes, Docs (anything in the docs, or that says it is docs) and
Other (dependencies, tests, the deploy's own plumbing). The groups are read
from the words of a commit subject, so a fix described without the word may
land under Features. A release whose changes could not be read says so
rather than showing an empty list.

A self-hosted or locally built install has no notes and reports `dev`, or
whatever `FOLDRUN_VERSION` it was started with.

## The API version

`api` in `/api/version`, and the `X-Foldrun-Api` header, is a date —
`2026-10-01` — that changes only when a route changes in a way an existing
caller would break on. A new route or a new field in an answer does not move
it. Breaking changes are announced in the release notes of the version that
makes them.

## CLI compatibility

The CLI talks to the platform over the same HTTP API as everything else, so
an older CLI keeps working against a newer platform; what it lacks are the
newest commands. Each platform version records the CLI released with it
(`packages.cli` in `/api/version`, and `X-Foldrun-Cli` on every response):

- `foldrun version` compares that with its own version and warns when the
  platform's is newer.
- Any other command that reaches the platform prints one dim line when the
  platform's CLI is newer — at most once a day, only in a terminal, and
  never in a script or CI. `FOLDRUN_NO_UPDATE_NOTICE=1` turns it off.
- `foldrun --version` prints the CLI's version and nothing else, offline.

To update: `npm i -g foldrun@latest`.
