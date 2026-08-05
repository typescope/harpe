# Release workflow

Harpe publishes two independently versioned Jo packages:

- `harpe-caps`, the pure capability interfaces
- `harpe`, the Python runtime package, which depends on `harpe-caps`

Release artifacts are retained on the private `typescope/harpe` GitHub release
and published for Jo clients through `https://pkg.typescope.ai`. Developers do
not need Cloudflare credentials.

## 1. Prepare a release pull request

Create a branch from the latest `origin/main`. In the pull request:

1. Set `[module.caps.package].version` and `[module.harpe.package].version` in
   `jo.toml` to the intended versions.
2. Add the release notes to `CHANGELOG.md`.
3. Update the release badge in `README.md`.
4. Confirm package dependency constraints still describe the intended minimum
   compatible versions.

Do not tag or package the release from the pull-request branch. Wait for all
required CI checks to pass and merge the pull request into `main`.

## 2. Tag the merged commit

Update the local checkout and verify that it is clean and at the merged commit:

```sh
git switch main
git pull --ff-only origin main
git status --short
```

Run the full test suite with the dependencies from `requirements.txt`, then tag
the exact tested commit:

```sh
jo run test
git tag -a v0.1.0 -m "Harpe 0.1.0"
git push origin v0.1.0
```

Never move or reuse a published version tag.

## 3. Build the release artifacts

Build capability interfaces first, followed by the runtime package:

```sh
jo package caps
jo package harpe
```

Jo writes the artifacts under:

```text
.build/caps/release/
.build/harpe/release/
```

Each package produces a `.joy`, `.joy.sha512`, source archive, and source
checksum. Verify both artifact checksums before uploading:

```sh
(cd .build/caps/release && sha512sum --check harpe-caps-v0.1.0.joy.sha512)
(cd .build/harpe/release && sha512sum --check harpe-v0.1.0.joy.sha512)
```

## 4. Create the Harpe GitHub release

Create a permanent release in the private Harpe repository containing the
binary and source artifacts for both packages:

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

## 5. Publish through the TypeScope registry

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

Wait for the proxy's `Publish package` workflow to succeed. It validates the
checksum and package metadata, writes the artifact and JSONL index to R2, then
deletes the temporary release and tag. Next publish `harpe`:

```sh
gh release create upload-harpe-v0.1.0 \
  --repo typescope/proxy \
  .build/harpe/release/harpe-v0.1.0.joy \
  .build/harpe/release/harpe-v0.1.0.joy.sha512 \
  --prerelease \
  --title "Publish harpe 0.1.0" \
  --notes "Internal package publication upload"
```

If publication fails, the proxy keeps the temporary release for inspection and
workflow retry. A version may be retried with identical bytes but must never be
replaced with different content.

## 6. Verify public resolution

Confirm both indexes and artifacts are publicly reachable:

```sh
curl --fail https://pkg.typescope.ai/harpe-caps.jsonl
curl --fail https://pkg.typescope.ai/harpe.jsonl
```

Finally, use a clean Jo cache and build the shipped applications with:

```sh
export JO_REGISTRY_URL=https://pkg.typescope.ai
```

Verify the CLI, web, and Telegram drivers and their sandbox guests before
announcing the release.
