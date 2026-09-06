# Smart Logistics

A local depot planner, and a demonstration of what happens when you let people
write policy as sentences instead of filling in threshold fields.

![The stock page: a banner reading "4 products will run out before a delivery
could arrive", above a table of products sorted by days of cover, the short ones
marked in red.](docs/stock.png)

Two agents share one depot and one list of checks. Neither can buy anything.

```
interface Watch                     interface Plan
  products()                          products()
  demandHistory(id, days)             demandHistory(id, days)
  checks()                            checks()
  saveWarning(...)                    saveDraftOrder(...)
```

The **watcher** runs unattended on a schedule, so the only thing it can create
is a note for a person to read. The **planner** runs when a person asks and
everything it produces is reviewed by a person, so it gets one write, and that
write produces a draft. Neither can approve an order, send one to a supplier,
change a check, or reach a database, file, or network — those are not operations
they have. `sandbox/watch/API.jo` and `sandbox/plan/API.jo` are the whole of it.

## Run

```sh
pip install -r requirements.txt
cp .env.example .env
# add ANTHROPIC_API_KEY or OPENAI_API_KEY
jo start
```

OpenRouter works too, but needs both `OPENROUTER_API_KEY` and `MODEL` — it
has no default model id. A key alone stops with
`Error: MODEL is required when OPENROUTER_API_KEY is set.`

Open <http://127.0.0.1:8766>. The first run creates `data/logistics.db` with a
depot that is already in trouble.

`WATCH_INTERVAL_MINUTES=0` keeps the schedule off; **Check now** runs the
watcher by hand. The app has no login, and refuses to bind anywhere but loopback
unless `ALLOW_UNSAFE_REMOTE=true` is set — which is unsafe on an untrusted
network.

## What to try

The page opens on the problem, in plain words:

> **4 products will run out before a delivery could arrive.**

Hand soap is the worst: 2 days of cover, and Nordic Hygiene takes 9 days to
deliver. Press **Plan orders** and you get a draft from Nordic.

Now go to **Checks** and add a sentence:

> Nordic shuts down for two weeks over Christmas — don't order from them if it
> won't arrive first.

![The checks page: four checks written as plain sentences, each with Edit, Turn
off and Delete.](docs/checks.png)

Press **Plan orders** again. The line moves to Helvetia Wholesale, and the
quantity drops, because Helvetia delivers in 4 days rather than 9 and less stock
is needed to cover a shorter wait. The report says which check did it.

That check is not a field in any planning system. No schema change, no code, no
redeploy — a sentence changed the plan.

Accept the draft and the shortfall is covered; the next check clears the
warning. The order moves to **On order** with the date it is due.

![The orders page: one draft waiting for review, and two orders on order, each
showing when it is due and how much of it has been delivered.](docs/orders.png)

When the delivery turns up, **Record delivery** counts it in. Every line still
owed is offered, filled in with what is owed, because a delivery that matches
the order should need no typing at all — and a short one leaves the rest on
order until it follows.

![The delivery form open on an order: a box holding 25 against a line owing 40,
a note reading "DN-88213, one carton short", and a Book into stock
button.](docs/receiving.png)

Booking that in writes an ordinary receipt movement, so **Movements** shows
where the stock came from and cover moves because the ledger moved.

## Checks and skills

**Checks** are what this depot does — prose, in the database, revisioned, edited
constantly. One list, read by both agents:

> The watcher checks today's stock. The planner proposes orders that pass the checks.

| Check | The watcher | The planner |
| --- | --- | --- |
| "Food keeps 7 days of cover" | warns when food drops below | orders enough to reach it |
| "Nordic shuts down over Christmas" | warns if an order would land in the gap | sources elsewhere |
| "Never more than 300 units in one order" | — | caps the line, and says so |
| "Warn about packaging only below 3 days" | quiet until 3 days | — |

