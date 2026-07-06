# The Harpe sandbox — security model

A Harpe agent is an LLM that acts **only** by writing Jo programs that are
compiled and run each turn. This document describes the layers that contain
those programs, from the always-on gate to the opt-in defense-in-depth.

The design point worth stating up front: **OS-level confinement lives outside
the framework, in a shell script you write.** Harpe does not ship a bespoke
Landlock/seccomp implementation you would have to trust — it hands you a seam
(`sandbox/run.sh`) where you drop in `docker`, `bwrap`, `landrun`, `firejail`,
`setpriv`, or plain `ulimit`: tooling your ops team already audits. Confinement
you can read beats confinement you can't.

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

## Layer 1 — host-side backstops (always on)

Two things the guest cannot disable, applied by the runner (`runCapped`) around
every build and run:

- **Wall-clock timeout + process-group kill.** The compiled program runs under a
  time limit; on expiry the whole process group is SIGKILLed, so a stuck build
  or an infinite loop — even one that forks — cannot hang the agent. Tool output
  fed back to the model is size-bounded.
- **Environment scrub.** Guest code runs with a minimal environment — only
  `PATH`, so the interpreter and any `run.sh` tool are found. Every host variable
  is dropped, secret or not (the provider keys, and anything else in the agent's
  env), rather than guessing which are sensitive. A capability that needs a
  secret gets it added back deliberately in `run.sh`. (The trusted build/compile
  step keeps the full toolchain env; only untrusted guest *runs* are scrubbed.)

## Layer 2 — the `sandbox/run.sh` wrapper (opt-in, external, your choice of tool)

Beneath the type-level gate, this is the OS-level containment layer — and it is
deliberately **not framework code**. If an executable `sandbox/run.sh` exists,
the runner launches each guest program through it:

```
sandbox/run.sh <path-to-compiled-out.py>
```

instead of `python3 <out.py>`. The script owns **everything** about how the
program runs — the Python interpreter, any privilege drop, and OS confinement —
and then `exec`s it. Absent, the guest runs under the system Python with just
the layer-0/1 protections. Each driver ships a `sandbox/run.sh.example` with
ready-to-adapt blocks; enable it by renaming to `run.sh` and `chmod +x`.

**The contract** is tiny:

- `$1` is the absolute path to the compiled program (a `.py`).
- The run directory is `dirname "$1"` — bind-mount it for container wrappers.
- Do your setup, then `exec <python> "$@"`.
- The runner already handed the guest a minimal environment (only `PATH`); add
  back anything it needs here.

Because the restriction is applied *around* `exec`, it is inherited by the guest
and everything it spawns — the same property that makes `docker`/`bwrap`/Landlock
containment sound.

### Examples (adapt one)

**Resource limits, no dependency** — the in-process rlimits Harpe used to apply
are one `ulimit` line each, and clearer here:

```sh
#!/bin/sh
ulimit -v 1048576   # ~1 GiB address space (RLIMIT_AS)
ulimit -t 30        # 30 CPU-seconds (RLIMIT_CPU)
exec python3 "$@"
```

**Filesystem + network confinement** — with [landrun](https://github.com/Zouuup/landrun)
(a Landlock CLI, no daemon), the guest reads only what you list and cannot touch
the network:

```sh
exec landrun --ro /usr /lib /lib64 /etc --rw "$(dirname "$1")" -- python3 "$@"
```

or with bubblewrap:

```sh
exec bwrap \
  --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$(dirname "$1")" "$(dirname "$1")" \
  --unshare-net -- python3 "$@"
```

**Full container isolation** — docker gives a fresh filesystem, its own env, and
`--network none` in one line (mount the run dir so `out.py` is visible):

```sh
exec docker run --rm --network none \
  -v "$(dirname "$1"):$(dirname "$1"):ro" python:3.12-slim python3 "$@"
```

## IP-restricted egress — drop to a uid, filter with nftables

When the guest legitimately needs *some* network but must be held to specific
destinations, the wrapper drops to a dedicated low-privilege account and the
operator filters that account's traffic with nftables.

In `run.sh`, drop the uid before exec:

```sh
exec setpriv --reuid=harpe-sandbox --regid=harpe-sandbox --clear-groups python3 "$@"
```

Create the account once (no login, no home):

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin harpe-sandbox
```

Then an nftables ruleset that allows only chosen destinations for that uid and
drops the rest:

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

**On the privilege to switch uids.** `setpriv`/`runuser` moving to a *different*
user needs authority the runner must already hold — full root (crude), systemd
ambient `CAP_SETUID`/`CAP_SETGID` on an otherwise-unprivileged agent
(recommended), a pinned `sudo -u harpe-sandbox` rule, or a `subuid` + user
namespace (`newuidmap`) delegation. This is an operator/DevOps decision, made in
`run.sh` and the service definition — outside the framework's concern. (If you
use `sudo`, name a single runas user — `ALL=(harpe-sandbox)`, never `(ALL,
!root)`, the shape behind CVE-2019-14287 — and pin the command.)

Filesystem confinement can lean on the same dedicated user for free: run as an
account that does not own your secrets, keep `.env`/`~/.ssh` at `600`/`700`, and
standard Unix permissions deny the guest access — coarser than Landlock's
allowlist, but external and zero-config once the uid drop is in place.

## Summary

| Layer | What it stops | On by default | Where |
|-------|---------------|---------------|-------|
| 0 · compile-time gate | naming ungranted abilities | yes | `sandbox/` compile |
| 1 · timeout + env scrub | hangs, infinite loops, secret inheritance | yes | `runCapped` (host) |
| 2 · `run.sh` wrapper | fs / network / resources / uid — your tool | opt-in | `sandbox/run.sh` |

Layers 0–1 hold for every agent. An agent handling anything sensitive enables
`run.sh` with the confinement tool its environment trusts; one that needs
controlled network egress drops a uid there and filters it with nftables.
