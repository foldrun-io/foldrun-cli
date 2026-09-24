# Tools

A tool is one markdown file describing something an agent may call. One noun
for capability: `transport:` says how it connects, and an agent grants it by
name in `tools:`.

```
tools/email.md             flat — a definition and nothing else
tools/bounce-verify/       folder — tool.md plus the code it runs
  ├── tool.md
  └── run.py
```

Nothing is callable until an agent names it. That is the whole security model:
reading one `agent.md` tells you its blast radius.

## `outward: true` — the tool changes something that is not ours

A tool that sends, posts, buys, publishes or uploads says so in its own
frontmatter:

```yaml
---
name: lawyer_send
outward: true
run: send.py
---
```

Nothing changes at run time. What changes is `check`: a flow step whose agent
grants an outward tool must have a `verify:` the runtime can fail on, or a
gate (`!` or `ask:`). Neither, and the deploy is refused, with the step named.

The reason is in the failure it prevents. A step that sent nothing and a step
that sent everything both end the same way — reported as done — unless
something other than the agent says otherwise. A receipt file, a ledger row,
the reply's own verdict line: any of them is enough. So is a person.

## HTTP — an API as a tool

```yaml
---
transport: http
name: google-ads
description: The Google Ads API. GET /customers/… to read; POST to mutate.
base: https://googleads.googleapis.com/v18
methods: [GET, POST]
headers:
  Authorization: Bearer ${GOOGLE_ADS_TOKEN}
---
```

| field | |
|---|---|
| `base` | the URL every call is relative to |
| `methods` | the verb allowlist — a tool that declares none is read-only |
| `headers` | `${SECRET}` placeholders, resolved host-side at call time |
| `openapi` | a URL or file; turns one generic tool into typed ones, one per operation |

The model never sees a credential — the host substitutes it as the request
goes out. The method allowlist protects against the agent; the key's own scopes
protect against everyone else, so pair a read-only tool with a read-only key.

## Script — code as a tool

```yaml
---
transport: script
name: sql
run: run.py
description: >
  Run SQL over CSV and JSON files in the working directory. Use whenever the
  answer is a number: totals, averages, joins, de-duplication.
args:
  query: The SQL — one SELECT or WITH statement
  files: Comma-separated .csv / .json paths, one table each
timeout: 120
runtime:
  packages: [pandas]
---
```

