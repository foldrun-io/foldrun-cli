# Feature flags

Some changes ship dark: the code is deployed, and whether an account gets
the new behaviour is a decision made afterwards, by the platform team, one
account or a share of accounts at a time. That decision is a feature flag.

An account cannot change its flags — with one exception, the
[beta](#beta-features). It can see them: **Settings → Feature flags** in the
dashboard, `foldrun flags` in a terminal, or `GET /api/account/flags`. Each
flag says whether it is on for this account and why.

## What decides a flag

The flags themselves are code — a name, what it changes, who owns it, a
default, and sometimes a rollout percentage. A name the code does not
register is not a flag; asking for one is a 404. What the platform's
operator sets on top is checked in this order, and the first that has an
answer wins:

| | source | |
|---|---|---|
| 1 | `account` | this account's own override — on or off whatever else says |
| 2 | `global` | the install-wide setting — on or off for every account without an override |
| 3 | `beta` | a flag marked beta, for an account [in the beta](#beta-features): on |
| 4 | `rollout` | a percentage of accounts. Each account falls in a fixed bucket from 0 to 99, a hash of the account and the flag's names, so the same account gets the same answer on every server and every day, and raising the percentage only adds accounts — nobody who had it loses it |
| 5 | `default` | what the code says when nothing else does |

A change is seen at once on the server that made it, and on every other
within ten seconds.

## Beta features

An account may take new features before they reach everyone: it joins the
**beta**. New work ships dark as a flag marked beta; it is on for every
account in the beta first, then for a rollout, then for everyone. The
features are finished, but may still change.

Joining or leaving is the account's own choice, made by an admin of every
workspace, and it can be undone at any time:

- the dashboard: **Settings → General → Beta features**;
- `foldrun account beta on` (or `off`; bare `foldrun account beta` shows where
  it stands and the beta flags);
- `PUT /api/account/beta` with `{ "beta": true }` (or `false`); `GET` answers
  `{ beta, flags }`.

Each change is on the account's audit log as `account.beta_joined` or
`account.beta_left`. The operator may also put an account in the beta or take
it out (the flag `beta-program`), and an override for the account or for
everyone still decides a beta flag first. `example-beta` is the registered
example: on for accounts in the beta, and read by nothing.

## The example

`example-flag` is registered, off by default, and read by nothing: turning
it on changes no behaviour. It is there to try the API and the CLI
against without risk.

```sh
foldrun flags              # every flag, on or off for this account, and why
foldrun flags --json
```

```json
{ "flags": [ { "name": "example-flag", "description": "The registered example. …",
               "owner": "platform", "default": false, "on": false,
               "source": "default", "rollout": null } ] }
```

## Running the platform yourself

On the hosted platform the operator changes flags from its own console:
the install-wide on/off and rollout, and an override per account. Every change is on the platform's audit as
`operator.flag.global`, `operator.flag.global_cleared`,
`operator.flag.account` or `operator.flag.account_cleared`, with who made
it and what it was before. The settings are rows in Postgres
(`feature_flags`), or `<data>/.feature-flags.json` without a database; an
account's overrides go when the account is deleted, and their audit stays.

A self-hosted install has no operator console, so nothing changes a flag
there: every flag runs at its registry default.

A flag is added by a line in `foldrun-platform/src/flags.ts` and asked with
`flagOn(account, "<name>")`. Retire it by deleting the line and the code
that asks, once it is on for everyone; a row left behind for a name the
code no longer registers is ignored.
