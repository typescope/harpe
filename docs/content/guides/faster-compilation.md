+++
title = "Speed Up Compilation"
+++
Harpe invokes the Jo compiler each time the model calls `runCode`. The default
Jo launcher starts the compiler on the JVM, so its startup time is paid on every
call. Compiling the launcher to a native binary makes repeated calls faster.

This is an optional performance optimization. It does not change the capability
boundary or the generated program.

## Build the native launcher

Install [GraalVM](https://www.graalvm.org/downloads/) and confirm that
`native-image --version` works. Then compile the Jo version you currently use:

```sh
cd "$HOME/.jo/compilers/$(jo --version)/bin"
native-image --no-fallback -jar jo.jar -o jo.native
```

In that directory, edit the `jo` launcher and replace its last line with:

```sh
exec "$BIN_DIR/jo.native" "$@"
```

Verify the launcher:

```sh
jo --version
```

Harpe replays the compiler launcher recorded when the sandbox was built, so
subsequent `runCode` calls use the native binary. Repeat these steps after
installing a new Jo version.

See [Install Jo](https://jo-lang.org/usage/install.html) for the upstream
installation instructions and native-launcher tip.
