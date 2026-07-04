# The Harpe sandbox — security model

A Harpe agent is an LLM that acts **only** by writing Jo programs that are
compiled and run each turn. This document describes the layers that contain
those programs, from the always-on gate to the opt-in defense-in-depth.

The layers are independent and stack. Layer 0 is the design's foundation and is
never optional; the rest are opt-in hardening an agent author enables in their
own `sandbox/` — because each agent owns its `sandbox/` directory, turning a
layer on is a line of code or a config line the author can read and audit.

## Layer 0 — the compile-time capability gate (always on)

The model's program (`sandbox/guest`) is compiled **without the runtime API**:
its `jo.toml` has no `--use-runtime-api`, so guest Jo cannot name `py.*`, `os`,
or any capability the agent did not grant. Granting an ability and proving it
safe are the same act: you declare a capability interface, widen `runTask`'s
`receives` in `sandbox/api`, and construct its implementation in
`sandbox/runtime`. A program that names an ungranted capability **fails to
compile, so it never runs** — the compile step is the security checkpoint.

This is strong against a program that plays by the rules, but it is a single
wall: a compiler soundness bug, or a bug in a capability *implementation* (which
runs with full power inside the guest process), would breach it. The remaining
layers are defense in depth for exactly that case.

## Layer 1 — host-side resource + time bounds (always on)

`runCode` runs the compiled program under a **wall-clock timeout** and kills the
whole process group on expiry (`runCapped`), so a stuck build or an infinite
loop cannot hang the agent. Tool output fed back to the model is size-bounded.
These are host-side backstops the guest cannot disable.

## Layer 2 — in-guest resource caps (opt-in, in the runtime)

The `Sandbox` facility exposes POSIX rlimits the runtime applies to itself
before running guest code, in `SandboxRuntime.main`:

```jo
sandbox.limitMemoryMb(512)     // RLIMIT_AS — address space
sandbox.limitCpuSeconds(10)    // RLIMIT_CPU — SIGKILL on overrun
```

Once lowered they cannot be raised, so guest code inherits them irrevocably.
They catch memory exhaustion and CPU-bound loops from *inside*, complementing
the host's wall-clock timeout.

## Layer 3 — Landlock OS confinement (opt-in, Linux only)

Beneath the type-level gate, Landlock lets the runtime **drop its own filesystem
and TCP-network rights** via the kernel — so even a total breach of layer 0 is
contained: the escaped code, and anything it spawns, cannot read secrets or
reach the network. The restriction is irreversible and inherited across
`execve`.

Two facilities on `Sandbox`, applied in `SandboxRuntime.main` before `runTask`:

```jo
val sys = py.module("sys")
// readable MUST include Python's own dirs, or the interpreter can no longer
// import the stdlib / C-extensions once restricted — derive them at runtime
// (venv/pyenv-safe), never hardcode /usr.
sandbox.restrictFilesystem(
  [sys.prefix.asString, sys.base_prefix.asString, "/usr", "/lib", "/lib64", "/bin", "/etc", "/dev"],
  [scratchDir])                // the only writable path

sandbox.denyNetwork()          // cut all TCP
```

- **`restrictFilesystem(readable, writable)`** — only `readable` paths are
  readable (read + execute, so shared libraries still load) and only `writable`
  paths writable; everything else — the agent's `.env`, `~/.ssh`, other
  sessions' logs — becomes inaccessible.
- **`denyNetwork()`** — denies all TCP (bind and connect).

**Linux only, and fail-closed.** These are Linux kernel features (files 5.13+,
network 6.7+). On any other OS, or a kernel without support, the call **aborts
the run** rather than proceeding unprotected — if you ask for restriction and it
cannot be enforced, the guest does not run.

**Landlock network is all-or-nothing.** It gates TCP bind/connect only — no UDP,
no raw sockets, and **no IP matching**. `denyNetwork()` is therefore the "no
network" switch; it cannot express "reach only `api.example.com`." That is what
layer 4 is for. An agent that legitimately needs egress should get it as a
*granted capability* (an impl that talks to an allowlisted host or a proxy),
keeping network access a visible, audited grant — not by loosening the sandbox.

## Layer 4 — nftables egress by uid (opt-in, advanced)

For **IP-restricted** egress — allow the guest to reach specific hosts, deny the
rest — run the guest as a dedicated low-privilege account and filter that
account's traffic with nftables. This is entirely an operator/DevOps posture;
the framework's only part is running the guest as the configured uid.

### The runner's part: drop to a uid

`sandbox/sandbox.conf` (a plain `key = value` file kept inside `sandbox/` so the
posture is inspectable next to the code) names the account:

```
# A low-privilege account the guest's runCode program runs as, so its egress
# can be filtered by uid.
run_user = harpe-sandbox
```

