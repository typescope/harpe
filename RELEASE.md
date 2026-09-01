# Release workflow

Harpe publishes three independently versioned Jo packages:

- `harpe-caps`, the pure capability interfaces
- `harpe`, the Python runtime package, which depends on `harpe-caps`
- `harpe-testing`, the test framework, which depends on neither

Packages are published through `https://pkg.typescope.ai`. Developers do not
need Cloudflare credentials.

Set the version once and paste the commands as written:

```sh
VERSION=0.9.0
MINOR=${VERSION%.*}          # the MAJOR.MINOR constraint consumers pin
PREV_MINOR=0.8               # the constraint being replaced
```

## Publication comes before the green build

Nothing in this repository resolves the registry any more. The framework, the CLI
agent, and both test suites all build from these sources, so a release pull
request is green throughout — the deadlock that used to make one red before
publication is gone with the agents that caused it.

What moved is where that tension lives. The five agents in
[typescope/agents](https://github.com/typescope/agents) are pinned to a published
release, so they are updated *after* publication, not before it. Step 8 is that
update.

## 1. Prepare the release pull request

Create a branch from the latest `origin/main`. In the pull request:

- [ ] Set `[module.caps.package].version` in `jo.toml`.
- [ ] Set `[module.harpe.package].version` in `jo.toml`.
- [ ] Set `[module.testing.package].version` in `jo.toml`.
- [ ] Confirm `harpe` has the intended `harpe-caps` dependency constraint, and
      that `harpe-testing` still declares none.
- [ ] Add the release notes to `CHANGELOG.md`.
- [ ] Update the version and link in the release badge in `README.md`.
- [ ] Confirm nothing here still pins a released version, with the check below.

Consumers here are the package blocks in the root `jo.toml` and nothing else —
`cli/` builds from source, so it carries no version to retarget. The pins that do
move live in `typescope/agents`, and step 8 moves them.

The only `version =` lines left in this repository are the three package blocks
in the root `jo.toml`. A constraint anywhere else means something started
resolving the registry again, which is what this layout exists to prevent:

```sh
grep -rn 'version = "' --include='jo.toml' . | grep -v '^./jo.toml'
```

**The gate before publishing is the `Jo` job**: `jo run test`, plus the CLI
agent's build and its end-to-end suite. All of it builds from these sources, so
it is green before publication and stays green after.

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

## 4. Merge

CI here does not depend on what has been published, so its verdict has not
changed since step 1. Merge when it is green and review is done.

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

## 8. Move the agents to the new release

The five agents in [typescope/agents](https://github.com/typescope/agents) are
pinned to the previous release until now. In that repository:

```sh
MINOR=${VERSION%.*}
grep -rl "version = \"$PREV_MINOR\"" --include='jo.toml' . \
  | xargs -r sed -i "s/version = \"$PREV_MINOR\"/version = \"$MINOR\"/g"
```

Then mirror this repository's `cli/` over it, rewriting its manifests from source
dependencies to those same pins — it is the one agent that lives here.

If the release changed an API, the agents need their sources adapted too, in the
same pull request. Its CI builds all six against the packages just published and
runs the suites that ship with them, so it is a real gate: `jo new` serves that
repository's default branch, and a red build there means users are being handed
templates that do not build.

Tag it `v$VERSION` to match.
