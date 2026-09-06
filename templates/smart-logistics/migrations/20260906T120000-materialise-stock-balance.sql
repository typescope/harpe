-- Stock on hand becomes a stored total instead of a sum over the whole ledger.
--
-- It was `SUM(quantity)` over every movement ever recorded, grouped by product,
-- behind the `product_stock` view. Correct, and unbounded: the ledger only grows,
-- and every page load re-summed it from the first movement. `products.on_hand`
-- now holds the total, and a trigger adds each new movement to it.
--
-- The ledger is still the record of truth. This column is a cache of its sum, and
-- `Stock.reconcile` recomputes it to prove the two agree.
--
-- The trigger itself is not created here. `Schema` declares it and runs first, so
-- a database arriving at this migration already has it — which is also why the
-- backfill below is written to be correct either way: it SETS the total rather
-- than adding to it, so it lands on the right number whether or not anything has
-- been inserted since.

BEGIN IMMEDIATE;

ALTER TABLE products
  ADD COLUMN on_hand INTEGER NOT NULL DEFAULT 0;

UPDATE products SET on_hand = (
  SELECT COALESCE(SUM(quantity), 0)
  FROM stock_movements
  WHERE stock_movements.product_id = products.id
);

COMMIT;
