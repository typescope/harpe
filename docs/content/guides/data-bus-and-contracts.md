+++
title = "Data Bus and Contracts"
+++
The [logging framework](/concepts/logging/) is designed to be able to serve as a
data bus to carry business data, which enables an elegant solution to
[billing](/guides/usage-and-billing/).

However, unlike diagnostic data, business data demands a much higher standard for
clarity, reliability and stability of the protocol. The malleability of the
logging format fails to meet the requirements.

## Where the open format falls short

- **Documentation.** The field list lives in whichever call site last emitted it.
  A consumer learns the shape by reading a producer, or by reading a sample record
  and hoping it was typical.
- **Contract.** Renaming a field is not a compile error. The producer changes, the
  consumer goes on asking for a key nobody writes, and gets a default back instead
  of a failure.
- **Versioning.** A log outlives the code that wrote it. Nothing on a record says
  which shape it was written in, so nothing downstream can decide what to do with
  an old one.

## Explicit contracts

The best practice is to define a class for the domain data, and one module that
owns the event name, the encoder, and the decoder:

```jo
class SearchCall(vendor: String, queries: Int, vendorCost: Int)

section SearchLog
  def searchedEvent: String = "myagent.tools.search"

  def searched(call: SearchCall): Unit receives logger =
    logger.logFields(searchedEvent, encode(call))

  def encode(call: SearchCall): Map[String, Value] =
    Map:
      "vendor"     ~ call.vendor
      "queries"    ~ call.queries
      "vendorCost" ~ call.vendorCost

  def decode(entry: Entry): SearchCall = ...
end
```

The encoder and decoder are located in the same file, so they cannot drift apart.
Also, the usage site uses the class directly, which is well-documented and any
breaking changes would be caught by the compiler.

The point is not ceremony. It is that the contract can now only be broken on
purpose.

## Contracts in the framework

The framework follows its own rule for the two records something is usually built
on: `TurnLog`, which the [transcript](/concepts/transcript/) is read back from,
and `Usage`, which [billing](/guides/usage-and-billing/) is computed from.

## See also

- [Logging](/concepts/logging/) — the event stream and what a record is
- [Usage and Billing](/guides/usage-and-billing/) — the contract put to work
