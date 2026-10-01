# Status and incidents

Is it us or is it you? The platform answers that itself, in three places
that read the same record:

- **The status page** — [foldrun.io/status](https://foldrun.io/status/). A
  static page on the website, not on the platform, so it still loads when
  the platform does not. If it cannot reach the platform it says so: *status
  unavailable — the platform may be down*, which is itself the answer.
- **The dashboard banner** — an amber line across every page during
  maintenance or a minor incident, red during a major one, with the latest
  update. It goes when the incident is resolved. **Status** in the account
  menu opens the status page.
- **`foldrun status --platform`** — the same, in a terminal (`--json` for a
  script). Plain `foldrun status`, which compares your folder with what is
  deployed, now opens with one line saying whether the platform is
  operational and lists any live incident.

## What each component means

| Component | Operational when | Measured from |
|---|---|---|
| Dashboard and API | the web tier answers and its database does | the request itself; the worker also fetches `/api/healthz` through the public address every five minutes |
| Run workers | a worker holds the lease and nothing queued has waited over ten minutes | the worker lease and the queue's oldest job |
| Scheduler | it has ticked in the last fifteen minutes | the samples themselves — they are written from inside the scheduler's tick, so a stale sample *is* a stopped scheduler |
| Model providers | `api.anthropic.com` answers, and fewer than two step attempts in the last hour failed with a provider error (overloaded, rate limited, a 5xx; a refused credential only when two accounts saw one — one account's own expired key is that account's) | a reachability check, and the run records |
| Email | `api.resend.com` answers | a reachability check; `unknown` on an install without a platform mail key |
| Storage | the database answers and the workspace volume is writable | the same checks `healthz` makes |

Each is `operational`, `degraded`, `outage`, `maintenance` or `unknown`
(not measured — not counted against uptime). An incident or maintenance
window the operator posted raises the components it names: a minor incident
to `degraded`, a major one to `outage`.

## Uptime history

Every five minutes the worker that holds the scheduler lease records one
sample per component. Ninety days are kept. A day's uptime is the share of
its measured samples that were not an outage; a day with no samples has no
figure rather than a hundred per cent. The status page draws these as 90
bars per component, with the incidents of the same period below.

These are the platform's own measurements of itself, from inside. They do
not see a network problem between you and the platform — the page saying
*unavailable* does.

## Incidents and maintenance

The super admin posts them from **Admin → Incidents** (or
`/api/admin/incidents`): a title, what customers should read, the impact
(minor or major) and the components affected. Each update adds a line with
a status — `investigating`, `identified`, `monitoring`, `resolved`.
Maintenance is a window with a start and an end; it shows as upcoming before
it starts and as `maintenance` while it runs. Incidents are resolved, not
deleted, so the history stays; deleting is for one posted by mistake. Every
change is in the audit log as `status.*`.

What customers see never includes who wrote an update.

## Reading it from code

`GET /api/status` and `GET /api/status/history?days=90` are open — no key —
and readable cross-origin from foldrun.io. See [the API](api) for the
shapes. The answer to `/api/status` is cached for fifteen seconds and never
calls a provider per request.

## On your own install

The same routes and sampler run on a self-hosted install. Point the
dashboard's **Status** link at your own page with `FOLDRUN_STATUS_PAGE_URL`,
allow your page's origin with `FOLDRUN_STATUS_ORIGINS`, and see
[Environment](environment) for the rest. Without a database, samples and
incidents are files under `<data>/status/`.
