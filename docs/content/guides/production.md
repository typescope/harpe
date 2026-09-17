+++
title = "Deployment Checklist"
aliases = ["/concepts/production/"]
+++
Compile-time sandboxing constrains generated programs. A production deployment
must also secure users, trusted implementations, processes, stored data, and
model-provider access.

## Identity and session scope

Authenticate users before they can start a turn. Derive user and tenant scope
from trusted session state, not from identifiers supplied by the model.

Isolate each session's files, transcript, and approvals. The Web and
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
it for approval. Perform the effect only after `Approvals.Approved`.

Make externally visible operations idempotent where retries could duplicate
them. Record the request, decision, and resulting effect in the audit log.

## Process isolation

Use an external sandbox to limit the guest program's CPU and memory, and set
system-level file system and network policies. File system and network
restrictions add defense in depth around the compile-time capability boundary.

Follow [Add Defense in Depth](/guides/defense-in-depth/) to configure the
external sandbox.

## Model and data policy

Review the model provider's retention, regional processing, and training
policies for the data your agent handles. Configure provider-side storage to
match your requirements.

For high-stakes workflows or highly sensitive data, consider deploying a
**local open-weight model**.

Define retention and deletion policies for prompts, outputs, files, generated
programs and audit events. Restrict who can query or export them, and
redact secrets and personal data.

## Serving HTTP

`Http.server` is `wsgiref`, the standard library's reference implementation. It
is for development and tests: no read timeout, so a client that connects and
stays silent holds a thread indefinitely, an accept backlog of five, and
HTTP/1.0 with no keep-alive.

Bind a real server to `Http.app` in your own code, so the framework keeps no
dependency you did not choose:

```jo
val settings = new Http.Settings:
  maxBodyBytes = 26214400
  hosts = Http.Host.Named("agent.example.com")
  crossSite = Http.CrossSite.Refuse

val httpd = py.module("waitress").create_server:
  Http.app(settings, () => server.route())
  host = host
  port = port
  threads = 32
  channel_timeout = 3600
  max_request_body_size = settings.maxBodyBytes
httpd.run()
```

Name the host your users type. A server on loopback uses `Http.Host.Loopback`,
which still refuses a hostile name rebound to `127.0.0.1`. Keep
`CrossSite.Refuse` unless browsers on other sites must write to the server.

Size `threads` for concurrency, not for request rate. A streaming response holds
one worker for its whole life, so the pool needs room for every turn in flight
and every open subscription at once — a fixed pool that runs out stops answering
everything, including the page. Set `channel_timeout` above your longest quiet
period, or a subscription waiting on a slow turn is closed underneath it.

Pass the same body limit to the server. The framework refuses an oversized
body before any route sees it, but it does so without draining what the client
is still sending, so the transport-layer limit is what gives the client a clean
answer.

A streaming producer should stop once `emit` returns `false`, since the client
has gone. Behind a proxy with a read timeout, an event stream sends
`Http.Sse.keepalive()` during quiet periods.

## Test the boundaries

- Test that forbidden capability use fails to compile.
- Test authorization across users and tenants.
- Test approval rejection, timeout, replay, and duplicate decisions.
- Test malformed and oversized uploads, against both limits.
- Test sandbox timeouts and resource limits.
- Test restart behavior for sessions.
