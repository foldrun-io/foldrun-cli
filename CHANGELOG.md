# Changelog

Notable changes to the `foldrun` CLI. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/), with the 0.x rule that a
breaking change is a minor bump until 1.0.0.

Entries are drafted from the commit subjects by `npm run release` and then
edited by a person.

<!-- releases -->

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
