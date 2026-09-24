#!/usr/bin/env bash
# Unpack versioned Harpe API docs into docs/static/api/<library>/<version>/.
set -uo pipefail

REPO="${HARPE_REPO:-typescope/harpe}"
ASSET_BASE="${HARPE_DOCS_ASSET_BASE:-https://github.com/$REPO/releases/download}"
VERSIONS_FILE="docs/api-versions.jsonl"
OUT_DIR="docs/static/api"
METADATA="docs/api-docs.json"
PACKAGES=(harpe-caps harpe harpe-testing-python)

if [[ ! -f "$VERSIONS_FILE" ]]; then
  echo "no $VERSIONS_FILE — skipping Harpe API docs"
  exit 0
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
versions="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$VERSIONS_FILE")"
declare -A published

for package in "${PACKAGES[@]}"; do
  published["$package"]=""
  for version in $versions; do
    archive="$package-api-docs-v$version.zip"
    url="$ASSET_BASE/v$version/$archive"
    if ! curl -sSfL "$url" -o "$tmp/$archive" 2>/dev/null; then
      echo "  $package $version — no API docs asset, skipping"
      continue
    fi
    if ! unzip -q -o "$tmp/$archive" -d "$OUT_DIR" 2>/dev/null; then
      echo "  $package $version — asset is not a readable zip, skipping"
      continue
    fi
    if [[ ! -f "$OUT_DIR/$package/$version/index.html" ]]; then
      echo "  $package $version — asset is missing index.html, skipping"
      rm -rf "$OUT_DIR/$package/$version"
      continue
    fi
    echo "  $package $version — published at /api/$package/$version/"
    published["$package"]+="$version "
  done
done

found=0
printf '{\n  "libraries": [' > "$METADATA"
for package in "${PACKAGES[@]}"; do
  list="${published[$package]}"
  [[ -n "$list" ]] || continue
  ((found++))
  [[ "$found" -eq 1 ]] || printf ',' >> "$METADATA"
  printf '\n    {\n      "name": "%s",\n      "versions": [' "$package" >> "$METADATA"
  first=1
  read -ra entries <<< "$list"
  for (( index=${#entries[@]} - 1; index >= 0; index-- )); do
    [[ "$first" -eq 1 ]] || printf ',' >> "$METADATA"
    first=0
    version="${entries[$index]}"
    printf '\n        { "version": "%s", "path": "/api/%s/%s/" }' "$version" "$package" "$version" >> "$METADATA"
  done
  printf '\n      ]\n    }' >> "$METADATA"
done
printf '\n  ]\n}\n' >> "$METADATA"

if [[ "$found" -eq 0 ]]; then
  rm -rf "$OUT_DIR"
  echo "no API docs assets found — API dropdown will be hidden"
else
  echo "published API docs for $found package(s)"
fi
