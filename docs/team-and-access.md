# Team and access

Every member and every API key has a role, and every write route asks for
the least role that may take that action. Reads are open to every role: a
viewer sees everything, including run output and files, because a platform
whose supervisors cannot see what the agents did is not supervised.

## Roles

| role | may |
|---|---|
| **viewer** | read everything — workspaces, runs and their output, files, history, usage |
| **editor** | + edit files, upload, deploy, push; run, stop, re-run, approve and promote runs; test tools |
| **admin** | + create and delete workspaces; write secrets and connect credentials; mint keys; invite, re-role and remove editors and viewers |
| **owner** | + billing; make and unmake admins; transfer the account |

There is exactly one owner: the account's creator until they transfer it.
The owner is never re-roled or removed — transfer first. Nobody changes their
own role, and an admin cannot make or remove another admin: an admin who can
promote peers is an owner with extra steps.

A refused call answers `403` with the role that was needed.

## Scoped members

A member can be limited to some workspaces. The customer whose desk lives in
one workspace sees that workspace's runs and files and nothing else; the
sidebar, Find, the runs list and the approvals banner all filter to their
scope. Scope is set on the invite and changed per member later.

## Invites

An invite carries a role, a workspace scope, and an email address it is bound
to — only that address can accept it. It is sent through the account's email
connection, or returned as a link to pass on yourself.

## API keys

A key is minted with a role (`editor` unless you say otherwise) and acts as
the account with that role. It can never be wider than the person who made
it: not a higher role, and not a workspace they cannot open — a key minted
by someone scoped to two workspaces is scoped to those two. The git remote
honours the same scope: pushing needs write on that workspace, and pushing
the library needs admin. Two things a key cannot do: act against a named
member — inviting, re-roling, removing, transferring need a signed-in person,
because a key names an account and never a who — and exceed its role.

**Deploy keys** are keys scoped to one workspace's git remote, read or write.
They clone and push that workspace and are refused everywhere else, which is
what a CI job or a contractor's checkout should hold.

A key **is** its account: the platform reads the account off the key, so one
account's key can never reach another's workspaces. Someone who looks after
several accounts — an agency, a reseller — holds one key per account and
switches between them; the CLI stores each as a named profile. See
[More than one account](cli#more-than-one-account).

## Sessions

Signing in creates a session; your Profile page lists them and revokes any
one of them, which signs that device out without touching the others.
Changing your password or email signs out every other session, and says
how many. Sign-
ins, key use and role changes are written to the account's audit log.
