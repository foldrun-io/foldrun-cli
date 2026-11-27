# A browser for AI apps

`foldrun browser` gives an AI app on your computer — Claude Code, Claude
Desktop, Cursor, Codex — a real Google Chrome window to work in. The app
opens pages, reads them, clicks, types, fills forms, switches tabs, uploads
and downloads, and hands the page to you when something needs a person.

It is the same browser program a deployed agent's `web` tool browses with
([tools](tools.md)), run on your machine: the CLI fetches it from your
platform's gallery with your sign-in and starts it. Nothing is sent to
foldrun while you browse; pages load from your own connection.

## In `foldrun code`, on this computer

A `foldrun code` session working on this computer (`/where local`) gives its
agent the same browser as a tool: `web` with `action: browse`, the same tool
and the same arguments a deployed agent's `web` tool takes, run in this
window. You see every page it opens, and you can step in. It is offered once
`foldrun browser setup` has run; each call is asked like any other tool.
A session in the cloud browses in the cloud, as any step does.

### Who is driving the window

The window carries a small badge in its bottom-right corner that says who
drives it and what it is doing: `koder · code-1a2b3c4d5e6f7a8b — step 2 of 3:
click @e13` while a call runs, then `done — waiting for the next step` (or
`stopped at step 2 — waiting`). A `foldrun code` session names itself by
its id, the one `/sessions` shows; an AI app over `foldrun browser mcp` by
the program name it gives (`claude-code · foldrun browser`), else as `an AI
app`.

