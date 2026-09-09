+++
title = "Usage and Billing"
+++
The [logging framework](/concepts/logging/) is designed to be able to carry
business data, not only diagnostics — a [data
bus](/guides/data-bus-and-contracts/) for anything an application needs to
communicate and persist. Billing is made possible by the logging framework: every model call
writes a `harpe.metering.usage` record, and contextual logging says whose call it
was.

To enable billing, simply create a decorator logger to extract usage logging
items:

```jo
class UsageMeter(inner: Logger, meter: Meter)
  view Logger

  def logEntry(entry: Entry): Unit =
    meter.record(entry)      // update per-session counters / push to a metrics service
    inner.logEntry(entry)    // and still persist

  def close(): Unit = inner.close()
end
```

Inside the meter, the usage data is reconstructed from the logging item, and
`entry.context` carries the user information the outer scope stamped on it:

```jo
if entry.event == Usage.event then
  val usage = Usage.decode(entry)
  val user = User.fromContext(entry.context)
  cents = cents + rate(usage.provider, usage.model).charge(usage)
  // insert into billing database
```

The same decode works offline over a stored journal, so a live meter and an
end-of-month invoice read the identical record.

## See also

- [Logging](/concepts/logging/) — the event stream and the `Usage` contract
- [Prompt Caching](/guides/prompt-caching/) — what the cache fields mean for a
  price table
