# Storage and sharing

Two kinds of file live in a workspace, and the dashboard shows them on two
pages. **Files** is the markdown source — agents, flows, tools, knowledge —
the thing you edit and deploy. **Storage** is bytes: what agents produce
and what people upload — reports, CSVs, images, PDFs. This page is about the
second.

## Where it lives, from an agent's point of view

An agent writes a deliverable to `workspace/storage/` (or `../../storage/`,
the same place) and it appears on the workspace's Storage page after the
step, kept and downloadable. Uploads dropped on that page land in the same
directory and are there for the next run to read.

Two neighbours are not storage:

- **`outputs/`** is the step's scratch, archived with the run — read it from
  the run page, not from Storage.
- **`state/`** is what the next run needs — a cursor, a history line — and a
  person rarely reads it.

The rule: a value regenerated each run is `storage/`; a value accumulated
across runs is `state/`.

## Limits

One object up to 512 MB; a workspace up to 5 GB, shown on the Storage page.
Both are platform settings (`FOLDRUN_STORAGE_MAX_MB`,
`FOLDRUN_STORAGE_QUOTA_MB`). Storage is metered per GB-month where billing is
on.

## Under the hood

Blobs are content-addressed and go to object storage (S3-compatible — R2, S3
— or local disk on a small install); the index of what exists stays with the
workspace. Uploading the same bytes under a second name costs nothing, and a
rename moves no data. A run pod never holds the bucket credential: it reads
and writes through presigned URLs, so a step that goes wrong cannot list or
delete what other workspaces stored.

## Sharing a file

Some work is not done until something outside can fetch the bytes — a
Google Business Profile post will not accept image data and wants a URL it
can GET for itself. A share is a public link to one file:

```
POST /api/workspaces/<ws>/shares   { "path": "storage/cover.jpg", "ttlDays": 7 }
→ https://<your-install>/s/<token>
```

or **Share** on the run page's Out column, or on the Storage page, or from
the terminal:

```
foldrun storage share cover.jpg --to <ws>        # 7 days; --ttl 30, or --forever
foldrun storage shares --to <ws>                 # live links; --all shows expired and revoked
foldrun storage unshare <token> --to <ws>
```

- Links expire in **7 days** unless you say otherwise; `null` never expires.
- The token is 24 random bytes and never derived from the path; every failed
  fetch is the same 404, so a guesser learns nothing.
- Only `storage/`, `outputs/` and `files/` can be shared. An agent talked
  into sharing is confined to what the workspace produced and can never hand
  out `memory/`, a prompt, or a credential.
- Revoking is permanent; a re-share mints a new token.

Files written under **`storage/public/`** get a link automatically after the
run — for the agent that needs a URL for what it just produced.

Shares need the install to know its public address (`FOLDRUN_PUBLIC_URL`);
without it the request answers `409` rather than minting a link that only
works from inside.

A share is a record the platform keeps, not a file in the workspace: minted
from the dashboard or after a step, it lands in the platform's database,
so every web and worker process sees the same links and a link survives a
workspace being redeployed.

## The account view

Storage at the account level shows every workspace's folder in one tree,
with what each is costing at the foot. It is a view: a run still sees only
its own workspace's folder, and there is no upload there — a file is uploaded
where it will be read.
