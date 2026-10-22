#!/bin/bash
# Builds, packages and signs a test DMG on the Desktop, then installs it into
# /Applications and reopens Nightly.
#
# When the local signing keychain exists, builds are signed with its
# self-signed certificate. The app's designated requirement then names that
# certificate instead of a per-build hash, so apps that approve Nightly by its
# signature, such as 1Password's "Add Browser", keep trusting new builds.
# Without the keychain, builds fall back to ad-hoc signing.
#
# Every DMG carries its build time in its file name, its volume name and the
# app version that Finder shows, so an installed copy can be matched to it.
#
# Artifact builds reuse the downloaded build ID, and Firefox clears a
# profile's cached browser code only when that ID changes. Without help, an
# installed copy keeps running the code of the first DMG that profile ever
# ran. The app therefore sets MOZ_PURGE_CACHES through LSEnvironment, so
# Firefox rebuilds the cache at each launch. A .purgecaches flag file would
# only clear it once, but Firefox deletes that file, which breaks the bundle's
# signature seal.
set -euo pipefail
cd "$(dirname "$0")/../.."
here=tools/recursive-split
py=/opt/homebrew/bin/python3.13
work=/tmp/ffsign
stamp=$(date +%m%d-%H%M)
out=~/Desktop/Nightly-split-$stamp.dmg
kc=~/Library/Keychains/nightly-split-signing.keychain-db
kcpass=~/.config/nightly-split/kc-pass
identity=-
if [ -f $kc ] && [ -f $kcpass ]; then
  security unlock-keychain -p "$(cat $kcpass)" $kc
  identity="Nightly Split Local Signing"
fi

$here/run-guarded.sh 1500 60 12000 -- nice -n 10 $py ./mach build -j8 > /tmp/ff-build-dmg.log 2>&1
$here/run-guarded.sh 1200 60 12000 -- nice -n 10 $py ./mach package > /tmp/ff-pkg.log 2>&1

rm -rf $work/stage $work/dmgsrc
mkdir -p $work/mnt $work/stage $work/dmgsrc
hdiutil attach -quiet -nobrowse -mountpoint $work/mnt obj-artifact/dist/firefox-157.0.1.en-US.mac.dmg
ditto $work/mnt/Nightly.app $work/stage/Nightly.app
hdiutil detach -quiet $work/mnt
$here/fix-helpers.sh $work/stage/Nightly.app > /dev/null
plutil -replace LSEnvironment.MOZ_PURGE_CACHES -string 1 \
  $work/stage/Nightly.app/Contents/Info.plist
plutil -replace CFBundleShortVersionString -string "157.0.1 split $stamp" \
  $work/stage/Nightly.app/Contents/Info.plist
$here/run-guarded.sh 900 40 8000 -- $py ./mach macos-sign -s "$identity" -a $work/stage/Nightly.app > /tmp/ff-sign.log 2>&1
codesign --verify --deep --strict $work/stage/Nightly.app

ditto $work/stage/Nightly.app $work/dmgsrc/Nightly.app
ln -s /Applications $work/dmgsrc/Applications
rm -f "$out"
hdiutil create -quiet -volname "Nightly Split $stamp" -srcfolder $work/dmgsrc -ov -format UDZO -fs HFS+ "$out"
codesign --sign "$identity" "$out"
echo "$out"

# Install right away so the change can be tried at once.
$here/install-dmg.sh "$out"
