# Release workflow

Releases are made in `typescope/harpe`. Confirm that `origin` points to this
repository before pushing a release branch or tag.

Harpe publishes three packages together: `harpe-caps` (pure capability
interfaces), `harpe` (the Python runtime, depending on `harpe-caps`), and
`harpe-testing-python` (the independent test framework).

The order is: validate locally, merge a green release PR, publish the GitHub
release, wait for Jo's registry, merge a separate template PR, open the two
downstream upgrade PRs, then deploy the documentation.

~~~sh
VERSION=0.12.0
MINOR=${VERSION%.*}
PREV_MINOR=0.11
~~~

## 1. Prepare and validate locally

Start a release branch from the latest public `origin/main`. Activate the
repository's `.venv/` and install the framework and template requirements:

~~~sh
git fetch origin main
git switch -c release-$VERSION origin/main
. .venv/bin/activate
python -m pip install -r requirements.txt
for requirements in templates/*/requirements.txt; do
  python -m pip install -r "$requirements" || exit 1
done
~~~

Use the same released Jo compiler that CI installs. Compare `jo --version`
with `gh release view --repo typescope/jo --json tagName --jq .tagName`.
If they differ, install the current release before validating or packaging.
For 0.12.0 this is Jo 0.13.5. An artifact built by an incompatible compiler
cannot be repaired once the registry records it.

Prepare the release changes:

- Set all three package versions in the root `jo.toml`.
- Turn the unreleased section of `CHANGELOG.md` into dated release notes,
  including breaking APIs and migration instructions.
- Update the release badge and link in `README.md`.
- Keep template manifests pinned to the previous published release in this PR.

Prepare template API migrations on a separate local branch. Bring forward the
pending commits from `after-harpe-release`, resolving conflicts with current
`main`, and keep additional compatibility fixes on that template branch.
Use a separate worktree so these changes do not enter the release PR.

~~~sh
jo run test
(cd cli && jo build agent && jo build --spec sandbox/jo.toml guest && jo run tests)
python3 scripts/test-templates-local.py --templates /path/to/template-worktree/templates
~~~

The helper requires Python 3.11 or later. It copies each template to a temporary
directory, replaces its Harpe package dependencies with direct module references
to this release checkout, and builds its sandbox and agent. It also runs every
declared `tests` module. It copies no `.env`, virtual environment, lock file,
runtime data, or existing build output. Absolute module paths keep copied test
sandboxes connected to the same sources. The original manifests stay untouched.
Without `--templates`, it tests this checkout's templates.

If parallel tests exhaust local resources, set `HARPE_TEST_WORKERS=2`.
Fix failures and repeat affected checks. Review the template migrations alongside
the release so a new API has a tested consumer before publication.

## 2. Open and merge the release PR

Open a PR against `typescope/harpe:main` containing the package versions,
release notes, badge, and release workflow changes. Record the local framework,
CLI, and template validation in its description.

The `Jo` job must pass on the final PR head. Every other triggered check must
also pass. Template pins and pending template features belong in the later PR,
so the release PR does not depend on an unpublished package.

~~~sh
gh pr checks --repo typescope/harpe RELEASE_PR
gh pr merge --repo typescope/harpe RELEASE_PR --merge --match-head-commit HEAD_SHA
git fetch origin main
git switch --detach origin/main
git status --short
~~~

Review the diff before merging. If the head changes, verify its checks again.
Package only from the clean merged commit, with the compiler used for validation.

## 3. Package and publish the public GitHub release

~~~sh
jo package caps
jo package harpe
jo package testing

(cd .build/caps/release && sha512sum --check harpe-caps-v$VERSION.joy.sha512 && sha512sum --check harpe-caps-v$VERSION-sources.zip.sha512)
(cd .build/harpe/release && sha512sum --check harpe-v$VERSION.joy.sha512 && sha512sum --check harpe-v$VERSION-sources.zip.sha512)
(cd .build/testing/release && sha512sum --check harpe-testing-python-v$VERSION.joy.sha512 && sha512sum --check harpe-testing-python-v$VERSION-sources.zip.sha512)

unzip -p .build/harpe/release/harpe-v$VERSION.joy meta.toml
unzip -p .build/testing/release/harpe-testing-python-v$VERSION.joy meta.toml
unzip -l .build/harpe/release/harpe-v$VERSION.joy
~~~

Confirm that `harpe` depends on the new `harpe-caps` compatibility line, that
`harpe-testing-python` has no package dependencies, and that Harpe's assets
are bundled. Verify binary and source checksums for every package.

Extract only this version's notes, then tag the merged commit:

~~~sh
awk -v version="$VERSION" '
  /^## / { if (found) exit; found = ($2 == version) }
  found { print }
' CHANGELOG.md > /tmp/harpe-release-notes.md
test -s /tmp/harpe-release-notes.md
git tag -a v$VERSION -m "Harpe $VERSION"
git push origin v$VERSION

gh release create v$VERSION \
  .build/caps/release/harpe-caps-v$VERSION.joy \
  .build/caps/release/harpe-caps-v$VERSION.joy.sha512 \
  .build/caps/release/harpe-caps-v$VERSION-sources.zip \
  .build/caps/release/harpe-caps-v$VERSION-sources.zip.sha512 \
  .build/harpe/release/harpe-v$VERSION.joy \
  .build/harpe/release/harpe-v$VERSION.joy.sha512 \
  .build/harpe/release/harpe-v$VERSION-sources.zip \
  .build/harpe/release/harpe-v$VERSION-sources.zip.sha512 \
  .build/testing/release/harpe-testing-python-v$VERSION.joy \
  .build/testing/release/harpe-testing-python-v$VERSION.joy.sha512 \
  .build/testing/release/harpe-testing-python-v$VERSION-sources.zip \
  .build/testing/release/harpe-testing-python-v$VERSION-sources.zip.sha512 \
  --repo typescope/harpe --verify-tag \
  --title "Harpe $VERSION" --notes-file /tmp/harpe-release-notes.md
~~~

All three packages are assets of this public release. Private proxy upload
releases are no longer part of the process. Never move a published tag or
replace a recorded version's artifacts; fix a bad release with a new version.

## 4. Wait for Jo's registry

The registrations in `typescope/packages` must name `typescope/harpe` as their
`[publish].github` source. Jo discovers release assets automatically and
verifies their checksums. See the
[registry reference](https://jo-lang.org/usage/reference/registry.html).

The registry scans hourly. To request an immediate scan:

~~~sh
gh workflow run sync-releases.yml --repo typescope/packages
~~~

Wait for all three versions to appear at the public endpoints:

~~~sh
curl --fail https://pkg.jo-lang.org/harpe-caps.jsonl
curl --fail https://pkg.jo-lang.org/harpe.jsonl
curl --fail https://pkg.jo-lang.org/harpe-testing-python.jsonl
~~~

Check the exact version, artifact URL, and checksum against the GitHub release.
A successful sync workflow alone is insufficient: it can finish without adding
a package. Do not advance the template or downstream pins until all three
entries are available from `pkg.jo-lang.org`.

## 5. Update the templates in a separate PR

Bring the prepared template branch onto the merged public `main`. Include the
pending `after-harpe-release` changes and the compatibility fixes already
validated in step 1. Update every Harpe constraint under `templates/` from
`PREV_MINOR` to `MINOR`, including test and sandbox manifests.

Use Jo's public registry (`https://pkg.jo-lang.org`) in the `Templates` workflow.
Clear any local `JO_REGISTRY_URL` override or set it to that URL. Rebuild each
template's sandbox and agent against the published packages, and run every
declared test suite. Check `jo new` against the PR commit as well, now that the
repository is public.

Open the template PR against `typescope/harpe:main`. Check that its diff contains
published package pins, with no temporary source references. Merge only when
the `Jo` job and all `Templates` jobs pass on its final head. `jo new` serves
the default branch, so these checks protect newly created projects.

## 6. Open the downstream upgrade PRs

Create one PR in each of:

- `typescope/smart-logistics`
- `typescope/campaign-planner`

Start from each repository's current `main`, read its contributor instructions,
and update every Harpe dependency in its application, tests, and sandbox
manifests. Adapt changed APIs and regenerate tracked lock files with `jo lock`
against the public registry. Update workflow registry overrides as needed.
Build the application and all sandbox guests, run its documented tests, and
include the results in the PR. Leave these PRs for downstream review.

## 7. Deploy the documentation

After the template PR is merged and both downstream PRs are open, deploy the
public repository's current `main`:

~~~sh
gh workflow run docs.yml --repo typescope/harpe --ref main
gh run list --repo typescope/harpe --workflow docs.yml --limit 1
gh run watch --repo typescope/harpe RUN_ID --exit-status
~~~

Confirm the deployment succeeds and `https://harpe.typescope.ai` serves the
updated site. Documentation PR builds validate the site; only the manual
workflow dispatch publishes it.
