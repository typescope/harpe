+++
title = "Sandboxing"
weight = 8
+++
A Harpe agent is an LLM that acts **only** by writing Jo programs that are
compiled and run each turn. Its security rests on a foundation the framework
enforces for you, plus three OS-level restrictions you add for defense in depth.

## Runner Interface

The runner compiles and runs each guest program in an isolated temp directory,
applying two protections around every build/run that the guest cannot disable:

- **Wall-clock timeout + process-group kill.** Each build/run is time-bounded; on
  expiry the whole process group is SIGKILLed, so a stuck build or an infinite
  loop — even one that forks — cannot hang the agent. Tool output is size-bounded.
- **Environment scrub.** Guest code runs with a minimal `PATH`-only environment;
  every host variable is dropped, secret or not, so a breach inherits none of the
  agent's secrets. (The trusted compile step keeps the full toolchain env; only
  untrusted runs are scrubbed.)

## Compile-time sandboxing — the capability gate

The foundation. The model's program (the `guest` module) is compiled *without*
the runtime API: its module declares no `enable-ffi`, so guest Jo cannot name
`py.*`, `os`, or any capability the agent did not grant. Granting an ability and
proving it safe are the same act — you declare a capability interface, widen
`runTask`'s `receives` in the `api` module, and construct its impl in the
`runtime` module. A program that names an ungranted capability *fails to
compile, so it never runs* — the compile step is the security checkpoint.

The framework's own capability interfaces ([media](/concepts/media/):
`FileSystem`, `MediaProvider`, the format processors) ship in the pure **`caps`
module** — interfaces and value types only, no FFI, no implementations. An `api`
module depends on `caps` rather than on the framework, so the trusted
implementations are not in the guest's dependency graph at all.

This is strong against a program that plays by the rules, but it is a single
wall: a compiler soundness bug, or a bug in a capability implementation (which
runs with full power inside the guest process), would breach it — which is
exactly what the OS-level restrictions below defend against.

## The three OS-level restrictions (opt-in, external)

For defense in depth beneath the type gate, there are three things worth
restricting — what the guest may **consume**, **read/write**, and **reach**:

1. **Resource quotas**
2. **Filesystem restriction**
3. **Network filtering**

Each is a separate layer you enable independently. All three are enforced
*outside* the framework — Harpe ships no bespoke Landlock/seccomp code you would
have to trust — through one seam and the OS tool you prefer.

**The seam — `sandbox/run.sh`.** If an executable `sandbox/run.sh` exists, the
runner launches each guest program through it (`run.sh <out.py>` instead of
`python3 <out.py>`); the script sets up confinement and `exec`s the interpreter.
Absent → plain `python3` with just the background protections. Each driver ships
a `sandbox/run.sh.example`; enable it by renaming to `run.sh` and `chmod +x`.

Its contract is tiny: `$1` is the compiled `.py`, the run directory is
`dirname "$1"`, and you finish with `exec <python> "$@"`. Because confinement is
applied *around* `exec`, it is inherited by the guest and everything it spawns —
the property that makes `docker`/`bwrap`/Landlock containment sound. (The guest
already arrives with a minimal `PATH`-only environment; add back anything it
needs here.) The recipes for each layer below go in that script.

**Lightweight by default, but bring your own stack.** The recipes here use
lightweight OS primitives — `ulimit`, Landlock (via `landrun`), namespaces (via
`bwrap`), `nftables` — with no daemon and minimal setup, which is the right
starting point for most agents. But `run.sh` only wraps the `exec`, so it is
equally the place to hand the guest to a heavier isolation stack you already run:
a container (Docker, Podman) or a microVM / sandboxed runtime (Firecracker, Kata,
gVisor). Whatever you `exec` into, the guest and its children are confined by it.

### Layer 1 · Resource quotas

Cap memory, CPU, and process count so a runaway program cannot exhaust the host.
The built-in wall-clock timeout catches *hangs*; these catch *consumption*. One
`ulimit` line each, no dependency:

```sh
ulimit -v 1048576   # ~1 GiB address space (RLIMIT_AS)
ulimit -t 30        # 30 CPU-seconds (RLIMIT_CPU)
ulimit -u 64        # max processes — fork-bomb guard
exec python3 "$@"
```

For hierarchical, accounted limits use cgroups —
`systemd-run --scope -p MemoryMax=1G -p CPUQuota=100% python3 "$@"`, or a
container's `--memory`/`--cpus`.

### Layer 2 · Filesystem restriction

Keep the guest from reading your secrets (`.env`, `~/.ssh`, other sessions' logs)
and from writing outside a scratch directory.

Allowlist with [landrun](https://github.com/Zouuup/landrun) (a Landlock CLI, no
daemon) — deny everything not listed:

```sh
exec landrun --ro /usr /lib /lib64 /etc --rw "$(dirname "$1")" -- python3 "$@"
```

or with bubblewrap (bind-mount allowlist + a private `/tmp`):

```sh
exec bwrap \
  --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$(dirname "$1")" "$(dirname "$1")" -- python3 "$@"
```

Or lean on plain Unix permissions: run as a dedicated user (see Layer 3) that
does not own your files; with `.env`/`~/.ssh` at `600`/`700`, the kernel denies
the guest access with zero extra config. Coarser than an allowlist (world-readable
files stay readable), but fully external.

### Layer 3 · Network filtering

Two distinct needs: cut the network entirely, or allow only specific
destinations.

**Cut it entirely** — a network namespace with no interfaces:

```sh
exec bwrap ... --unshare-net -- python3 "$@"      # bubblewrap
# or a container:  docker run --rm --network none ... python3 "$@"
```

**Allowlist destinations** — reach some hosts, deny the rest. Run the guest as a
dedicated low-privilege account and filter *that account's* traffic with
nftables. Drop the uid in `run.sh`:

```sh
exec setpriv --reuid=harpe-sandbox --regid=harpe-sandbox --clear-groups python3 "$@"
```

Create the account once (no login, no home):

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin harpe-sandbox
```

Then an nftables ruleset that allows chosen destinations for that uid and drops
the rest:

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

Because the guest process carries `harpe-sandbox`'s uid, `meta skuid` matches
exactly its traffic and nothing else on the host. The same dedicated user also
gives you the Layer 2 filesystem confinement for free.

**On the privilege to switch uids.** `setpriv`/`runuser` moving to a *different*
user needs authority the runner must already hold — full root (crude), systemd
ambient `CAP_SETUID`/`CAP_SETGID` on an otherwise-unprivileged agent
(recommended), a pinned `sudo -u harpe-sandbox` rule, or a `subuid` + user
namespace (`newuidmap`) delegation. This is an operator/DevOps decision, made in
`run.sh` and the service definition — outside the framework's concern. (If you
use `sudo`, name a single runas user — `ALL=(harpe-sandbox)`, never `(ALL,
!root)`, the shape behind CVE-2019-14287 — and pin the command.)

## Summary

Always on (framework): the compile-time capability gate, the wall-clock timeout,
and the environment scrub. On top of that, three restrictions you enable in
`sandbox/run.sh`, independently:

| Layer | Restriction | Enforce with |
|-------|-------------|--------------|
| 1 | resource quotas | `ulimit` / cgroups |
| 2 | filesystem restriction | `landrun` / `bwrap` / dedicated uid |
| 3 | network filtering | `--unshare-net`, or uid + nftables |

An agent handling anything sensitive adds the layers its environment calls for —
each a few lines in `run.sh`, using the OS tool your team already trusts.