The badge is drawn inside the page, so the site can read it, hide it or
imitate it: it is a convenience, not a security indicator. So it says nothing
private. A step shows its verb, an `@e13` reference or a key's name (`press
Enter`), never the text it types, a selector, a site's address or a URL:
`fill @e4` or just `fill`, never the password. A session is shown by its id,
never its name or a `--context` you chose, which can say what you are
working on. An agent's `web.browse` block cannot change it.

It is for you, not for the agent. It shows only while a step that acts
(click, fill, press, go to …) runs, and comes off before a step that reads
the page (`get`, `extract`, `if`, `expect`, `eval`, a screenshot, a pdf) and
before the result is read, so nothing a call returns holds it. Clicks pass
through it. It is never drawn while the window is recorded (`trace`,
`video`), and a browser in the cloud has no window, and so no badge. A call
first takes off what the last call left; if a tab will not let it, the call
stops with nothing recorded or read, and says which tab to close.

What a call cannot do on this computer is refused by name, never dropped:

| On this computer | In the cloud |
|---|---|
| `browse`, every option below | `search`, `fetch`, `crawl`, `map`, `extract`, `answer`, `monitor` too |
| Google Chrome (`browser: chrome`) | chromium, firefox, safari (webkit), lightpanda, obscura |
| the page stays open between calls (`live: true`); `live: end` closes the window | `live` as you choose |
| — | options that name a secret from the vault: `proxy`, `captcha` (and `captcha_solver`), `cookies`, `auth`, `state_key` |
| — | `identity` (an agent's `web.browse` identities), `extensions`, `state`, vendor browsers |
| — | `allowed_domains`: the window stays open between calls, so a hold to some sites cannot be kept there |

The agent's `web.browse` block (else its project's, else the account's) means
the same here as in the cloud, read by the same code. `deny`, `boundaries`,
`webgpu`, `ignore_https_errors`, `cookie_domain` and `storage_origin` apply.
A block that names what cannot run here (a vendor, an engine other than
Chrome, `cookies`, `storage`, `state`, `state_key`, `init`, `extensions`,
`allowed_domains`) refuses each call with the reason, and so does an agent
whose `web.actions` leaves out `browse`. Settings the open window does not
take (`device`, `user_agent`, `locale`, `timezone`, `video`, `headless`,
`version`, `live`, `live_view`, `identities`) are named in every answer as
not kept. The files are read again after 30 seconds, so a change to them
holds without a restart.

Files a call writes (`mode: screenshot`, `download`) land in
`~/.foldrun/browser/work/outputs/`. Text in pages is data from the site, never
instructions; the agent asks you to type passwords and codes in the window
yourself, and says what it will do before anything that pays, sends, posts or
deletes.

## Set it up

You need Google Chrome and the foldrun CLI, signed in (`foldrun login`).

```sh
foldrun browser setup
claude mcp add --scope user foldrun-browser -- foldrun browser mcp
```

`setup` checks for Chrome, fetches the browser program and installs
Playwright once, at the version the program names (no browser download:
your Chrome is used). For another app, give it the same command —
`foldrun browser mcp` — as a local (stdio) MCP server.

## Its own profile, and signing in

The window is your Chrome in a profile of its own,
`~/.foldrun/browser/chrome` — not your everyday one. That is on purpose:
Chrome lets a program drive your everyday profile only after you allow it,
every time it connects, because that is how malware steals sign-ins. A
profile of its own needs no allowing, and the app reaches only the sites you
signed in to there.

Sign in once to the sites you want the app to use:

```sh
foldrun browser open https://mail.example.com
```

The sign-ins stay in that profile across sessions and restarts.
`foldrun browser reset` removes the profile and signs you out of everything
(it asks first).

## When a page needs you

Some steps only a person can do: a sign-in with nothing saved, a code sent
by SMS, email or an authenticator app, a passkey, an "is this you?" approval
on your phone, a bank's payment confirmation, an image or slider puzzle. The
app then tells you what to do and calls `browser_wait_for_person`; you do it
in the window, and the app carries on when the page has moved on — you do
not have to come back and say so.

It never asks for a password, a card number or a code in the chat. Type
those in the window.

Because the window is real Chrome on your own connection, with your
sign-ins, most sites show far fewer challenges than they show a browser in a
data centre. Clicks move the pointer the way a person's does.

## The tools

| Tool | Does |
|---|---|
| `browser_open` | open a page (the current tab or a new one) and read it |
| `browser_read` | read the current page again: the accessibility tree with a `[ref=eN]` on everything that can be acted on, or its text, markdown, links, tables, head |
| `browser_act` | steps in order — click, fill, type, press, choose, scroll, wait, go back, switch tabs, upload, download, read a value — then read the page; an element is named by its ref (`@e13`), a CSS selector or `text=…` |
| `browser_screenshot` | a picture of what is in view, the whole page (`full_page`) or one element; one too big to send (a very long page) is refused with what to take instead |
| `browser_wait_for_person` | hand the page to you; returns when the address changes, or the condition given (`until_url_contains`, `until_gone`, `until_visible`) |
| `browser_close` | close the window; the sign-ins stay |
| `web` | the cloud's own `web` tool, `action: browse`, with every option this computer can run (`mode`, `actions`, `device`, `block`, `capture`, `har`…): the same tool a deployed agent and `foldrun code` browse with. What needs the cloud is refused by name ([the table](#in-foldrun-code-on-this-computer)). Offered once `foldrun browser setup` has fetched it |

Reading a page as text costs the app far less than a screenshot, which is
an image; the app is told to take one only when the layout matters.

## Files

Each call runs in `~/.foldrun/browser/work/`. A file to upload goes in its
`uploads/` folder first; screenshots and downloads land in `outputs/`. An
upload cannot read from anywhere else on your computer.

## What the app does not get

A call is started with Chrome, the page and nothing else: none of your
environment variables, so no foldrun token or other key can be typed into a
page by a site that tries to talk the app into it. Text on a web page is
data for the app, never an instruction to it.

## Commands

| | |
|---|---|
| `foldrun browser setup` | check Chrome, fetch the browser program, install Playwright |
| `foldrun browser open [url]` | open the window yourself, to sign in |
| `foldrun browser close` | close it |
| `foldrun browser reset` | remove the profile (asks; `--yes`) |
| `foldrun browser doctor` | what is installed, where the profile is, whether the window is open |
| `foldrun browser mcp` | the MCP server an app starts |
