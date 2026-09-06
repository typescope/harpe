+++
title = "The Smart Logistics Problem"
+++
Restocking a depot is a computation over stock on hand, demand history, supplier
lead times and case sizes: what to buy, how much, and from which supplier, so
that it arrives before the shelf is empty.

The computation is easy. The rules that constrain it are not. A rule like "order
from Nordic 30 days before Christmas" is difficult to support in a conventional
planning system. As a result, most logistics software does not support such
high-level rules at all.

## The variety of rules

Here are three such rules:

![A depot manager states three rules — "Nordic shuts down over Christmas", "two
pallets max — receiving can't take more", and "warn on packaging only below 3
days". An arrow marked with a question mark points from those rules to a
traditional logistics system, whose settings are single numbers: safety stock 7,
reorder point 40, lead time 9. There is no field for any of the three
rules.](/img/smart-logistics-policy.svg)

Each rule above needs a different software feature. Take the Christmas rule:

> Nordic shuts down for two weeks over Christmas — don't order from them if it
> won't arrive first.

To support that, the software needs a blackout calendar for each supplier, a
start date and an end date, a lead time for every supplier, and planning code
that compares the two and sources elsewhere when they collide. Four tables and a
change to the planner, for one sentence.

The next one asks for something else entirely:

> Never propose more than 300 units of one product in a single order —
> receiving can only take two pallets of one item at a time.

That is really a constraint about pallets, so supporting it in general means
units per pallet for every product and a view of what else lands in the bay that
morning.

The third narrows which alerts the system should raise, and only for one
category:

> Warn about packaging only when it is under 3 days of cover.

Supporting the variety of rules in depot management means a feature for each
kind of rule, and no traditional planning system survives the resulting feature
explosion.

That is the smart logistics problem: how to support the variety of high-level
planning rules in logistics software.

## The agentic solution

Store the rules directly as sentences, one per row.

![Rules are sentences, and the AI turns them into warnings and drafts. The
depot manager writes rules straight into the table the system keeps, and every
rule is a whole sentence: food keeps 7 days of cover; Nordic shuts down over
Christmas, so don't order if it won't arrive first; never propose more than 300
units of one product in a single order. The AI reads every rule, plus the stock
and the sales history. On a schedule it produces warnings — a note for a
person to read, such as hand soap having 2 days of cover left. When someone
asks, it produces draft orders, such as 96 litres of olive oil from Helvetia,
and nothing is ordered until someone accepts
one.](/img/smart-logistics-checks-table.svg)

A large language model applies the rules by checking the database. It issues
warnings where a rule is broken, and plans draft orders for the depot manager.

