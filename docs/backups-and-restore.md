# Backups and restore

Two different things get called "a backup" here, and they bring back
different things:

| | What it brings back | Who does it | How far back |
|---|---|---|---|
| **A workspace's history** | its agents, flows, knowledge, skills, tools, scripts — the markdown | you, from Settings → Backups, `foldrun restore` or the API | every change it ever had |
| **A database dump before a migration** | the database: people, API keys, the ledger and every balance, the queue, the audit log | the platform team, when you ask | the last 10 deploys that changed the schema |

You do not need to switch either on.

## There is no nightly snapshot

The hosted platform today is a development server, and since 11 October 2026
it takes **no nightly backup**. Run records, `state/`, storage's index and
the vault are on its data volume and are not copied anywhere on a schedule.
The last full archive is from 7 October 2026 (`foldrun-data-20261007-0330`,
in Cloudflare R2), encrypted with [age](https://age-encryption.org) to a key
the server does not hold.

What remains is the **database dump taken before every deploy that runs a
new migration**. It is checked with `pg_restore --list` before it is kept,
encrypted to the same off-server key (the server can write it and cannot
read it), and the deploy refuses to go ahead without it, because a migration
has no way back. The newest 10 are kept on the server and a copy goes to R2.
It holds the database only, not the data volume.

### What it does not hold

- Workspace files, run records, `state/`, `memory/`, the vault and each
  workspace's history: the data volume is not backed up. A workspace's
  source can still be restored from its own history (below).
- **Storage file bytes.** These live in object storage (R2), not on the data
  volume. *Unverified:* whether a storage file deleted by mistake can still
  be recovered from object storage. Ask, and say when it was deleted.
- Anything that only existed inside a sandbox while a step ran.
- What model providers and connected services hold on their side.

A self-hosted install backs up however its operator set it up; this page
describes the hosted platform. `foldrun-infra/dev/ci/premigrate-backup.sh`
is the pre-migration dump, if you want the same for yours: it needs `age` and
`FOLDRUN_BACKUP_RECIPIENT` (your age public key) and will not run without them.

## Seeing your snapshots

Settings → **Backups** and `foldrun backups` list the archives recorded for
your account. With the nightly job gone, nothing new is added to that list:
it ends at the last nightly run, on 7 October 2026.

```sh
foldrun backups                          # the same, in the terminal
```

```http
GET /api/account/backups
```

An account sees only the archives it is in, and its own name as the only
entry in `accounts`. Each record says `encrypted` and names the key it was
encrypted to by fingerprint (`recipient`, `sha256:` and 16 hex digits of the
public key).

## Restoring a workspace yourself

Every change to a workspace — a dashboard save, a deploy, an import — is a
revision, and every revision keeps a snapshot of the whole source as it
stood right after it. Restoring puts the workspace's source back as it was
at one of them — the platform's own deploy history, so it works the same
whether or not you keep the source in git:

```sh
foldrun restore sales --to 2026-09-28T14:00 --dry-run   # what would change, with the diff
foldrun restore sales --to 2026-09-28T14:00             # asks you to type the name, then does it
```

`--to` takes a revision id (`r-…`, from the History page or `foldrun
history`), the commit a deploy named, a date or time (the last revision at
or before it — a time without a zone is read in the server's timezone, so
add `Z` or an offset to be exact), or an age: `90m`, `12h`, `3d`, `2w`.
A revision's diff is that one change; its snapshot is the whole source as
it stood on disk just after it, so two people saving at once each see the
other's change in their snapshot. History holds snapshots from 17 October 2026: each workspace's starts with
a "history starts here" revision, its source as it stood then, and nothing
before it can be restored this way.

- **Preview first.** The dry run lists every file that would change, come
  back, or go, with a line diff. Nothing is written.
- **Confirm by name.** The restore itself needs the workspace's name typed
  back (`confirm` in the API). The CLI sends the removals you were shown, and
  if anything else would now be removed — a file added in between — the
  restore is refused and you are asked to look again.
- **It is undoable.** A restore is a new revision whose files are the old
  ones; history says "restored to r-…". To undo it, restore to the revision
  it answered as `from`.
- **It touches only the source.** Runs, `state/`, storage, secrets and the
  memory agents wrote are what a deploy keeps, and a restore is a deploy:
  they are left as they are.
- **It waits for runs.** While a run is in flight the restore is refused, as
  a deploy is — the run would otherwise finish on agents its first step never
  saw.
- It needs the editor role or above, and is written to the audit log as
  `workspace.restored`.

```http
POST /api/workspaces/<ws>/restore
{ "to": "3d", "dryRun": true }
{ "to": "<to.id from the dry run>", "confirm": "<ws>", "expectRemoved": [ … ] }
```

The workspace's History page lists every revision; open one and **Roll back
to this** does the same restore, by revision instead of by time, with its
preview first.

## Asking for a restore from a snapshot

Run records, `state/`, storage and the account's records (people, keys,
balances) come back only from an archive: the database from a pre-migration
dump, the rest only from the last full archive (7 October 2026). That restore
replaces a volume and a database every account shares, and the key that opens the
sealed half of the archive is deliberately not on the server, so it is done
by the platform team rather than by a button.

Settings → Backups → **Request a restore**: what (run records, `state/`,
storage, or everything), which workspace (or all), the time you want back,
optionally the snapshot, and a note. The request is recorded, mailed to the
platform team and written to the audit log (`backup.restore_requested`); the
page lists your earlier requests. Asking needs the admin role and access to
every workspace.

```sh
foldrun backups request --what runs --at "2026-09-28 14:00" --to sales --note "a run record was deleted"
```

```http
POST /api/account/backups/requests
{ "what": "runs", "workspace": "sales", "target": "2026-09-28 14:00", "note": "…" }
```

Nothing is restored automatically. The team restores the archive somewhere
else first and copies back only your account's paths, so a restore for you
does not roll back anyone else.

## On AWS

The AWS production design (`foldrun-infra/prod`) backs up differently —
database point-in-time recovery, nightly EFS snapshots kept 35 days, both
copied to a second region. It has not been built yet; this page will change
when it is.
