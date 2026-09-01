# Depot planning guidance

- Prefer transparent trailing-average demand over an unexplained forecast.
- Treat `onHand - reserved + incoming` as the projected available quantity, and
  check `incomingEta` before counting a shipment as cover for the near term.
- Target lead-time demand plus the cover the rules ask for. Where several rules
  could apply to one product, the most specific one wins; say which you used.
- Round upward to a complete case and honor the minimum order quantity of the
  source you picked; both differ between suppliers of the same product.
- Default to the preferred source. Deviate for a written rule, a lead time the
  cover math cannot absorb, or a supplier that cannot be used — and say so.
- Never propose more than remaining storage capacity.
- Existing open drafts already cover demand; do not duplicate them.
- Explain unusual demand, capacity constraints, and every skipped proposal.
