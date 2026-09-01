# Smart Logistics

A local web-based depot planner and a concrete demonstration of REST API surface
narrowing with Jo's capability model. Generated code can inspect logistics data
and create validated drafts, but it has no operation for approving or submitting
orders—and no raw database, filesystem, or network access.

## Run

```sh
pip install -r requirements.txt
cp .env.example .env
# add ANTHROPIC_API_KEY or OPENAI_API_KEY
jo start
```

Open <http://127.0.0.1:8766>. The first run creates `data/logistics.db` with demo
products, demand, rules, and suppliers. `ANALYSIS_INTERVAL_MINUTES=0` keeps the
scheduler off; set a positive value to enable periodic analysis.

The application has no login and is designed for a local administrator machine.
It refuses non-loopback binding unless `ALLOW_UNSAFE_REMOTE=true` is explicitly
set. That override is unsafe on an untrusted network.

## Data model

SQLite, defined in `src/Database.jo` and stored in `data/logistics.db`.

| Table | Holds |
| --- | --- |
| `suppliers` | Supplier name and trading currency. |
| `products` | Item master, reservations and expected arrivals. |
| `product_suppliers` | Terms for one product-supplier pair. |
| `stock_movements` | Every receipt, issue and adjustment. |
| `rules` | Administrator policy, in plain language. |
| `draft_orders`, `draft_order_lines` | Proposed orders awaiting review. |
| `skill_revisions` | Version history of the editable planning skills. |
| `analysis_runs` | One row per analysis, with its report. |

Commercial terms sit on the product-supplier pair rather than on the product,
because the same item is often sourced from several suppliers at different
prices, lead times and pack sizes:

```sql
CREATE TABLE product_suppliers (
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
  lead_time_days   INTEGER NOT NULL DEFAULT 1 CHECK(lead_time_days >= 0),
  case_size        INTEGER NOT NULL DEFAULT 1 CHECK(case_size > 0),
  minimum_order_quantity INTEGER NOT NULL DEFAULT 1 CHECK(minimum_order_quantity > 0),
  preferred INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(product_id, supplier_id),
  CHECK(minimum_order_quantity % case_size = 0)
);
```

The planner defaults to `preferred`; a rule can send it elsewhere, and
`saveDraftOrder` takes the chosen pair's terms and snapshots its price onto the
line.

Stock on hand is never stored. Each shipment out, delivery in and count
correction is a row in `stock_movements`, and the balance is their sum:

```sql
CREATE VIEW product_stock AS
  SELECT p.id AS product_id, COALESCE(SUM(m.quantity), 0) AS on_hand
  FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
  GROUP BY p.id;
```

So every stock figure can be traced to the movements that produced it, and
demand history is the `issue` rows rolled up by day rather than a number
somebody typed. Movements are refused if they would drive stock below zero or
past storage capacity. `reserved` and `incoming` stay columns on `products`:
they are commitments and expectations, not movements.

Rules are text and only text, so nothing machine-checks them: validation covers
physical facts only—sourcing, case size, minimum order quantity, storage
capacity, duplicate lines—and the administrator reviewing each draft is the gate
on policy.

The schema stays deliberately small for a demo: there are no locations, bins, or
units of measure, and nothing tracks cost or valuation beyond the purchase price
on each draft line.
