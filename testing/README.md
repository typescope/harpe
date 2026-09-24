# Harpe testing

`harpe-testing-python` is a small test framework for Jo. It does not depend on
`harpe`, so it can test any Python-platform project.

## Add the dependency

Add the package to the app module that contains your tests. The `0.12` range
accepts the latest compatible 0.12 release:

```toml
[module.tests]
kind = "app"
platform = "python"
src = ["tests/"]
packages = [
  { name = "harpe-testing-python", version = "0.12" },
]

links = [
  { from = "jo.main", to = "my.tests.main" },
]
```

The module needs `enable-ffi = true` because the Python test runner uses the
host platform for its worker pool and clock. Keep the test module separate from
the application module when the application has a different entry point.

## Declare tests

Build a suite tree with `Testing.define`, `suite`, and `test`. Assertions are
recorded against the current test, so a test continues after a failed check and
reports all of its failures together.

```jo
namespace my.tests

import jo.IO.stdout
import harpe.testing.Runner
import harpe.testing.Testing
import harpe.testing.check
import harpe.testing.suite
import harpe.testing.test
import harpe.testing.thisSuite

def main(): Unit receives stdout, args =
  val root = Testing.define("my tests", () => suites())
  if !Runner.runWithArgs(root) then
    py.module("sys").exit(1)

private def suites(): Unit receives thisSuite =
  suite: "math", () =>
    test: "adds numbers", () =>
      check("one plus one", 1 + 1 == 2)
  suite: "independent checks", () =>
    thisSuite.parallel = true
    test: "first check", () => check("first", true)
    test: "second check", () => check("second", true)
```

The runner reports the suite tree and returns `false` when any test fails.
`runWithArgs` reads the first command-line argument as a filter. For the example
above, `math` selects the whole suite and `math/adds numbers` selects one test.
Use `Runner.run(root, filter, lanes)` when the caller needs to parse arguments
itself or choose a worker count.

Set `thisSuite.parallel = true` when the suite's direct children are independent
and safe to run concurrently. The runner keeps their report in declaration
order while using the configured worker pool.

## Run tests

Build and run the test module from the project root:

```sh
jo build tests
jo run tests
```

Pass a path after `--` to run only part of the tree:

```sh
jo run tests -- math
jo run tests -- "math/adds numbers"
```

Parallel suites use one worker per available CPU by default. Set
`HARPE_TEST_WORKERS` to bound the worker count, or pass an explicit non-negative
`lanes` value to `Runner.run`. A negative value keeps the environment-based
default.
