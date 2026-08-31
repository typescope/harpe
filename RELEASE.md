# Release workflow

Harpe publishes three independently versioned Jo packages:

- `harpe-caps`, the pure capability interfaces
- `harpe`, the Python runtime package, which depends on `harpe-caps`
- `harpe-testing`, the test framework, which depends on neither

Packages are published through `https://pkg.typescope.ai`. Developers do not
need Cloudflare credentials.

Set the version once and paste the commands as written:

```sh
VERSION=0.8.0
MINOR=${VERSION%.*}          # the MAJOR.MINOR constraint consumers pin
PREV_MINOR=0.7               # the constraint being replaced
```

## Publication comes before the green build

CI builds each driver twice: from `ci/*.toml` against local sources, and from
the driver's own `jo.toml` against the public registry. A release that changes
the API means the driver *sources* already need the new version, so the
registry-resolving jobs **cannot pass until that version is published**.

So a release pull request is red before publication and green after it. Waiting
for green before publishing deadlocks, and publishing from a merged commit is
therefore impossible for any release that changes the API.

What replaces "publish from a merged commit" as the safety property is step 5: a
content check proving the published artifact matches what landed on `main`.
Between publishing and merging, **do not push another source change**. A
published version is immutable — it may be retried with identical bytes, never
replaced with different content — so a post-publication fix means burning the
version and releasing the next patch instead.

## 1. Prepare the release pull request

Create a branch from the latest `origin/main`. In the pull request:

- [ ] Set `[module.caps.package].version` in `jo.toml`.
- [ ] Set `[module.harpe.package].version` in `jo.toml`.
- [ ] Set `[module.testing.package].version` in `jo.toml`.
- [ ] Confirm `harpe` has the intended `harpe-caps` dependency constraint, and
      that `harpe-testing` still declares none.
- [ ] Add the release notes to `CHANGELOG.md`.
- [ ] Update the version and link in the release badge in `README.md`.
- [ ] Retarget every consuming `harpe` and `harpe-caps` constraint, with the
      command below.

Consumers are every `jo.toml` except the repo root's and `ci/`'s: the
applications, the templates, the examples, each of their `sandbox/` manifests,
and any secondary module such as `[module.view]`. Nothing here names them
individually, so adding a template or an example does not change this checklist.

```sh
grep -rl "version = \"$PREV_MINOR\"" --include='jo.toml' . | grep -v '^\./ci/' \
  | xargs -r sed -i "s/version = \"$PREV_MINOR\"/version = \"$MINOR\"/g"
```

Jo package constraints use `MAJOR.MINOR`, so `0.7.0` is referenced as `0.7`. The
pattern the command rewrites is the constraint alone — a package's own
`version = "MAJOR.MINOR.PATCH"` in the root `jo.toml` is a different string, so
the rewrite cannot reach it. A minor bump retargets every consumer. A patch bump
retargets none, and the command is a harmless no-op.

Confirm the constraint being replaced now matches nothing, and that the new one
reached every consumer:

```sh
grep -rn "version = \"$PREV_MINOR\"" --include='jo.toml' . | grep -v '^\./ci/'
grep -rln "version = \"$MINOR\"" --include='jo.toml' . | grep -v '^\./ci/'
```

**The gate before publishing is the local-source half of CI**: every
`jo build … --spec ci/*.toml` job, plus `jo run test`. Those prove the code is
correct. The registry-resolving jobs are expected to fail here, and are the
thing publication fixes.

A patch release that changes no API is the one case where the driver pins can go
in a second pull request after publication, as they resolve against the older
published minor either way. It is not worth a separate process.

## 2. Build and verify the artifacts from the pull request head

```sh
git status --short          # must be clean
jo run test
jo package caps
jo package harpe
jo package testing
```

Jo writes the artifacts under `.build/caps/release/` and
`.build/harpe/release/`. Verify their checksums:

```sh
(cd .build/caps/release && sha512sum --check harpe-caps-v$VERSION.joy.sha512)
(cd .build/harpe/release && sha512sum --check harpe-v$VERSION.joy.sha512)
(cd .build/testing/release && sha512sum --check harpe-testing-v$VERSION.joy.sha512)
```

Confirm the package carries what it should — the dependency constraint, and any
bundled resources:

```sh
unzip -p .build/harpe/release/harpe-v$VERSION.joy meta.toml | grep -E 'version|harpe-caps'
unzip -l .build/harpe/release/harpe-v$VERSION.joy | grep resources/ | head
```

Keep an extracted copy for the step 5 check, before anything else can rebuild
over it:

```sh
mkdir -p /tmp/published-$VERSION && (cd /tmp/published-$VERSION && \
  unzip -oq $OLDPWD/.build/harpe/release/harpe-v$VERSION.joy)
```