| field | |
|---|---|
| `run` | the program beside this file. Omit it and a fenced code block in the body is the program (the single-file form) |
| `args` | each argument and what it means — this is what the model reads |
| `timeout` | seconds; without one the program runs until it finishes |
| `interpreter` | what runs the file — `python3`, `bash`, `node` — when the extension does not say, or says wrong |
| `secrets` | `proxied` when the program sends through the egress proxy itself (reads `FOLDRUN_EGRESS`, sends `${NAME}`); the default, `materialised`, puts the real values in its environment |
| `outward` | `true` when the program makes something happen outside — sends, posts, orders. On a [test run](runs#test-runs) a step granting it is handed no real secret at all, whatever their names |
| `test_mode` | `allow` for a reader that happens to use a send-capable secret (a Business Profile reader on the same token the poster uses): on a test run the step still gets the real values. An `outward` tool in the same step wins. Parsed as `testMode` |
| `runtime` | interpreters and packages, merged into the step's environment |

`args` descriptions are the tool's interface. Write them for someone who has
never seen the program, and say when to use the tool in `description` — that
sentence is what decides whether it gets called at all.

## MCP — someone else's tools

```yaml
---
transport: mcp
name: linear
url: https://mcp.linear.app/sse
headers:
  Authorization: Bearer ${LINEAR_TOKEN}
---
```

Both transports the SDK supports: a local process (`command:`, with `args:` and
`env:`) or a remote endpoint (`url:`, with `headers:`). Every tool the server
exposes reaches the agent that grants it. `mcpServers:` in an agent's own
frontmatter is the inline spelling of the same thing.

## The library — define it once

```
<account>/library/
├── tools/<name>.md
├── skills/<name>/SKILL.md
├── knowledge/ · memory/ · scripts/
```

Resolution is **nearest wins**: an agent's own beats its project's, which beats
the account library. So a shared integration is defined once for the whole
account and rotating its credential is a single edit — and a workspace can
still shadow it by defining the same name locally.

The Library page lists, for every shared file, which agents granted it and
where a nearer copy overrides it. That list is the blast radius of changing it.

## The gallery — platform-maintained tools

Every tool the platform ships — `web_browse`, `web_search`, `sql`, `git_repo`,
`email` and the rest — is **available in every account from the start**.
An agent grants one the same way it grants anything: `tools: [web_search]`
in its `agent.md`, and it runs, with nothing installed first. The gallery
is a shelf beneath your account library, laid down on the box at boot, so
a platform upgrade reaches every account at once.

**Installing** is still there, and it means something narrower now: it
copies the tool into your account library (or one workspace), and your
copy shadows the platform's by name. A copy you have **not edited** follows
the gallery: every platform deploy brings it to the current version. A copy
you **have** edited is yours and is never changed under you. The Library
page marks each copy **gallery · current** or **gallery · differs**, with a
one-click *update to gallery version* for an edited copy — it writes the
current files through the revision log, so your version is one revision
back. Nothing from the gallery is granted
to any agent until its `agent.md` names it.

| tool | what it does | the key it needs |
|---|---|---|
| `web_search` | searches the web on the account's own engine — titles, links, snippets | none |
| `web_fetch` | reads one URL, or up to twenty: the page itself, as markdown, text, html, meta or links | none |
| `web_browse` | a real browser: JavaScript runs, and it can click, fill, scroll, screenshot, download and extract | none |
| `sql` | SQL over the CSV and JSON files in the working directory — read-only | none |
| `git_repo` | a git repository as material: clone narrowly, read, commit and push one change | `GIT_TOKEN` (or `GITHUB_TOKEN`) with write access to the repository |
| `email` | sends transactional email through Resend | `RESEND_API_KEY` |
| `slack` | posts a message to a Slack channel | `SLACK_BOT_TOKEN` — a bot with `chat:write`, invited to the channel |
| `github` | reads repos, issues and pull requests; opens issues and comments | `GITHUB_TOKEN` — fine-grained, scoped to the repos |
| `stripe` | reads customers, payments, subscriptions and invoices. Read-only on purpose: reporting, not refunds | `STRIPE_API_KEY` — a restricted key |

The key is a vault secret, declared under the agent's `secrets:`; the value
never appears in a file.

## Reaching the web

Three tools, three jobs. They are one family on purpose: the same vocabulary,
so moving between them costs one word.

| tool | what it does | what it costs |
|---|---|---|
| `web_search` | finds URLs — query in, titles and links out | free on the account's own engine |
| `web_fetch` | reads one URL — **the page itself**, not a summary of it | tokens only |
| `web_browse` | drives one URL — a real browser, JavaScript runs | a pod |

Nothing searches the live web. `web_search` queries an **index** — somebody's
stored copy of the web, made earlier. `web_fetch` and `web_browse` are the
only two that touch a live page. Search finds; the other two read.

Start with `web_fetch`. It is one HTTP request, roughly fifty times cheaper
than `web_browse`, and it is enough for anything the server sends whole —
documentation, JSON, RSS, most articles. When a page builds itself with
JavaScript, `web_fetch` says so and names `web_browse` rather than returning
an empty shell that reads as "no content". That message is the signal to
escalate; the `url` and `mode` carry over unchanged.

`web_fetch` returns the page at the fidelity you ask for — `markdown` (the
default), `text`, `html`, `meta`, `links`, or `raw` for the bytes untouched.
It is deliberately not Anthropic's built-in `WebFetch`, which fetches a page
and then hands it to a small model, so what reaches your agent is that
model's answer *about* the page. Ours returns the page, lands on the run
record with every other step, and works whichever model is driving.

### One page, a list, or a whole site

`web_fetch` reads **one URL per call**. That is not a limitation to work
around — it is what makes it cheap and what makes a run legible, because every
page read is its own line on the record. Scale comes from the flow, not from
the tool:

| you want | use |
|---|---|
| one page | `web_fetch url=…` |
| a list of pages | a flow step with **`each:`** — the step runs once per URL, in parallel |
| a whole site | `web_browse mode=map` (every URL it can find) or `mode=crawl` (page by page, robots.txt honoured, resuming where it stopped) |

So a search that returns twenty links becomes twenty reads by adding one line
to the flow, not by passing twenty URLs to one call:

```markdown
1. [[researcher]] — Find pages about {{topic}}.
2. [[reader]] — Read this page and pull out what matters.
   each: lines
   max: 20
```

A hundred sites is the same shape one level up: a flow fanning out, each step
mapping or crawling one site. Not one enormous call.

### What else the browser does

Reading a page is the smallest thing `web_browse` does. It is a real browser,
so it can also **act**: click, fill a form, press keys, pick from a dropdown,
scroll, go back and forward, follow a link, step into an iframe or a popup tab,
open and close tabs, paste HTML into a rich editor, hand a file to a file
picker, save a download, type and click and swipe with no selector at all,
set a cookie or a storage key, stub the server (`mock`), and go offline.
Those go in an `actions` list that runs in order before the page is read.

Some steps are not actions. `expect` is a **claim** — the element is there,
reads this, the URL contains that — and a wrong one fails the step. `if`
**branches** on the same claim ("dismiss the banner if it is there"). `get`
and `eval` ask a **question** whose answer comes back as data. Those three
are what turn a list of clicks into something a flow can trust.

Around that it carries what a real browser carries: a named `session` so a
login done once holds for the rest of the run, `state` so it holds for the
next run too, `cookies` from a secret for sites that sign in without a
password, three engines (`browser: chromium | firefox | webkit`), phone
emulation, `block` to drop images and trackers on heavy pages, `proxy` and
`auth` and `headers` from secrets, `capture` to save the JSON a page fetches
for itself, and `video`, `trace` or `har` when you need to see what happened.

Its eighteen `mode` values fall into five groups — **read** the page (`text`,
`markdown`, `html`, `aria`), take **what it carries** (`meta`, `table`,
`network`, `capture`, `links`), keep a **file** (`screenshot`, `pdf`), walk
the **site** (`map`, `crawl`), or **ask it a question** (`console`, `vitals`,
`a11y`, `diff`, `feed`). Every argument, action and mode is listed under
[The browser, in full](#the-browser-in-full).

Beside `mode` (what comes back) and `actions` (what is done first) the tool
has three more layers, each a different kind of thing: **claims** (`expect`,
and the `expect` and `if` steps — a statement about the page that fails the
call when wrong), **identity** (`identity=`, a name for who the browser is),
and **state** (`state=`, a login that outlives the run). Those are under
[Claims, identity and state](#claims-identity-and-state).

Whatever the job, a page's own failures come back with it — an uncaught error,
a script the server refused, a request that never landed — one line each on the
run log. An empty page arrives with its reason.

### Which language the tools work in

None of the three hardcode a country. `web_search` asks the engine in the
agent's `language:` — and for its region when the tag carries one, as
`en-AU` or `pt-BR` — `web_browse` reports it as the page's locale, and
`web_fetch` sends it as `Accept-Language`. The value cascades from the agent
to its workspace to the account, and is English when nobody set it; see
[`language:`](agents#language--the-language-this-agent-works-in). A
country the tag does not carry comes from
[`region:`](agents#region--the-country-this-agent-works-for) — `language: en`
with `region: au` searches as `en` for Australia. One call can differ:
`web_search … language=de region=at`, `web_browse … locale=de-DE`.

### Two kinds of search company

Every "search API for AI" is one of two businesses, and the difference decides
what you can buy, what it costs, and what can break it.

**1. They crawl the web and sell access to their own copy.**

A bot visits *websites* — millions of them — stores what it finds, and builds
an index. Your query is answered from **their copy**, not from Google. Google
is not a party to it and cannot block it; the only people who can refuse a
crawler are site owners, through `robots.txt`.

| who | index | ~$/1,000 | free tier |
|---|---|---|---|
| Google | ~400B+ pages | not for sale — Custom Search JSON API retires 1 Jan 2027 | — |
| Bing | ~100–200B | not for sale — public API shut 11 Aug 2025 | — |
| **Brave** | ~40B pages, ~100M refreshed a day | **$5–9** | 2,000/month |
| **Exa** | its own **semantic** index — by meaning, not keywords | **$7** | $20 signup + ~$10/month |
| **Parallel** | its own closed index | **$1** (Turbo) | **$5/month ≈ 5,000 searches** |
| Perplexity | its own crawler, sold as an answer | $5–14 | — |
| Tavily | own crawler **plus** bought-in feeds | ~$7–10 | 1,000/month |
| You.com | its own index and cache *(self-reported)* | per call | yes |
| Mojeek | ~8B, fully in-house | cheap | yes |

**2. They scrape Google's results page and sell you what it said.**

No index of their own. Your query goes to `google.com`, their bot reads that
results page, and you get the ten links back as JSON.

| who | ~$/1,000 |
|---|---|
| Serper | ~$1 |
| DataForSEO | ~$1–3 |
| SerpAPI | dearer, same idea |
| Bright Data | volume pricing |

**These are not Google partners.** There is no Google SERP partner programme —
the only official Google search APIs are the Custom Search JSON API (limited,
retiring) and Search Console, which returns your own site's data and nobody
else's. Tier two scrapes Google against its Terms of Service, and the proof is
in what the money buys: thousands of rotating residential IP addresses, captcha
solving and constant selector repair. **A partner would need none of that.**

So the two kinds fail in completely different ways. A crawler can go stale.
A scraper can get blocked — and the blocking is not a bug to fix, it is the
other side pushing back.

Which to use is not a matter of quality:

- **Where does our page rank on Google?** Only Google knows Google's ranking,
  so that answer can only come from tier two. It is why rank-desk uses
  DataForSEO.
- **Find me good pages about X?** Tier one. You want good sources, not
  Google's exact ordering, and a licensed index is never refused.

One more thing the marketing blurs: **searching is almost never live.** Tier
one answers from a stored copy made hours or months ago. "Real-time" usually
means a fresh index plus a live fetch of the top few results. Only `web_fetch`
and `web_browse` touch a page as it is right now.

### Searching somewhere else

`web_search` is the only one of the three whose *index* you can buy from
someone else, and what you are buying is **an index we cannot crawl** — not
a faster endpoint. Name who answers and the tool the model sees does not
change: same name, same arguments, same shape back.

```yaml
---
name: researcher
tools: [web_search, web_fetch, web_browse]
web_search: exa              # short form — the key is EXA_API_KEY in the vault
---
```

```yaml
web_search:                  # long form — your own vault name
  name: exa
  key: ${MY_EXA_KEY}
```

The long form is the same two spellings `provider:` takes, and `key:` is a
reference, never a value: a credential written into the file is refused.

Two kinds of name, and they run in different places:

| `web_search:` | kind | whose index | where it runs |
|---|---|---|---|
| *unset* | ours | the account's own engine | in the run's sandbox |
| `brave` | search API, your key | Brave — ~40B pages, ~100M refreshed a day; the index Claude searches | **our tool, in the sandbox** |
| `exa` | search API, your key | Exa — its own semantic index, by meaning | our tool |
| `parallel` | search API, your key | Parallel — its own closed index; $1 / 1k, 5,000 a month free | our tool |
| `tavily` | search API, your key | Tavily — own crawler plus bought-in feeds | our tool |
| `you` | search API, your key | You.com — its own index and cache *(self-reported)* | our tool |
| `jina` | search API, your key | Jina — each result arrives with its page already read | our tool |
| `firecrawl` | search API, your key | Firecrawl — open-source core | our tool |
| `perplexity` | search API, your key | Perplexity's own crawl — its Search API returns results, not an answer | our tool |
| `linkup` | search API, your key | Linkup — agent-shaped, each result with its content | our tool |
| `serper` | **SERP scraper**, your key | Google's results page, read for you — ~$1 / 1k | our tool |
| `serpapi` | SERP scraper, your key | Google's results page — the dearest, 80+ engines | our tool |
| `dataforseo` | SERP scraper, your key | Google's results page — $0.60 / 1k; what rank-desk uses | our tool |
| `anthropic` | model provider | Brave, licensed | **Anthropic's servers** — `web_search_20250305` |
| `zai` | model provider | Zhipu's own, China-weighted | z.ai's endpoint, the *same* server tool |
| `openrouter` | model provider | native where the model has one, Exa otherwise | OpenRouter, as a plugin |
| `openai` | model provider | Bing plus OpenAI's own crawl | OpenAI, Responses-shaped |
| `kimi` | model provider | Moonshot's own, China-weighted | Moonshot, `$web_search` |
| `deepseek` | — | **none.** `check` refuses the word | — |
| `bing` · `google` | — | **not for sale.** Bing's API retired 11 Aug 2025; Google's retires Jan 2027 — both survive only as grounding inside their own models. `check` says so | — |
| `apify` | — | a marketplace, not an endpoint — reach an actor as an http tool file | — |

The difference in the last column is the one to hold. A **search API** is
called by our own tool from the run's sandbox: the call is on the run record
with its query, it rides the egress proxy, and it works whichever model is
driving. A **model provider's** search runs on that provider's machines,
inside its own tool loop — cheaper to set up, but off the record and only
while that provider is the one answering.

Every search API's own response shape is mapped in the tool to the one the
model already knows:

| API | its results live at | one result is | mapped to |
|---|---|---|---|
| Brave | `web.results[]` | `title, url, description, extra_snippets[]` | title · url · snippet |
| Exa | `results[]` | `title, url, highlights[], summary, publishedDate` | title · url · snippet · date |
| Parallel | `results[]` | `title, url, excerpts[], publish_date` | title · url · snippet · date |
| Tavily | `results[]` | `title, url, content, score, published_date` | title · url · snippet · date |
| You.com | `results.web[]` | `title, url, description, snippets[], page_age` | title · url · snippet · date |
| Jina | `data[]` | `title, url, description, content, publishedTime` | title · url · snippet · date |
| Firecrawl | `data.web[]` | `title, url, description` | title · url · snippet |
| Perplexity | `results[]` | `title, url, snippet, date, last_updated` | title · url · snippet · date |
| Linkup | `results[]` | `name, url, content, type` | title · url · snippet |
| Serper | `organic[]` | `title, link, snippet, date, position` | title · url · snippet · date |
| SerpApi | `organic_results[]` | `title, link, snippet, date, position` | title · url · snippet · date |
| DataForSEO | `tasks[0].result[0].items[]` where `type: organic` | `title, url, description, rank_group` | title · url · snippet |

Each was read from its vendor's own reference on 2026-09-16, and Jina was
called live: `s.jina.ai` refuses without a key, `r.jina.ai` does not.

**The keys.** Store each once, under the name the API expects —
`foldrun secrets set EXA_API_KEY` — and the runtime declares it for every
step whose agent names that API; nobody writes it twice. The vault names:
`BRAVE_SEARCH_API_KEY`, `EXA_API_KEY`, `PARALLEL_API_KEY`, `TAVILY_API_KEY`,
`YOU_API_KEY`, `JINA_API_KEY`, `FIRECRAWL_API_KEY`, `PERPLEXITY_API_KEY`,
`LINKUP_API_KEY`, `SERPER_API_KEY`, `SERPAPI_API_KEY`. The key goes through
the egress proxy and is filled in for that API's host and no other — in a
header, or in the URL for SerpApi, whose key is a query parameter; it is
never in the sandbox. DataForSEO speaks HTTP basic auth, so its entry holds
the encoded pair: `printf 'LOGIN:PASSWORD' | base64`, stored as
`DATAFORSEO_AUTH_BASIC`.

The SERP scrapers are the one kind to reach for when the question is about
Google itself — where a page ranks, what the SERP shows. For finding good
pages, an index is the better buy and is never refused.

That last row of the table is the one worth reading twice. DeepSeek's
endpoint is Anthropic-shaped, so every shape check passes, and there is
still no search behind it. Speaking a wire is not the same as running a
tool on it — which is why `check` refuses it offline rather than letting a
desk search nothing for a month.

### Fetching through someone else

`web_fetch` is ours by default — free, one HTTP request, on the record —
and that is enough for most of the web. A fetch API is for the pages ours
cannot read: one that refuses a plain request, or twenty that would be slow
one at a time. Same switch, same two spellings:

```yaml
web_fetch: jina              # or firecrawl, exa, tavily, parallel, zyte, scrapingbee
```

| `web_fetch:` | tier | what it gives back | per call | key |
|---|---|---|---|---|
| *unset* | ours | the page, at the fidelity asked | 1, or up to 20 with `urls=` | — |
| `jina` | reader | clean markdown, text or html | 1 | **optional** — 20 a minute without one |
| `firecrawl` | reader | main-content markdown or html, boilerplate stripped | 1 | `FIRECRAWL_API_KEY` |
| `exa` | extract | text, from Exa's own cache unless told to fetch fresh — the tool tells it | up to 100 | `EXA_API_KEY` |
| `tavily` | extract | markdown or text, failures listed beside successes | up to 20 | `TAVILY_API_KEY` |
| `parallel` | extract | full-page markdown; handles JavaScript pages and PDFs | up to 20 | `PARALLEL_API_KEY` |
| `zyte` | **unblocker** | the page rendered in a real browser behind a proxy pool; pays per success | 1 | `ZYTE_API_KEY_BASIC` |
| `scrapingbee` | **unblocker** | the page rendered in a real browser (`render_js`) behind a proxy pool; credits per call | 1 | `SCRAPINGBEE_API_KEY` |
| `anthropic` | model provider | a small model's reading of the page, on Anthropic's servers | 1 | — |

A provider answers `markdown`, `text` and `html`. The modes only a raw read
can answer — `meta`, `links`, `raw` — are always read directly, and the tool
says so rather than quietly switching.

Two of these need a word. **Zyte** authenticates with HTTP basic auth, and
the egress proxy fills a placeholder verbatim, so its vault entry holds the
encoded form: `printf 'KEY:' | base64`, stored as `ZYTE_API_KEY_BASIC`.
**Exa** serves a fetch from its own index by default; a fetch is expected to
be live, so the tool asks for the page as it is now (`maxAgeHours: 0`).

What each hands back, and what the tool turns it into:

| API | shape | the tool reads |
|---|---|---|
| Jina Reader | `data.{title, url, content, publishedTime, warning}` | `content`, in the format asked |
| Firecrawl | `data.{markdown \| html, metadata.{url, statusCode}}` | the format asked |
| Exa Contents | `results[].{url, title, text}` + `statuses[].{status, source}` | `text`; `source` noted |
| Tavily Extract | `results[].{url, raw_content}` + `failed_results[].{url, error}` | both arrays, always |
| Parallel Extract | `results[].{url, title, full_content, excerpts[]}` + `errors[].{url, error_type}` | `full_content`, else the excerpts |
| Zyte | `browserHtml` (or base64 `httpResponseBody`), `url`, `statusCode` | html, converted here |

One cost worth stating plainly for both switches: a *model provider's*
search or fetch runs on **their** servers, off the run record and outside
the egress proxy. A *search or fetch API* does not — it is called by our own
tool, from the sandbox, with your key filled in at the boundary. Prefer the
second whenever the same index is available both ways.

The one to know is `web_browse`: a real headless browser that opens a page,
renders its JavaScript, and can then click, fill, press keys, select, scroll,
screenshot, print to PDF, paste HTML into a rich editor, hand a file to a
file picker, save a download, step into an iframe or a popup tab, and pull
structured rows out — all from one `actions` list. Chromium by default;
`browser: firefox` or `browser: webkit` (Safari's engine) render a page the
way those do, and `device: "iPhone 15"` serves the mobile layout. `block:
"image,font,media"` makes a heavy page render in a fraction of the time, and
`capture: "**/api/*"` saves the JSON the page fetched for itself instead of
parsing what it drew. `headers` sends extra request headers — a `${NAME}` in
a value is read from that secret inside the run, the http tools' own
convention — and `auth` and `proxy` name secrets for HTTP basic auth and a
proxy. `video: true` records the pages as `.webm`; `trace: true` saves a
step-by-step replay for trace.playwright.dev, which is what to ask for when a
selector fails. `mode: markdown` is the read to reach for when the
structure matters — headings, lists, tables and every link's target kept,
navigation and footer dropped, at a fraction of what the HTML costs;
`mode: meta` is the head as an SEO desk reads it (title, description,
canonical, og, hreflang, every JSON-LD block, the heading outline, images
without alt); `mode: table` is every table as rows; `mode: network` is the
page's own status, redirect chain and headers, then every request it
made — the link check, and how to find the endpoint a `capture` should
ask for. `mode: aria` reads the accessibility
tree — often the cleanest read of a complex app — with a number on every
element, so the next call acts on `"@e4"` instead of a guessed selector. `mode: map` lists every URL on a site
(sitemap plus links, same host); `mode: crawl` reads the site page by page
into `outputs/crawl/` with an index, robots.txt honoured, three tabs at a
time, resuming from where it stopped when called again. A hundred sites is
a flow fanning out one step per site, not one call — parallelism is the
flow's job, and each step gets its own browser.

An `extract` step is the way to read a directory. One row per match, each
field a selector inside it, `@attr` for an attribute; the rows are the
output and the whole set lands in `outputs/extracted.json` uncapped:

```text
web_browse(url="https://example.com/directory", block="image,font",
        actions='[{"extract": ".listing",
                   "fields": {"name": "h3", "phone": ".tel", "url": "a@href"}}]')
```

For a site that signs in without a password
(magic link, Google), copy the session cookies once from a signed-in browser
(DevTools → Application → Cookies), store the Cookie header line as a
secret, declare the secret on the agent and pass its **name** as `cookies`:

```sh
foldrun secrets set MEDIUM_COOKIES        # paste: sid=…; uid=…
```

```yaml
tools: [web_browse]
secrets: [MEDIUM_COOKIES]
```

```text
web_browse(url="https://medium.com/new-story", cookies="MEDIUM_COOKIES",
        wait_for="[data-testid=editorTitleParagraph]",
        actions='[{"fill": "[data-testid=editorTitleParagraph]", "text": "Title"},
                  {"paste": "[data-testid=editorParagraphText]", "file": "outputs/article.html"},
                  {"wait": 5000}]')
```

The cookie value is read from the secret's environment variable inside the
run and appears nowhere in arguments, output or the run record; the last
stderr line is the page's final URL, which is how a caller learns the id of
the draft a save just created. That promise is why `js` — an expression
evaluated in the page, for the case a selector map cannot express — refuses
to run in the same call as `cookies`, or in a session those cookies seeded:
`document.cookie` is one expression away. A site that answers with a bot
challenge gets that page back as the output — in any engine, unless the
call names a `captcha` secret.

**Captcha, on your own account.** `captcha: "CAPSOLVER_KEY"` names a secret
holding your solver's API key (`captcha_solver` picks `capsolver`, the
default, `2captcha` or `anticaptcha` — the three speak one protocol). With
it, a reCAPTCHA v2, hCaptcha or Turnstile widget on the page is read for
its site key, sent to the solver with the page URL, and the token that
comes back is written into the widget's response field and handed to its
callback — what the widget would have done. The form is not submitted: the
next action does that, as for a person. One stderr line per solve — type,
solver, seconds — and a site key is solved once per page, so a re-check
after an action does not bill twice. The platform ships no solver and
pays for none; a solve is a call from the sandbox to your vendor on your
key. Not covered, and said so rather than implied: reCAPTCHA v3 (no
widget, the site scores the session), Cloudflare's full-page managed
challenge, Arkose, GeeTest — those come back as the page they are. Tested
against a stand-in solver and stand-in widgets in real Chromium, not yet
against a real solver account.

The other one to know is `git_repo`: a git repository — a site, a codebase
— as material an agent reads and changes. `clone` fetches it into a
checkout that lives only for the step (pass `paths` to narrow a large repo
to the directories you need), `read` and `find` look inside it, `write`
copies a workspace file in, `commit` pushes one change, and `publish` puts
a drafted file into a fresh clone and pushes it. Which repository, branch
and live site is a `git:` block in the workspace's `AGENTS.md`; the token
is the `GIT_TOKEN` secret, read by git through a credential helper so it is
in no URL and no log.

```yaml
git:
  repo: acme/website           # or any https URL
  branch: main
  site: https://acme.example   # for routes and newest, the live sitemap
  author: bot@acme.example
```

Every push holds a write lock on the remote (`refs/foldrun/lock/<branch>`),
so two desks never push in the same minute; a push rejected because the
branch moved is replayed on the new tip, up to three times; a true conflict
— the same lines changed both ways — stops with the file names and pushes
nothing; and a SHA is reported only once the remote confirms the commit is
on the branch. `publish` refuses to overwrite a file that changed since the
workspace last `read` it. The record of every attempt is `storage/git/`
(`pushed.sha`, `pushed.run`, `failed.txt`), which a flow's `verify:` can
hold a step to. Git cannot cross steps — a run copies files back, never
`.git/` — so the step that commits is the step that clones.

### Browsing somewhere else

`web_browse` renders in the account's own browser pod. Name a vendor and the
same tool — every mode, every action — connects over CDP to a browser on
their machines instead. For the pages that refuse ours: a residential pool,
built-in unblocking, a different reputation.

```yaml
web_browse: browserbase      # or steel, hyperbrowser, browserless, brightdata, zenrows
```

| `web_browse:` | what it is | key |
|---|---|---|
| *unset* | the account's own pod, whichever engine the block or the call asks for | — |
| `browserbase` | hosted Chromium with stealth; a session is opened for the call | `BROWSERBASE_API_KEY` |
| `steel` | hosted Chromium, open-source core; a session per call | `STEEL_API_KEY` |
| `hyperbrowser` | hosted Chromium with built-in unblocking; a session per call | `HYPERBROWSER_API_KEY` |
| `browserless` | hosted Chrome, one websocket with the token | `BROWSERLESS_TOKEN` |
| `brightdata` | Chromium behind a residential proxy pool, port 9222 — for the sites that refuse everything else | `BRIGHTDATA_BROWSER_AUTH` — the zone's whole `user:pass` |
| `zenrows` | hosted Chromium with residential IPs and fingerprinting, one websocket with the key | `ZENROWS_API_KEY` |

Two things differ from the search and fetch switches. **The key is in the
step**, not at the proxy: CDP is a websocket, which the egress proxy does
not carry, so the wrapper holds the real value the way it already holds a
cookie secret, and opens the vendor's session itself. And **`proxy=` and
`block=` do not reach a vendor's browser** — those are launch options, and
the vendor launched it; configure them on the vendor's session instead. The
tool says so on the run log when both are present.

A vendor that cannot be reached is not fatal: the tool says which one
refused and renders in the step, as it does when the account pod is away.
Browserless is SSPL-licensed — its cloud is a plain vendor, but the free
self-hosted path is out for a paid service. Apify is not on this list: it is
an actor marketplace, not a browser endpoint.

### The browser, in full

Every argument, action and mode the gallery `web_browse` takes. The first seven
arguments are the original ones, so a call that passed only `url` behaves
exactly as it always did.

**Arguments**

| argument | what |
|---|---|
| `url` | the page to open — the one required argument |
| `wait_for` | a CSS selector to wait for before reading or acting |
| `mode` | how to read the page — the modes below (default `text`) |
| `actions` | a JSON array of steps — the actions below |
| `session` | a name; cookies and logins persist across calls in the run |
| `cookies` | the NAME of a secret holding a site's sign-in cookies |
| `cookie_domain` | the domain those cookies belong to |
| `browser` | `chrome` (default), `firefox`, or `safari` — Safari's engine, WebKit; `chromium` and `webkit` still work |
| `engine` | the same setting, under the name the `web_browse:` block uses; either on a call, both only if they agree |
| `device` | a device to emulate by Playwright name: `"iPhone 15"`, `"Pixel 7"` |
| `block` | resource types and host globs not to load: `"image,font,*.doubleclick.net"` |
| `capture` | a URL glob; every matching response is saved under `outputs/captures/` |
| `js` | an expression evaluated in the page; refused with `cookies` |
| `geolocation` | `"lat,lng"` the page will see |
| `permissions` | permissions granted up front: `geolocation`, `notifications`, `clipboard-read`, `camera`, `microphone` |
| `locale` | `en-AU` |
| `timezone` | `Australia/Sydney` |
| `headers` | a JSON object of request headers; a `${NAME}` in a value is read from that secret; `cookie` is refused |
| `user_agent` | an explicit user-agent, beating the engine's and the device's |
| `auth` | the NAME of a secret holding `user:pass` for HTTP basic auth |
| `captcha` | the NAME of a secret holding your captcha solver's API key; off by default; passes reCAPTCHA v2 / hCaptcha / Turnstile widgets, the next action submits |
| `captcha_solver` | `capsolver` (default), `2captcha` or `anticaptcha` |
| `proxy` | the NAME of a secret holding a proxy URL, `http://user:pass@host:port` — every engine honours it for plain and TLS pages, and a missing secret is refused by name. Chromium also sends its own start-up traffic through it — a time check, an update check, an accounts ping, ~10 small requests per launch — which a metered proxy will bill; Firefox and WebKit do not |
| `video` | `"true"` or a `.webm` path — records every tab |
| `trace` | `"true"` or a `.zip` path — a Playwright trace for trace.playwright.dev |
| `dialogs` | `accept` or `dismiss` (default) for alert, confirm and prompt |
| `dialog_text` | what to answer a `prompt()` with, when accepting |
| `color_scheme` | `light` or `dark` |
| `limit` | `map` and `crawl`: the most pages (500 and 50 by default, up to 5000) |
| `interactive` | with `mode=aria`: `true` lists only the numbered things you can act on, one per line |
| `expect` | a JSON array of claims checked after the actions, each the shape of an `expect` step; every one is reported, any failure fails the call |
| `routes` | a JSON array of `mock` steps in place before the first request |
| `identity` | a name from the agent's `web_browse: identities:` map — engine, device, locale, timezone, user agent, proxy, headers, cookies as one word |
| `state` | a name; the login (cookies and localStorage) is loaded from `../../state/browser/<name>.json` first and saved back at the end — across runs. Refused with `cookies` or `storage` from a secret |
| `har` | `"true"` or a `.har` path — every request and response with bodies, as an HTTP Archive |

**Modes** — `text` (default), `markdown`, `html`, `aria` read the page;
`meta`, `table`, `network`, `capture`, `links` take what it carries;
`screenshot`, `pdf` keep a file; `map`, `crawl` walk the site. The five that
ask a question:

| mode | what comes back |
|---|---|
| `console` | every console message and uncaught error, with level and source; `outputs/console.json` |
| `vitals` | LCP, CLS, FCP, TTFB, INP (after an interaction) graded good / needs improvement / poor, load timings, resource weight; `outputs/vitals.json` |
| `a11y` | an accessibility audit — axe-core's violations with the elements and the fix; the built-in checks when the image has no axe; `outputs/a11y.json` |
| `diff` | the page as markdown against the last `diff` read of the same URL, as a line diff with context; the baseline lives in `../../state/browser/diff/` and the first read saves it |
| `feed` | the RSS, Atom or JSON feed — the URL itself when it is one, else the first linked, else the usual paths — as items; `outputs/feed.json` |

**Actions** — each step is an object with one of these keys. Selectors are
Playwright's: CSS, `text=Sign in`, `role=button[name="Save"]`, `xpath=…`,
`label=Email`, `placeholder=Search`, `alt=Logo`, `title=Close`, `testid=save` —
or a number from the last `mode=aria`, written `"@e4"`.

| action | what |
|---|---|
| `click`, `dblclick`, `rightclick`, `hover` | the pointer, on a selector |
| `check`, `uncheck` | a checkbox or radio |
| `drag` + `to` | drag one selector onto another |
| `fill` + `text` | set a field's value |
| `type` + `text` | key by key, for the editors `fill` cannot set |
| `press` + `key` | a key on a selector, or on the page when the selector is `""` — `"Enter"`, `"Control+A"` |
| `select` + `value` | a dropdown option |
| `wait` | a selector, or a number of milliseconds |
| `goto` | navigate to a URL |
| `scroll` | `"bottom"`, `"top"`, or a number of pixels |
| `screenshot` (+ `selector`, `full`, `clip`, `quality`, `settle`) | the full page to `outputs/<name>.png`, scrolled once first so lazy images are in it; one element with `selector`; the viewport alone with `"full": false`; a rectangle with `"clip": [x, y, w, h]`; `"settle": false` skips the scroll. A `.jpg` path is JPEG at `"quality"` (default 60) — a fraction of the PNG's size for the same read |
| `pdf` | the page, to `outputs/<name>.pdf` — Chromium only |
| `paste` + `html` or `file` | a real paste of HTML into a rich editor; headings, links and lists survive |
| `upload` + `file` | hand a file to a control that opens a file picker |
| `download` + `to` | from a control or a URL, saved under `outputs/` |
| `extract` + `fields` (+ `limit`) | one JSON row per match; a field is a selector inside it, `a@href` reads an attribute; the rows are the output and the whole set is written to `outputs/extracted.json` |
| `frame` | scope the steps after it to an iframe; `""` returns to the page. A selector missing from the page is also looked for inside every frame automatically |
| `tab` | `1` or `"last"` — switch to a tab a click opened; `"new"` (+ `url`) opens one, `"close"` closes the current |
| `back`, `forward`, `reload` | `true` — history, and the page again |
| `focus`, `clear`, `highlight` | focus a control; empty a field; outline elements for the next screenshot |
| `scroll` | also takes a selector: bring it into view |
| `keyboard` + text, `keydown` / `keyup` + key | type into whatever has focus; hold and release a key |
| `mouse` (`click`, `dblclick`, `move`, `down`, `up`) + `x`, `y` | the pointer at page pixels, for what no selector names |
| `wheel` + pixels (+ `dx`) | scroll by wheel; negative is up |
| `tap`, `swipe` (`up` / `down` / `left` / `right`, + `selector`) | touch: a tap on an element, a swipe's touch events at it or the page |
| `clipboard` (`write` + `text`, `read`) | the clipboard; a read joins the results |
| `wait` | also: `"load"`, `"domcontentloaded"`, `"networkidle"`, `"navigation"`; `"url"` + `matches`; `"text"` + `text`; `"response"` / `"request"` + `matches`; `"fn"` + `js`; a selector + `"gone": true`; any with `timeout` |
| `get` + `what` (`text`, `html`, `value`, `count`, `box`, `visible`, `checked`, `enabled`, `attr` + `attr`) | a question; also `"url"`, `"title"`, `"localstorage"` / `"sessionstorage"` + `key`. Answers go to the results — the output when nothing else is — and `outputs/results.json` |
| `eval` + expression | its value joins the results; the same rules as `js` |
| `expect` | a claim: a selector (visible) with `text`, `value`, `count`, `gone`, `checked`, `enabled`, or `attr` + `equals` / `contains` / `matches`; or `"url"` / `"title"` / `"text"` + `contains` / `matches` / `equals`. Wrong, the step fails and the rest stop |
| `if` + `then` / `else` | the shape of `expect`, as a branch: lists of steps, either optional |
| `mock` + `json` / `body` / `file` / `status` / `headers`, or `abort` | answer for the server on every request matching the glob, from now on |
| `unmock` | lift a mock by its glob, or `"*"` |
| `offline` | `true` / `false` |
| `cookie` + `value` (+ `domain`, `path`), or `delete` | set one; delete one, or all with `"*"` |
| `localstorage`, `sessionstorage` + `value`, or `delete` | set a key; delete one, or clear with `"*"` |
| `viewport` `[w, h]` | resize |
| `dialog` (`accept` / `dismiss`, + `text`) | what later alert / confirm / prompt boxes get |
| `solve` | `true`: send the captcha widget on the page to the solver now; a selector + `into`: read an image captcha into a field. Needs `captcha=` |


**Numbered elements.** `mode=aria` gives every element a number and an
action names it as `"@e4"` — the model points at what it read rather than
writing CSS. The next call loads the page fresh, where Playwright's own
numbers mean nothing, so what is kept (in `outputs/.browser/refs.json`, per
`session`) is what the number pointed at: its role and name, and which of
the matches it was. `"@e4"` is found again by that. When it is gone, or the
page now has a different count of the same thing — a third "Delete" where
there were two — the step fails and says which, instead of clicking a
neighbour. Read the page with `mode=aria` again and use the new numbers.

```
web_browse(url="https://example.com/cart", mode="aria", interactive=true)
  → button "Delete" [ref=e5]
    button "Delete" [ref=e7]
    link "Checkout" [ref=e12] -> /checkout
web_browse(url="https://example.com/cart", actions='[{"click": "@e7"}]')
  →   @e7 = button "Delete" (2 of 2)
```

**Modes** — four groups, and no two modes answer the same question.

*To read the page.* Four fidelities of the same read; pick by what you
need from it.

| mode | when |
|---|---|
| `text` | you want what a person sees, as plain text — the default |
| `markdown` | the structure matters: headings, lists, tables, emphasis, code, and where each link goes — navigation and chrome dropped; also `outputs/page.md` |
| `html` | you need selectors for a later `actions` call |
| `aria` | you need the controls: the accessibility tree, often the cleanest read of a complex app, every element numbered for `"@e4"` |

*What the page carries.*

| mode | what comes back |
|---|---|
| `meta` | its head as JSON: title, description, canonical, robots, og/twitter, hreflang, feeds, JSON-LD, heading outline, word/link/image counts — an image with no `alt` attribute is `imagesWithoutAlt`, one with `alt=""` is `imagesDecorative` (correct markup, not a fault); also `outputs/meta.json` |
| `table` | every table as JSON rows keyed by its header row, with the heading above it; also `outputs/tables.json` |
| `network` | its own status, every redirect hop, content-type and headers first (Set-Cookie withheld), then every request it made — status, type, bytes, ms; also `outputs/network.json`. The link check, and how to find what `capture` should ask for |
| `capture` | the bodies the `capture` glob matched |
| `links` | every link on the page, text and href |

*Files.*

| mode | what comes back |
|---|---|
| `screenshot` | `outputs/page.png` — the full page, settled first; the output ends with `Read outputs/page.png to see it.` |
| `pdf` | `outputs/page.pdf` — Chromium only |

**Looking at what you captured.** A screenshot is a file, and nothing
shows it to the agent by itself. An agent with `read` opens it like any
other file — `Read outputs/page.png` — and sees the page. That is the step
that turns a screenshot from evidence for a person into something the agent
can reason about: a layout, a chart, whether a banner covered the content.
For anything the agent will read back, a `.jpg` path with `"quality": 60`
costs a fraction of the PNG to look at and reads the same; keep PNG for
pixel-exact evidence a person will inspect.

*The site.*

| mode | what comes back |
|---|---|
| `map` | every URL on the site: sitemap plus links, same host, to `outputs/map.txt` |
| `crawl` | the site page by page to `outputs/crawl/` with an index; robots.txt honoured; the same call again continues |

Whatever the mode, the page's own failures — an uncaught error, console
errors, a script the server refused or that never loaded — are one stderr
line each, so an empty page comes with its reason. A crawl retries a wire
error, a 5xx or a 429 once before recording it.

Not there, on purpose: reading cookies or localStorage back, rewriting
requests, HAR files, offline mode, an `edge` engine (it is Chromium), and
anything that helps a page not look automated.

### How this agent's browser presents itself

Engine, user agent, device, locale and timezone are the browser's identity,
not what one call does, so they belong in the file once rather than in every
call. `web_browse:` takes a block for them, and the vendor moves to `via:`.
What one call does stays in the call — `mode`, `interactive`, and `"@e4"`
in its actions — so there is no block key for any of them:

```yaml
---
name: publisher
tools: [web_browse]
web_browse:
  engine: chrome             # chrome (default) | firefox | safari
  user_agent: "Mozilla/5.0 (Macintosh; …) Chrome/153.0.0.0 Safari/537.36"
  cookies: MEDIUM_COOKIES    # the vault NAME, never the cookies
  cookie_domain: .medium.com
  device: "Pixel 7"          # optional: viewport, scale, touch and its own UA
  locale: en-AU
  timezone: Australia/Sydney
  via: browserbase           # optional: render on a vendor's machines
---
```

`cookies:` is a secret's name, and `check` refuses anything that is not one —
a header line pasted into the file is caught while the mistake is still
private. The secret is still declared under `secrets:`, as it always was; the
block only saves naming it in every call.

**When the login is not a cookie.** Firebase keeps its record in IndexedDB,
MSAL can keep tokens in sessionStorage, and a page like that opens signed out
however good the cookie jar is. `storage:` is the sibling of `cookies:` for
those sites: a secret holding the signed-in Web Storage and IndexedDB as JSON,
and `storage_origin:` beside it, because storage is walled off per origin and
`.example.com` cannot name one.

```yaml
web_browse:
  storage: INDIEHACKERS_STORAGE
  storage_origin: https://www.indiehackers.com
```

```json
{ "localStorage": { "user-session": "…" },
  "sessionStorage": {},
  "indexedDB": { "firebaseLocalStorageDb": { "firebaseLocalStorage": [ { "fbase_key": "firebase:authUser:…", "value": { … } } ] } } }
```

It is seeded by a script that runs in the page **before any of the site's own
code**, so a framework that reads its session on boot finds it there, and
IndexedDB is filled through its own API rather than copied as files. The
console command in the browser prints the shape to store. Nothing is ever read
back out, and for the same reason `js` refuses to run in a call that carries
`storage`, exactly as it refuses one that carries `cookies`: an expression in
the page could hand the model the token. A file-level default is dropped when
the call opens a different origin, with one line on stderr saying so.

**A cookie default must name its site.** `cookie_domain:` is required beside
`cookies:`, and a call to any other host opens signed out, with one line on
stderr saying so. Otherwise an agent that browses widely would hand whatever
page it opened the session that belongs to one site. A `cookies=` on the call
is the caller's own decision and is used as given.

`web_browse: browserbase` still means exactly what it did, so no file needs
changing. A block may sit on the agent, the workspace's `AGENTS.md` or the
account's; the nearest one wins and replaces the others whole. **A call
argument beats the file** — `browser=`, `user_agent=`, `device=`, `locale=`,
`timezone=` — so the block is a default, never a lock.

`chrome` and `safari` are the names people use; Playwright calls the same two
`chromium` and `webkit`, and both spellings are accepted so nothing written
earlier breaks. Worth knowing what they are: `chrome` is the open-source
**Chromium** build, not the branded Chrome, and `safari` is **WebKit**,
Safari's engine. A cookie earned in one is presented by the other at your own
risk — the user agent is part of what a site checked.

Why identity belongs together: a Cloudflare clearance cookie is bound to the
user agent that earned it. A skill that repeats the UA in every call is one
edit away from a session that stops working and says nothing about why
(what happened to Medium on 2026-09-17). `check` refuses an engine that does
not exist and a setting that is not text, in one sentence, before a run.

### Proving a write stuck

A save that reports success and reverts is the worst failure a driven page
has: every line of the log says it worked. `confirm=` is the contract that
catches it.

```
web_browse(url="…", actions='[…]', confirm="text=Draft saved")
```

After the actions, the call reloads the page and requires that selector, or
`text=…`, to be there in what the **server** returns. If it is not, the call
fails, says the change did not stick, and says not to retry — a refused write
is a session or a permission, not a flake. It needs `actions:` for the same
reason: confirming a page nobody changed proves nothing.

Use it on every call that writes. Without it, "the tool reported ok" is the
only evidence a step has, and on 2026-09-17 that evidence was wrong for hours.

### Claims, identity and state

`confirm=` proves one thing: a selector survived a reload. `expect=` is the
general form — a list of claims about the page after the actions, each
checked and reported, any failure failing the call:

```
web_browse(url="…", actions='[…]',
           expect='[{"expect": "text=Draft saved"},
                    {"expect": "url", "contains": "/p/"},
                    {"expect": "label=Title", "value": "Owner Inspections"}]')
```

A claim is a selector that must be visible, with `text` (contains), `value`,
`count`, `gone`, `checked`, `enabled`, or `attr` + `equals` / `contains` /
`matches`; or `url`, `title` or `text` (the page's) with `contains`,
`matches` or `equals`. It is about the page **as it stands** — put a `wait`
first when the page must settle. The same object is an `"expect"` step
between actions (wrong, it stops the rest), and an `"if"` step branches on it
with `then` and `else` lists, which is how "dismiss the cookie banner if it
is there" becomes one step instead of a failed click.

`get` and `eval` steps ask questions rather than make claims: the answers
are the call's results, its output when nothing else claims it and always
`outputs/results.json`. An `eval` is script in the page and obeys the same
rule as `js` — never beside a secret's cookies or storage.

**Identity.** Engine, device, locale, timezone, user agent, proxy, headers,
geolocation, colour scheme, block list and a cookie secret are who the
browser *is*, and a call that sets six of them to be an Australian phone
will set five next time. The block names the bundle once and the call says
the name:

```yaml
web_browse:
  identities:
    au-mobile:  { device: "Pixel 7", locale: en-AU, timezone: Australia/Sydney, proxy: PROXY_AU }
    au-desktop: { locale: en-AU, timezone: Australia/Sydney }
    us-desktop: { locale: en-US, timezone: America/New_York, proxy: PROXY_US }
```

```
web_browse(url="…", identity="au-mobile", mode="screenshot")
```

`check` refuses an identity with an engine that does not exist, a secret
that is a value rather than a NAME, a cookie without its domain, or a key
that belongs to a call (`mode`, `actions`) rather than to an identity. A
call argument still beats the identity, and the identity beats the block's
own defaults.

**State.** `session` keeps a login for one run. `state` keeps it for the
next one: the cookies and localStorage the call ends with are written to
`../../state/browser/<name>.json` and loaded before any later call that
names it, in this run or a run next month. It is the agent's own login,
made with `actions` from credentials it can see — `state` refuses
`cookies=` and `storage=` and a session those seeded, because `state/` is a
workspace file every later step can read, and a vault secret written there
would stop being one. `mode=diff` keeps its baselines in the same place,
under `state/browser/diff/`, for the same reason: they must outlive the run.

### Where the browser runs

Locally — the CLI, a compose install — Chromium launches inside the step,
and always did. On a cluster it runs in **the account's own browser pods**:
Playwright servers on the runner image (Playwright pinned to an exact
version, 1.63.0, in `run-container.ts` — the numbered snapshot needs 1.59
or later, and a floating `@1` would move the pods and the tool under a
working desk on any rebuild), in the run namespace, the first
started the moment a step in the account grants `web_browse`, another added
for every two steps browsing at once (`FOLDRUN_BROWSER_STEPS_PER_POD`, up to
`FOLDRUN_BROWSER_MAX_PODS`, four), kept while calls keep coming, and
deleted after fifteen minutes unused (`FOLDRUN_BROWSER_IDLE_MS`): a pod
beyond what the account currently needs idles out first, the last one
goes when the account stops, and nothing is deleted while any of the
account's steps is running, so a call in flight is never cut by a pod
going away under it.
The step is handed its address as `FOLDRUN_BROWSER_WS`; every call connects
and gets a browser launched for it alone, with the same flags the in-step
launch uses, so two runs never share cookies and two accounts never share a
pod. The pod's seconds and bytes are the account's compute and network on
the ledger, as one `browser <pod>` line when it is reaped — the search
pod's lifecycle, for the browser. An account that does not browse pays for
no browser; nothing account-level is always on.

Every engine is served the same way: `browser=firefox` and `browser=webkit`
are launched in that same pod, so where a page renders never depends on which
engine you asked for. What stays in the step is any call whose pod cannot be
reached — stderr then says `running <engine> inside the step`, and the call
proceeds.
A `session` in the pod is the context's storage state — cookies and
localStorage, which is what a login is — saved under
`outputs/.browser/<name>/` between calls; locally it is a profile directory
as before. Uploads, downloads, screenshots, PDFs, video, trace and HAR all
cross the wire; `proxy`, `auth`, `headers`, `device`, `block`, `mock`,
`state` and `captcha` work as they do in the step. `mode=a11y` injects
axe-core from the runner image (`axe-core@4.13.0`, pinned beside
Playwright in `run-container.ts`) into the page, so it runs wherever the
page renders.

A [test run](runs#test-runs) is handed no browser pod at all. The policy
that denies a test run the internet is on the run pod, and a browser pod it
drove would fetch the world on its behalf; refusing the address keeps its
browser under that policy, so a `web_browse` call on a test run fails closed
like any other outward call, and the run log says so.

The pool is one Service and one plain NetworkPolicy pair per account: this
account's run pods may reach this account's browsers on their port and nothing else may;
the pod itself reaches the internet and DNS and never the cluster, the LAN
or the metadata endpoint — the same egress shape as a run pod. Search pods
are built from the same module (`account-pod.ts` in the platform), so the
rule is written once.

## Search — the account's own engine

`web_search` is a gallery tool that asks the account's search engine, a
SearXNG that federates the public engines and merges what they return. On a
cluster it is **the account's own pool of pods**: the first started when a
step that grants `web_search` is about to run, another for every eight
steps searching at once (`FOLDRUN_SEARCH_STEPS_PER_POD`, up to
`FOLDRUN_SEARCH_MAX_PODS`, three), kept while steps keep using them, and
deleted after fifteen minutes unused, surplus first. It asks SearXNG's
default engines plus Yandex and Naver: measured from the platform's own
address, several of the defaults refuse it, and those two answered every
query with relevant results. An account's queries share a process
with no one else's, an account that hammers search suspends only its own
engines, and the pod's seconds and bytes are that account's compute and
network on the ledger. A step that does not grant `web_search` starts
nothing. There is no shared engine behind it any more: should the cluster
refuse the account its pod, the step **fails** with one line saying so
rather than searching through a process every account once shared. The
[browser](#where-the-browser-runs) has the same lifecycle.

What this does not change: every pod leaves the cluster from the node's
address, so the public engines' per-address limits stay shared. Search
here is for finding a page to read — a directory, a firm's site, a primary
source — not for tracking rankings, which is a paid SERP API's job.

## Script tools and secrets

On a [test run](runs#test-runs) a script is not given a send-capable secret:
the variable is there and reads `TEST_MODE_WITHHELD`, and `FOLDRUN_TEST_MODE=1`
is set beside it. A script that sends should check the variable and say what
it would have done; one that does not is stopped by the provider's auth error.
Mark a tool that sends `outward: true`, and a reader that shares a sender's
token `test_mode: allow`.

A script reads its secrets from its environment. By default that means the
real values are in the sandbox for the step, and the run trace says which
script asked for them. A script that sends its own requests can instead go
through the egress proxy — read `FOLDRUN_EGRESS`, send `${NAME}` in the
header — and declare `secrets: proxied` in its tool file; then nothing
real is in the sandbox for it. The gallery's `web_search` does, because it
needs no secret at all; the `web_browse` does not, because a cookie has to be
seeded into a real browser. See [Secrets](secrets#where-the-value-actually-is).

## Skills — procedure, not capability

A skill is a folder with a `SKILL.md`, in the open
[Agent Skills](https://agentskills.io) format:

```markdown
---
name: pacing-check
description: Check whether ad spend is pacing to budget. Use when asked if spend is on track.
---

Run `scripts/pace.py --spent <amount> --budget <amount>` from this skill's
folder, then report the verdict in one sentence.
```

Only names and descriptions sit in context; the agent reads the full file when
a task matches. So an agent can carry many skills for a few tokens each — which
is the reason to move a procedure out of `agent.md` in the first place.

Skills are discovered in the agent's own `skills/`, the workspace's, the
account library, and the cross-client `.agents/skills/` convention that other
tools read and write. A skill written here drops into them, and one they
install is visible here.

**A tool is what an agent may call; a skill is how to do something well.** The
test for moving text out of an agent body: is it procedure (not role), does it
apply to some runs rather than all, and does more than one agent need it?

## Secrets

Names in `secrets:`, values in the vault. A secret may also be an **OAuth2
credential** — the vault stores the refresh recipe (`token_url`, `client_id`,
`client_secret`, `refresh_token`) and the host exchanges it for a live access
token immediately before every use, cached until near expiry.

Resolution is nearest-wins across the workspace and account vaults, and the run
log says which store each one came from — a workspace quietly falling back to
an account credential is the kind of thing you want to see rather than infer.

### Connecting a provider

Two ways in, one rule. An OAuth app has to know its redirect URL in advance,
so register these on every app you make for foldrun and every developer on
the team is covered:

| | redirect URL to register |
|---|---|
| `foldrun connect` from a terminal | `http://localhost:8642/callback` — the same on every machine |
| Connect from the dashboard | `<dashboard URL>/api/oauth/callback` — the form shows the exact value |

```sh
foldrun connect LINKEDIN_OAUTH --provider linkedin --to linkedin-desk
```

opens the provider's consent screen, catches the redirect on this machine,
exchanges the code, and stores the result on the platform you are signed in
to (or the local vault with `--local`). A provider that returns a refresh
token gives you an auto-refreshing credential; one that does not (GitHub,
most LinkedIn apps) has its access token stored as is, and the command says
when it expires. Scopes are one space-separated string, as OAuth defines
them; each preset starts you with an example. Nothing secret is printed.

Most providers refuse a plain-http redirect anywhere but `localhost`, which
is why the terminal path is the one that works from any laptop against any
box, and the dashboard path needs a dashboard with an https address.

## Testing one

The Tool Test button calls a tool with arguments you type, from where a run
would call it, and shows the raw result. That is the difference between "the
tool is broken" and "the agent used it wrong", and it costs no model call.

## The Test button

Every tool has a Test button, and `POST /api/workspaces/<ws>/tools/<tool>/test`
behind it: it calls the tool with typed arguments from where a run would call
it, shows the raw result, and costs no model call. A single-file tool that
carries its program in a fenced block is materialised for the test exactly as
a call materialises it, so the test runs the identical program from the
identical directory — for a long time it did not, and every fenced-code tool
failed the button while running perfectly in a flow, which is the worst way
round for the one place a developer goes to check their work.
