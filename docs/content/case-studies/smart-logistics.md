+++
title = "The Smart Logistics Problem"
+++

Restocking a depot necessitates computing over stock on hand, demand history,
supplier lead times and case sizes. It tells what to buy, and from which
supplier — all to ensure it arrives before the shelves are empty.

The computing part is easy — the rules that constrain it are not. A rule such as
"order from Nordic 30 days before Christmas" is difficult to support in a
conventional planning system. As a result, most logistical software doesn't
support such high-level rules.

## The variety of rules

Here are three rules that arise in managing a depot:

![A depot manager states three rules — "Nordic shuts down over Christmas", "two
pallets max — receiving can't take more", and "warn on packaging only below 3
days". An arrow marked with a question mark points from those rules to a
traditional logistical system, whose settings are single numbers: safety stock 7,
reorder point 40, lead time 9. There is no field for any of the three
rules.](/img/smart-logistics-policy.svg)

Each rule above requires a different software feature. Look at the Christmas rule:

> Nordic shuts down for two weeks over Christmas — don't order from them if it
> won't arrive first.

To support that, the software needs a blackout database table and update the
algorithm to take holiday shutdown into consideration.

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
planning rules in logistical software.

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

The agent applies the rules by checking the database. It issues
warnings where a rule is broken, and plans draft orders for the depot manager.

The planning and the checks are performed by running a program created by LLM
in [Jo](https://jo-lang.org/). Before that program is allowed to run,
[Harpe](https://github.com/typescope/harpe) checks it against a short list of
things it is permitted to do: read the stock, read the rules, propose a draft
order. Buying, approving and sending are not included in the list, so a program that
tries one of them is rejected during the check.

![The program is checked before it is allowed to run. The AI writes a program
in Jo. Harpe checks it against the list of permitted operations — read the
stock, read the rules, propose a draft order. A program that names buying,
approving or sending is rejected and never runs. A program that stays on the
list is allowed to run, and it is the only part of the system the AI wrote: it
reads and writes the depot, where every write is checked, and what it produces
are draft orders and warnings for the depot manager, who accepts or rejects
them. Until then nothing is ordered.](/img/smart-logistics-solution.svg)

The program only issues warnings and draft orders, and nothing else. In the end,
the manager is the one who decides.

### What it guarantees

**The agent cannot buy anything.** Buying, approving and sending are not in the
list.

**Security risk is under control.** Even under prompt injection attacks, the worst can happen is a
problematic draft order that the manager can refuse.

**A new rule does not need any development effort.** It is a sentence, typed by the person whose
rule it is, and it takes effect on the next run.

### The alternatives

**Give the agent a set of tools instead.** A depot holds tens of thousands of
products, and each one needs a calculation. Sending the data to the model
saturates the context window, burns tokens and runs up the bill, and the answers
get worse as it fills.

**Let agent write Python code, run it in a container.** A container decides which files
and sockets a process gets, while the rule that matters — *the unattended
agent may not order anything* — is about business logic. Inside the
container, the generated Python program still has permission to delete every
row in the database.

## The Agentic Planner

The prototype is a complete app — a depot database, a web UI, and two agents
built with [Harpe](https://github.com/typescope/harpe) on
[Jo](https://jo-lang.org/).

The home page shows an overview of the stock:

![The stock page. A banner reads "4 products will run out before a delivery
could arrive", above a table of products with days left, the short ones marked
in red, and a Plan orders button.](/img/smart-logistics-stock.png)

The checks page allows adding a rule as a sentence:

![The checks page. Four checks written as plain sentences, each marked active
and offering Edit, Turn off and Delete.](/img/smart-logistics-checks.png)

Drafts wait on the orders page. Accept places the order, Reject drops it, and
nothing an agent can call moves a draft out of that state.

![The orders page. One draft waiting for review with Accept and Reject, and two
orders already placed, each showing when it is due and how much has been
delivered.](/img/smart-logistics-orders.png)

The two agents have a page of their own, with the history of what they have
run:

![The agents page. A Planner card — runs only when you ask, everything it
produces is reviewed by a person, so its one write is a draft order — above a
Watcher card that runs on a schedule and can only write a warning for a person
to read. Below them a run history listing the last planner run, the last
watcher run, and an earlier planner run that
failed.](/img/smart-logistics-agents.png)

They are not given the same authority, because they do not run at the same
time. The watcher runs unattended, and the only thing it can do is produce
warnings. The planner has to be triggered by hand, and it may only create draft
orders for the manager to approve.

![One depot, two agents, two grants. Both read products, demand history and
checks. The watcher, running unattended on a schedule, can additionally only
save warnings, which are advisory and nothing else. The planner, running when a
person asks, can additionally read open drafts and save draft orders, which
wait for approval. In neither grant: approve an order, send one to a supplier,
change a check, or reach a database, file or
network.](/img/smart-logistics-grants.svg)

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
    agents/
      Watcher.jo         # the unattended agent
      Planner.jo         # the on-demand agent
      Turn.jo            # what the two share: one turn, and no approvals
    db/
      DB.jo              # the connection, as a context parameter
      Schema.jo          # every table, at the shape this build expects
      Migrations.jo      # applies migrations/*.sql to an existing database
      Seed.jo            # the demo depot, and the only file you can delete
      Stock.jo           # products, suppliers, and the ledger
      Orders.jo          # drafts, placing, and receiving
      Checks.jo          # what was written, and what the watcher says
      Runs.jo            # what each agent did
      Skills.jo          # the planner's method, and its revisions
  sandbox/
    watch/API.jo         # the watcher's complete authority
    plan/API.jo          # the planner's complete authority
    shared/              # the depot types both grants use
  skills/
    watch/, plan/        # method each agent can read on demand
  migrations/            # one .sql file per change to a live database
  assets/                # the page
  tests/                 # the capability boundary, and the validator (jo run tests)
```

- Edit the checks in the running app, not in the source. That is the point of
  the example.
- Edit `sandbox/watch/API.jo` or `sandbox/plan/API.jo` to change what an agent
  may do at all, then update the matching `WatchImpl` or `PlanImpl`.
- Edit `skills/plan/planning.md` to change the method the planner follows —
  how cover is judged, how a supplier is chosen, how a quantity is rounded.
- Edit `prompts/` to change how each agent reports what it did.
