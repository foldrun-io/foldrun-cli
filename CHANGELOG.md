# Changelog

Notable changes to the `foldrun` CLI. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) from 1.0.0:
a patch is a bug fix, nothing new; a minor adds something and breaks
nothing; a major breaks something, and its entry opens with Breaking
changes. Pre-releases (`1.3.0-rc.1`) are published under npm's `next` tag.

Entries are drafted from the commit subjects by `npm run release` and then
edited by a person.

<!-- releases -->

## [10.1.1] — 2026-10-30

### deps

- @foldrun/core ^9.1.0 ([22be59e](https://github.com/foldrun-io/foldrun-cli/commit/22be59e))

## [10.1.0] — 2026-10-30

### New in the public API

- `foldrun secrets workspaces`
- the `--none` flag
- the `--workspaces` flag

- feat(secrets): secrets workspaces / set --workspaces; masked share ids; check --online note ([2bc54f1](https://github.com/foldrun-io/foldrun-cli/commit/2bc54f1))

## [10.0.0] — 2026-10-30

### Breaking changes

- the CLI now runs on @foldrun/core 9.0.0, a new major. (790a0cb)

- fix(storage): send the file size when asking for an upload URL ([11f13c7](https://github.com/foldrun-io/foldrun-cli/commit/11f13c7))

### deps

- @foldrun/core ^9.0.0 ([790a0cb](https://github.com/foldrun-io/foldrun-cli/commit/790a0cb))

## [9.0.3] — 2026-10-30

### deps

- @foldrun/core ^8.0.1 ([d36fa9d](https://github.com/foldrun-io/foldrun-cli/commit/d36fa9d))

## [9.0.2] — 2026-10-30

### chore

- remove dead code, and refuse unused locals at typecheck ([174de9e](https://github.com/foldrun-io/foldrun-cli/commit/174de9e))

## [9.0.1] — 2026-10-30

- fix(flags): the platform's operator changes flags, not a super admin ([9fe926f](https://github.com/foldrun-io/foldrun-cli/commit/9fe926f))

## [9.0.0] — 2026-10-29

### Breaking changes

- the CLI now runs on @foldrun/core 8.0.0, a new major. (ea452b5)

### deps

- @foldrun/core ^8.0.0 ([ea452b5](https://github.com/foldrun-io/foldrun-cli/commit/ea452b5))

## [8.1.2] — 2026-10-29

### deps

- @foldrun/core ^7.0.2 ([4ce4b3d](https://github.com/foldrun-io/foldrun-cli/commit/4ce4b3d))

## [8.1.1] — 2026-10-29

### deps

- @foldrun/core ^7.0.1 ([7855d3a](https://github.com/foldrun-io/foldrun-cli/commit/7855d3a))

### docs

- sync from foldrun-docs (CLI renewal retry and unwritable credentials) ([d71e311](https://github.com/foldrun-io/foldrun-cli/commit/d71e311))

### fix

- renewal never loses the new key, and runs on every remote command (FOL-71 review) ([1f3b21f](https://github.com/foldrun-io/foldrun-cli/commit/1f3b21f))

## [8.1.0] — 2026-10-29

### feat

- renew CLI-login keys; clearer login and network_enforce output; pull into an empty folder stays there (FOL-71, FOL-105, FOL-104) ([1155ae6](https://github.com/foldrun-io/foldrun-cli/commit/1155ae6))

### fix

- --wait shows why a run failed (FOL-106) ([d77fc92](https://github.com/foldrun-io/foldrun-cli/commit/d77fc92))

## [8.0.0] — 2026-10-29

### Breaking changes

- the CLI now runs on @foldrun/core 7.0.0, a new major. (dbf2b2e)

### deps

- @foldrun/core ^7.0.0 ([dbf2b2e](https://github.com/foldrun-io/foldrun-cli/commit/dbf2b2e))

## [7.1.0] — 2026-10-29

### New in the public API

- `foldrun team invites`
- `foldrun team invites revoke`

- feat(team): foldrun team invites [--all] and team invites revoke <id> ([83a03b4](https://github.com/foldrun-io/foldrun-cli/commit/83a03b4))

## [7.0.0] — 2026-10-29

### Breaking changes

- the CLI now runs on @foldrun/core 6.0.0, a new major. (2ae2d0a)

### deps

- @foldrun/core ^6.0.0 ([2ae2d0a](https://github.com/foldrun-io/foldrun-cli/commit/2ae2d0a))

## [6.0.0] — 2026-10-28

### Breaking changes

- the CLI now runs on @foldrun/core 5.0.0, a new major. (ac33b83)

### deps

- @foldrun/core ^5.0.0 ([ac33b83](https://github.com/foldrun-io/foldrun-cli/commit/ac33b83))

## [5.0.2] — 2026-10-28

- fix(security): pull and downloads never write outside their folder; browser opens web pages only ([7d4af08](https://github.com/foldrun-io/foldrun-cli/commit/7d4af08))

## [5.0.1] — 2026-10-28

### docs

- sync api.md, budgets-and-billing.md, cli.md, feature-flags.md, status.md ([99fd980](https://github.com/foldrun-io/foldrun-cli/commit/99fd980))

## [5.0.0] — 2026-10-28

### Breaking changes

- the CLI now runs on @foldrun/core 4.0.0, a new major. (53a02dd)

### deps

- @foldrun/core ^4.0.0 ([53a02dd](https://github.com/foldrun-io/foldrun-cli/commit/53a02dd))

## [4.0.1] — 2026-10-28

### docs

- sync agents.md, team-and-access.md ([8bee35e](https://github.com/foldrun-io/foldrun-cli/commit/8bee35e))

## [4.0.0] — 2026-10-28

### Breaking changes

- the CLI now runs on @foldrun/core 3.0.0, a new major. (7a3494f)

### deps

- @foldrun/core ^3.0.0 ([7a3494f](https://github.com/foldrun-io/foldrun-cli/commit/7a3494f))

## [3.0.1] — 2026-10-28

### deps

- @foldrun/core ^2.14.3 ([52ada05](https://github.com/foldrun-io/foldrun-cli/commit/52ada05))

### docs

- sync security.md and api.md (FOL-96) ([444f07d](https://github.com/foldrun-io/foldrun-cli/commit/444f07d))
- sync self-hosting note (FOL-96) ([e913958](https://github.com/foldrun-io/foldrun-cli/commit/e913958))

## [3.0.0] — 2026-10-28

### Breaking changes

- `foldrun billing credit` is gone (it was never deprecated)

- fix(cli): retire billing credit, point at billing top-up (FOL-94) ([7922099](https://github.com/foldrun-io/foldrun-cli/commit/7922099))

## [2.10.12] — 2026-10-27

### docs

- sync api.md, budgets-and-billing.md ([1333baa](https://github.com/foldrun-io/foldrun-cli/commit/1333baa))
- sync api.md ([94cb521](https://github.com/foldrun-io/foldrun-cli/commit/94cb521))

## [2.10.11] — 2026-10-27

### docs

- sync budgets-and-billing.md ([66bb1bc](https://github.com/foldrun-io/foldrun-cli/commit/66bb1bc))

## [2.10.10] — 2026-10-27

### docs

- sync budgets-and-billing.md ([a1527b7](https://github.com/foldrun-io/foldrun-cli/commit/a1527b7))

## [2.10.9] — 2026-10-27

### docs

- sync budgets-and-billing.md ([74d2ed4](https://github.com/foldrun-io/foldrun-cli/commit/74d2ed4))

## [2.10.8] — 2026-10-27

### docs

- sync security.md (dashboard CSP) ([12cf7de](https://github.com/foldrun-io/foldrun-cli/commit/12cf7de))

## [2.10.7] — 2026-10-27

### docs

- synced (extra credits, pay as you go) ([9bd9d99](https://github.com/foldrun-io/foldrun-cli/commit/9bd9d99))

## [2.10.6] — 2026-10-27

### docs

- synced (cold-start wait) ([ebeebc6](https://github.com/foldrun-io/foldrun-cli/commit/ebeebc6))

## [2.10.5] — 2026-10-27

### deps

- @foldrun/core ^2.14.2 ([abd3f79](https://github.com/foldrun-io/foldrun-cli/commit/abd3f79))

## [2.10.4] — 2026-10-27

- ci(release): the same change rule and release recovery as core ([7a31780](https://github.com/foldrun-io/foldrun-cli/commit/7a31780))

## [2.10.3] — 2026-10-27

- ci(release): bump-core starts over from a fresh main when its push loses, forward only ([c44e8e6](https://github.com/foldrun-io/foldrun-cli/commit/c44e8e6))

### deps

- @foldrun/core ^2.14.1 ([d2d32f3](https://github.com/foldrun-io/foldrun-cli/commit/d2d32f3))

## [2.10.2] — 2026-10-27

- ci(release): bump-core waits for the core it was told of — npm's latest lags the dispatch ([4f02749](https://github.com/foldrun-io/foldrun-cli/commit/4f02749))

## [2.10.1] — 2026-10-27

- ci(release): release-merge looks for its own evidence; connect tests take free ports ([1ca98cb](https://github.com/foldrun-io/foldrun-cli/commit/1ca98cb))
- ci(release): automatic CLI releases — move onto each new core, merge the release PR once ci passes ([184ab6f](https://github.com/foldrun-io/foldrun-cli/commit/184ab6f))

## [2.10.0] — 2026-10-27

### New in the public API

- `foldrun flow compute`

- feat(compute): flow compute, workspace and account compute with disk, every level in usage compute ([f1f757f](https://github.com/foldrun-io/foldrun-cli/commit/f1f757f))
- feat(usage): foldrun usage compute lists the steps waiting for room ([7b359fe](https://github.com/foldrun-io/foldrun-cli/commit/7b359fe))

### deps

- @foldrun/core ^2.14.0 — compute at four levels, disk, flow compute: in check ([3951ae1](https://github.com/foldrun-io/foldrun-cli/commit/3951ae1))

### docs

- synced (cloudflare trust mode) ([723a388](https://github.com/foldrun-io/foldrun-cli/commit/723a388))

## [2.9.1] — 2026-10-26

### docs

- synced (installer needs a local Docker) ([587b53a](https://github.com/foldrun-io/foldrun-cli/commit/587b53a))
- synced (setup link and tunnel) ([7796f79](https://github.com/foldrun-io/foldrun-cli/commit/7796f79))
- synced (setup link on 127.0.0.1) ([1ce2c0e](https://github.com/foldrun-io/foldrun-cli/commit/1ce2c0e))
- synced (self-hosting setup link and checks) ([d1d1227](https://github.com/foldrun-io/foldrun-cli/commit/d1d1227))
- synced (the installer sets Docker up) ([52ceb56](https://github.com/foldrun-io/foldrun-cli/commit/52ceb56))
- synced (a step's disk is scratch space) ([cfff659](https://github.com/foldrun-io/foldrun-cli/commit/cfff659))

## [2.9.0] — 2026-10-26

### New in the public API

- `foldrun usage compute`

### deps

- @foldrun/core ^2.13.0 (resources:, compute:, the compute pool) ([ac8bd2a](https://github.com/foldrun-io/foldrun-cli/commit/ac8bd2a))

### docs

- synced (the compute pool needs k8s isolation) ([c5946a3](https://github.com/foldrun-io/foldrun-cli/commit/c5946a3))
- size: and resources: in the agent guide; synced docs ([cac0b2d](https://github.com/foldrun-io/foldrun-cli/commit/cac0b2d))
- synced (size classes cap cores) ([e0bba39](https://github.com/foldrun-io/foldrun-cli/commit/e0bba39))
- synced (self-hosting: one command, ready-made images) ([e5337f0](https://github.com/foldrun-io/foldrun-cli/commit/e5337f0))

### feat

- foldrun usage compute, and foldrun account set compute vcpu <n> memory <GiB> ([322df02](https://github.com/foldrun-io/foldrun-cli/commit/322df02))

## [2.8.1] — 2026-10-26

### ci

- read the public foldrun-core with the job's own token ([0cfa6b8](https://github.com/foldrun-io/foldrun-cli/commit/0cfa6b8))

### deps

- @foldrun/core ^2.12.1 ([15220fa](https://github.com/foldrun-io/foldrun-cli/commit/15220fa))
- TypeScript 7.0.2 ([af89c00](https://github.com/foldrun-io/foldrun-cli/commit/af89c00))

## [2.8.0] — 2026-10-25

### billing

- print the platform's notices instead of guessing from the numbers ([a7a7118](https://github.com/foldrun-io/foldrun-cli/commit/a7a7118))

### ci

- GitHub's hosted runners, now that this repository is public ([7513582](https://github.com/foldrun-io/foldrun-cli/commit/7513582))

### deps

- @foldrun/core ^2.12.0 (the FSL release) ([2d68eb5](https://github.com/foldrun-io/foldrun-cli/commit/2d68eb5))

### docs

- synced (API version 2026-10-26) ([b4a87c0](https://github.com/foldrun-io/foldrun-cli/commit/b4a87c0))
- the billing verbs are the hosted platform's; synced docs; a neutral test desk ([0162f6d](https://github.com/foldrun-io/foldrun-cli/commit/0162f6d))
- synced — source-available, and your own server ([4241442](https://github.com/foldrun-io/foldrun-cli/commit/4241442))

### licence

- Functional Source License 1.1 (Apache 2.0 future licence) ([1861a19](https://github.com/foldrun-io/foldrun-cli/commit/1861a19))

## [2.7.0] — 2026-10-25

### New in the public API

- `foldrun flow filter`
- `foldrun eval compare`
- `foldrun eval improve`
- `foldrun proposals`
- `foldrun eval grades`
- `foldrun eval grade`
- `foldrun inbox`
- `foldrun inbox read`
- the `--models` flag
- the `--repeat` flag
- the `--max-usd` flag
- the `--no-wait` flag
- the `--team` flag
- the `--unread` flag
- the `--dismissed` flag
- the `--started` flag
- the `--mine` flag

- fix(deps): zod 4.6.7, body-parser 2.4, fast-uri (npm audit) ([d78d5af](https://github.com/foldrun-io/foldrun-cli/commit/d78d5af))

### deps

- @foldrun/core ^2.11.0 ([64e16b7](https://github.com/foldrun-io/foldrun-cli/commit/64e16b7))

### docs

- sync (fetch: anthropic answered by foldrun's fetch) ([b534a1e](https://github.com/foldrun-io/foldrun-cli/commit/b534a1e))
- sync network.md (browser scripts need the proxy credentials) ([e2e8bdb](https://github.com/foldrun-io/foldrun-cli/commit/e2e8bdb))
- sandbox: own hands back its files too; synced docs (on-fail/retry after a spent cap) ([eaf5d73](https://github.com/foldrun-io/foldrun-cli/commit/eaf5d73))

### feat

- eval grades/grade/compare/improve, proposals, inbox, flow filter ([e4f27da](https://github.com/foldrun-io/foldrun-cli/commit/e4f27da))

### fix

- read sandbox and network from the guardrail block (FOL-77) (#35) ([3103947](https://github.com/foldrun-io/foldrun-cli/commit/3103947))

## [2.6.0] — 2026-10-22

### Deprecated

Still here and still working; to be removed in a later major. Move off them now.

- the `--provider` flag

### New in the public API

- the `--authorize-param` flag

- feat(agent link): --isolated writes sandbox: own on the worker ([4dd7b39](https://github.com/foldrun-io/foldrun-cli/commit/4dd7b39))

### deps

- @foldrun/core ^2.8.0 (sandbox: own sub-agents) ([39bc630](https://github.com/foldrun-io/foldrun-cli/commit/39bc630))

### feat

- --authorize-param name=value on connect and secrets clients add; --provider deprecated ([fec978f](https://github.com/foldrun-io/foldrun-cli/commit/fec978f))

## [2.5.0] — 2026-10-22

### New in the public API

- `foldrun identity`
- the `--basic-user` flag
- the `--basic-password` flag
- the `--subject` flag
- the `--cert-file` flag
- the `--passphrase` flag
- the `--export` flag
- the `--audience` flag
- the `--no-pkce` flag
- the `--issuer` flag

- feat(identity): foldrun identity; secrets set --kind identity --audience ([f6a8255](https://github.com/foldrun-io/foldrun-cli/commit/f6a8255))
- feat(secrets): --kind client-cert (--cert-file, --key-file, --passphrase, --export) ([2633cfe](https://github.com/foldrun-io/foldrun-cli/commit/2633cfe))
- feat(secrets): --subject for service accounts; --basic-user/--basic-password for api secrets ([37d4860](https://github.com/foldrun-io/foldrun-cli/commit/37d4860))
- feat(connect): PKCE by default, public apps, --no-pkce and --issuer ([e250b12](https://github.com/foldrun-io/foldrun-cli/commit/e250b12))
- feat(connect): --client <saved> --scopes asks for this connection's own scopes ([acbd329](https://github.com/foldrun-io/foldrun-cli/commit/acbd329))

### deps

- @foldrun/core ^2.7.0 (public apps, Basic, client certificates, identities on this machine) ([a0e36bb](https://github.com/foldrun-io/foldrun-cli/commit/a0e36bb))

## [2.4.0] — 2026-10-21

### New in the public API

- `foldrun jobs`
- the `--last` flag
- the `--run` flag

- feat(cli): eval --to starts async and polls its own run; --run <id> and --last read verdicts ([151d654](https://github.com/foldrun-io/foldrun-cli/commit/151d654))
- fix(cli): init scaffolds in the directory it is given ([c74e3fd](https://github.com/foldrun-io/foldrun-cli/commit/c74e3fd))

### deps

- @foldrun/core ^2.6.0 (the four job blocks in foldrun check) ([b69c361](https://github.com/foldrun-io/foldrun-cli/commit/b69c361))

### docs

- sync checks, evals and flows from foldrun-docs 4717659 ([8ae181f](https://github.com/foldrun-io/foldrun-cli/commit/8ae181f))

### feat

- foldrun jobs; account/workspace set <job>.<field>; owner, alerts, judge ([36b9de7](https://github.com/foldrun-io/foldrun-cli/commit/36b9de7))

## [2.3.0] — 2026-10-21

### New in the public API

- `foldrun runs views`
- `foldrun runs doctor`
- `foldrun insights`
- `foldrun issues`
- `foldrun issues show`
- `foldrun issues doctor`
- the `--stale` flag
- the `--online` flag
- the `--should` flag
- the `--outcome` flag
- the `--tool-error` flag
- the `--min-tokens` flag
- the `--min-secs` flag
- the `--view` flag
- the `--compare` flag
- the `--tree` flag
- the `--calls` flag
- the `--for` flag
- the `--times` flag
- the `--reason` flag
- the `--stop` flag

- feat(cli): account telemetry — set, clear, test ([25359f6](https://github.com/foldrun-io/foldrun-cli/commit/25359f6))
- feat(cli): agent ls shows the last run; --stale [days] ([8274df8](https://github.com/foldrun-io/foldrun-cli/commit/8274df8))
- feat(cli): account and workspace pause / resume, with --reason and --stop ([6785a92](https://github.com/foldrun-io/foldrun-cli/commit/6785a92))
- feat(cli): set network_enforce on|off for the account and a workspace ([d28bd27](https://github.com/foldrun-io/foldrun-cli/commit/d28bd27))
- feat(cli): agent ls shows each agent's owner ([a07d208](https://github.com/foldrun-io/foldrun-cli/commit/a07d208))
- ci(dependabot): say that the bot key must be a Dependabot secret too ([e9e81e7](https://github.com/foldrun-io/foldrun-cli/commit/e9e81e7))
- build(deps): bump actions/create-github-app-token (#33) ([327a4f6](https://github.com/foldrun-io/foldrun-cli/commit/327a4f6))
- feat(cli): foldrun issues doctor <id> — the run doctor on an issue's newest run ([fc1fdeb](https://github.com/foldrun-io/foldrun-cli/commit/fc1fdeb))
- fix(cli): check reports an agent whose frontmatter does not parse; parse without gray-matter's cache ([58d7547](https://github.com/foldrun-io/foldrun-cli/commit/58d7547))
- docs(cli): tools: [peers] in the managed AGENTS.md block and synced docs ([aa54b11](https://github.com/foldrun-io/foldrun-cli/commit/aa54b11))
- feat(cli): foldrun report says why a step's prompt cache missed ([45a6886](https://github.com/foldrun-io/foldrun-cli/commit/45a6886))
- fix(cli): saved views apply every filter as the dashboard does (Codex review of FOL-72) ([fc16640](https://github.com/foldrun-io/foldrun-cli/commit/fc16640))
- feat(cli): promote --should (FOL-72 step 10) ([b33c162](https://github.com/foldrun-io/foldrun-cli/commit/b33c162))
- feat(cli): runs --tool/--tool-error/--agent/--model/--min-tokens/--min-secs/--view; runs views (FOL-72 step 9) ([b149458](https://github.com/foldrun-io/foldrun-cli/commit/b149458))
- feat(cli): foldrun insights (FOL-72 step 8) ([07f0cbf](https://github.com/foldrun-io/foldrun-cli/commit/07f0cbf))
- feat(cli): issues snooze --times; regressed and missed shown (FOL-72 step 7) ([d4f3901](https://github.com/foldrun-io/foldrun-cli/commit/d4f3901))
- feat(cli): report --compare; rerun --instruction (FOL-72 step 6) ([3640c0d](https://github.com/foldrun-io/foldrun-cli/commit/3640c0d))
- feat(cli): foldrun report --tree (FOL-72 step 5) ([33da831](https://github.com/foldrun-io/foldrun-cli/commit/33da831))
- feat(cli): report --calls and report <run> call <id> (FOL-54 step 4) ([ddec975](https://github.com/foldrun-io/foldrun-cli/commit/ddec975))
- feat(cli): foldrun issues [show|ack|snooze|resolve|reopen] (FOL-54 step 3) ([537b994](https://github.com/foldrun-io/foldrun-cli/commit/537b994))
- feat(cli): runs shows credits charged (FOL-54) ([5b7d717](https://github.com/foldrun-io/foldrun-cli/commit/5b7d717))
- feat(cli): foldrun runs --outcome (FOL-54) ([df63a82](https://github.com/foldrun-io/foldrun-cli/commit/df63a82))
- feat(cli): foldrun check --to <ws> --online (FOL-58) ([002f82e](https://github.com/foldrun-io/foldrun-cli/commit/002f82e))
- feat(cli): foldrun account set deploy_block none|secrets|security (FOL-58) ([a74de7b](https://github.com/foldrun-io/foldrun-cli/commit/a74de7b))
- feat(cli): history restore says when the version fails today's checks (FOL-57) ([40ea73e](https://github.com/foldrun-io/foldrun-cli/commit/40ea73e))
- feat(cli): foldrun runs doctor <run-id> — the run doctor from a terminal (FOL-22) ([35ae8d0](https://github.com/foldrun-io/foldrun-cli/commit/35ae8d0))

### ci

- run directly in the CI VM as its runner user, not in a root container (FOL-62) (#34) ([daa7c65](https://github.com/foldrun-io/foldrun-cli/commit/daa7c65))
- run tests on the self-hosted ci runner (FOL-62) (#31) ([483c24c](https://github.com/foldrun-io/foldrun-cli/commit/483c24c))

### deps

- @foldrun/core ^2.5.0 — owner:, network_enforce, pause, stale/behaviour alerts, limits: repeat, telemetry ([a473820](https://github.com/foldrun-io/foldrun-cli/commit/a473820))

### docs

- sync checks.md (config/invalid-frontmatter) ([de2ee36](https://github.com/foldrun-io/foldrun-cli/commit/de2ee36))
- sync — limits: repeat and the behaviour alerts ([221a07d](https://github.com/foldrun-io/foldrun-cli/commit/221a07d))
- sync checks.md (what the platform's checks leave unread) ([de6674a](https://github.com/foldrun-io/foldrun-cli/commit/de6674a))
- sync the prompt-caching page ([6d1b33e](https://github.com/foldrun-io/foldrun-cli/commit/6d1b33e))
- sync (alerts:) ([b59cdc2](https://github.com/foldrun-io/foldrun-cli/commit/b59cdc2))
- sync (FOL-64, FOL-66) ([f7b0c02](https://github.com/foldrun-io/foldrun-cli/commit/f7b0c02))
- clearer team refusal text, team changes are browser-only (FOL-64) (#32) ([a5d2aef](https://github.com/foldrun-io/foldrun-cli/commit/a5d2aef))
- sync — model-named secrets (FOL-19) ([95a05a6](https://github.com/foldrun-io/foldrun-cli/commit/95a05a6))

## [2.2.0] — 2026-10-18

- feat(cli): report says each step's turns; observe shows turns and result sizes ([ee6069f](https://github.com/foldrun-io/foldrun-cli/commit/ee6069f))

### deps

- @foldrun/core ^2.3.0 ([b6a6833](https://github.com/foldrun-io/foldrun-cli/commit/b6a6833))

### docs

- sync — judge and draft through the translator (FOL-16) ([fa37d89](https://github.com/foldrun-io/foldrun-cli/commit/fa37d89))
- sync — model key onboarding step (FOL-15) ([7992f39](https://github.com/foldrun-io/foldrun-cli/commit/7992f39))
- sync — long results only spilled for agents that can read them ([e170c43](https://github.com/foldrun-io/foldrun-cli/commit/e170c43))
- sync — long tool results kept and previewed ([b44f8e1](https://github.com/foldrun-io/foldrun-cli/commit/b44f8e1))

## [2.1.0] — 2026-10-17

- feat(cli): report, usage and observe print the prompt-cache share ([673b1be](https://github.com/foldrun-io/foldrun-cli/commit/673b1be))
- fix(cli): a refused API version stops every command with what to install (FOL-41) ([9eac6dd](https://github.com/foldrun-io/foldrun-cli/commit/9eac6dd))

### deps

- @foldrun/core ^2.2.0 ([53d1736](https://github.com/foldrun-io/foldrun-cli/commit/53d1736))

### docs

- sync — fetch's per-page cap (FOL-28) ([26dab3b](https://github.com/foldrun-io/foldrun-cli/commit/26dab3b))

## [2.0.0] — 2026-10-17

### Breaking changes

- foldrun repo and keys create --for/--access are removed. (17cfc23)
- `foldrun repo ls` is gone (it was never deprecated)
- the `--for` flag is gone (it was never deprecated)
- the `--access` flag is gone (it was never deprecated)

- feat(cli)!: foldrun repo and keys create --for go with the platform's own git ([17cfc23](https://github.com/foldrun-io/foldrun-cli/commit/17cfc23))
- feat(restore): revisions by their full id; repo is deprecated ([32cb104](https://github.com/foldrun-io/foldrun-cli/commit/32cb104))
- feat(observe, report): start-up phases — a table per phase in observe --to, a start-up label per step (FOL-29) ([0d5feb6](https://github.com/foldrun-io/foldrun-cli/commit/0d5feb6))

### deps

- @foldrun/core ^2.0.0 ([2617f2f](https://github.com/foldrun-io/foldrun-cli/commit/2617f2f))

### docs

- sync — weighted turns between accounts ([119ab5c](https://github.com/foldrun-io/foldrun-cli/commit/119ab5c))
- sync — fair share, room to start, schedule spread ([5d4ca61](https://github.com/foldrun-io/foldrun-cli/commit/5d4ca61))
- sync — an account's own concurrency lowers its share, never raises it ([a72aa44](https://github.com/foldrun-io/foldrun-cli/commit/a72aa44))

### fix

- strip markdown from published links (FOL-45) (#29) ([1bccc49](https://github.com/foldrun-io/foldrun-cli/commit/1bccc49))

## [1.3.0] — 2026-10-17

- feat(check): frontmatter values from core's schema; a skill's missing description said once ([d2ff4ca](https://github.com/foldrun-io/foldrun-cli/commit/d2ff4ca))

### deps

- @foldrun/core ^1.4.0 — frontmatter values validated from core's schema ([4a83451](https://github.com/foldrun-io/foldrun-cli/commit/4a83451))

## [1.2.0] — 2026-10-17

### New in the public API

- the `--security` flag
- the `--rules` flag
- the `--fail-on` flag
- the `--rule` flag
- the `--changed` flag
- the `--base` flag
- the `--write-baseline` flag
- the `--no-baseline` flag

- fix(check): library findings at the account root, single-file subagents at their own path, -z for --changed ([4b4b43e](https://github.com/foldrun-io/foldrun-cli/commit/4b4b43e))
- feat(check): the security scanner, rule ids, --security, JSON/SARIF, ignores, baseline, --changed ([9d4f70f](https://github.com/foldrun-io/foldrun-cli/commit/9d4f70f))

### chore

- proprietary licence; repository private ([7da93e2](https://github.com/foldrun-io/foldrun-cli/commit/7da93e2))

### ci

- read foldrun-core with the App token (#25) ([6153d42](https://github.com/foldrun-io/foldrun-cli/commit/6153d42))

### deps

- @foldrun/core ^1.3.0, which the security scanner needs (#26) ([329c31e](https://github.com/foldrun-io/foldrun-cli/commit/329c31e))
- @foldrun/core ^1.3.0 — the scanner, with Codex's review fixes ([13a0488](https://github.com/foldrun-io/foldrun-cli/commit/13a0488))

### licence

- proprietary from this release; LICENSE clarified, lockfile matches (#24) ([1b05493](https://github.com/foldrun-io/foldrun-cli/commit/1b05493))

## [1.1.2] — 2026-10-16

### docs

- sync assistant page (network line) ([6dee78b](https://github.com/foldrun-io/foldrun-cli/commit/6dee78b))

## [1.1.1] — 2026-10-16

- build(deps-dev): bump typescript from 5.9.3 to 6.0.3 (#20) ([4530d06](https://github.com/foldrun-io/foldrun-cli/commit/4530d06))
- build(deps): bump actions/setup-node (#19) ([1f880a0](https://github.com/foldrun-io/foldrun-cli/commit/1f880a0))
- build(deps-dev): bump @types/node (#18) ([521487a](https://github.com/foldrun-io/foldrun-cli/commit/521487a))

### ci

- release — Dependabot's build(deps) commits are a patch, not a feature ([020b345](https://github.com/foldrun-io/foldrun-cli/commit/020b345))

## [1.1.0] — 2026-10-16

### New in the public API

- `foldrun agent network`
- `foldrun assistant`
- `foldrun assistant history`
- `foldrun secrets sites`
- the `--add` flag
- the `--remove` flag
- the `--conversation` flag
- the `--q` flag
- the `--site` flag
- the `--clear` flag

- agent network, secrets sites and --site — the sites a sandbox may reach, from the terminal ([b27740c](https://github.com/foldrun-io/foldrun-cli/commit/b27740c))

### ci

- npm ci, not npm install, in CI and the release ([d61cef3](https://github.com/foldrun-io/foldrun-cli/commit/d61cef3))

### deps

- @foldrun/core ^1.1.0 — the CLI's agent network uses @foldrun/core/network, new in 1.1.0 ([1196b3f](https://github.com/foldrun-io/foldrun-cli/commit/1196b3f))

### docs

- sync assistant ([163662a](https://github.com/foldrun-io/foldrun-cli/commit/163662a))
- sync tools (script tool arguments) ([2af12ce](https://github.com/foldrun-io/foldrun-cli/commit/2af12ce))
- sync the assistant's limits ([d9906db](https://github.com/foldrun-io/foldrun-cli/commit/d9906db))
- sync flows (on-fail) ([fb54668](https://github.com/foldrun-io/foldrun-cli/commit/fb54668))

### feat

- foldrun assistant history / show / rm, and --conversation to carry one on ([9399d48](https://github.com/foldrun-io/foldrun-cli/commit/9399d48))
- foldrun assistant creates a proposed workspace and shows tokens and the charge ([caa5464](https://github.com/foldrun-io/foldrun-cli/commit/caa5464))
- foldrun assistant (also foldrun ai) — the dashboard's assistant from a terminal ([34efe26](https://github.com/foldrun-io/foldrun-cli/commit/34efe26))

### fix assistant

- typecheck — the proposed workspace is passed in, not read from a variable ask() sets ([a0ec141](https://github.com/foldrun-io/foldrun-cli/commit/a0ec141))

## [1.0.0] — 2026-10-13

### New in the public API

- `foldrun hook ls`
- `foldrun hook add`
- `foldrun hook test`
- `foldrun hook rm`
- the `--runs` flag
- the `--on` flag
- the `--tool` flag
- the `--library` flag

### cli

- hook ls --to lists a deployed workspace's hooks; sync-docs runs only as a program ([118d714](https://github.com/foldrun-io/foldrun-cli/commit/118d714))
- foldrun api version shows your last 30 days and any deprecated route you still call ([495104b](https://github.com/foldrun-io/foldrun-cli/commit/495104b))
- nothing a platform sends can write escape sequences to your terminal ([4ec3c3e](https://github.com/foldrun-io/foldrun-cli/commit/4ec3c3e))
- platform text printed without escape sequences; the update notice needs a bare version ([059a30e](https://github.com/foldrun-io/foldrun-cli/commit/059a30e))
- foldrun changelog leads with the API — version, breaks, deprecations ([b5538c3](https://github.com/foldrun-io/foldrun-cli/commit/b5538c3))
- foldrun library ls|put|rm take hooks ([32d6006](https://github.com/foldrun-io/foldrun-cli/commit/32d6006))
- foldrun hook ls | add | test | rm, and hooks in foldrun check ([61a5f51](https://github.com/foldrun-io/foldrun-cli/commit/61a5f51))

### deps

- @foldrun/core ^1.0.0 ([b5fcb9d](https://github.com/foldrun-io/foldrun-cli/commit/b5fcb9d))

### docs

- sync state + state_key cookie seeding from foldrun-docs ([4e952b9](https://github.com/foldrun-io/foldrun-cli/commit/4e952b9))
- sync backups-and-restore from foldrun-docs (no nightly snapshot) ([ed0d32c](https://github.com/foldrun-io/foldrun-cli/commit/ed0d32c))

### release

- a CLI deprecation is a marker on its help line, not the word in a sentence ([a5ddbae](https://github.com/foldrun-io/foldrun-cli/commit/a5ddbae))
- same release.mjs as core — the first declared API lists no additions ([aa261fc](https://github.com/foldrun-io/foldrun-cli/commit/aa261fc))
- full SemVer 2.0.0 — the help is the public API, breaks found from it ([42b8d64](https://github.com/foldrun-io/foldrun-cli/commit/42b8d64))

## [0.9.0] — 2026-10-11

- build(deps-dev): bump @types/node from 22.20.2 to 26.6.4 (#15) ([891f4ed](https://github.com/foldrun-io/foldrun-cli/commit/891f4ed))
- flow hook prints a flow's webhook URL without rotating it; runtimes list apt: packages ([8138a74](https://github.com/foldrun-io/foldrun-cli/commit/8138a74))
- foldrun workspaces --json ([5948ccd](https://github.com/foldrun-io/foldrun-cli/commit/5948ccd))
- foldrun export / foldrun import — a workspace, flow or agent as a .zip (FOL-23) ([93d7029](https://github.com/foldrun-io/foldrun-cli/commit/93d7029))

### check

- error on an agent.md whose frontmatter has no opening --- ([be1ee5c](https://github.com/foldrun-io/foldrun-cli/commit/be1ee5c))

### cli

- a verb for every API route — workspaces show/new --platform, agent ls/new --platform/import --list, flow ls/new --platform, eval new, tool new --platform, source new, library new + memory kind, backups requests, status --history, team (read), stop/rerun --until, billing credit, approve --payload for wait: event; observe/triggers send days; docs synced ([47bfd73](https://github.com/foldrun-io/foldrun-cli/commit/47bfd73))
- foldrun new makes a blank workspace (--starter for the example); foldrun agent import <ws>/<agent> ([7cc3967](https://github.com/foldrun-io/foldrun-cli/commit/7cc3967))

### deps

- @modelcontextprotocol/sdk 1.32.1 (and sharp 0.35.5 in web) for new advisories ([b65b930](https://github.com/foldrun-io/foldrun-cli/commit/b65b930))

### docs

- sync tool.md body note from foldrun-docs ([a0b59f2](https://github.com/foldrun-io/foldrun-cli/commit/a0b59f2))
- sync judge: wording from foldrun-docs ([cc54349](https://github.com/foldrun-io/foldrun-cli/commit/cc54349))
- sync FOLDRUN_API_URL from foldrun-docs ([fbd8415](https://github.com/foldrun-io/foldrun-cli/commit/fbd8415))
- sync (automatic retries, web brings Read) ([b720ebe](https://github.com/foldrun-io/foldrun-cli/commit/b720ebe))
- sync (export carries a tool's run script) ([c6ca6ae](https://github.com/foldrun-io/foldrun-cli/commit/c6ca6ae))
- synced (flows: rescuer owes verify) ([b238575](https://github.com/foldrun-io/foldrun-cli/commit/b238575))
- synced (workspaces: engine files) ([2366869](https://github.com/foldrun-io/foldrun-cli/commit/2366869))
- sync flows.md (plain approval of an ask: gate) ([f3103d3](https://github.com/foldrun-io/foldrun-cli/commit/f3103d3))

### Docs sync

- the install tool ([d38a686](https://github.com/foldrun-io/foldrun-cli/commit/d38a686))
- system package snapshots ([29ed322](https://github.com/foldrun-io/foldrun-cli/commit/29ed322))

### flags

- foldrun flags — the account's feature flags, on or off and why (--json); docs synced ([cbf8a07](https://github.com/foldrun-io/foldrun-cli/commit/cbf8a07))

### foldrun account model

- show, set <provider> --key, remove ([b98da6e](https://github.com/foldrun-io/foldrun-cli/commit/b98da6e))

### foldrun import

- list what the zip held that is not imported ([3bd1835](https://github.com/foldrun-io/foldrun-cli/commit/3bd1835))

## [0.8.0] — 2026-10-03

- --help shows each verb exactly its options — `api --help` listed secrets' --kind (its text has "api (… Name: value"), `restore --help` listed nothing ([2c0a447](https://github.com/foldrun-io/foldrun-cli/commit/2c0a447))
- flow <unknown verb> names set, trigger, move-step, copy-step, paste and draft — the dispatcher had them since b87c9b5, the error's list did not ([bed1887](https://github.com/foldrun-io/foldrun-cli/commit/bed1887))
- flow draft on a pipe without --yes exits 1 — it printed "nothing saved" and returned 0 after a paid model call, so a script read an unsaved draft as done ([2cfc76f](https://github.com/foldrun-io/foldrun-cli/commit/2cfc76f))
- flow set to a value the step already has is "nothing to change" — core re-emits the managed lines at the top of the step, so the old next === raw test never fired and the reorder was written (a platform revision for no change) ([a3122ab](https://github.com/foldrun-io/foldrun-cli/commit/a3122ab))
- flow set refuses effort, timeout, retry, loop and max values core's rewriter would drop or clamp — timeout=15m deleted `timeout: 900` and exited 0, retry=abc wrote 0 ([8c55222](https://github.com/foldrun-io/foldrun-cli/commit/8c55222))

### credentials

- a Claude login token (CLAUDE_CODE_OAUTH_TOKEN, from claude setup-token) is accepted beside an API key; doctor says which a local run uses ([2c03143](https://github.com/foldrun-io/foldrun-cli/commit/2c03143))

### deps

- @foldrun/core ^0.6.0 — model credentials, docker script fixes, workspace/ prompts ([d9cc3cd](https://github.com/foldrun-io/foldrun-cli/commit/d9cc3cd))

### docs

- sync — a test run's later steps see its earlier steps' writes ([24bb26a](https://github.com/foldrun-io/foldrun-cli/commit/24bb26a))
- sync — local runs load no claude.ai connectors or on-disk MCP config ([8d3db4e](https://github.com/foldrun-io/foldrun-cli/commit/8d3db4e))

### e2e

- reads the account layout init makes, and skips without an API key instead of failing ([e3734ac](https://github.com/foldrun-io/foldrun-cli/commit/e3734ac))

### release automation

- every push to main keeps a "release X.Y.Z" pull request open; merging it publishes and tags ([9c12bb0](https://github.com/foldrun-io/foldrun-cli/commit/9c12bb0))

### release-pr

- approve the release pull request's own ci run — it waits for approval, and the required checks are its jobs ([f174f9a](https://github.com/foldrun-io/foldrun-cli/commit/f174f9a))

## [0.7.2] — 2026-10-02

The first 0.7 on npm. 0.7.0 and 0.7.1 were tagged but their release jobs
failed before publishing (a test that read the sibling core checkout, then
prepack's docs check with no docs checkout). The changes are listed under
0.7.0 below.

- sync-docs --check passes with no ../foldrun-docs when docs/ has pages — the release job has no docs checkout (private), and its prepack failed v0.7.1 unpublished ([c29e505](https://github.com/foldrun-io/foldrun-cli/commit/c29e505))

## [0.7.1] — 2026-10-02

0.7.0 was tagged but never reached npm: its release job failed on a test that
read the sibling core checkout. 0.7.1 is 0.7.0 with that test fixed; the
changes are listed under 0.7.0 below.

### report test

- core's wording through @foldrun/core, not the sibling checkout — the release job has no sibling, and v0.7.0 failed there unpublished ([f8ac942](https://github.com/foldrun-io/foldrun-cli/commit/f8ac942))

## [0.7.0] — 2026-10-02

- workspace/storage/ is the spelling the agent rules and the docs teach; check notes ../../ as info ([6e82932](https://github.com/foldrun-io/foldrun-cli/commit/6e82932))
- agent link / unlink in this folder: refuse a file that changed since it was read ([db8754e](https://github.com/foldrun-io/foldrun-cli/commit/db8754e))
- flow add / rm-step / dup-step in this folder: refuse a file that changed since it was read ([3821a2f](https://github.com/foldrun-io/foldrun-cli/commit/3821a2f))
- flow add / rm-step / dup-step --to: send expect, so a stale step number is refused ([b1d87a1](https://github.com/foldrun-io/foldrun-cli/commit/b1d87a1))
- foldrun audit; keys create --expires, keys rotate --grace, keys ls shows last use and expiry; docs synced ([6fbe1e5](https://github.com/foldrun-io/foldrun-cli/commit/6fbe1e5))
- foldrun webhooks deliveries|redeliver, foldrun notifications [set <category> on|off]; docs synced ([1383771](https://github.com/foldrun-io/foldrun-cli/commit/1383771))
- foldrun restore <ws> --to <commit|time|age> [--dry-run], foldrun backups [request], foldrun onboarding; docs synced ([07f5e42](https://github.com/foldrun-io/foldrun-cli/commit/07f5e42))
- invoke --inputs <set>: start a flow with a saved input set ([a46af98](https://github.com/foldrun-io/foldrun-cli/commit/a46af98))
- deploy sends the confirmed removals; workspaces rm takes only a real workspace ([82cf668](https://github.com/foldrun-io/foldrun-cli/commit/82cf668))
- foldrun answer / foldrun message; approvals lists questions agents are asking ([cc75007](https://github.com/foldrun-io/foldrun-cli/commit/cc75007))
- --help never runs a command; deploy names where it goes and asks before deleting ([d4cc7a0](https://github.com/foldrun-io/foldrun-cli/commit/d4cc7a0))
- login <site> never sends the platform key to the site; concurrency must be a number ([18ed05f](https://github.com/foldrun-io/foldrun-cli/commit/18ed05f))
- check reports agent schedule:; deploy prints warnings; docs synced ([3edf52d](https://github.com/foldrun-io/foldrun-cli/commit/3edf52d))
- coding-agent rules as Next.js writes them: a block in AGENTS.md, CLAUDE.md importing it, and the docs shipped in the package ([44922e5](https://github.com/foldrun-io/foldrun-cli/commit/44922e5))
- rerun, storage put/rm, keys create --workspaces, invoke --once: the developer-account verbs the API had and the terminal did not ([a73b8f7](https://github.com/foldrun-io/foldrun-cli/commit/a73b8f7))
- storage share/shares/unshare, account providers, triggers: the account's records a developer could only reach from the dashboard ([2fdfbe7](https://github.com/foldrun-io/foldrun-cli/commit/2fdfbe7))
- foldrun login <site>: find Playwright where laptops actually keep it ([ed6cad8](https://github.com/foldrun-io/foldrun-cli/commit/ed6cad8))
- foldrun login <site>: a browser window to sign in by hand, the session stored ([a834518](https://github.com/foldrun-io/foldrun-cli/commit/a834518))
- one line per tool call in the run stream: the completion carries the duration, an unfinished call flushes its start ([d84e305](https://github.com/foldrun-io/foldrun-cli/commit/d84e305))
- tool test, agent run, and check against what is deployed ([927d609](https://github.com/foldrun-io/foldrun-cli/commit/927d609))
- foldrun agent new, flow new, tool new: scaffolding inside a workspace ([e2ffc11](https://github.com/foldrun-io/foldrun-cli/commit/e2ffc11))
- See what is waiting for a person, decide it, and read a run whole ([16ac482](https://github.com/foldrun-io/foldrun-cli/commit/16ac482))
- check refuses a timezone the deploy would refuse ([6f7b4f9](https://github.com/foldrun-io/foldrun-cli/commit/6f7b4f9))
- --workspace names a workspace inside an account, and run and eval say which is missing ([df11a69](https://github.com/foldrun-io/foldrun-cli/commit/df11a69))

### An account folder

- init makes the shape the platform keeps, and every command reads it ([13f1959](https://github.com/foldrun-io/foldrun-cli/commit/13f1959))

### answer

- a bare --option is a usage error, not option 1 ([b41174c](https://github.com/foldrun-io/foldrun-cli/commit/b41174c))

### backups

- foldrun backups says whether each snapshot is encrypted ([23be08c](https://github.com/foldrun-io/foldrun-cli/commit/23be08c))

### check

- a pinned user_agent on engine chromium is compared with the platform's Chromium ([a1d877f](https://github.com/foldrun-io/foldrun-cli/commit/a1d877f))
- warn on a pinned user_agent behind the platform's Chrome and on web.browse.session:; version prints browser versions; docs synced ([72d4fdc](https://github.com/foldrun-io/foldrun-cli/commit/72d4fdc))
- limits: — an unknown key or unreadable count is an error, a tool not granted a warning; docs synced ([1b1c073](https://github.com/foldrun-io/foldrun-cli/commit/1b1c073))
- a tool's listed secrets are granted with it — drop the 'does not declare' error ([bc98caa](https://github.com/foldrun-io/foldrun-cli/commit/bc98caa))
- an agent granting a tool must declare the secrets its file lists ([2f0d654](https://github.com/foldrun-io/foldrun-cli/commit/2f0d654))
- subagents: names that are nothing, no description, no tools left ([3225583](https://github.com/foldrun-io/foldrun-cli/commit/3225583))
- retired tool names use core's sentence; docs: files and bash retired ([9ac770a](https://github.com/foldrun-io/foldrun-cli/commit/9ac770a))
- retired web names are errors; the platform's web tools are never missing; docs: built-ins by category ([c33f8e6](https://github.com/foldrun-io/foldrun-cli/commit/c33f8e6))
- an unknown agent is reported once, by core; bundled docs synced ([acf45f1](https://github.com/foldrun-io/foldrun-cli/commit/acf45f1))
- work out which agents hold an outward tool, and tell the flow lint ([faf8f42](https://github.com/foldrun-io/foldrun-cli/commit/faf8f42))
- refuse region:, currency:, units: and calendar: values that cannot be read ([a3ec961](https://github.com/foldrun-io/foldrun-cli/commit/a3ec961))
- a language: that is not a tag is said here first ([b54543b](https://github.com/foldrun-io/foldrun-cli/commit/b54543b))
- report a web_search:, web_fetch: or web_browse: value that cannot work ([6a7102f](https://github.com/foldrun-io/foldrun-cli/commit/6a7102f))

### cli

- foldrun flow rm-step <flow> --step <n|agent> ([726b88d](https://github.com/foldrun-io/foldrun-cli/commit/726b88d))
- an old error does not block flow add; no colour escapes off a terminal ([f4f1675](https://github.com/foldrun-io/foldrun-cli/commit/f4f1675))
- everything the platform does — canvas patterns, and the missing routes ([1bf5d3a](https://github.com/foldrun-io/foldrun-cli/commit/1bf5d3a))
- web is the only web tool; drop web_search, web_fetch, web_browse ([10840d2](https://github.com/foldrun-io/foldrun-cli/commit/10840d2))
- deploy reports the environments it caused to be built; foldrun runtimes ([e74798c](https://github.com/foldrun-io/foldrun-cli/commit/e74798c))
- web in check and the browse block it prints; docs synced ([ba021f3](https://github.com/foldrun-io/foldrun-cli/commit/ba021f3))
- run links open the run's own page; docs: the run page and mission control ([162db4e](https://github.com/foldrun-io/foldrun-cli/commit/162db4e))
- gallery help names the three web tools; docs synced ([18d916c](https://github.com/foldrun-io/foldrun-cli/commit/18d916c))

### CLI

- Foldrun-Version on every call, an Idempotency-Key per write (reused on its retry), one wait on 429 then a clear message; foldrun api spec [--out] ([db59223](https://github.com/foldrun-io/foldrun-cli/commit/db59223))

### deps

- lock claude-agent-sdk 0.3.285 (via core) ([3f0aacd](https://github.com/foldrun-io/foldrun-cli/commit/3f0aacd))

### docs

- synced — a Node program started through workspace/ is its own main module ([e2bc005](https://github.com/foldrun-io/foldrun-cli/commit/e2bc005))
- sync tools.md — web search site= is a domain ([a4c54d2](https://github.com/foldrun-io/foldrun-cli/commit/a4c54d2))
- sync api-usage (rate-limit exemptions) ([70668bf](https://github.com/foldrun-io/foldrun-cli/commit/70668bf))
- sync — Appearance (light, dark or system) ([a379d8f](https://github.com/foldrun-io/foldrun-cli/commit/a379d8f))
- sync flows.md (the flow canvas) ([1668f31](https://github.com/foldrun-io/foldrun-cli/commit/1668f31))
- sync billing — details, tax invoices, portal, dunning ([b0af763](https://github.com/foldrun-io/foldrun-cli/commit/b0af763))
- sync billing — admin levers, accountant export, your data ([5032eb3](https://github.com/foldrun-io/foldrun-cli/commit/5032eb3))
- sync — billing's bookkeeping rules, the webhook's event list ([55428a5](https://github.com/foldrun-io/foldrun-cli/commit/55428a5))
- sync (cli/authorize decision) ([1ae493c](https://github.com/foldrun-io/foldrun-cli/commit/1ae493c))
- sync from foldrun-docs (api.md audit corrections + 7 pages behind) ([8efe55c](https://github.com/foldrun-io/foldrun-cli/commit/8efe55c))
- synced (pause_when) ([68bb177](https://github.com/foldrun-io/foldrun-cli/commit/68bb177))
- web actions and who does them ([52e2ca4](https://github.com/foldrun-io/foldrun-cli/commit/52e2ca4))
- sync — web_search settings block ([9c73d09](https://github.com/foldrun-io/foldrun-cli/commit/9c73d09))
- sync — web_browse live view, obscura, cdp ([c96f430](https://github.com/foldrun-io/foldrun-cli/commit/c96f430))
- sync — web_browse agent-browser parity ([e3030ad](https://github.com/foldrun-io/foldrun-cli/commit/e3030ad))
- sync — click/check keyboard fallback ([1bc14e5](https://github.com/foldrun-io/foldrun-cli/commit/1bc14e5))
- sync — web_browse live sessions ([b525f3d](https://github.com/foldrun-io/foldrun-cli/commit/b525f3d))
- sync — web_browse version: ([e693880](https://github.com/foldrun-io/foldrun-cli/commit/e693880))
- sync — engine: chrome is real Chrome ([9a11fc4](https://github.com/foldrun-io/foldrun-cli/commit/9a11fc4))
- sync — gallery is the three web tools ([9b22d5c](https://github.com/foldrun-io/foldrun-cli/commit/9b22d5c))
- headless: false now opens a window ([ed3482e](https://github.com/foldrun-io/foldrun-cli/commit/ed3482e))
- browser pod flags need run-server --unsafe; headless: accepted, not acted on yet ([f7a2093](https://github.com/foldrun-io/foldrun-cli/commit/f7a2093))
- a gate holds its group; check warns on a shared number or a gap ([d6adec0](https://github.com/foldrun-io/foldrun-cli/commit/d6adec0))
- when: rows of, FOLDRUN_REPLY_FILE, options under [[flow:x]] ([fea8588](https://github.com/foldrun-io/foldrun-cli/commit/fea8588))
- bundle the 10 MB body limit ([b4f723f](https://github.com/foldrun-io/foldrun-cli/commit/b4f723f))

### docs synced

- api ([03c240a](https://github.com/foldrun-io/foldrun-cli/commit/03c240a))
- flows (canvas run overlay and controls) ([5de3bee](https://github.com/foldrun-io/foldrun-cli/commit/5de3bee))
- tools ([2f48cbe](https://github.com/foldrun-io/foldrun-cli/commit/2f48cbe))
- runs ([f09ca7c](https://github.com/foldrun-io/foldrun-cli/commit/f09ca7c))
- the canvas verbs and the new platform verbs ([22d25c3](https://github.com/foldrun-io/foldrun-cli/commit/22d25c3))
- deploy keeps what runs wrote ([c9d508c](https://github.com/foldrun-io/foldrun-cli/commit/c9d508c))
- vendor browser sessions ([95b4f02](https://github.com/foldrun-io/foldrun-cli/commit/95b4f02))

### every CLI delete asks first

- storage rm, unshare, source rm, secrets rm, keys revoke, workspaces rm ([8a844bb](https://github.com/foldrun-io/foldrun-cli/commit/8a844bb))

### flow dup-step

- the canvas's Duplicate from a terminal ([f66152e](https://github.com/foldrun-io/foldrun-cli/commit/f66152e))

### foldrun account

- the account's defaults, read and set ([6809b30](https://github.com/foldrun-io/foldrun-cli/commit/6809b30))

### foldrun billing

- the balance, and what the money went on ([cd4a51f](https://github.com/foldrun-io/foldrun-cli/commit/cd4a51f))

### foldrun guide

- init writes CLAUDE.md, pull and guide keep it current, a person's notes are never touched ([5d30bd9](https://github.com/foldrun-io/foldrun-cli/commit/5d30bd9))

### foldrun schedule

- what fires on a clock, and when it fires next ([7c575cf](https://github.com/foldrun-io/foldrun-cli/commit/7c575cf))

### foldrun stop

- kill a run in flight ([7761e9a](https://github.com/foldrun-io/foldrun-cli/commit/7761e9a))

### foldrun storage

- what the agents produced, from the terminal ([2a9b330](https://github.com/foldrun-io/foldrun-cli/commit/2a9b330))

### gallery

- foldrun gallery, and local runs find the platform's tools ([62efc43](https://github.com/foldrun-io/foldrun-cli/commit/62efc43))

### git hooks

- pre-push checks the pushed commit in a worktree, not the working tree; a failed archive is not a clean scan ([58ee63d](https://github.com/foldrun-io/foldrun-cli/commit/58ee63d))
- run pre-push checks without git's GIT_DIR ([1f85b5e](https://github.com/foldrun-io/foldrun-cli/commit/1f85b5e))
- take the repo's own .gitleaks.toml when it has one ([de28833](https://github.com/foldrun-io/foldrun-cli/commit/de28833))
- secrets, typecheck and tests before the push, not in CI ([981594a](https://github.com/foldrun-io/foldrun-cli/commit/981594a))

### guide

- the managed AGENTS.md block names flow show/add/rm-step, agent link, and tool-granted secrets ([6ca4f28](https://github.com/foldrun-io/foldrun-cli/commit/6ca4f28))

### keys create/rotate

- a replayed answer has no secret — say so instead of printing null ([c9f2be4](https://github.com/foldrun-io/foldrun-cli/commit/c9f2be4))

### keys rotate

- an already-rotated key's refusal names the command for its replacement; keys ls shows rotated → <id> ([2c4f5ce](https://github.com/foldrun-io/foldrun-cli/commit/2c4f5ce))

### login --engine chrome

- sign in with real Google Chrome when installed ([13ea088](https://github.com/foldrun-io/foldrun-cli/commit/13ea088))

### message

- --step picks one of several running steps; docs synced ([9a93110](https://github.com/foldrun-io/foldrun-cli/commit/9a93110))

### parity with the dashboard

- flow set/trigger/move-step/copy-step/paste/draft, history restore, library, find, changelog, preferences, api version, billing plans/plan/top-up/card, secrets clients + set --kind, connect --client, schedule tick, workspaces demo, report live, workspace vocabulary, repo rm-branch/mirror/mirror-now ([b87c9b5](https://github.com/foldrun-io/foldrun-cli/commit/b87c9b5))

### probe

- say why the model's turn stopped ([70e2d94](https://github.com/foldrun-io/foldrun-cli/commit/70e2d94))

### pull

- a folder tool comes down with its program ([ba5cc33](https://github.com/foldrun-io/foldrun-cli/commit/ba5cc33))

### put

- type the upload-url answer, so the typecheck passes again ([6bbe84f](https://github.com/foldrun-io/foldrun-cli/commit/6bbe84f))

### report

- a lost browser pod never let a reconnect "through"; one that reached the pod and closed again says so; tries numbered #1, #2 ([0a397d8](https://github.com/foldrun-io/foldrun-cli/commit/0a397d8))
- when the browser pod was lost under a slim step, a "tries:" line — slim (lost), then full, each with its cost ([63d0475](https://github.com/foldrun-io/foldrun-cli/commit/63d0475))
- each step's runner image and what happened to the browser pod under a slim step ([901215a](https://github.com/foldrun-io/foldrun-cli/commit/901215a))

### runs

- a filtered list asks each workspace for everything, not its newest twenty ([2ee143c](https://github.com/foldrun-io/foldrun-cli/commit/2ee143c))

### runs/report

- show a completed run's verdict, ⛔ for BLOCKED; --verdict filter ([9bdbcd2](https://github.com/foldrun-io/foldrun-cli/commit/9bdbcd2))

### share and providers --check

- send the JSON body as a string, as every other remoteCall does; the unknown-verb test names all six verbs ([8249a75](https://github.com/foldrun-io/foldrun-cli/commit/8249a75))

### status

- type fetchPlatformStatus's answer (typecheck failed in CI); docs synced ([4ee6fb0](https://github.com/foldrun-io/foldrun-cli/commit/4ee6fb0))

### status --platform

- the platform's status, each component and any live incident or maintenance, from the open /api/status; plain status opens with the one-line verdict; docs synced (status, security, api, cli) ([bf1864c](https://github.com/foldrun-io/foldrun-cli/commit/bf1864c))

### storage put

- many files and whole folders, --into, presigned upload ([f32d53d](https://github.com/foldrun-io/foldrun-cli/commit/f32d53d))

### The CLI asks for core 0.5.0

- workspace/ spelling and the main-module preload ([546057c](https://github.com/foldrun-io/foldrun-cli/commit/546057c))

### version

- print the browsers the platform's runner image was built with; docs synced ([db30766](https://github.com/foldrun-io/foldrun-cli/commit/db30766))
- `foldrun version` (CLI, core, the platform's release and component shas; warns when the platform ships a newer CLI), `foldrun --version` offline, and a once-a-day notice in a terminal when X-Foldrun-Cli is newer; docs synced ([e943985](https://github.com/foldrun-io/foldrun-cli/commit/e943985))

### web_browse

- chrome and safari, the names people use ([75fd5ca](https://github.com/foldrun-io/foldrun-cli/commit/75fd5ca))

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
