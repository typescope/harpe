+++
title = "Serving HTTP"
description = "Deploy a Harpe application with WSGI, bounded uploads, responsive turn handling, and a reverse proxy."
+++
A `WebApp` declares HTTP routes and the policy checked before a handler runs.
Its `wsgi()` method returns a plain WSGI application. HTTP handlers belong in
your trusted application, where they authenticate users, scope sessions, and
start agent turns.

This guide covers serving an existing agent. Use the [Deployment Checklist](/guides/production/)
for the wider security and data policy review.

## Run a WSGI server

Harpe supports all WSGI-compatible web servers. We recommend
[Waitress](https://docs.pylonsproject.org/projects/waitress/en/stable/).
Install it in the Python environment Jo uses, and include it in your project's
dependencies:

```sh
pip install waitress
```

The following startup code assumes `api` is your application's HTTP handler
object, with application-defined methods returning `Response`.

```jo
import harpe.server.Route
import harpe.server.WebApp

val application = new WebApp:
  host = "agent.example.com"
  crossSite = WebApp.NoCrossSite
  routes = List:
    Route.Get("/", () => api.page(), maxReqBody = 0)
    Route.Get("/api/info", () => api.info(), maxReqBody = 0)
    Route.Post("/api/message", () => api.message(), maxReqBody = 1048576)
    Route.Post("/api/upload", () => api.upload(), maxReqBody = 26214400)

val httpd = py.module("waitress").create_server:
  application.wsgi()
  host = "127.0.0.1"
  port = 8765
  threads = 16
  max_request_body_size = application.maxReqBody
httpd.run()
```

`application.wsgi()` is quiet by default. Pass an output callback to receive one
newline-terminated record containing each request's method, path, query string,
and response status when response headers are accepted. Writes are serialized
across request threads, so an application can pass `stdout` directly or provide
its own sink:

```jo
application.wsgi(output = stdout)
application.wsgi(output = (line: String) => saveAccessLog(line))
```

The default quiet sink and custom output use no logging package.

The two `host` settings have different jobs. `WebApp.host` is the hostname
clients use, without a scheme, path, or port. Waitress's `host` is the interface
to bind. Here, a reverse proxy on the same machine accepts HTTPS for
`agent.example.com` and forwards requests to `127.0.0.1:8765`. For a proxy in
another container, bind an interface it can reach and restrict access to the
upstream port.

For local development, use `WebApp.Loopback`, the default, and visit
`http://127.0.0.1:8765`. It accepts `localhost`, `127.0.0.1`, and `::1`, and
rejects other hostnames with 400. Setting only the server's bind address does
not change this check.

## Choose the browser request policy

`crossSite` controls requests identified as coming from another browser origin:

| Policy | Behavior |
|---|---|
| `WebApp.NoCrossSite` (default) | Allows top-level GET page visits; rejects cross-origin fetches, images, iframe loads, and writes. |
| `WebApp.NoCrossSiteWrite` | Rejects cross-origin POST, PUT, and DELETE; allows all cross-origin reads. Use when other origins need to fetch your resources. |
| `WebApp.AnyCrossSite` | Disables this check. The application must supply its own origin and sender checks. |

Keep `NoCrossSite` for an agent whose own page calls its API. It allows someone
to follow a link from another site: a page visit is a GET with
`Sec-Fetch-Mode: navigate` and `Sec-Fetch-Dest: document`. An iframe uses a
different destination, and a form POST uses a different method, so neither
qualifies for this exception. Inbound links work with the default policy.

The check uses `Sec-Fetch-Site`, falling back to a comparison of `Origin` and
`Host`. Direct visits and same-origin requests pass either restrictive policy.
Clients that send neither header also pass, so this policy does not authenticate
API clients or webhooks. Authenticate requests and authorize access to the
session before starting work, accepting files, or resolving an approval.
Keep GET handlers free of state-changing effects.

CORS does not prevent cross-site form submissions. If your application supports
cross-origin browser clients, choose a compatible `crossSite` policy, validate
the allowed origins, answer preflights with `Route.Options`, and send the
appropriate `Access-Control-Allow-*` headers. CORS headers alone do not override
`WebApp`'s request policy.

## Define routes and fallbacks

Exact routes match both method and path. Use `Route.Prefix("/c/", handler)`
for application-defined handling of a path prefix; the prefix must end in `/`.
An exact match wins over a prefix, and the longest matching prefix wins over a
shorter one. For static asset trees, use
[`Route.assets`](#serve-assets-and-files).

With no explicit `fallback`, unclaimed paths receive `WebApp.notFound()`: a
bundled HTML page with status 404. It accepts no body, so a request with a
declared nonempty body is rejected with 413 before the fallback runs.
`Response.notFound()` is the JSON equivalent for use inside a handler.

To serve your own 404 page, add this argument to `WebApp`:

```jo
fallback = WebApp.notFound("/srv/agent/assets/404.html")
```

The file is read on each request; if it cannot be read, Harpe serves its bundled
page. This preserves status 404. `Response.html(...)` returns 200, even if its
content says "not found".

An application that dispatches with a `match` can use one fallback instead of a
route table:

```jo
val application = new WebApp:
  host = "agent.example.com"
  crossSite = WebApp.NoCrossSite
  routes = []
  fallback = WebApp.Fallback(() => api.route(), maxReqBody = 26214400)
```

Here, `api.route()` is your application's dispatcher. Every request shares the
fallback's body limit. Use separate routes when message, upload, and page
handlers need different limits. A fallback used for client-side navigation
should distinguish valid page URLs from unknown API paths and return an
appropriate 404 for the latter.

## Keep HTTP requests short while turns run

A WSGI worker remains occupied while the application produces a response. An
agent turn can spend minutes waiting on a model, a tool, or a human approval.
If the request handler waits for it, enough concurrent turns can occupy every
worker and prevent the page, cancellation, and approval routes from responding.

Structure your turn handling as follows:

1. Authenticate and authorize `POST /api/message`, then start the turn on an
   application worker and return the session or turn identifier promptly.
2. Let the browser poll `GET /api/events` with a cursor, returning only new
   events and advancing the cursor after each response.
3. Keep cancellation and approval requests short too. Serialize turns within a
   session and bound the number of active turns across the application.

The HTTP thread pool and the turn workers are separate resource budgets. Size
the former for concurrent requests, including uploads and downloads, and the
latter for model-provider and sandbox capacity. The example's 16 HTTP threads
are a starting point to measure under load. The
[log viewer](/concepts/observability/#integrate-the-log-viewer) uses the same
cursor-polling pattern.

Run **one process while live session state is held in memory**. A second process
does not share running turns, locks, event cursors, or pending approvals, even
if both read the same transcript files. To scale across processes, route every
request for a session to its owning process, or move state and work coordination
to shared services. Sticky routing alone does not recover a turn after its
process exits; define what clients see after a restart.

Unhandled handler exceptions propagate to the WSGI server, which normally logs
them and returns 500. Wrap handlers when you need a structured error response
and [logs](/concepts/logging/) carrying the user, session, and turn identifiers.
Log background turn failures separately: their originating HTTP request has
already returned.

## Limit request bodies at every layer

Each route has a `maxReqBody` limit, in bytes. The default is
`Route.defaultMaxReqBody`, 1 MiB (1,048,576 bytes); use 0 for a handler that
accepts no body. A custom `WebApp.Fallback` requires an explicit limit.

`application.maxReqBody` is the largest route or fallback limit. Pass
it to the WSGI server and match the reverse proxy's limit to it. In the example,
the server allows 25 MiB, while the message route still allows only 1 MiB.
Limits apply to the **whole encoded request body**, including multipart framing
or base64 expansion. Allow room for this overhead when choosing a file-size
limit.

`WebApp` checks the declared length before calling a handler. It does not drain
an oversized upload, so the server must enforce its own limit to handle the
remaining input. Waitress de-chunks requests and supplies their length.
Harpe's readers reject a body that reaches them still marked with
`Transfer-Encoding` but no declared length.

Read the body once. A second body read aborts. Treat `None` from `request.body()`,
`request.json()`, or `request.form(...)` as an invalid or incomplete input,
rather than continuing a turn with a default value. For example:

```jo
val body = request.json() rescue None =>
  return Response.badRequest("expected a complete JSON object")
```

This belongs inside a handler that imports `harpe.server.request` and
`harpe.server.Response` and declares `receives request`. `request.json()` also
requires the `application/json` content type and an object at the top level.

## Budget memory and upload storage

`request.bytes()`, `body()`, and `json()` hold the whole body in memory. Budget
for concurrent requests multiplied by their body limits, plus decoded strings,
parsed objects, and any server buffering. Sixteen simultaneous 25 MiB JSON
uploads can require 400 MiB just for raw bodies, before parsing or decoding
base64 data.

Use the file APIs to transfer large bodies incrementally:

| API | Storage behavior |
|---|---|
| `request.form(fileStoreDir)` | Writes multipart files under generated names in the directory you choose. Text fields remain in memory. |
| `request.saveTo(path)` | Copies a raw request body to the chosen path in blocks; replaces an existing file at that path. |
| `Response.static(...)` / `Response.file(...)` / `Response.download(...)` | Reads a response file in blocks, using the server's file wrapper when available. |

Choose the upload directory from the authorized session, create it before
reading the form, and keep it on the filesystem where you intend to retain the
files. That allows a rename instead of a copy. Check whether temporary storage
is RAM-backed, and budget disk space for both retained files and simultaneous
uploads. The proxy and WSGI server may also buffer uploads in temporary files.

On a successful multipart parse, your handler owns the written files: validate
them, keep or rename accepted files, and delete rejected ones. The client's
filename is metadata; choose the destination path in your handler. Malformed or
truncated multipart input returns `None` and removes files created by that parse.
Calling `request.form()` without a directory stores no file parts;
URL-encoded forms still use the whole-body text reader.

## Serve assets and files

Choose the response builder according to where the path comes from and how the
browser should handle the file:

| API | Input and browser behavior |
|---|---|
| `Response.static(root, path)` | Resolves a client-selected relative path under a static root and serves it inline. |
| `Response.file(path)` | Serves a file at a path your application already holds, inline. |
| `Response.download(path, filename = ...)` | Serves a file at a path your application already holds, as an attachment with an optional download name. |

`Response.static` serves a named file. Empty paths, directories, missing files,
and paths that resolve outside the root return 404. The content type and
response filename come from the resolved file, so a symlink uses its target's
name. URL conventions, including which paths request an index page, belong to
the route.

For development or a container without a proxy, add this route to your
`WebApp`'s routes:

```jo
Route.assets("/assets/", "/srv/agent/assets")
```

`Route.assets(prefix, root)` removes the prefix and appends `index.html` when
the remaining path is empty or ends in `/`, then calls `Response.static`:

| URL | File under `/srv/agent/assets` |
|---|---|
| `/assets/app.css` | `app.css` |
| `/assets/` | `index.html` |
| `/assets/guide/` | `guide/index.html` |
| `/assets/guide` | `guide`; returns 404 if it is a directory. |

The prefix must end in `/`. A missing index returns 404; the route neither
lists directories nor redirects a path to add a slash. It accepts only GET,
sets `maxReqBody = 0`, and sends `Cache-Control: no-store`. Its only arguments
are `prefix` and `root`; configure production asset caching at the
[reverse proxy](#serve-public-assets-and-protect-session-files).

For another URL convention, such as extensionless `.html` paths or one page
answering several paths, use `Route.Prefix` and an application handler that
chooses the file before calling `Response.static`.

`file` and `download` do not perform root containment checks. Get their paths
from application-owned state after authorizing access to the session and file;
keep client-selected relative paths on the `static` path. A missing file passed
to `file` or `download` aborts. Handle an unavailable session file in your route
if the client should receive a 404.

Use `download` for uploaded content that should be saved rather than rendered
in your application's origin. Its optional `filename` sets the browser's save
name and the guessed content type, without changing which file is read. For
example, a handler can serve a PDF stored under an application-generated name:

```jo
Response.download("/srv/agent/data/session-42/9f2ca1", filename = "report.pdf")
```

Without `filename`, the last segment of the stored path supplies both the name
and the extension used to infer the type. All three builders default to
`Cache-Control: no-store`; pass your own `headers` to set a different cache
policy for public assets. They stream file contents through the server's file
wrapper when available.

## Behind a reverse proxy

Terminate TLS at the proxy, keep the upstream accessible only to that proxy,
and configure it to accept your application's public hostname.

### Preserve the request host

nginx replaces `Host` with the upstream address by default. Preserve the
client's authority, including a port when present, so Harpe's host validation
and fallback `Origin` comparison see the same value as the browser:

```nginx
# Inside the HTTPS server block for agent.example.com:
client_max_body_size 25m;

location / {
    proxy_pass http://127.0.0.1:8765;
    proxy_set_header Host $http_host;
}
```

Using `$http_host` preserves the original port; `$host` does not. This matters
when the public URL uses a non-default port. See nginx's
[`proxy_set_header` documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header).
The 25 MiB limit matches the application's maximum; nginx's
[`client_max_body_size` default](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)
is `1m`, which would reject larger uploads before they reach Harpe.

### Serve public assets and protect session files

Serve public frontend files at the proxy. For a page that loads `/assets/...`:

```nginx
location /assets/ {
    alias /srv/agent/assets/;
    add_header Cache-Control "no-cache";
}
```

Use `public, max-age=31536000, immutable` only for assets whose URLs change when
their contents change, such as filenames containing a content hash. Keep
unversioned assets revalidating so a deployment does not leave clients using
old JavaScript.

Keep session uploads, generated files, and logs outside public asset mappings.
Serve them through an authorized handler using application-owned paths scoped
to the session. See [Serve assets and files](#serve-assets-and-files) for the
response builders and for serving public assets without a proxy.

### Cookies and forwarded headers

`Response.cookie` defaults to `secure = true`. Keep that setting when the
browser connects over HTTPS, even if the proxy forwards plain HTTP upstream.
For deliberate local HTTP development, `secure = false` may be needed on hosts
other than `localhost`; see the browser's
[`Secure` cookie rules](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#secure).

If you need the client IP or original scheme, configure the proxy to replace
client-supplied forwarded headers and the WSGI server to trust only that proxy.
Waitress strips untrusted proxy headers by default; configure its
[`trusted_proxy` and `trusted_proxy_headers` settings](https://docs.pylonsproject.org/projects/waitress/en/stable/arguments.html)
for your topology. `request.header(...)` can read headers the server retains.

## Verify the deployed path

Test through the actual proxy and WSGI server, as well as directly against the
application. For the configuration above, check:

| Check | Expected result |
|---|---|
| Direct visit and inbound link to the public hostname | Both reach the page with the default `NoCrossSite` policy. |
| Cross-site GET with `Sec-Fetch-Mode: navigate` and `Sec-Fetch-Dest: document` | Reaches the page as a top-level navigation. |
| Cross-site fetch, image request, or iframe navigation | 403 before any handler runs, including for GET. |
| Request reaching `WebApp` with an unrecognized `Host` | 400 before any handler runs. |
| POST marked `Sec-Fetch-Site: cross-site`, including a form navigation | 403 before any handler runs. |
| Message body over 1 MiB but below 25 MiB | 413 from the route limit, even though the outer limits allow it. |
| Body over 25 MiB | Rejected by the proxy, and by the server when tested directly. |
| Malformed or interrupted multipart upload | No turn starts and no partially parsed files remain. |
| Several running turns and pending approvals | Page, event polling, cancellation, and approval routes stay responsive. |
| Process restart during a turn | The client sees the recovery or interruption behavior your application defines. |

Use GET for HTTP health probes: Harpe currently returns 501 for HEAD. Include
the accepted public `Host` when probing the upstream directly.
