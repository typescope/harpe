# Release workflow

Harpe publishes two independently versioned Jo packages:

- `harpe-caps`, the pure capability interfaces
- `harpe`, the Python runtime package, which depends on `harpe-caps`

Packages are published through `https://pkg.typescope.ai`. Developers do not
need Cloudflare credentials. The final tag is created only after the drivers
have resolved and built against the published package versions.

## 1. Prepare the package pull request

Create a branch from the latest `origin/main`. In the pull request:

- [ ] Set `[module.caps.package].version` in `jo.toml`.
- [ ] Set `[module.harpe.package].version` in `jo.toml`.
- [ ] Confirm `harpe` has the intended `harpe-caps` dependency constraint.
- [ ] Add the release notes to `CHANGELOG.md`.
- [ ] Update the version and link in the release badge in `README.md`.

Wait for required CI checks to pass and merge. Do not tag yet.

## 2. Build and publish the packages

Update the local checkout, run the tests, and build from the merged commit:

```sh
git switch main
git pull --ff-only origin main
git status --short
jo run test
jo package caps
jo package harpe
```

Jo writes the artifacts under `.build/caps/release/` and
`.build/harpe/release/`. Verify their checksums:

```sh
(cd .build/caps/release && sha512sum --check harpe-caps-v0.1.0.joy.sha512)
(cd .build/harpe/release && sha512sum --check harpe-v0.1.0.joy.sha512)
```

The proxy accepts one package per temporary private release. Publish
`harpe-caps` first so that `harpe` never points at an unavailable dependency:

```sh
gh release create upload-harpe-caps-v0.1.0 \
  --repo typescope/proxy \
  .build/caps/release/harpe-caps-v0.1.0.joy \
  .build/caps/release/harpe-caps-v0.1.0.joy.sha512 \
  --prerelease \
  --title "Publish harpe-caps 0.1.0" \
  --notes "Internal package publication upload"
```

Wait for the proxy's `Publish package` workflow to succeed, then publish
`harpe`:

```sh
gh release create upload-harpe-v0.1.0 \
  --repo typescope/proxy \
  .build/harpe/release/harpe-v0.1.0.joy \
  .build/harpe/release/harpe-v0.1.0.joy.sha512 \
  --prerelease \
  --title "Publish harpe 0.1.0" \
  --notes "Internal package publication upload"
```

The workflow validates the checksum and metadata, writes the artifact and JSONL
index to R2, then deletes the temporary release and tag. On failure it retains
them for inspection and retry. A version may be retried with identical bytes,
but must never be replaced with different content.

## 3. Verify public resolution

Confirm both indexes are publicly reachable:

```sh
curl --fail https://pkg.typescope.ai/harpe-caps.jsonl
curl --fail https://pkg.typescope.ai/harpe.jsonl
```

## 4. Prepare the driver integration pull request

Only after both packages are public, create a second branch from `main`. In the
pull request:

- [ ] Update the `harpe` package version in `cli/jo.toml`, `web/jo.toml`, and
      `telegram/jo.toml`.
- [ ] Update the `harpe` and `harpe-caps` versions in each driver's
      `sandbox/jo.toml`.
- [ ] Set `JO_REGISTRY_URL=https://pkg.typescope.ai` in CI.
- [ ] Build CLI, web, and Telegram from their own `jo.toml` files so CI resolves
      the published packages instead of local source modules.
- [ ] Build every driver sandbox guest from its own `sandbox/jo.toml`.

Jo package constraints use `MAJOR.MINOR`, so a `0.1.0` package is referenced as
`0.1`. A metadata file already carrying that constraint needs no textual edit;
confirm it explicitly during review.

Wait for required checks to pass and merge. This green integration commit is
the commit to tag: it contains the package and driver versions tested against
the public registry.

## 5. Tag the tested integration commit

```sh
git switch main
git pull --ff-only origin main
git status --short
git tag -a v0.1.0 -m "Harpe 0.1.0"
git push origin v0.1.0
```

Never move or reuse a published version tag.

## 6. Create the permanent Harpe GitHub release

Create a private release containing the binary and source artifacts:

```sh
gh release create v0.1.0 \
  .build/caps/release/harpe-caps-v0.1.0.joy \
  .build/caps/release/harpe-caps-v0.1.0.joy.sha512 \
  .build/caps/release/harpe-caps-v0.1.0-sources.zip \
  .build/caps/release/harpe-caps-v0.1.0-sources.zip.sha512 \
  .build/harpe/release/harpe-v0.1.0.joy \
  .build/harpe/release/harpe-v0.1.0.joy.sha512 \
  .build/harpe/release/harpe-v0.1.0-sources.zip \
  .build/harpe/release/harpe-v0.1.0-sources.zip.sha512 \
  --repo typescope/harpe \
  --verify-tag \
  --title "Harpe 0.1.0" \
  --notes-file CHANGELOG.md
```
