+++
title = "Production Considerations"
aliases = ["/concepts/production/"]
+++
Compile-time sandboxing constrains generated programs. A production deployment
must also secure users, trusted implementations, processes, stored data, and
model-provider access.

## Identity and session scope

Authenticate users before they can start a turn. Derive user and tenant scope
from trusted session state, not from identifiers supplied by the model.

Isolate each session's files, memory, transcript, and approvals. The Web and
Telegram applications demonstrate per-session data directories. Define
authentication, authorization, retention, and deletion for your application.

## Capability review

Review capability interfaces and implementations:

- remove capabilities the agent does not need
- prefer domain operations over raw filesystem, network, database, or shell
  access
- separate read and write authority
- attenuate broad authority into tenant-scoped or operation-scoped interfaces
- keep credentials and provider SDKs in trusted runtime code

## Consequential operations

Require [human approval](/concepts/approvals/) inside the trusted implementation
of consequential capabilities. Validate and scope the request before presenting
it for approval. Perform the effect only after `Approved`.

Make externally visible operations idempotent where retries could duplicate
them. Record the request, decision, and resulting effect in the audit log.

## Process isolation

Use an external sandbox to limit the guest program's CPU and memory, and set
system-level file system and network policies. File system and network
restrictions add defense in depth around the compile-time capability boundary.

Follow [Add Defense in Depth](/guides/defense-in-depth/) to configure the
external sandbox.

## Logs and retention

Install a durable [`Logger`](/concepts/logging/). Correlate model calls,
generated programs, approvals, and capability effects with the user, tenant,
and session that caused them.

Decide explicitly:

- which prompts, outputs, files, and generated programs may be retained
- who can query or export logs
- how secrets and personal data are redacted
- when transcripts, memory, files, and audit records are deleted

Do not treat the conversation transcript as the audit log. It omits host-side
events such as approval traffic and trusted implementation details.

## Billing and accounting

Harpe does not calculate prices or issue invoices. Built-in models emit one
`harpe.model` event per call with the provider, model, input tokens, output
tokens, and session context. Use a durable [`Logger`](/concepts/logging/) to
aggregate these events by customer and apply the relevant price table.

For other billable work, emit structured events from trusted tools and
capability implementations. Record the units consumed, provider cost, and
customer context under a stable category. See
[Building usage, billing, and stats](/concepts/logging/#building-usage-billing-and-stats)
for offline aggregation and live metering patterns.

## Model and data policy

Review the model provider's retention, regional processing, and training
policies for the data your agent handles. Configure provider-side storage to
match your requirements.

Keep sensitive intermediate data inside generated programs when possible.
Return only the bounded result the model needs, and inline images or documents
only when visual reasoning is required.

## Test the boundaries

- Test that forbidden capability use fails to compile.
- Test authorization across users and tenants.
- Test approval rejection, timeout, replay, and duplicate decisions.
- Test malformed and oversized uploads.
- Test sandbox timeouts and resource limits.
- Test restart behavior for sessions and memory.
