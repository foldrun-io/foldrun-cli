# Backups and restore

Two different things get called "a backup" here, and they bring back
different things:

| | What it brings back | Who does it | How far back |
|---|---|---|---|
| **A workspace's history** | its agents, flows, knowledge, skills, tools, scripts — the markdown | you, from Settings → Backups, `foldrun restore` or the API | every change it ever had |
| **The nightly snapshot** | everything else: runs, `state/`, storage's index, secrets, people, keys, the ledger, the audit log | the platform team, when you ask | the snapshots kept (below) |

You do not need to switch either on.

## What the nightly snapshot holds

On the hosted platform today (a single server), a job runs
**nightly at 03:30, server time (Sydney)** and archives every account
together:

- the whole data volume: every workspace's files — source, `memory/`,
  `state/`, run records — each workspace's git history, the account's
  encrypted secrets (the vault) and the storage index;
- the database (`pg_dump`): people, API keys, sessions, the ledger and every
  balance, the queue, the audit log;
- the server's key file.

**Encrypted before it leaves the server.** Every file the job writes — the
archive (with the database dump inside it), the list of what it holds, and
the key file — is encrypted with [age](https://age-encryption.org) to a
public key whose private half is **not** on the server: the server can make
a backup and cannot open one, and neither can anyone holding the object
storage it is copied to. The archive is encrypted as it is written, so it is
never stored unencrypted, even on the server. The job refuses to run rather
than copy anything unencrypted. Snapshots taken before this change
(October 2026) were copied off the server unencrypted, all but the key file:
the first encrypted run deletes those copies from object storage, and the
server's own copies of those nights age out of the 14 kept.

Before an archive is kept it is checked: the database dump must be readable
by `pg_restore --list` and list table data, row counts are taken from the
live database at the same moment, and the archive is listed in full and
its checksum recorded — of the very bytes being encrypted, in the same pass.
An archive that fails the check is deleted and the older ones are kept.
That an encrypted archive decrypts, with the private key, to exactly that
checksum is proved by an automated test of the whole job on every change to
it; the server cannot prove it nightly, because it does not have the key.

**Kept:** the last 14 on the server, and 15 days in object storage off it
(Cloudflare R2).

A full restore from one of these archives was performed on 2026-09-05, from
the R2 copy: the archive matched the server's byte for byte and restored the
workspaces, run records, the database and the sealed key file. That was
before the archive itself was encrypted; *not yet performed* on an encrypted
one — the next restore drill is.

### What it does not hold

- **Storage file bytes.** On the hosted platform the files in a workspace's
  Storage live in object storage (R2), not on the data volume; the snapshot
  has the index of what exists, not the bytes. *Unverified:* whether a
  storage file deleted by mistake can still be recovered from object
  storage. Ask, and say when it was deleted.
- Anything that only existed inside a sandbox while a step ran.
- What model providers and connected services hold on their side.

A self-hosted install backs up however its operator set it up; this page
describes the hosted platform. `foldrun-infra/dev/backup.sh` is the job, if
you want the same for yours: it needs `age` and `FOLDRUN_BACKUP_RECIPIENT`
(your age public key) and will not run without them.

## Seeing your snapshots

Settings → **Backups** shows how often, how many are kept, when the last one
was taken and whether it was verified, copied off the server and
**encrypted**, and each snapshot that holds your account, newest first —
each one marked encrypted or not (the ones from before October 2026 are
not).

```sh
foldrun backups                          # the same, in the terminal
```

```http
GET /api/account/backups
```

Each archive the job verifies is recorded with the accounts it holds; an
account sees only the archives it is in, and its own name as the only entry
in `accounts`. Each record says `encrypted` and
names the key it was encrypted to by fingerprint (`recipient`,
`sha256:` and 16 hex digits of the public key) — a change of fingerprint is
a change of key. *Not yet verified on the server:*
the recording landed on 2026-10-01, so the list starts with the first
nightly run after that deploy — older archives exist but are not listed.

## Restoring a workspace yourself

Every change to a workspace — a dashboard save, a deploy, a `git push` — is
a commit in its own git repository. Restoring puts the workspace's source
back as it was at one of those commits:

```sh
foldrun restore sales --to 2026-09-28T14:00 --dry-run   # what would change, with the diff
foldrun restore sales --to 2026-09-28T14:00             # asks you to type the name, then does it
```

`--to` takes a commit (or the start of one), a branch or tag, a date or time
(the last commit at or before it — a time without a zone is read in the
server's timezone, so add `Z` or an offset to be exact), or an age: `90m`, `12h`, `3d`, `2w`.

- **Preview first.** The dry run lists every file that would change, come
  back, or go, with a line diff. Nothing is written.
- **Confirm by name.** The restore itself needs the workspace's name typed
  back (`confirm` in the API). The CLI sends the removals you were shown, and
  if anything else would now be removed — a file added in between — the
  restore is refused and you are asked to look again.
- **It is undoable.** A restore is a new commit whose files are the old
  ones; history says "restored to abc1234". To undo it, restore to the commit
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
{ "to": "<sha from the dry run>", "confirm": "<ws>", "expectRemoved": [ … ] }
```

The workspace's History page lists every commit, and its Repository page can
deploy any one of them — the same operation, by commit instead of by time.

## Asking for a restore from a snapshot

Run records, `state/`, storage and the account's records (people, keys,
balances) come back only from a nightly snapshot. That restore replaces a
volume and a database every account shares, and the key that opens the
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
