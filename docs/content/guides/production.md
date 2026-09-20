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

A `WebApp` declares its routes and the policy enforced before any of them
runs. `application.wsgi()` is a plain WSGI application: run it on the server you
choose, in development as in production, since harpe installs none. With
waitress, for example:

```jo
val application = new WebApp:
  host = "agent.example.com"
  routes = List:
    Route.Get("/api/info", () => agent.info())
    Route.Post("/api/message", () => agent.message())
    Route.Post("/api/upload", () => agent.upload(), maxBodyBytes = 26214400)
  fallback = WebApp.Fallback(() => agent.page(), maxBodyBytes = 1048576)

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
with `Route.Prefix("/assets/", () => agent.asset())` and `Response.file`.

Every handler names the largest body it accepts, and `application.ceiling` is
the largest of them, which is what the server should allow. A route that names
no limit takes `Route.defaultMaxBodyBytes`, 1 MiB.

A fallback names its own, because an application that dispatches in a `match`
has no other limit. One whose routes cover everything names no fallback at all
and takes `WebApp.notFound`, which answers a small bundled 404 page and
reads no body. It is HTML, not the JSON `Response.notFound` answers, because a
path no route claims is usually a browser's. A body sent to one is refused 413
before the 404.

`WebApp.notFound(path)` answers the application's own page instead,
read from `path` per request:

```jo
fallback = WebApp.notFound(os.path.join(appHome, "assets/404.html"))
```

Reach for it rather than building the `Fallback` by hand, since `Response.html`
answers 200 — a page that says 404 under a status that says otherwise is one a
crawler indexes and monitoring never counts. A path that cannot be read answers
harpe's own page rather than failing the request.

Budget memory for the bodies a route holds, not just for the limit it names.
`Request.bytes`, `body` and `json` hold the whole body, so the peak for those
is `concurrent requests × maxBodyBytes`.

The readers that write to disk do not, and cost a block each however large the
body is. `Request.form` writes every file into the directory the route
names as the body arrives, `Request.saveTo` copies a whole body to a path, and
`Response.file` sends through the server's own file wrapper. What an upload
route budgets is that directory's disk, not this process's memory.

Give the spool somewhere real. A file lands where the route says, so point an
upload route at the filesystem it will keep the file on — a rename then costs
nothing, where a directory on another device makes it a copy. Note that `/tmp`
is a RAM-backed tmpfs on many systems, which would put the upload back in
memory by another name.

A route that raises reaches the server, which answers 500 and logs it. Wrap your
own routes to answer differently, and to log the failure with the session it
belongs to, which only your application knows.

Run one process. A server that keeps sessions, running turns or pending
approvals in memory breaks when a second process answers half its requests.
Scale with threads, or put each process behind sticky routing. With gunicorn,
that means `--workers 1 --threads N`.

Name the host your users type. `host` defaults to
`WebApp.Loopback`, which suits a prototype and refuses a hostile name
pointed at `127.0.0.1`, so a deployment that forgets to name its own host is
refused rather than quietly served. `crossSite` defaults to `NoCrossSite`, which refuses every cross-site request
and suits an internal tool nothing links to. A site other pages link to needs
`NoCrossSiteWrite`, or the GET behind every inbound link is a 403. Neither
setting touches a direct visit or the application's own pages. CORS is not a
defence against any of this — it governs what a browser lets a page *read*, so
a cross-site form POST needs none of it. An application that wants CORS answers
its own preflight with `Route.Options` and sends its own
`Access-Control-Allow-*`.

Size the thread pool for concurrency, not for request rate. WSGI pins one
worker for a response's whole life, so the pool needs room for every request in
flight at once, and a fixed pool that runs out stops answering everything,
including the page.

Keep every response short for the same reason. A route that waits on a running
turn holds a worker for as long as the turn takes, which is exactly what a
server cannot predict. Start the work on a worker of your own, have the route
return at once, and let the page follow it by polling a cursor —
`harpe.observability.Viewer` is that shape, and a poll costs a list slice.

Pass the server the same body limit. `wsgi` refuses an oversized body before the
route sees it, but without draining what the client is still sending, so the
server's own limit is what gives the client a clean answer.

A body must declare its length, since the limit is enforced from the
declaration rather than as the bytes arrive. One that does not is None from
`Request.body`, `json` and `form`, so the route answers its own 400 rather
than acting on an empty body it believes whole. Waitress de-chunks a chunked
request and declares the length itself, so this is the servers that pass the
chunks through.

## Behind a reverse proxy

A proxy changes what the application sees, and three of harpe's checks read
exactly those values.

**Pass the original `Host` through.** nginx's default `proxy_pass` replaces it
with the upstream address, so a `host` named as a string refuses every request
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
default, refusing an upload before `maxBodyBytes` is consulted:

```nginx
client_max_body_size 25m;
```

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
