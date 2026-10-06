# Budgets and billing

Money on this platform is a cap at three levels and a meter underneath. The
caps are yours to set and the thing to set first: an agent with a tool loop
and no ceiling can spend in an hour what a month was meant to.

## Four caps

| level | where | what it does when reached |
|---|---|---|
| **an agent, per run** | `budget: 2` in the agent's `agent.md` | the most that agent may spend in one run, across every step it takes in it — its step stops itself mid-turn at what is left, and a later step of its own in the same run is refused before it starts. Its steps running at once share what is left, as a group shares the run's: the copies of a fan-out split the cap, they are not each handed the whole of it |
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
A step counts as BYOK when it ran on a key of the account's own (Settings →
Model, or a `provider:` block); the run page says which credential each step
used. On a hosted platform every customer account brings one
([providers](providers.md#your-accounts-own-model-key)).

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
avatar, with eight tabs:

| tab | what it is |
|---|---|
| **Balance** | the number, large, with how long it lasts in words, thirty days of spend as a sparkline, what is held against runs in flight, and Add credit with the amount that covers a month already chosen |
| **Plan** | the plan you are on, this cycle's credits and when they reset, and the plans you could move to |
| **Usage** | what was consumed, from the run records, and what each flow and agent cost by week from the ledger |
| **Statement** | the ledger as a statement: grouped by day, human labels, month-to-date, filters, and a CSV for the month |
| **Invoices** | a tax invoice for every card payment — the plan's fee and each top-up — hosted by Stripe, and a statement for every month |
| **Payment** | the saved card and the auto top-up rule, with defaults derived from the burn |
| **Details** | who the invoices are made out to: legal name, ABN, address and the invoice email |
| **Spend limits** | the account's cap and each workspace's — over a day, a week or a month — as bars with the warning marks drawn where they fire, editable in place |

The balance also sits in the header of every page, tinted by runway, and a
banner appears across the dashboard when the balance is under a week's cover
or empty, carrying the one button that fixes it. A refused run says why at
the button that was clicked, with a link to add credit when money was the
reason. The old `/dashboard/wallet` address redirects here.

Adding credit is the owner's to do. Anyone else sees why the button is not
there, and who to ask, rather than a button that fails.

**Tax invoices.** Every payment is invoiced to the account's one Stripe
customer, made on the first payment and carrying what Details holds — the
legal name, the invoice email, the address, and the ABN as the customer's
tax id (checked against the ABN rule before it is kept). A top-up's
checkout asks Stripe for a numbered invoice, not just a receipt, so a
business can claim the GST on credits as well as on the plan. With
`STRIPE_TAX=1` (Stripe Tax enabled on the Stripe account), checkout works
the tax out from the address, collects the address and a tax id if they
are missing, and writes them back to the customer. Saving Details updates
the customer at Stripe at once; without Stripe, or when Stripe refuses,
they are kept and sent with the next save or payment.

**Manage in Stripe.** The Payment, Plan, Invoices and Details tabs carry a
button into Stripe's Billing Portal — the card, every invoice as a PDF, the
plan — for the owner. Its look and what it allows (cancelling, switching
plan) are set once at Stripe, under Settings → Billing → Customer portal.

**When a plan payment fails.** Stripe retries the card on its own
schedule. On the first failure of an invoice the owner is emailed once —
the amount, Stripe's page to pay that invoice, and the way to update the
card — and a grace period starts (`FOLDRUN_DUNNING_GRACE_DAYS`, default 7).
Runs go on meanwhile, and an amber banner across the dashboard says until
when. If the invoice is still unpaid when the grace ends, the hourly sweep
suspends the account for new runs with the reason **payment overdue**, and
one more email says so; the banner turns red. Runs in flight finish, people
can still sign in, nothing is deleted. The moment `invoice.paid` arrives
for it — or `invoice.voided`, `invoice.marked_uncollectible`, or Stripe
cancelling the subscription — the suspension is lifted, and a payment
gets a thank-you email. Every step is once per invoice, however often
Stripe retries or redelivers; a second invoice failing during the grace
does not restart it. Dunning lifts only a suspension it placed: an account
the super admin suspended for another reason stays suspended. The super
admin sees where it stands on the customer's overview.

**Your data, and leaving.** Settings → Your data gives the owner one JSON
file with the account's workspaces, members, an index of every run and the
whole ledger (`GET /api/account/export`). The same place holds **Close
account**: type the account's name and it is suspended at once — no new
runs, schedules stop firing — while the platform team settles the last
invoice and any refund. Nothing is deleted by the request itself; people can
still sign in and take the copy.

## The admin console's money levers

Each customer (account) in the super admin console has a Billing tab with
every lever that changes what the customer pays, each behind a confirmation
that names the amount and the account: **credit or debit** with a reason on
the ledger (the console sends an idempotency key, so a double click is one
line), **extend the trial** (more trial credits as a grant, with whatever
trial credit is left carried into it; not for an account on a plan), the
**plan** (grant a cycle by hand, end it, and the lane and limits that ride
with it), **going into minus**, and **charges this account does not pay**.
The overview beside it holds the contact on record (name, email, phone,
company, ABN), notes, suspension, and the customer's Stripe customer and
subscription with links into Stripe's own dashboard — test or live, read
from the install's key.

Revenue has a CSV per month for the accountant (`GET /api/admin/export`):
one row per customer and a total, charges by leg, fees, top-ups, grants,
expiries, refunds, disputes, adjustments and net, with Stripe's own figures
for the month beside them when Stripe is connected.

## The wallet

Usage is settled from a credit balance. Add credit by card, once or with
auto top-up; set a low-balance email so the empty wallet is never a
surprise. With billing on, an empty balance refuses *new* runs — runs in
flight finish. Every run is charged exactly once; the ledger is a database
table with that as a constraint, not a promise.

## How the money is kept straight

The bookkeeping rules behind the numbers, for whoever has to answer "why is
my balance this".

**One grant per plan cycle.** A cycle is the subscription, the plan and the
end of the period it pays for, and that is the grant's key. Stripe tells us
about a paid cycle several ways — the checkout returning, the checkout
webhook, `invoice.paid`, `customer.subscription.updated` — and in no fixed
order; whichever arrives first grants and the rest find it done. A plan
change inside a period is a new cycle on the new plan (the prorated invoice
and the updated event are the same cycle, one grant); a renewal is a new
period. A change inside a period grants the new plan's bundle **pro-rated
by the share of the period left**, the way Stripe prorates the charge; a
renewal grants it whole. Going back to a plan already granted this period
switches the plan and its gates back but grants nothing again. Downgrades
still lose the carry.

**The low-balance guard runs every hour**, and right after a run whose
charge takes the balance across the warning line. Per crossing of the line
it makes at most **one** auto top-up attempt and sends at most **one**
email; a declined card is not retried every hour — the email goes instead —
and both re-arm once the balance is back above the line.

**Tax.** A top-up credits the price before tax: with Stripe Tax on, the
Checkout price is tax-inclusive, so a $50 top-up costs $50 and credits $50.
An auto top-up is a bare charge with no Stripe Tax and no tax invoice.

**Refunds.** A refunded top-up takes off the credits it added — the charge's
own amount caps it, scaled to the pre-tax share when the charge carried tax — and the balance is **not** floored at zero: credit
refunded after it was spent leaves the account in the red, and admission
refuses the next run until it is topped up. A refunded plan fee does not
touch the wallet: the credits it bought were a grant, and they end with the
cycle.

**Chargebacks.** The disputed amount comes off when the dispute opens (the
card network already has the money). The account is found through the
disputed charge — its metadata, its payment's, then the saved customer. Won
(or an inquiry closed without a chargeback): the same amount goes back on,
once. Lost: it stays off. As with refunds, a dispute on a plan fee does not
touch the wallet; it is logged and left to the super admin.

**Every line says why it exists.** Each ledger line carries a reason —
usage, pod, fee, checkout, auto-topup, manual, operator, refund, dispute,
dispute-won, plan, trial, grant-expired, credits-expired — and lines written
before the field have theirs derived from their key and note. Statements
label lines by it. **Burn**, the 30-day spend and month-to-date count usage
and the daily fees only — not expiries, refunds, chargebacks or an
operator's debit. The admin console's **charged** figure is usage (runs and
account pod sessions) in the customer list and the money report alike;
**paid in** is top-ups paid plus plan fees from the invoices Stripe said
were paid; **held in wallets** is credit bought and unspent — granted
credit is shown apart, because nobody paid for it by the dollar.

**Hand-placed plans renew.** A plan the super admin grants runs a month and
is renewed by the hourly sweep at its period's end, with the same grant and
rollover rules. Granting a plan to an account Stripe is billing is refused
(end it first, or change it at Stripe); ending a Stripe-billed plan cancels
the subscription at Stripe first, at once, and changes nothing if Stripe
refuses.

**An operator's credit or debit is written once** per idempotency key the
console sends, and audited once.

**Stripe.** Every call pins its API version (`2025-03-31.basil`;
`STRIPE_API_VERSION` overrides) — create the webhook endpoint on the same
version — and charges in `FOLDRUN_CURRENCY` (default `usd`), which is also
the unit of every balance. Set the currency before any money is on the
books; Stripe will not mix currencies on one customer. The webhook endpoint
is `<public url>/api/billing/stripe`, sending exactly:

| event | what it does |
|---|---|
| `checkout.session.completed` | a top-up credited, or a plan's first cycle granted |
| `invoice.paid` | a plan cycle granted: signup, renewal, or a change; an overdue invoice settled |
| `invoice.payment_failed` | the plan goes past due; dunning starts |
| `invoice.voided` | an overdue invoice cancelled; dunning ends |
| `invoice.marked_uncollectible` | an overdue invoice written off; dunning ends |
| `customer.subscription.updated` | a plan swap, or a status change |
| `customer.subscription.deleted` | the plan it paid for ends; its dunning ends |
| `payment_intent.succeeded` | an auto top-up credited |
| `payment_intent.payment_failed` | an auto top-up refused; the warning goes |
| `charge.refunded` | a refunded top-up's credits come off |
| `charge.dispute.created` | a chargeback's amount comes off |
| `charge.dispute.closed` | won: it goes back on; lost: it stays off |

Every delivery is logged — the event, the account, what was done or the
error, and a hash of the payload (never the payload, which carries names
and addresses). The super admin lists the log at `GET
/api/admin/stripe-events` and replays one event with `POST
/api/admin/stripe-events/<id>/replay`, which re-fetches it from Stripe and
runs it through the same handler; every write it makes is keyed once, so a
replay of an event that was handled changes nothing.

## Plan gates

Two more limits come with the plan rather than the wallet: how many
workspaces an account may create (beyond it, creation refuses with `402`),
and how many runs may execute in parallel (beyond it, runs **wait** — they
are never refused, because a queued run is work that will happen and a
refused one is work that will not).

## On your machine

None of this meters. `budget:` still caps a run and every step's cost is on
its record — the model bill is yours, paid to your provider directly.
