# Storage and sharing

Two kinds of file live in a workspace, and the dashboard shows them on two
pages. **Files** is the markdown source — agents, flows, tools, knowledge —
the thing you edit and deploy. **Storage** is bytes: what agents produce
and what people upload — reports, CSVs, images, PDFs. This page is about the
second.

## Where it lives, from an agent's point of view

An agent writes a deliverable to `workspace/storage/` (the older
`../../storage/` is the same place) and it appears on the workspace's Storage page after the
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

Both limits hold for a direct upload too. An upload asks for its URL with the
file's length (`POST …/storage/upload-url` with `path`, `sha`, `size`); the
limits are checked then, and the length is signed into the URL, so the bucket
refuses a body of any other length. Recording the file afterwards measures
the object the bucket holds; the record, the limit and the quota use that,
never the length the client claimed, and an object over a limit is removed.

Storage belongs to a workspace that exists: a name with no workspace is a
`404`, never a fresh, empty store.

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
foldrun storage unshare <token|id> --to <ws>
```

- Links expire in **7 days** unless you say otherwise; `null` never expires.
- The token is 24 random bytes and never derived from the path; every failed
  fetch is the same 404, so a guesser learns nothing.
- Only `storage/`, `outputs/` and `files/` can be shared. An agent talked
  into sharing is confined to what the workspace produced and can never hand
  out `memory/`, a prompt, or a credential.
- Revoking is permanent; a re-share mints a new token.
- Revoking takes effect at once: a link is served `Cache-Control: private,
  no-store`, so no CDN keeps answering it after a revoke or its expiry.
- Only an admin, or the person who made a link, sees its token and can copy
  it. Everyone else sees that the file is shared, by whom and until when;
  an editor can still revoke it (by its id).
- Deleting a workspace revokes its links and deletes its stored files.
  Renaming one moves both: its links keep working, under the new name.
- A link answers at most 120 requests a minute to one caller (where a trusted
  proxy names the caller) and 1,200 a minute in all, then `429` with
  `Retry-After`. The file is streamed, never read whole into memory.

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

Storage at the account level lists every workspace as its own section, each
closed until you open it, with each file's size, age and share state. It is a
view: a run still sees only its own workspace's folder.

You can upload any file, of any type, to any workspace from there. Use
**Upload** in the toolbar and pick the workspace, use the **Upload** button on
a workspace's section, or drop files onto that section. From a terminal,
`foldrun storage put` does the same, and it takes folders whole:

```sh
foldrun storage put report.pdf photos/ --into inspections/ --to blog-desk
foldrun storage put draft.md --as drafts/today.md --to blog-desk
```

## Previews

Click a file to read it without downloading it. Images, video, audio, PDFs
and fonts play in the browser as themselves. Everything else is parsed on the
server and drawn as what it is:

| What | Formats |
|---|---|
| text and code | txt, md, mdx, json, yaml, csv as a table, source files, logs, anything that reads as text |
| office | docx, xlsx, pptx, odt, ods, odp, rtf; legacy doc, xls and ppt as their text |
| Apple and design | pages, numbers, key, sketch, xd by the preview picture inside them |
| camera and layered images | RAW (cr2, nef, arw, dng and others), psd, tiff, heic by their embedded preview; svg and svgz as a picture |
| mail and contacts | eml, mht, ics, vcf |
| notebooks and links | ipynb, url, webloc |
| archives | zip, tar, tgz, gz by their contents; 7z, rar and others by name only |
| 3D | stl, obj, ply, glb, drawn and turned by dragging |

A stored web page opens in a sandboxed frame with scripts off, and an SVG
only as an image, so a file cannot run code on the dashboard. Anything the
preview cannot read shows its first bytes, and the download button always
gives the file itself. Files over 25 MB are not previewed.
