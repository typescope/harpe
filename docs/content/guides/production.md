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

`Http.app` turns a route into a plain WSGI application. Run it on the WSGI
server you choose, in development as in production. harpe installs none. With
waitress, for example:

```jo
val settings = new Http.Settings:
  maxBodyBytes = 26214400
  hosts = Http.Host.Named("agent.example.com")
  crossSite = Http.CrossSite.Refuse

val server = py.module("waitress").create_server:
  Http.app(settings, () => routes.route())
  host = host
  port = port
  threads = 32
  channel_timeout = 3600
  max_request_body_size = settings.maxBodyBytes
server.run()
```

A route that raises reaches the server, which answers 500 and logs it. Wrap your
own routes to answer differently, and to log the failure with the session it
belongs to, which only your application knows.

Run one process. A server that keeps sessions, running turns or pending
approvals in memory breaks when a second process answers half its requests.
Scale with threads, or put each process behind sticky routing. With gunicorn,
that means `--workers 1 --threads N`.

Name the host your users type. A server on loopback uses `Http.Host.Loopback`,
which still refuses a hostile name rebound to `127.0.0.1`. Keep
`CrossSite.Refuse` unless browsers on other sites must write to the server.

Size the thread pool for concurrency, not for request rate. A streaming
response holds one worker for its whole life, so the pool needs room for every
turn in flight and every open subscription at once — a fixed pool that runs out
stops answering everything, including the page. Set the idle timeout
(`channel_timeout` in waitress) above your longest quiet period, or a
subscription waiting on a slow turn is closed underneath it.

Pass the server the same body limit. `Http.app` refuses an oversized body before
any route sees it, but without draining what the client is still sending, so
the server's own limit is what gives the client a clean answer.

A streaming producer should stop once `emit` returns `false`, since the client
has gone.

## Behind a reverse proxy

A proxy changes what the application sees, and three of harpe's checks read
exactly those values.

**Pass the original `Host` through.** nginx's default `proxy_pass` replaces it
with the upstream address, so `Http.Host.Named` refuses every request with a
400, and an older browser's POST, which has no `Sec-Fetch-Site` for the
cross-site check to read, gets a 403 from the `Origin` comparison:

```nginx
proxy_set_header Host $host;
```

**Match the proxy's limits to the application's.** nginx allows a 1 MB body by
default, refusing an upload before `maxBodyBytes` is consulted, and closes a
proxied connection idle for 60 seconds, which cuts a stream waiting on a slow
turn:

```nginx
client_max_body_size 25m;
proxy_read_timeout 3600s;
```

An event stream can also send `Http.Sse.keepalive()` during quiet periods.

**Do not buffer a streamed response.** `Response.stream` sends
`X-Accel-Buffering: no`, which nginx honours. Other proxies need their own
setting, such as `proxy_buffering off`.

**`Secure` cookies need TLS at the browser, not at the application.** The proxy
terminates TLS, so `Response.cookie(…, secure = true)` is right in production
even though the application only ever sees plain HTTP. In local development
over `http://` on anything but `localhost`, that cookie will not come back.

The client's IP and the original scheme arrive in `X-Forwarded-For` and
`X-Forwarded-Proto`, which `Http.header` reads. Trust them only from a proxy you
control.

## Test the boundaries

- Test that forbidden capability use fails to compile.
- Test authorization across users and tenants.
- Test approval rejection, timeout, replay, and duplicate decisions.
- Test malformed and oversized uploads, against both limits.
- Test sandbox timeouts and resource limits.
- Test restart behavior for sessions.