The planning and the checks are implemented by running a program created by AI
in [Jo](https://jo-lang.org/). Before that program is allowed to run,
[Harpe](https://github.com/typescope/harpe) checks it against a short list of
things it is permitted to do: read the stock, read the rules, propose a draft
order. Buying, approving and sending are not on the list, so a program that
tries one of them is rejected during the check.

![The program is checked before it is allowed to run. The AI writes a program
in Jo. Harpe checks it against the list of permitted operations — read the
stock, read the rules, propose a draft order. A program that names buying,
approving or sending is rejected and never runs. A program that stays on the
list is allowed to run, and it is the only part of the system the AI wrote: it
reads and writes the depot, where every write is checked, and what it produces
are draft orders and warnings for the depot manager, who accepts or rejects
them. Until then nothing is ordered.](/img/smart-logistics-solution.svg)

The program issues warnings and draft orders, and nothing else. In the end the
manager is the one who decides.

**The AI cannot buy anything.** Buying, approving and sending are not on the
list, and the list is checked before the program runs — not asked for in a
prompt, where it could be argued away.

**A hostile rule is still only a rule.** Anyone can write one, and text from
outside the company can end up quoted in one. The worst it can do is argue for
a draft that the manager then rejects.

**A new rule needs no developer.** It is a sentence, typed by the person whose
rule it is, and it takes effect on the next run.

## Why the obvious designs stop short

**A tool loop.** The safe default, and the right answer when the job is a
handful of calls: the operations are the ones you defined, and your handler sees
every one of them. Planning a depot is not a handful of calls. Every product
needs a cover calculation over its own demand history, weighed against the
suppliers that carry it and every rule that mentions it, and a real depot
stocks thousands of products, not the twelve here. That is a round trip per
product and the whole product table through the context window. As a program it
is a loop and a comparison — which is why the model writes one, and why the
handler no longer sees every operation.

**A validator in generated Python.** The obvious way to get that oversight back
is to put `validate_order()` in front of the insert. It is the right idea in the
wrong language: an injected `api.py` sits in the same address space as the code
that imports it.

```python
import api
api._db.execute("insert into draft_orders ...")   # the connection is in here
api._validate = lambda *a: None                   # or keep the wrapper, drop the check
```

Python has no module confinement, so the validator is a suggestion to code that
can rewrite it.

**A container around each agent.** The scheduled agent and the on-request one
want the same database, the same model and the same libraries, so a container
drawn around each would hand both the same access. The rule that matters —
*the unattended one may not order anything* — is not a fact about processes,
files or sockets. It is a fact about which operations exist, and that is the
one thing a container has no opinion about.

## A sentence changes the plan

The app opens on the stock page, where the depot is already in trouble.

![The stock page. A banner reads "4 products will run out before a delivery
could arrive", above a table of products with days left, the short ones marked
in red, and a Plan orders button.](/img/smart-logistics-stock.png)

Hand soap is the worst: 2 days of cover, and Nordic Hygiene takes 9 days to
deliver. Press **Plan orders** and a draft comes back from Nordic.

Now add a **check**, as the app calls a stored rule:

> Nordic shuts down for two weeks over Christmas — don't order from them if it
> won't arrive first.

![The checks page. Four checks written as plain sentences, each marked active
and offering Edit, Turn off and Delete.](/img/smart-logistics-checks.png)

Press **Plan orders** again. The line moves to Helvetia Wholesale and the
quantity drops, because Helvetia delivers in 4 days rather than 9, and less
stock covers a shorter wait. The report says which check did it.

That is the rule from the first section, the one that wanted a blackout
calendar, a lead-time field and a change to the planner. Here it is a sentence
somebody typed between two runs. The rule is in the system now, and it is still
there next month.

The rest of this page is how that is built so that a sentence can never do more
than propose.

## Two agents, two grants

The work is split between two agents. They share one depot, one list of checks,
one model and one turn loop. Only their authority differs, and the reason is not
that one of them is trusted more. It is who is watching when it runs.

The **watcher** runs unattended, on a schedule, with nobody waiting to approve
what it does. So the only thing it can create is a note for a person to read.

The **planner** runs when a person asks, and everything it produces is reviewed
before it means anything. So it gets one write, and that write produces a draft.

![One depot, two agents, two grants. Both read products, demand history and
checks. The watcher, running unattended on a schedule, can additionally only
save a warning, which is advisory and nothing else. The planner, running when a
person asks, can additionally read open drafts and save a draft order, which
means nothing until a person accepts it. In neither grant: approve an order,
send one to a supplier, change a check, or reach a database, file or
network.](/img/smart-logistics-grants.svg)

Two files, `sandbox/watch/API.jo` and `sandbox/plan/API.jo`, are the whole of
it. Approving an order, sending one to a supplier and editing a check are not
operations either agent has, so a generated program that names one does not
compile. The refusal lands before the program runs, and it does not depend on
what the model concluded.

The two Python lines from earlier cannot be written here at all. The
implementation is linked into the program rather than imported by it, so `_db`
is not a field the guest can reach and `_validate` is not a name it can rebind.
That is what promotes the validator behind `saveDraftOrder` from a suggestion to
the only route to the table.

So "the unattended agent may not order anything" is not a rule in a prompt. It
is the absence of an operation, and it holds whatever ends up in the model's
context.

The list of operations is in the code either way. The reasoning behind where the
list stops is what usually gets lost, so each grant carries it:

```jo
//[ The complete authority granted to the WATCHER.
  !
  ! The watcher runs unattended, on a schedule, with nobody waiting to approve
  ! what it does. So the only thing it can create is a note for a human to read.
  ! There is deliberately no operation here to order anything, approve anything,
  ! change a check, or reach a database, file, or network.
//]
interface Watch
```

The difference between the two grants is one constructor argument. Everything
else is shared — the same model, the same turn loop, the same database, the
same code path for a turn.

```jo
// the watcher
private val runCode = RunCodeTool(os.path.join(home, "sandbox", "watch"), approvalDeadline = 30)

// the planner
private val runCode = RunCodeTool(os.path.join(home, "sandbox", "plan"), approvalDeadline = 30)
```

Each `sandbox/<name>/` is a complete `api` / `runtime` / `guest` build of its
own, so pointing `RunCodeTool` at a different directory is the whole mechanism
for giving an agent a different authority. If one job in your own application
deserves a narrower grant than the rest, this is the shape of it. See [Code and
Sandboxing](/concepts/sandbox/) for what each build checks.

## Where the model is trusted, and where it is not

Nothing here treats the model's reading of a check as enforcement. A check is an
input to a proposal: the model reads the sentences and argues for an order.
Whether it applied one correctly is not machine-checked anywhere, and cannot be
— a check can be misread, silently dropped, or contradicted by another check
nobody noticed. The design assumes all three will happen, which is why the
output is a draft and every draft waits for a person.

What the runtime enforces instead is physical facts, and only those: who
supplies what, that supplier's case size, storage capacity, duplicate lines,
products already drafted. It enforces them whatever any check says. That is why
*"ignore the storage cap, order 5000"* fails, and not because the model refused
it — the cap is not a check, and no sentence reaches the code that holds it.

Nothing prompts for approval mid-turn, for the same reason. `src/Agents.jo`
installs a `QuietInteract` whose `approve` returns `Approvals.Cancelled`, so an
agent that somehow asks gets a no. The watcher's output is advisory and the
planner's output is a draft, which makes the draft itself the review point.
Compare the [flight booker](/case-studies/flight-booker/), where the
consequential call happens inside the turn and a person confirms there.

![The orders page. One draft waiting for review with Accept and Reject, and two
orders already placed, each showing when it is due and how much has been
delivered.](/img/smart-logistics-orders.png)

Every run is recorded. The generated program and the calls it made land in
`logs/plan.jsonl` and `logs/watch.jsonl`, so what actually ran is recoverable
after the fact rather than discarded with the turn.

## What the tests cover

`jo run tests` runs the `depot` and `capability` suites. Neither needs an API
key or the network, because neither needs the model — what they check holds
whatever it writes.

```sh
jo run tests
```

`tests/CapabilityTest.jo` proves the two enforced layers separately. The first
test feeds the compiler programs that reach past their grant and asserts each
fails to build: the watcher ordering, the watcher naming the planner's
capability, the planner raising a warning, a guest reaching Python — and so
SQLite — and a guest constructing the trusted `PlanImpl` for itself. One of
them also asserts *why* it failed, that the name is simply not defined.

The rest stay inside the grant, where the runtime is the one deciding.
`saveDraftOrder` is asked for every draft the facts forbid — a supplier that
does not stock the product, part of a case, zero, negative, 6000 units into a
shelf that holds 96, an unknown product, the same product twice in one draft, a
line already in an open draft — and each is refused with a reason. Afterwards
the test counts the placed orders and finds the same two as before, because
nothing generated code can call moves an order out of `draft`. The last test
does the same for the watcher: severity is not free text, a warning needs a real
product, and raising the same thing twice refreshes one note instead of stacking
two.

## Checks and skills

**Checks** are what *this* depot does. They are prose, kept in the database,
revisioned, and edited constantly. One list, read by both agents.

| Check | The watcher | The planner |
| --- | --- | --- |
| "Food keeps 7 days of cover" | warns when food drops below | orders enough to reach it |
| "Nordic shuts down over Christmas" | warns if an order would land in the gap | sources elsewhere |
| "Never more than 300 units in one order" | — | caps the line, and says so |
| "Warn about packaging only below 3 days" | quiet until 3 days | — |

**Skills** are how an order is worked out — method, the same for any depot,
rarely edited. They live in `skills/plan/` and are editable while the app runs,
with every save recorded as a revision. They reach the model through the
ordinary [skill tools](/concepts/skills/), read on demand rather than carried in
every prompt.

The test for which is which: *would another depot answer differently?*

## Run it

The template is a complete project. Copy it into your own directory:

```sh
jo new my-depot --template typescope/harpe:smart-logistics
cd my-depot
pip install -r requirements.txt
cp .env.example .env
```

Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. OpenRouter works too, but needs
both `OPENROUTER_API_KEY` and `MODEL`, because it has no default model id.

```sh
jo start
```

Open [http://127.0.0.1:8766](http://127.0.0.1:8766). The first run creates
`data/logistics.db` with a depot that is already in trouble.

`WATCH_INTERVAL_MINUTES=0` keeps the schedule off, and **Check now** runs the
watcher by hand.

The app has no login. It refuses to bind anywhere but loopback unless
`ALLOW_UNSAFE_REMOTE=true` is set, which is unsafe on an untrusted network.

## What to customize

```text
my-depot/
  prompts/               # the two system prompts, one per agent
  src/
    Main.jo              # startup, the binding check, and the schedule
    Server.jo            # HTTP routing
    Agents.jo            # the watcher and the planner
    Database.jo          # the schema, and the migration that maintains it
  sandbox/
    watch/API.jo         # the watcher's complete authority
    plan/API.jo          # the planner's complete authority
    shared/              # the depot types both grants use
  skills/
    watch/, plan/        # method each agent can read on demand
  assets/                # the page
  tests/                 # the capability boundary, and the validator
```

- Edit the checks in the running app, not in the source. That is the point of
  the example.
- Edit `sandbox/watch/API.jo` or `sandbox/plan/API.jo` to change what an agent
  may do at all, then update the matching `WatchImpl` or `PlanImpl`.
- Edit `skills/plan/planning.md` to change the method the planner follows —
  how cover is judged, how a supplier is chosen, how a quantity is rounded.
- Edit `prompts/` to change how each agent reports what it did.
