# Budgets and billing

Money on this platform is a cap at three levels and a meter underneath. The
caps are yours to set and the thing to set first: an agent with a tool loop
and no ceiling can spend in an hour what a month was meant to.

## Four caps

| level | where | what it does when reached |
|---|---|---|
| **an agent, per run** | `budget: 2` in the agent's `agent.md` | the most that agent may spend in one run, across every step it takes in it — its step stops itself mid-turn at what is left, and a later step of its own in the same run is refused before it starts |
| **a run** | `budget: 6` in a flow's frontmatter | a hard cap: between groups the next group does not start; within a group each step gets an equal share of the remainder and stops itself mid-turn when it is spent — the run cannot end over the cap |
| **a workspace, over time** | `budget: 60` in the workspace's `AGENTS.md`, or Settings | new runs refuse until the window turns |
| **the account, over time** | `budget: 500` in the account's `AGENTS.md`, or Settings | the same, for everything |

**Unset means no limit.** No file, no key, `budget: unlimited` — all the
same: the platform invents no cap on its own. The two caps over time take
a period: `budget: 60` alone is per month, as it always was; `budget: 60/day`
and `budget: 60/week` say so. The window is measured in the account's own
calendar (`timezone:` in `AGENTS.md`, nearest wins), so a daily cap resets
at midnight where the customer is, not at midnight UTC. The two per-run
caps take no period — an agent has no calendar, and writing one there is a
mistake the editor names rather than a cap it quietly keeps.