## 3. Publish the packages

The proxy accepts one package per temporary private release. Publish
`harpe-caps` first so that `harpe` never points at an unavailable dependency.
`harpe-testing` depends on nothing, so its position does not matter — it goes
last only to keep the order memorable:

```sh
gh release create upload-harpe-caps-v$VERSION \
  --repo typescope/proxy \
  .build/caps/release/harpe-caps-v$VERSION.joy \
  .build/caps/release/harpe-caps-v$VERSION.joy.sha512 \
  --prerelease \
  --title "Publish harpe-caps $VERSION" \
  --notes "Internal package publication upload"
```

Wait for the proxy's `Publish package` workflow to succeed, then publish
`harpe`:

```sh
gh release create upload-harpe-v$VERSION \
  --repo typescope/proxy \
  .build/harpe/release/harpe-v$VERSION.joy \
  .build/harpe/release/harpe-v$VERSION.joy.sha512 \
  --prerelease \
  --title "Publish harpe $VERSION" \
  --notes "Internal package publication upload"
```

Then `harpe-testing`, the same way:

```sh
gh release create upload-harpe-testing-v$VERSION \
  --repo typescope/proxy \
  .build/testing/release/harpe-testing-v$VERSION.joy \
  .build/testing/release/harpe-testing-v$VERSION.joy.sha512 \
  --prerelease \
  --title "Publish harpe-testing $VERSION" \
  --notes "Internal package publication upload"
```

The workflow validates the checksum and metadata, writes the artifact and JSONL
index to R2, then deletes the temporary release and tag. On failure it retains
them for inspection and retry.

Confirm all three indexes are publicly reachable:

```sh
curl --fail https://pkg.typescope.ai/harpe-caps.jsonl | tail -1
curl --fail https://pkg.typescope.ai/harpe.jsonl | tail -1
curl --fail https://pkg.typescope.ai/harpe-testing.jsonl | tail -1
```

## 4. Re-run CI, then merge

Re-run the pull request's checks. The registry-resolving jobs now resolve the
version just published, and the run should be fully green. Merge only then.

If review still demands a source change, the published version is spent: do not
force the artifacts to match. Bump to the next patch, and start again at step 1.

## 5. Verify the merged commit matches what was published

This is the check that makes publishing from a branch safe. Repackage from
`main` and compare *content*, not archive bytes — `jo package` records the build
time in each zip entry, so two runs over an identical tree differ in bytes while
their contents are the same:

```sh
git switch main
git pull --ff-only origin main
jo package harpe

rm -rf /tmp/merged-$VERSION && mkdir -p /tmp/merged-$VERSION
(cd /tmp/merged-$VERSION && unzip -oq $OLDPWD/.build/harpe/release/harpe-v$VERSION.joy)

diff -r /tmp/published-$VERSION /tmp/merged-$VERSION && echo "matches what was published"
```

Any difference means something changed between publishing and merging. The
registry cannot be corrected — release the next patch from `main` instead.

## 6. Tag the merged commit

```sh
git status --short
git tag -a v$VERSION -m "Harpe $VERSION"
git push origin v$VERSION
```

Never move or reuse a published version tag.

## 7. Create the permanent Harpe GitHub release

The release notes are the new version's section of `CHANGELOG.md` alone, so cut
it out — passing the whole file would republish every earlier version's notes:

```sh
awk '/^## /{n++} n==1' CHANGELOG.md > /tmp/notes-v$VERSION.md
```

Create a private release containing the binary and source artifacts:

```sh
gh release create v$VERSION \
  .build/caps/release/harpe-caps-v$VERSION.joy \
  .build/caps/release/harpe-caps-v$VERSION.joy.sha512 \
  .build/caps/release/harpe-caps-v$VERSION-sources.zip \
  .build/caps/release/harpe-caps-v$VERSION-sources.zip.sha512 \
  .build/harpe/release/harpe-v$VERSION.joy \
  .build/harpe/release/harpe-v$VERSION.joy.sha512 \
  .build/harpe/release/harpe-v$VERSION-sources.zip \
  .build/harpe/release/harpe-v$VERSION-sources.zip.sha512 \
  .build/testing/release/harpe-testing-v$VERSION.joy \
  .build/testing/release/harpe-testing-v$VERSION.joy.sha512 \
  .build/testing/release/harpe-testing-v$VERSION-sources.zip \
  .build/testing/release/harpe-testing-v$VERSION-sources.zip.sha512 \
  --repo typescope/harpe \
  --verify-tag \
  --title "Harpe $VERSION" \
  --notes-file /tmp/notes-v$VERSION.md
```
