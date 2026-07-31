+++
title = "Production Considerations"
aliases = ["/concepts/production/"]
+++
Harpe provides a compile-time authority boundary for generated programs. A
production agent still needs the ordinary controls of a networked application.
Treat the shipped CLI, Web, and Telegram applications as inspectable starting
points whose deployment policy you own.

## Identity and session scope

Authenticate users before they can start a turn. Derive user and tenant scope
from trusted session state, not from identifiers supplied by the model.

Keep each session's files, memory, transcript, and pending approvals separate.
The Web and Telegram templates demonstrate per-session data directories, but
your authentication, authorization, retention, and deletion policies remain
application decisions.

## Capability review

Review capability interfaces and implementations:

- remove capabilities the agent does not need
- prefer domain operations over raw filesystem, network, database, or shell
  access
- separate read and write authority
- attenuate broad authority into tenant-scoped or operation-scoped interfaces
- keep credentials and provider SDKs in trusted runtime code

The compiler enforces the declared boundary. It does not decide whether the
boundary is appropriately narrow.

## Consequential operations

Require [human approval](/concepts/approvals/) inside the trusted implementation
of irreversible capabilities. Construct the approval request from validated
arguments and perform the effect only after `Approved`.

Make externally visible operations idempotent where retries could duplicate
them. Distinguish rejection, timeout, and cancellation in application behavior
and logs.

## Process isolation

Use an external sandbox to limit the guest program's CPU and memory, and set
system-level file system and network policies. File system and network
restrictions add defense in depth around the compile-time capability boundary.

Follow [Add Defense in Depth](/guides/defense-in-depth/) for the template
wrapper and verification steps.

## Logs and retention

Install a durable [`Logger`](/concepts/logging/) and preserve the context needed
to attribute model calls, generated programs, approvals, and capability effects
to a session.

Decide explicitly:

- which prompts, outputs, files, and generated programs may be retained
- who can query or export logs
- how secrets and personal data are redacted
- when transcripts, memory, files, and audit records are deleted

Do not treat the conversation transcript as the audit log. It omits host-side
events such as approval traffic and trusted implementation details.

## Model and data policy

Review the selected model provider's retention, regional processing, and
training policies for the data your agent handles. Configure provider-side
storage and reasoning features consistently with those requirements.

Keep sensitive intermediate data inside generated programs when possible.
Return only the bounded result the model needs, and inline images or documents
only when visual reasoning is required.

## Before deployment

- Test that forbidden capability use fails to compile.
- Test authorization across users and tenants.
- Test approval rejection, timeout, cancellation, and duplicate decisions.
- Test malformed and oversized uploads.
- Test sandbox timeouts and resource limits.
- Test restart behavior for sessions, memory, and pending work.
- Review dependencies and native media parsers.
- Define incident response and credential-rotation procedures.

Compile-time sandboxing is one strong boundary. Production safety comes from
combining it with narrow capability design and the controls above.