When set, `runCode` runs the compiled program as that user (via the child's own
`user`/`group`, dropping supplementary groups), and makes the run directory
readable to it. Absent = run as the current user (the default). A non-existent
account fails fast at startup. **The runner only drops to the uid** — it does
not install firewall rules; that is the operator's job below.

The shipped runner performs the drop with the child process's own
`user`/`group`, which needs the agent to hold `CAP_SETUID` and `CAP_SETGID`.
**How the agent comes to hold them is a deployment choice — see below — and
running the whole agent as root is only the crudest of the options.**

### Granting the uid switch (operator/DevOps)

Changing to a *different* user is privileged: the kernel only lets a process
move among uids it already owns, so acquiring `harpe-sandbox` needs authority
from somewhere. The options, weakest-exposure last:

| How | Agent runs as root? | Extra attack surface | Works with the shipped runner? |
|-----|--------------------|----------------------|-------------------------------|
| **Full root** | yes | whole agent privileged | yes — simplest, worst posture |
| **Ambient capabilities** (systemd `User=agent`, `AmbientCapabilities=CAP_SETUID CAP_SETGID`) | no | just those two caps | yes — no code change; recommended |
| **`sudo -u`** with a pinned command | no | `sudo` (large setuid-root binary) | needs the runner to launch via `sudo` instead |
| **Subuid + user namespace** (`/etc/subuid` + `newuidmap`) | no | `newuidmap` (small, narrow) | needs the runner to launch under a userns |

Notes:

- **Ambient capabilities** are the sweet spot for the shipped runner: the agent
  runs as an unprivileged account but holds exactly `CAP_SETUID`/`CAP_SETGID`,
  so `Popen(user=…)` succeeds without full root. A systemd unit is the usual way
  to grant them.
- **`sudo`** is safe from *escalation* here — it is a downward grant to a weaker
  account, and the guest (running as `harpe-sandbox`) has no reverse sudo right —
  but it exposes the large `sudo` binary to a compromised agent. If you use it,
  **name a single runas user** (`ALL=(harpe-sandbox)`, never `(ALL, !root)`,
  which is the shape behind CVE-2019-14287) and **pin the command**
  (`NOPASSWD: /usr/bin/python3 *`) rather than `ALL`.
- **Subuid + userns** is the narrowest: fully unprivileged agent, the guest gets
  a distinct subordinate uid the host's nftables still matches, and the only
  setuid-root helper involved is the small, `/etc/subuid`-constrained
  `newuidmap`. It needs the `uidmap` package, an `/etc/subuid` delegation, and
  unprivileged user namespaces enabled — the same machinery rootless containers
  use.

The `sudo` and subuid routes reach the same end state (the guest running as the
sandbox uid) but launch it differently, so adopting them means adapting the
runner's spawn, not just configuration. Pick per your environment; the firewall
rules below are identical regardless of how the uid was granted.

### The operator's part: the account and the rules

Create the account (no login, no home) once:

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin harpe-sandbox
```

Then an nftables ruleset that allows only chosen destinations for that uid and
drops the rest. Example — allow DNS and HTTPS to one address, deny all other
egress from `harpe-sandbox`:

```
table inet harpe {
  chain out {
    type filter hook output priority 0; policy accept;

    # Only restrict traffic owned by the sandbox user.
    meta skuid != harpe-sandbox accept

    # Allow loopback and DNS.
    oifname "lo" accept
    udp dport 53 accept
    tcp dport 53 accept

    # Allow HTTPS to a specific host (resolve and pin the address you trust).
    ip daddr 203.0.113.10 tcp dport 443 accept

    # Everything else from this uid is dropped.
    drop
  }
}
```

```sh
sudo nft -f harpe.nft
```

Because the guest process carries `harpe-sandbox`'s uid, `meta skuid` matches it
and the policy applies to exactly the guest's traffic, nothing else on the host.
Combined with layer 3, an escaped guest is confined on disk *and* limited to the
allowlisted destinations.

Whichever way the operator granted the uid switch, if the agent lacks the
authority to make it (no root, no capability, no sudo/subuid path) the run fails
rather than running as the wrong user — fail-closed.

## Summary

| Layer | What it stops | On by default | Where |
|-------|---------------|---------------|-------|
| 0 · compile-time gate | naming ungranted abilities | yes | `sandbox/` compile |
| 1 · wall-clock timeout | hangs, infinite loops | yes | `runCode` host |
| 2 · rlimits | memory / CPU exhaustion | opt-in | `SandboxRuntime.main` |
| 3 · Landlock | reading secrets, all network | opt-in (Linux) | `SandboxRuntime.main` |
| 4 · uid + nftables | egress to non-allowlisted IPs | opt-in (privileged) | `sandbox.conf` + operator |

Layers 0–1 hold for every agent. An agent handling anything sensitive should add
2 and 3; one that needs controlled network egress adds 4.
