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

An `Application` declares its routes and the policy enforced before any of them
runs. `application.wsgi()` is a plain WSGI application: run it on the server you
choose, in development as in production, since harpe installs none. With
waitress, for example:

```jo
val application = new Application:
  host = Application.Host.Named("agent.example.com")
  routes = List:
    Router.Get("/api/info", () => agent.info())
    Router.Post("/api/message", () => agent.message())
    Router.Post("/api/upload", () => agent.upload(), maxBodyBytes = 26214400)
  fallback = () => agent.page()

val server = py.module("waitress").create_server:
  application.wsgi()
  host = host
  port = port
  threads = 32
  channel_timeout = 3600
  max_request_body_size = application.ceiling
server.run()
```

Serve static assets from the proxy rather than the application. An application
running without one, in development or in a single container, serves its own
with `Router.Prefix("/assets/", () => agent.asset())` and `Response.file`.

Keep `maxBodyBytes` small — it defaults to 1 MiB and covers every route that
names none — and let an upload route raise its own. `application.ceiling` is the
largest of them, which is what the server should allow.

Budget memory for the bodies a route holds, not just for the limit it names.
`Request.bytes`, `body` and `json` hold the whole body, and `multipart` holds it
twice while it parses, so the peak is roughly `concurrent uploads ×
maxBodyBytes × 2`. A route whose upload belongs in a file calls
`Request.saveTo`, which copies it a block at a time and never holds it.
`Response.file` sends through the server's own file wrapper, so what it answers
costs a block rather than the file's size.

A route that raises reaches the server, which answers 500 and logs it. Wrap your
own routes to answer differently, and to log the failure with the session it
belongs to, which only your application knows.

Run one process. A server that keeps sessions, running turns or pending
approvals in memory breaks when a second process answers half its requests.
Scale with threads, or put each process behind sticky routing. With gunicorn,
that means `--workers 1 --threads N`.

Name the host your users type. `host` defaults to
`Application.Host.Loopback`, which suits a prototype and refuses a hostile name
pointed at `127.0.0.1`, so a deployment that forgets to name its own host is
refused rather than quietly served. Keep `crossSite` at `Refuse` unless
browsers on other sites must write to the server.

Size the thread pool for concurrency, not for request rate. A streaming
response holds one worker for its whole life, so the pool needs room for every
turn in flight and every open subscription at once — a fixed pool that runs out
stops answering everything, including the page. Set the idle timeout
(`channel_timeout` in waitress) above your longest quiet period, or a
subscription waiting on a slow turn is closed underneath it.

Pass the server the same body limit. `wsgi` refuses an oversized body before the
route sees it, but without draining what the client is still sending, so the
server's own limit is what gives the client a clean answer.

A body must declare its length, since the limit is enforced from the
declaration and nothing here streams a body. One that does not is None from
`Request.body`, `json` and `multipart`, so the route answers its own 400 rather
than acting on an empty body it believes whole. Waitress de-chunks a chunked
request and declares the length itself, so this is the servers that pass the
chunks through.

A streaming producer should stop once `emit` returns `false`, since the client
has gone.

## Behind a reverse proxy

A proxy changes what the application sees, and three of harpe's checks read
exactly those values.

**Pass the original `Host` through.** nginx's default `proxy_pass` replaces it
with the upstream address, so `Application.Host.Named` refuses every request
with a 400, and an older browser's POST, which has no `Sec-Fetch-Site` for the
cross-site check to read, gets a 403 from the `Origin` comparison:

```nginx
proxy_set_header Host $host;
```

**Serve the assets yourself.** A page's own files never need to reach the
application, and a fingerprinted one can be cached for a year. `Response.file`
answers `no-store`, since what it exists for is the download a proxy cannot
serve, the one the request must be entitled to:

```nginx
location /assets/ {
    alias /srv/agent/assets/;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

**Match the proxy's limits to the application's.** nginx allows a 1 MB body by
default, refusing an upload before `maxBodyBytes` is consulted, and closes a
proxied connection idle for 60 seconds, which cuts a stream waiting on a slow
turn:

```nginx
client_max_body_size 25m;
proxy_read_timeout 3600s;
```

An event stream can also send `Sse.keepalive()` during quiet periods.

**Do not buffer a streamed response.** `Response.stream` sends
`X-Accel-Buffering: no`, which nginx honours. Other proxies need their own
setting, such as `proxy_buffering off`.

**`Secure` cookies need TLS at the browser, not at the application.** The proxy
terminates TLS, so the `secure = true` that `Response.cookie` defaults to is
right in production even though the application only ever sees plain HTTP. In
local development over `http://` on anything but `localhost`, that cookie will
not come back, and `secure = false` is the deliberate way to say so.

The client's IP and the original scheme arrive in `X-Forwarded-For` and
`X-Forwarded-Proto`, which `Request.header` reads. Trust them only from a proxy you
control.

## Test the boundaries

- Test that forbidden capability use fails to compile.
- Test authorization across users and tenants.
- Test approval rejection, timeout, replay, and duplicate decisions.
- Test malformed and oversized uploads, against both limits.
- Test sandbox timeouts and resource limits.
- Test restart behavior for sessions.
