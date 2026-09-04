# How to work out an order

- Demand is a trailing average of the issue ledger. Say the number you used.
- Cover what the wait costs: lead-time demand, plus whatever cover the checks
  ask for. `daysOfCover` already counts stock on hand plus what is on order.
- Default to the preferred source. Deviate for a check, or for a lead time the
  cover math cannot absorb — and say which it was.
- A shorter lead time needs a smaller order. When you switch source, expect the
  quantity to change too, and explain that it did.
