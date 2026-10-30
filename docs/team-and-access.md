# Team and access

Every member and every API key has a role, and every write route asks for
the least role that may take that action. Reads are open to every role: a
viewer sees everything, including run output and files, because a platform
whose supervisors cannot see what the agents did is not supervised.

## Roles

| role | may |
|---|---|
| **viewer** | read everything — workspaces, runs and their output, files, history, usage |
| **editor** | + edit files, upload, deploy (to a workspace that exists — a deploy that makes one is an admin's), push; run, stop, re-run, approve and promote runs; test tools |
| **admin** | + create and delete workspaces; delete a run from history; write secrets and connect credentials; mint keys; invite, re-role and remove editors and viewers |
| **owner** | + billing; make and unmake admins; transfer the account |

There is exactly one owner: the account's creator until they transfer it.
Transferring asks for the owner's password again, and a code from their app
when two-step sign-in is on — a session left open is not enough to give the
account away. The owner is never re-roled or removed — transfer first. Nobody changes their
own role, and an admin cannot make or remove another admin: an admin who can
promote peers is an owner with extra steps.

A refused call answers `403` with the role that was needed.

### A workspace's policy is an admin's

The keys in a workspace's `AGENTS.md` that set policy for the whole
workspace — `budget`, `compute`, `notify`, `network_enforce`, `telemetry`,
`alerts`, `owner`, `judge` and `timezone` (also when written under a
`governance:`, `guardrail:`, `observability:` or `evaluation:` block) — need
the **admin** role to change, whichever way the file is written: the
workspace's settings, a save in the editor (`PUT …/source`), `foldrun deploy`,
an import, or a restore to an older point. An editor still edits the rest of
`AGENTS.md` — its prose and every other key — and may deploy, import or
restore anything that leaves those keys as they are; a change to one of them
is refused with a `403` that names the key, and nothing is written. Removing
the file, or saving one whose frontmatter does not parse, drops the keys, so
it counts as a change too. A dry run (deploy, import, restore) is not
refused.

The account's own `AGENTS.md` is written only through the account's settings
(`PATCH /api/account`), which needs an admin with access to every workspace.

## Scoped members

A member can be limited to some workspaces. The customer whose desk lives in
one workspace sees that workspace's runs and files and nothing else; the
sidebar, Find, the runs list and the approvals banner all filter to their
scope. Scope is set on the invite and changed per member later.

Secrets and OAuth connections follow the scope too. A scoped member or key
sees and changes only its own workspaces' secrets and connections: not
another workspace's, and not the account-level ones, which belong to
everyone's workspaces at once.

## Invites

An invite carries a role, a workspace scope, and usually an email address it
is bound to — only that address can accept it. It is sent through the
account's email connection, or returned as a link to pass on yourself; an
invite with no address is a link for one person, whoever opens it first.

- **It works once.** The first signup on it uses it up, in the same step that
  creates the member; a second person, or the same person again, is refused.
  It lasts seven days.
- **Pending invites are listed.** Settings → Team shows the links still out —
  the address or "anyone with the link", role, workspaces, who made it, when
  it expires — with **Revoke** on each. The same list is
  `GET /api/team/invites` (`?all=1` adds accepted, revoked and expired ones)
  and `foldrun team invites`. The link itself is never listed: it is shown
  once, to the person who made it.
- **Revoke one** with that button, `DELETE /api/team/invites/<id>` or
  `foldrun team invites revoke <id>`; its link stops working at once. An
  admin invite is the owner's to revoke, and a member scoped to some
  workspaces sees and revokes only the invites inside its scope.
- **Other things revoke them too.** A new invite to an address revokes the
  older ones still pending to it. Removing a member revokes every pending
  invite they made and any pending invite to their address — a removed
  member cannot rejoin with an old link. Lowering a member's role or
  narrowing their workspaces revokes the invites they made that they could
  no longer make. An invite is also checked against its maker when it is
  accepted: if they have left or can no longer grant it, it is refused.
- **Old links are refused.** Invite links made before 29 October 2026 were
  signed statements with no record behind them; they no longer work. Send a
  new invite.

Each revocation is in the audit log as `member.invite_revoked`;
`member.removed` lists `invitesRevoked`, and `member.joined` names the
`inviteId`.

## API keys

A key is minted with a role (`editor` unless you say otherwise) and acts as
the account with that role. It can never be wider than the person who made
it: not a higher role, and not a workspace they cannot open — a key minted
by someone scoped to two workspaces is scoped to those two. Two things a key cannot do: act against a named
member — inviting, re-roling, removing, transferring need a signed-in person,
because a key names an account and never a who — and exceed its role.
A scoped admin sees and revokes only keys inside its own scope; a key wider
than that, the owner's included, is not in its list.

A key stays no wider than its maker **after** it is made, too. Remove a
member and every key they minted in the account stops working at once —
the one `foldrun login` made included. Lower their role, or narrow their
workspaces, and each of their keys that would now reach more than they can
stops; they mint a new one at their new standing. Each such revocation is
in the audit log (`apikey.revoked`, and `keysRevoked` on `member.removed`).

A CI job or a contractor should hold a key that opens one workspace —
`foldrun keys create ci --workspaces leads`, or Settings → API keys. (Deploy
keys, for the platform's own git, went with it on 17 October 2026; one
minted before opens nothing.)

A key **is** its account: the platform reads the account off the key, so one
account's key can never reach another's workspaces. Someone who looks after
several accounts — an agency, a reseller — holds one key per account and
switches between them; the CLI stores each as a named profile. See
[More than one account](cli#more-than-one-account).

### Expiry, last use and rotation

A key can be given an end when it is minted — 30, 90 or 365 days, or never
(Settings → API keys offers 90 days first; `foldrun keys create ci --expires
90d`; the API's `expires`). After it, the key is refused with a 401 that
says it expired and on which day. The owner is emailed seven days before any
key ends, once per key.

Every key shows when it was created, when it was **last used** and roughly
from where — the address cut to its /24 (or /48 for IPv6), never the whole
of it. Last use is written at most once a minute per key, so a busy CI key
does not turn every request into a write.

**Rotate** mints a new key with the old one's label, role, workspaces and
deploy scope — and, if the old one had an end, the same lifetime from today —
and ends the old key: at once, or after a grace of an hour or a day so a CI
job can be moved across first. In the dashboard it is the Rotate button on
the key; `foldrun keys rotate <id> --grace 1h`; `POST /api/keys/<id>/rotate`.

A key is rotated **once**. While the old key runs out its grace it shows
**rotated → <new key>** (in `foldrun keys ls` too), and rotating it again is
refused with `this key was already rotated to <prefix>…; rotate that one`.
Lost the new key's secret? Rotate the **new** key: that mints another and
ends the lost one. Rotating the old key again would have left the lost key
working.

## Audit log

Settings → Audit log is the account's record of what people did: sign-ins
(and refused ones), sign-outs and session revokes, password and email
changes, MFA turned on or off, keys minted, rotated and revoked, invites,
joins, role and scope changes, removals and ownership transfers, secrets
set and deleted — **by name, never the value** — deploys, workspace deletes,
plan and billing changes, the account export and a close request, and every
time support viewed the account. Filter by time, action, person or
workspace, page back, and download it as CSV for an auditor.

The owner and admins who can open every workspace read it — people, or an
`admin` key. A member or key scoped to some workspaces cannot: the log is
the whole account's. It is the caller's own account, always; another
account's entries are never in it. Entries are kept for the life of the
account (no plan sets a shorter retention) and go when the account is
deleted. Also `GET /api/audit` and `foldrun audit --since 7d --csv`.

What agents did is a different record: every run's trail, under Runs.

## Support access

When you ask for help, foldrun support may open your account **read-only**
to look: your dashboard as the owner sees it, for thirty minutes at most.
They must give a reason, and it lands in your audit log word for word —
"support viewed your account: Ticket 42: daily flow not starting" — with
another line when the view ends. While it is open every change is refused,
in one place for every route: nothing can be run, deployed, edited,
invited, revoked or paid for, and the account export is refused too. The
support person sees a bar on every page saying whose account it is, that it
is read-only, how many minutes are left, and an Exit.

There is no API key or CLI command for this, on purpose: looking inside a
customer's account is an act a named person owns, from a browser, with a
reason you can read.

## Sessions

Signing in creates a session; your Profile page lists them and revokes any
one of them, which signs that device out without touching the others.
Changing your password or email signs out every other session, and says
how many. Sign-
ins, key use and role changes are written to the account's audit log.

## Appearance

The dashboard comes in light and dark. **Profile → Appearance** picks one:
**System** (the default) follows your computer's light or dark setting,
**Light** and **Dark** stay put whatever it says. The choice is yours alone
— it is kept on your profile, not in the browser, so it follows you to every
browser you sign in on, and the page is drawn in it from the first paint.
The sign-in pages, before anyone is signed in, follow the computer.

The API is `GET` / `PATCH /api/me/preferences` with `{ theme }`. There is no
CLI verb: a theme is how a browser draws the dashboard, and a terminal
already draws in its own colours.
