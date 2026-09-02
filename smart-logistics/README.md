# Smart Logistics

A local depot planner, and a demonstration of what happens when you let people
write policy as sentences instead of filling in threshold fields.

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

Press **Plan orders** again. The line moves to Helvetia Wholesale, and the
quantity drops, because Helvetia delivers in 4 days rather than 9 and less stock
is needed to cover a shorter wait. The report says which check did it.

That check is not a field in any planning system. No schema change, no code, no
redeploy — a sentence changed the plan.

Accept the draft and the shortfall is covered; the next check clears the
warning.

## Checks and skills

**Checks** are what this depot does — prose, in the database, revisioned, edited
constantly. One list, read by both agents:

> The watcher checks today's stock. The planner proposes orders that pass the checks.

| Check | The watcher | The planner |
| --- | --- | --- |
| "Food keeps 7 days of cover" | warns when food drops below | orders enough to reach it |
| "Nordic shuts down over Christmas" | warns if an order would land in the gap | sources elsewhere |
| "Never more than 300 units in one order" | — | caps the line, and says so |
| "Don't warn about packaging above 3 days" | stays quiet | — |

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

SQLite, defined in `src/Database.jo`.

| Table | Holds |
| --- | --- |
| `suppliers`, `products` | The item master, and who sells it. |
| `product_suppliers` | Price, lead time and case size, per pair. |
| `stock_movements` | Every receipt, issue and adjustment. |
| `checks` | What the administrator wrote. |
| `warnings` | What the watcher is currently saying. |
| `draft_orders`, `draft_order_lines` | Proposals awaiting review. |
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

The schema stays deliberately small: no locations, no bins, no units of measure,
and nothing tracks cost beyond the purchase price on a draft line. Accepting an
order means "on order" and the demo stops there — receiving goods into stock is
out of scope.

## Layout

- `prompts/` — the two system prompts, one per agent
- `src/` — the server, the database, and both agents
- `sandbox/watch/`, `sandbox/plan/` — one capability each, sharing `sandbox/shared/`
- `skills/watch/`, `skills/plan/` — reference each agent can read
- `assets/` — the page
- `tests/` — the boundary, and the validator
