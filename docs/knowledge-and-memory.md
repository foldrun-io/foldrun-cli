# Knowledge, memory and state

Four places hold what an agent knows, and they differ only by who may write.
Getting the four right is most of what separates a desk that improves from
one that repeats itself.

| place | who writes | what belongs there |
|---|---|---|
| **knowledge/** | people | what you tell the agents: reference material, standards, the price list |
| **memory/** | the agent | what it worked out: one fact per file, indexed |
| **state/** | the workspace | the bookmark between runs: a cursor, an append-only history |
| **storage/** | anyone | bytes a person reads — see [Storage and sharing](storage-and-sharing) |

## Knowledge is given, not learned

`knowledge/` at the workspace is read by every agent there; `knowledge/`
inside an agent's folder by that agent alone; the account library's by
every workspace. Writing to any of them is denied outright — through the
file tools and through a script. An agent that rewrites the price list it was
handed has corrupted its own source of truth; what it discovers goes to
`memory/`.

Knowledge files are **concepts** in the open OKF shape: a
markdown file with frontmatter naming its `type:`, a title, and a
description. The platform maintains `index.md` and `log.md` in each
knowledge and memory directory — an index of what is there and a provenance
log of who changed what — and refuses a push that adds a concept with no
`type:`. Those two files are generated on every write; do not edit them.

```markdown
---
type: Reference
title: Target keywords
description: The queries the business wants to win, and where each is measured.
---
| keyword | location | page |
|---|---|---|
| building inspection geelong | Geelong,Victoria,Australia | /vic/building-inspections-geelong |
```

## Memory is what the agent learned

`memory/` is the one place an agent writes without an explicit `files`
grant. One fact per file, with frontmatter the index can read. An agent that
learns a customer's phone format, a site's quirk, a date that mattered,
writes it there and finds it next run — and a deploy never overwrites memory
a push does not mention, so what was learned survives the next edit to the
prompt.

Memory is per agent by default; the workspace's `memory/` is shared by the
desk, and the library's by the account.

## Finding it: search and history

Two tool groups give an agent its own past at scale:

- **`tools: [search]`** — `search_files(query)`: ranked full-text search over
  knowledge, memory, state and storage, at the agent's, the workspace's and
  the library's scope. Lexical (BM25), not embeddings — nothing leaves the
  box, and the queries an agent makes are rare exact tokens where that
  wins. Behind it is an inverted index built inside the step on the first
  call and refreshed by mtime after that: a file the agent wrote to
  `state/` a moment ago is found on the next search and is the only file
  re-read, and nothing is persisted, so the index can never be stale across
  a deploy or a hand edit. Search first, then read the hit.
- **`tools: [history]`** — `recall_runs()` and `read_run(id)`: what this
  workspace's earlier runs concluded and what their steps said. A reporter
  that wants "what did last week's run find" asks, rather than being handed
  every prior run.

## State is the bookmark

A cursor into a list that takes a fortnight to walk; a dated, append-only
history line per run; last week's positions to diff against this week's.
The next run reads it, a person rarely does. It travels with a deploy and a
deploy never overwrites it. The one habit that keeps it useful: **append,
never rewrite**, so a run that went wrong cannot erase the record of the runs
that went right.

## The rule to write by

A value **regenerated** every run — a fetched list, a report — is `storage/`.
A value **accumulated** across runs — dead ends, a history, a cursor — is
`state/`. What the agent *learned* — a fact about the world — is `memory/`.
What you *told* it is `knowledge/`.