**Skills** are how to work an order out — method, the same for any depot, rarely
edited. They live in `skills/plan/` and are editable while the app runs, with
every save recorded as a revision.

The test for which is which: *would another depot answer differently?*

## What is checked, and by whom

A check is real, but a **model** applies it and a **human** confirms it.

The runtime enforces physical facts only — who supplies what, that supplier's
case size, storage capacity, duplicate lines, products already drafted — and it
enforces those no matter what any check says. Nothing machine-checks the prose,
which is why every draft goes to a person.

`tests/` proves both halves without an API key: guest programs that reach past
their capability fail to compile, and the runtime refuses every draft the
physical facts forbid.

```sh
jo run tests
```

## Data model

SQLite, in `src/db/`. `Schema.jo` declares every table and creates whatever is
missing, which builds an empty database outright. Changing a table that already
has rows in it is what `CREATE TABLE IF NOT EXISTS` cannot do, so each such
change is a file in `migrations/` that `Migrations.jo` applies once and records
in `schema_migrations`. A schema change is therefore two edits — the new shape
in `Schema.jo`, and the step to it in `migrations/`. See
[`migrations/README.md`](migrations/README.md).

| Table | Holds |
| --- | --- |
| `suppliers`, `products` | The item master, and who sells it. |
| `product_suppliers` | Price, lead time and case size, per pair. |
| `stock_movements` | Every receipt, issue and adjustment. |
| `checks` | What the administrator wrote. |
| `warnings` | What the watcher is currently saying. |
| `draft_orders`, `draft_order_lines` | Orders, from proposal to delivered. |
| `order_receipts` | Each delivery, and the ledger row it produced. |
| `runs`, `skill_revisions` | What each agent did, and how the method changed. |

Stock on hand is never stored. Every movement in or out is a row, and the
balance is their sum, so any figure traces to what produced it:

```sql
CREATE VIEW product_stock AS
  SELECT p.id AS product_id, COALESCE(SUM(m.quantity),0) AS on_hand
  FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
  GROUP BY p.id;
```

One number decides whether a product is in trouble — how long what we have plus
what is on order will last at the current rate of sale — and `product_position`
derives it once, so the watcher, the planner and the page can never disagree
about it. The arithmetic is SQL; the judgment is the model's.

Commercial terms sit on the product-supplier pair rather than on the product,
because the same item is often sourced from several suppliers at different
prices, lead times and pack sizes. That is what gives a written sourcing check
something to decide.

An order has a life: `draft`, then `ordered` or `rejected` by a person, then
`part_received` and `received` as deliveries arrive, or `cancelled` if they
never will. Only a delivery moves it along that second half — there is no button
that declares stock received without stock arriving.

What is on order is what was ordered and has **not** yet arrived:

```sql
SUM(l.quantity - l.received_quantity)  -- over 'ordered' and 'part_received'
```

That subtraction is the whole point. A delivered unit is in the ledger, in
`on_hand`; leaving it on order as well would count it twice and cover would
climb away from the truth with every delivery. Receiving writes an ordinary
`receipt` movement, past the same guards as one keyed in by hand, and keeps the
`movement_id` — so a figure on the page traces to the delivery that produced it.

A supplier really can send more than was ordered, but not against the line: that
subtraction would go negative. The excess is stock that arrived against no line,
and belongs in the ledger as its own receipt.

The schema stays deliberately small: no locations, no bins, no units of measure,
no lot or expiry tracking, and nothing tracks cost beyond the purchase price on
a line. There is still no supplier the order is actually sent to — accepting one
records the decision, and a person carries it to the supplier.

## Layout

- `prompts/` — the two system prompts, one per agent
- `src/` — the server, the database, and both agents
- `sandbox/watch/`, `sandbox/plan/` — one capability each, sharing `sandbox/shared/`
- `skills/watch/`, `skills/plan/` — reference each agent can read
- `assets/` — the page
- `tests/` — the boundary, and the validator
