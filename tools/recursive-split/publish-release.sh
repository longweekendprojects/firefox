#!/bin/bash
# Publishes a notarized DMG from make-dmg.sh as the latest GitHub release of
# the fork. The README links to releases/latest/download/$asset, so the asset
# keeps the same name in every release.
#
# Run it from a clean tree whose HEAD is pushed, right after make-dmg.sh built
# the DMG from that HEAD.
set -euo pipefail
cd "$(dirname "$0")/../.."
dmg=${1:?usage: publish-release.sh <notarized dmg>}
repo=longweekendprojects/firefox
asset=Nightly-Split-macOS-arm64.dmg

xcrun stapler validate -q "$dmg"
spctl --assess --type open --context context:primary-signature "$dmg"

[ -z "$(git status --porcelain --untracked-files=no)" ] ||
  { echo "publish-release: commit your changes first" >&2; exit 1; }
git fetch -q fork recursive-split
git merge-base --is-ancestor HEAD fork/recursive-split ||
  { echo "publish-release: push HEAD to fork/recursive-split first" >&2; exit 1; }

ver=$(cat browser/config/version.txt)
build=$(basename "$dmg" .dmg)
build=${build#Nightly-split-}
tag="split-$ver-$build"
commit=$(git rev-parse HEAD)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp "$dmg" "$tmp/$asset"
sha=$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)

cat > "$tmp/notes.md" << EOF
Nightly with recursive split view, based on Firefox $ver.

**Install**
1. Download \`$asset\` below.
2. Open it and drag Nightly to Applications.
3. Open Nightly from Applications.

The app is signed and notarized by Apple, so it opens without a warning.

**Requirements:** a Mac with Apple Silicon (M1 or newer).

**Good to know**
- Nightly uses its own profile, so your Firefox data is not touched.
- It does not update itself. Download a new release to update.
- To unlock 1Password with Touch ID, open the 1Password app, go to Settings, then Browser, click Add Browser, and choose Nightly. You do this once per Mac.

Build \`$build\`, from commit \`${commit:0:12}\`.
SHA-256: \`$sha\`
EOF

gh release create "$tag" "$tmp/$asset" -R "$repo" --target "$commit" \
  --title "Nightly Split $ver ($build)" --notes-file "$tmp/notes.md" --latest
echo "https://github.com/$repo/releases/latest/download/$asset"
