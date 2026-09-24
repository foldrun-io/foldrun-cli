# The harness

The model decides. The harness decides what that decision may touch, and what
counts as done.

Everything in this page already exists somewhere else in these docs: gates are
in [Flows](flows), budgets in [Budgets](budgets-and-billing), grants in
[Agents](agents). This page is the other way round: not what each field does,
but **what a step needs before it is safe to leave running while you sleep.**

## The five jobs

| job | what it answers | where it lives |
|---|---|---|
| Reach | what may it touch | `tools:`, `secrets:`, the sandbox, the egress boundary |
| Truth | how do we know it worked | `verify:`, `confirm=`, `until:` |
| Cost | what does being wrong cost | `budget:`, `timeout:`, `max:` |
| Consent | who says yes to the irreversible | `4!.`, `ask:`, `preview:` |
| Memory | how do we find out afterwards | the run record, `notify:`, the ledger |

A gap in any one is a different accident. A step with no reach limit does harm.
A step with no truth check **reports success it did not earn**, which is worse,
because nobody comes looking.

## The checklist

Run any step that acts on the outside world through these eight.

**1. Can it only do its job?**
Grant the tools it needs and no more. An agent that must not edit gets `read`,
not `files`. The publisher that posts should not hold the tool that rewrites
what it is posting — on 2026-09-14 a send step edited its own gate file to get
past a guard, and the fix was taking the editing tools away, not asking it
nicely.

**2. Does the runtime know it worked?**
"The tool returned ok" is not evidence. A save can report success and revert.
Use `confirm=` on a browser call that writes, and `verify:` on the step:

```markdown
2. [[publisher]] — post the approved draft
   verify: matches: (^|\n)[#*_>\s]*GOOD\b.*/comments/
```

**3. Does the failure say what to do?**
A check that fails with "exit 1" costs somebody an hour. Write the fix into
the message:

```markdown
   verify: node -e "const fs=require('fs');if(!fs.existsSync('../../storage/unanswered.csv')){console.error('the scan wrote no storage/unanswered.csv, and the next step fans out over it. Fix: run the tool once per office and let it write the file.');process.exit(1)}"
```

**4. Is a retry safe?**
`retry:` is for flakiness — a timeout, a 503, a cold start. It is not for a
refusal. A credential that was rejected will be rejected again, and repeating
a refused write is how a silent 403 becomes a block on your whole address.
When a step can be refused rather than merely fail, say so in the agent: one
`BLOCKED` reply naming the secret to renew, and no second attempt.

**5. Who approves the irreversible?**
`!` or `ask:` on the step that spends money, sends mail or publishes, with
`preview:` pointing at the artefact itself. The gate belongs **where the
irreversible thing happens**, not at the end of the flow: everything before it
should be research that costs cents.

**5b. Does the tool say it is outward?**
Mark it `outward: true` in the tool's frontmatter. `check` then refuses any
step that grants it without a `verify:` or a gate, so the rule on this page
stops being advice.

**6. Is it recorded before it happens?**
Write the ledger row before the call, with the run id and the external id,
`pending` first and the outcome after. A row written afterwards is missing
exactly when you need it: when the call half-succeeded.

**7. Will you hear about it?**
`notify:` with at least `failed`. A desk nobody is told about is a desk that
fails quietly for a week.

**8. What did it cost?**
Every step records its own cost and the run carries the total. Add `budget:`
where you want a ceiling; leave it off where you do not. Unset means no limit,
and the platform invents no default.

## Truth is the one people skip

Reach and consent feel like security, so they get done. Truth feels like
paperwork, so it gets skipped, and it is the one that fails silently.

The pattern to internalise: **a write is not done until something other than
the writer says so.** In a browser that is `confirm=`, which reloads the page
and requires the change to be in what the server returns. For a file it is a
`verify:` that reads the file back. For an outward action it is the ledger row
and the read-back of the external record.

On 2026-09-17 a desk drove Medium for hours. Every fill reported ok, every Save
reported ok, and every value was gone on the next load, because a Cloudflare
challenge had quietly started refusing writes. Nothing in the logs was false.
There was simply nothing in the system that asked the server what it had.

## The harness has to guard itself

Everything above is about an agent's work. The same questions apply to the
platform's own credentials, and they are easier to get wrong because nothing
fails until everything does.

The rule that matters: **a credential is read when it is used, never held from
boot.** The platform's model key is a mounted file, read per step
(`FOLDRUN_MODEL_KEY_FILE`), so a refresh reaches the next step by itself.
Before that it was an environment variable, and since refreshing an OAuth
token revokes the old one, every refresh needed a restart that could not
happen while work was in flight. That is not a scheduling problem to be tuned;
it is a design where the correct behaviour is impossible on a busy day.

If you take one thing from this section: a credential your system cannot
reload without stopping is a credential that will expire at the worst moment,
and the failure will look like something else.

## What this does not cover

The harness constrains an agent; it does not make it correct. A step can pass
every check in this page and still write a bad article, pick the wrong lawyer
or mis-read a rule. That is what [evals](evals) are for, and what a reviewer
step is for. The checklist keeps a wrong answer cheap and visible; it does not
make the answer right.
