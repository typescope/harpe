+++
title = "Structured output"
weight = 6
+++
Most agent frameworks produce text. When code needs the answer, they ask the
model for JSON matching a schema, parse it, and validate the result. Harpe
usually does not need that extra round trip: the model writes a **typed Jo
program**, and the program consumes structured data directly.

```text
Typical framework: model -> JSON text -> parser -> application code
Harpe:             model -> type-checked Jo program -> capability
```

## Keep data inside the program

Suppose an agent classifies a request, builds a report, or prepares an API
payload. Its Jo program can construct the value, branch on it, transform it, and
pass it to a capability. The compiler checks those operations before the program
runs.

The destination is normally the capability that needs the data:

- call an API;
- update a database;
- create a ticket;
- write an artifact;
- trigger another system.

There is no benefit in first serializing that value as the agent's final answer,
only for host code to parse it and send it to the same destination.

This guarantees the **shape and permitted use** of the data, not its truth. A
program can type-check while containing a wrong classification or summary, just
as schema-valid JSON can.

## Messages are for people

A conversational agent can finish with text and can use tools or capabilities to
deliver files and other media alongside it. These are complementary outputs:
the message explains the result to the user; the capability performs the typed
delivery.

Harpe therefore does not require every turn to fit one structured response
object. A useful answer may naturally be several messages, an attachment, and an
API call.
