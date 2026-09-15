# Changelog

Notable changes to the `foldrun` CLI. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/), with the 0.x rule that a
breaking change is a minor bump until 1.0.0.

Entries are drafted from the commit subjects by `npm run release` and then
edited by a person.

<!-- releases -->

## [0.6.0] — 2026-09-15

- The CLI asks for the core it was written against ([5151460](https://github.com/foldrun-io/foldrun-cli/commit/5151460))
- gray-matter as a dev dependency: the e2e test reads frontmatter itself ([270deda](https://github.com/foldrun-io/foldrun-cli/commit/270deda))
- ci checks out the sibling core and links it, the way a checkout has it ([6993084](https://github.com/foldrun-io/foldrun-cli/commit/6993084))
- check fails on a flow option core refuses, not just warns ([63c0545](https://github.com/foldrun-io/foldrun-cli/commit/63c0545))
- NO_COLOR turns the escapes off ([9ffa571](https://github.com/foldrun-io/foldrun-cli/commit/9ffa571))
- a quiet run stream is reconnected, then given up on; a refused key says whose ([387564c](https://github.com/foldrun-io/foldrun-cli/commit/387564c))
- --url acts as the current account, and every remote command says which ([f080b60](https://github.com/foldrun-io/foldrun-cli/commit/f080b60))
- invoke --wait asks in 25-second pieces ([794880e](https://github.com/foldrun-io/foldrun-cli/commit/794880e))
- --test on run and invoke ([4f75235](https://github.com/foldrun-io/foldrun-cli/commit/4f75235))
- connect reuses the saved client; secrets status ([2262bd6](https://github.com/foldrun-io/foldrun-cli/commit/2262bd6))
- Bump the actions group with 3 updates (#1) ([e766085](https://github.com/foldrun-io/foldrun-cli/commit/e766085))

### foldrun doctor

- the path to the platform, one line per check ([f5d1dc8](https://github.com/foldrun-io/foldrun-cli/commit/f5d1dc8))

### invoke --wait

- report a failed run, not "HTTP 500" (#7) ([2d96b11](https://github.com/foldrun-io/foldrun-cli/commit/2d96b11))

### npm run typecheck

- the .mjs sources checked from their JSDoc ([1ec2b99](https://github.com/foldrun-io/foldrun-cli/commit/1ec2b99))

### README

- doctor in the command table ([8d1a489](https://github.com/foldrun-io/foldrun-cli/commit/8d1a489))

### the HTTP client

- a clock, the cause, a User-Agent, one retry ([19c510e](https://github.com/foldrun-io/foldrun-cli/commit/19c510e))

## [0.5.0] — 2026-09-09

### Added

- **`foldrun source`** — one workspace file on a platform, from the terminal:
  `ls [dir]`, `cat <path>`, `put <path>` (from `--file`, else stdin, with
  `--message` recorded on the revision), `mv`, `rm`. The same door the
  dashboard's editor uses, so every write is a revision with who and why.
  For a whole tree, `deploy`.
- **Named accounts.** A profile is one signed-in account on one platform.
  `foldrun accounts` lists every account signed in on this machine with the
  active one marked, `foldrun use <name>` switches, and `--profile <name>`
  acts as one for a single command. Two customers on the *same* platform
  used to overwrite each other, which made looking after several of them a
  matter of pasting `--token` every time.

### Changed

- **Credentials are an API key, and only that.** A claude.ai login sitting on
  the machine is no longer accepted as one: Anthropic does not allow products
  built on its Agent SDK to run on claude.ai subscriptions. Set
  `ANTHROPIC_API_KEY`, or give the agent its own `provider:`.

### Compatibility

- A credentials file written by 0.4.0 is read as it was and migrated on the
  next write, and the old per-URL map goes on being written — a machine that
  moves between versions is not signed out by the move.

## [0.4.0] — 2026-09-08

- depends on @foldrun/core 0.3.0 ([e544799](https://github.com/foldrun-io/foldrun-cli/commit/e544799))

### ignore the lockfile

- this package is installed, not deployed ([43eb1c0](https://github.com/foldrun-io/foldrun-cli/commit/43eb1c0))

### release

- only stage the lockfile when git tracks it ([dfd7689](https://github.com/foldrun-io/foldrun-cli/commit/dfd7689))
- publish by trusted publishing, not a stored token ([cf4807e](https://github.com/foldrun-io/foldrun-cli/commit/cf4807e))

### release engineering

- changelog, tagged releases, CI, and the community files ([1979795](https://github.com/foldrun-io/foldrun-cli/commit/1979795))

## [0.3.1] — 2026-09-07

- `init --from templates/<name>` resolves inside the installed
  `@foldrun/core` rather than relative to the caller, so a template works
  from any directory.

## [0.3.0] — 2026-09-07

- Depends on `@foldrun/core` 0.2.0.

## [0.2.3] — 2026-09-06

- Republished after the npm scope wipe; `0.1.x` and `0.2.0`–`0.2.2` are
  burned and cannot be reused.

## [0.2.0] — 2026-09-05

- `login`, `whoami` and `keys`: sign a machine in, see who it is, manage the
  account's API keys.

## [0.1.0] — 2026-09-05

First publish: `init`, `check`, `run`, `eval`, `probe`, `logs`, `secrets`,
`deploy`.

[0.3.1]: https://github.com/foldrun-io/foldrun-cli/releases/tag/v0.3.1