When an agent's cap and the flow's both apply to one step, the tighter one
wins, and the step's error says which line set it: `budget: in the flow
file` or `budget: on the writer agent`.
| **runs at once** | `concurrency: 3` in the account's `AGENTS.md`, or Settings → Defaults | the fourth run waits its turn in the queue — never refused, only later. Empty means the install's plan number (`FOLDRUN_PLAN_CONCURRENCY`, which applies only where billing is on), or no cap |
| **the queue lane** | `priority: high` in the account's `AGENTS.md` (`high` \| `normal` \| `low`) | its runs are claimed before other accounts' normal ones when slots are short; a flow's own `priority:` adds to it. The cap above still holds — a lane jumps the queue, it does not hold the fleet |

A cap is a literal, never an expression, so it is readable off the file. The
run cap is hard: a step that reaches its share of the remainder is stopped
mid-turn, so a runaway costs at most the cap, and the step's own error says
how much of its ceiling it reached.

**What counts as spent is the whole bill**, tokens and the sandbox seconds
behind them. This matters more than it sounds: a step that calls no model —
a script looping on a page that never loads, a browser waiting for a selector
that never appears — spends nothing in tokens and would once have been capped
by nothing at all, while the sandbox billed by the second. The platform sets
no clock of its own by design, so the cap is the only backstop there is, and
it counts everything.

The account's cap and a workspace's are checked separately and both apply:
the workspace one stops that desk, the account one stops everything.

**A cap over time warns before it refuses.** At 80% and again at 95% of a
workspace's `budget:`, the workspace's notification destination is told what
has been spent and what happens at the cap. Each mark is sent once per
window — today, this week, this month, whichever the cap is over — and
resets when the cap does. Without it the way a customer learns about the
cap is a desk failing to start on a Tuesday.

Size the run cap from the run records, at two or three times the median — real
work never trips it, a runaway is stopped where it went wrong, and the
failure notification says why. The dashboard's Usage page shows spend by
workspace and by meter.

## Plans and credits

Usage is sold in **credits: one credit is one cent** of what a step consumes
at the platform's rates. The ledger stays in dollars underneath — every
statement, budget and refund reconciles to one column — and a credit is how
the money is shown and bought.

| plan | a month | credits a month | an extra credit | runs at once | workspaces | queue lane |
|---|---|---|---|---|---|---|
| **Starter** | $29 | 2,900 | 1.00¢ | 1 | 3 | standard |
| **Creator** | $79 | 8,800 | 0.90¢ | 2 | 10 | standard |
| **Pro** | $249 | 29,000 | 0.86¢ | 4 | unlimited | fast |
| **Scale** | $799 | 100,000 | 0.80¢ | 8 | unlimited | fast |

**How long a credit lasts.** A plan's credits land when its invoice is paid,
and what is unused **rolls over** into the next cycle up to **twice** the
plan's monthly quota — so a balance of plan credits reaches at most three
times it: this cycle's, plus at most two carried. Anything above the cap
expires, and the statement line says how much rolled and how much did not.
The carry is lost on a **cancellation** or a **downgrade**, because the
rollover is a courtesy of the subscription continuing at its level; moving
up keeps it. Credits **bought** on top (Balance → Add credit) are separate:
rollover does not touch them and they last **twelve months** from the day
they were bought (`FOLDRUN_CREDIT_TTL_MONTHS`; `0` turns expiry off).
Whoever changes that number should know that prepaid credit sold to
Australian consumers can attract gift-card rules, which are three years.

Which credit a run spends is the order that favours the customer: the
plan's granted credits first, then bought credit oldest-first — so the
credit closest to expiring is always the credit being used. Spend draws on the cycle's credits first, then
on the balance. A new account starts with **300 trial credits**, no card
asked. Without a plan, credit costs 1¢ each, one run at a time, standard
lane — a plan is cheaper from the first month you would have spent its fee
anyway. Changing plan happens at once, prorated by Stripe, and the new
bundle lands with the invoice; ending one ends it with the cycle.

**Seats are unlimited** on every plan: agents work, people supervise, and a
per-seat fee would tax the approver the safety story depends on.

**Bring your own model key** and tokens cost no credits at all — the model
is billed to your own provider account — so a plan then buys sandbox time
and the platform, which is most of what a BYOK customer's credits go on.

**Going into minus.** Ordinarily an empty balance starts no run. The
platform can allow an account to run below zero — to a floor, or with none —
for a customer on invoice terms. It shows on that account's Balance page
and on the audit; it is a term, never a surprise.

**Charges an account does not pay.** The platform can waive any of the three
meters for one account: model tokens, sandbox time, network. It is set per
account from the admin console, never as an install-wide rate, because a
rate turned off globally would quietly stop charging every customer. The
meters still run and the Usage page still shows everything measured; what
changes is the bill. Every run still writes a ledger line — at zero when
everything is waived — naming which legs were waived, so a statement that
totals nothing has a reason printed on it rather than looking like a fault.
It is for the accounts the platform runs itself, and for pilots and
partners whose compute is absorbed by arrangement.

## What a credit buys

Three meters, at the platform's rates. Every charge is recorded in **two
halves** — what the models cost and what the platform under them cost — and
the Usage page, the statement and its CSV all show them apart. They are
different questions: a customer on their own model key pays no model half
at all, and one whose bill moved needs to know which half moved. The halves
always sum to the charge; where a minimum-run fee applies it lands on the
platform half, never on a model number a customer can check against their
provider's own invoice.

| meter | what it counts |
|---|---|
| **tokens** | model usage at cost, times a margin. **Bring your own key and the margin does not apply** — a BYOK step is billed nothing for tokens |
| **compute** | sandbox seconds: what a step reserved (cores and memory, while it ran) and what it actually burned |
| **storage and network** | GB-months in the file store, accrued daily; GB the sandbox moved, both directions |

There is deliberately **no per-step fee**. Steps are sandbox-seconds, so a
step fee would charge compute twice and punish a well-factored flow for
having more, smaller steps. The Usage page shows every table in credits at
today's rates beside the meters, so a customer can read what a run will
cost from what the last one consumed.

## What each desk costs

The Usage page's per-workspace tables are rolled up from the run records,
which is right for step counts and pod seconds and wrong for money over
time: run records are pruned, so a desk's cost history disappears exactly
when it becomes interesting, and a record holds what a run consumed rather
than what it was charged.

So every charge also carries the flow it was, and that charge split across
the agents that did the work — in proportion to what each step actually
consumed, normalised so the shares add up to the charge. The fixed parts of
a bill are spread the same way, which is the ordinary treatment and the only
one where a column of shares equals the invoice.

The Usage page shows both, by week, with the change between the last two
**complete** periods so a partial week never reads as a collapse. Charges
written before attribution existed appear as a remainder rather than being
quietly dropped: a breakdown that does not add up is worse than one that
admits what it cannot place. `GET /api/usage/history?days=` is the same
thing as JSON.

## The Billing section

Money is one subject, and the dashboard treats it as one section under the
avatar, with six tabs:

| tab | what it is |
|---|---|
| **Balance** | the number, large, with how long it lasts in words, thirty days of spend as a sparkline, what is held against runs in flight, and Add credit with the amount that covers a month already chosen |
| **Usage** | what was consumed, from the run records, and what each flow and agent cost by week from the ledger |
| **Statement** | the ledger as a statement: grouped by day, human labels, month-to-date, filters, and a CSV for the month |
| **Invoices** | a receipt for every card payment, hosted by Stripe, and a statement for every month |
| **Payment** | the saved card, the auto top-up rule with defaults derived from the burn, and the billing details every statement is made out to |
| **Spend limits** | the account's cap and each workspace's — over a day, a week or a month — as bars with the warning marks drawn where they fire, editable in place |

The balance also sits in the header of every page, tinted by runway, and a
banner appears across the dashboard when the balance is under a week's cover
or empty, carrying the one button that fixes it. A refused run says why at
the button that was clicked, with a link to add credit when money was the
reason. The old `/dashboard/wallet` address redirects here.

## The wallet

Usage is settled from a credit balance. Add credit by card, once or with
auto top-up; set a low-balance email so the empty wallet is never a
surprise. With billing on, an empty balance refuses *new* runs — runs in
flight finish. Every run is charged exactly once; the ledger is a database
table with that as a constraint, not a promise.

## Plan gates

Two more limits come with the plan rather than the wallet: how many
workspaces an account may create (beyond it, creation refuses with `402`),
and how many runs may execute in parallel (beyond it, runs **wait** — they
are never refused, because a queued run is work that will happen and a
refused one is work that will not).

## On your machine

None of this meters. `budget:` still caps a run and every step's cost is on
its record — the model bill is yours, paid to your provider directly.
