# Feature flags

Some changes ship dark: the code is deployed, and whether an account gets
the new behaviour is a decision made afterwards, by the platform team, one
account or a share of accounts at a time. That decision is a feature flag.

An account cannot change its flags. It can see them: **Settings → Feature
flags** in the dashboard, `foldrun flags` in a terminal, or
`GET /api/account/flags`. Each flag says whether it is on for this account
and why.

## What decides a flag

The flags themselves are code — a name, what it changes, who owns it, a
default, and sometimes a rollout percentage. A name the code does not
register is not a flag; asking for one is a 404. What the platform's super
admin sets on top is checked in this order, and the first that has an
answer wins:

| | source | |
|---|---|---|
| 1 | `account` | this account's own override — on or off whatever else says |
| 2 | `global` | the install-wide setting — on or off for every account without an override |
| 3 | `rollout` | a percentage of accounts. Each account falls in a fixed bucket from 0 to 99, a hash of the account and the flag's names, so the same account gets the same answer on every server and every day, and raising the percentage only adds accounts — nobody who had it loses it |
| 4 | `default` | what the code says when nothing else does |

A change is seen at once on the server that made it, and on every other
within ten seconds.

## The example

`example-flag` is registered, off by default, and read by nothing: turning
it on changes no behaviour. It is there to try the console, the API and the
CLI against without risk.

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

On a hosted install the super admin changes flags at **/admin → Flags**:
the install-wide on/off and rollout, and an override per account. The same
is `PUT`/`DELETE /api/admin/flags/<flag>` and
`/api/admin/flags/<flag>/accounts/<account>` (see the API reference's
super admin section). Every change is on the platform's audit as
`operator.flag.global`, `operator.flag.global_cleared`,
`operator.flag.account` or `operator.flag.account_cleared`, with who made
it and what it was before. The settings are rows in Postgres
(`feature_flags`), or `<data>/.feature-flags.json` without a database; an
account's overrides go when the account is deleted, and their audit stays.

A flag is added by a line in `foldrun-platform/src/flags.ts` and asked with
`flagOn(account, "<name>")`. Retire it by deleting the line and the code
that asks, once it is on for everyone; a row left behind for a name the
code no longer registers is ignored.
