+++
title = "Build a Monitoring Agent"
weight = 4
+++
We'll build an **inventory monitor**: every hour it scans the warehouse stock, enforces
a policy written *in plain English by a non-programmer*, emails warnings, and places small
reorders on its own — routing only the large, expensive ones to a human.

```
   ⏰ every hour ──▶ agent
                     │ scans the whole catalogue, applies the policy,
                     │ emails low-stock warnings,
                     │ reorders small POs automatically,
                     │ queues large POs ──▶ buyer approves on their own time
```

This is the same Jo project as the [conversational](@/tutorial/conversational-agent.md) and
[request-driven](@/tutorial/request-driven-agent.md) agents — it just wakes on a **schedule** instead
of a message or a request, and it remembers what it saw last time. Like the request-driven
agent, **no human is in the loop**, so security is the capabilities you grant and oversight
is the audit log. The one twist: a couple of its actions spend real money.

> New to Harpe? Build the [hello-world agent](@/tutorial/_index.md) first, and keep
> [Concepts](@/tutorial/concepts.md) handy for the why.

## Why this needs an agent (not a cron script)

The rules live in a **logistics expert's head, in words, and change constantly** —
"warn when cover drops below 3 weeks given recent velocity; flag perishables near expiry;
reorder under the supplier's lead-time threshold." You can't freeze that into a fixed
program. So the LLM stays in the loop every cycle to *enforce the policy*, using generated
code to crunch data far too large to read directly. That's what makes it an agent.

## The whole thing

The agent's capabilities are its entry-point contract in `sandbox/api`:

```jo
// sandbox/api/src/Entry.jo — what the monitor can do
defer def runTask(): Unit receives inventory, email, reorder
```

Both `inventory` (read-only DB access) and `reorder` (place a PO, capped) are **bespoke
capabilities you write inline** — an interface in `sandbox/api` and an implementation in
`sandbox/runtime`. No `capabilities/` directory, no published packages: for an agent like
this, the api/runtime pair is where its capabilities live. The top-level `jo.toml` points
`main` at Harpe's schedule loop (`Harpe.schedule`) — the trigger — so `jo run` works with no
source files; the interval, the model, and the `OPERATOR` who oversees the agent live in
`.env`. All from the template.

```sh
jo new inventory-monitor --template monitoring
cd inventory-monitor
claude                 # "monitor stock hourly, enforce the policy, email + reorder"
jo run -- --once       # run a single cycle now, to test
```

## Step 1 — Scaffold

```sh
jo new inventory-monitor --template monitoring
cd inventory-monitor
```

You get the usual agent shape — the `jo.toml` agent app, the `sandbox/{api, runtime,
guest}` projects, `AGENT.md`, `skills/`, `.env.example`, `data/`, `logs/` — plus the `CLAUDE.md`
+ `.claude/skills/` that let Claude Code finish it. The steps below are what Claude does, and
what you'd type by hand. (The two capabilities are the one part you author yourself — inline
in `api`/`runtime`.)

## Step 2 — The trigger

A monitoring agent drives its own clock. Point `main` at Harpe's schedule loop in
`jo.toml`, and set the interval in `.env`:

```toml
# jo.toml
[main.links]
"jo.main" = "Harpe.schedule"
```
```sh
# .env
SCHEDULE=1h            # also accepts cron: "0 * * * *"
```

(For event-driven waking — "when a stock-out webhook fires" — point `main` at
`Harpe.watch`. A schedule is the simplest start.)

## Step 3 — Grant capabilities

No human is watching, so the capability set is the whole security story. Three capabilities,
each made safe in a different way:

- **`email`** — an actuator that sends a warning to the buyer. A small capability (interface
  in `api`, impl in `runtime`); it can only send mail to a fixed recipient, so it's safe to
  grant outright.
- **`inventory`** — access to the stock database, granted **read-only**. Its interface has
  no write or delete, so no matter what a turn's code says — or what a malformed policy asks —
  the agent physically cannot mutate stock. Put the interface in `sandbox/api`:

  ```jo
  // sandbox/api/src/Inventory.jo
  namespace InventoryAPI

  class Sku(code: String, onHand: Int, weeklyVelocity: Float, expiresInDays: Int, leadTimeDays: Int)

  interface Inventory
    def allSkus(): List[Sku]                 // the whole catalogue
    def supplierThreshold(code: String): Int
  end

  param inventory: Inventory
  ```

  (The database-backed implementation goes in `sandbox/runtime` — you write that yourself.
  The interface in `api` is the read-only grant.)

- **`reorder`** — drafts and places a purchase order. This **spends money and is
  irreversible**, the one kind of action a type can't fully make safe — so the capability
  asks for approval on the larger orders itself (Step 5).

## Step 4 — Write the policy as a skill

This is the heart of a monitoring policy agent, and it's written by the **domain
expert, in plain English** — no code:

```markdown
<!-- skills/policy.md -->
# Inventory Policy

Each run, evaluate every SKU:

1. **Low cover** — if on-hand ÷ weekly velocity < 3 weeks, email the buyer a warning
   with the SKU, current cover, and suggested order quantity.
2. **Expiring perishables** — if a lot is within 10 days of expiry and still over 60%
   on hand, email the buyer to flag it for markdown.
3. **Reorder** — if on-hand falls below the supplier's lead-time threshold, place a
   reorder for a 6-week supply.

Don't re-warn about the same SKU more than once every 3 days.
```

`AGENT.md` just sets the frame:

```markdown
# Inventory Monitor

You enforce the inventory policy in `skills/policy.md` for the Springfield warehouse,
once an hour. Be precise and quiet — only act when the policy says to.
```

Change the policy? Edit the Markdown. The agent compiles the new rules into code on its
next run. No redeploy, no developer. (Note this *business* policy can never widen the
agent's authority — that's fixed by the granted capabilities, whatever the policy says.)

## Step 5 — Make spending safe without a human in the loop

`inventory` is read-only and `email` can only send a warning to the buyer — both safe to grant outright.
`reorder` spends money, but the agent runs unattended, so there's no one to confirm each PO
in the moment. You don't configure any of that, though — it's the capability's job:

```jo
// sandbox/runtime/src/ReorderImpl.jo — the limit lives in the trusted implementation
class ReorderImpl(limit: Money = Money("5000 USD"))
  ...
  view Reorder
end
```

- The `reorder` capability places orders **up to its `limit`** on its own, and for
  anything larger it **asks for confirmation** (using the framework's confirmation
  service, exactly as the flight-booker's `payment` does).
- The agent has no one in the conversation, so the framework routes that confirmation to
  the agent's **operator** (`OPERATOR=buying@acme.com` in `.env`), who approves on *their*
  schedule. The loop does **not** block — it places what it can, sends the rest for
  approval, and carries on.

So routine restocking runs unattended; only the rare, expensive order involves a person, and
even then asynchronously. You set the capability's `limit` and the `OPERATOR` — nothing
about confirmation itself. The primary oversight for everything else is the **audit log**
(Step 7).

## Step 6 — Test a single cycle

`-- --once` passes a one-shot flag to the runtime, so it runs exactly one tick right now
instead of waiting an hour:

```sh
jo run -- --once
```

```
inventory-monitor ▸ cycle @ 14:00

  scanned 2,418 SKUs
  ✓ emailed buyer: 3 low-cover warnings (SKU-1187, SKU-2031, SKU-9920)
  ✓ emailed buyer: 1 expiry flag (SKU-4456)
  ✓ reordered SKU-1187 ($2,310) and SKU-9920 ($980) — under the $5,000 ceiling
  ↗ queued reorder SKU-2031 ($8,400) for buying@acme.com — over the ceiling
```

The agent wrote a program that scanned the catalogue, applied your English policy, and
acted — all within the authority you granted:

```jo
def runTask(): Unit receives inventory, email, reorder, skills =
  val policy = skills.read("policy")
  val skus   = inventory.allSkus()                      // read-only
  val low    = skus.filter(s => s.onHand.toFloat / s.weeklyVelocity < 3.0)
  for s in low do email.send(buyer, warn(s))            // actuator: a real email
  val toOrder = skus.filter(s => s.onHand < inventory.supplierThreshold(s.code))
  for s in toOrder do reorder.place(s.code, weeks = 6)  // ≤ $5k auto; > $5k queued
```

Even if the policy were mistaken, `inventory` couldn't delete a thing and `reorder`
couldn't auto-spend past $5,000 — the types bound it.

## Step 7 — Oversight: the audit log

Unattended agents are watched **after the fact**, not in the moment. Every warning, every
PO (placed or queued), and every approval decision is written to the audit log under
`logs/` for review.

The buyer skims the morning's activity, and reverses anything off (a reorder can be
cancelled, a markdown un-flagged). Match the oversight to the stakes: reversible actions
run freely and are reviewed in the log; the irreversible-and-large ones were queued for a
human up front.

## Step 8 — Go live

Run the same project on a host where it can stay up (`jo run` under the `schedule` trigger,
kept alive by your process manager — drop the `-- --once` so it loops). The agent now runs
every hour on its own, remembering across cycles (so it honours "don't re-warn within 3
days"). That memory is the **world-state** the runtime persists under `data/` between runs;
the schedule and the persistence are handled for you.

## How it works

Same engine as every Harpe agent — the model's only tool is **write a Jo program** — with
two things this monitoring workflow needs: it **runs itself** on a schedule, and it
**remembers** what it has seen between runs. Security is unchanged and needs no human in
the loop: the agent's authority is exactly the capabilities you granted, proven by the
compiler. `inventory` can only read; `reorder` can only auto-spend within a typed ceiling
and queues the rest. Everything else is caught in the audit log.
See [how a turn works](@/tutorial/concepts.md#how-a-turn-works) for the full picture.

## Next steps

- [Create a custom capability](@/tutorial/create-custom-capabilities.md) — build the `inventory` and `reorder` runtimes.
- [Conversational](@/tutorial/conversational-agent.md) · [Request-driven](@/tutorial/request-driven-agent.md) — the other two kinds.
- [Concepts](@/tutorial/concepts.md) — the model underneath all three.
