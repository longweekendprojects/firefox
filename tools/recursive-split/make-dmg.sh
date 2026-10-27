#!/bin/bash
# Builds a test DMG on the Desktop, then installs it into /Applications and
# reopens Nightly.
#
# By default the app is signed with the Developer ID in the login keychain,
# then notarized, so it opens on any Mac without a warning. 1Password trusts
# it after "Add Browser" once per Mac, because the signature keeps the same
# team ID across builds. The notary password is read from the keychain
# profile "nightly-notary" (xcrun notarytool store-credentials).
#
# The app sets MOZ_PURGE_CACHES through LSEnvironment. Artifact builds reuse
# the downloaded build ID, so without it Firefox would keep running its cached
# copy of the old interface code. A .purgecaches file would break the
# signature seal, because Firefox deletes it.
#
# SIGN=mozilla instead keeps Mozilla's signed Firefox release with our
# interface files (omni.ja) swapped in. Its compiled code is checked to be
# byte for byte Mozilla's, so apps that trust Firefox by its signature trust
# it too. The swapped files break the bundle's resource seal, so the app must
# be installed without the quarantine flag, which install-dmg.sh removes.
#
# A policy turns off app updates, which would replace the app with a stock
# build, and telemetry, which would report modified builds as Mozilla's.
set -euo pipefail
cd "$(dirname "$0")/../.."
here=tools/recursive-split
py=/opt/homebrew/bin/python3.13
work=/tmp/ffsign
stamp=$(date +%m%d-%H%M)
out=~/Desktop/Nightly-split-$stamp.dmg
mozreq='anchor apple generic and certificate leaf[subject.OU] = "43AQ936H96"'
team=3LY4F2RNVS
sign=${SIGN:-devid}

$here/run-guarded.sh 1500 60 12000 -- nice -n 10 $py ./mach build -j8 > /tmp/ff-build-dmg.log 2>&1
$here/run-guarded.sh 1200 60 12000 -- nice -n 10 $py ./mach package > /tmp/ff-pkg.log 2>&1

rm -rf $work/ours $work/stage $work/dmgsrc $work/cmp
mkdir -p $work/mnt $work/ours $work/stage $work/dmgsrc $work/cmp
hdiutil attach -quiet -nobrowse -mountpoint $work/mnt obj-artifact/dist/firefox-157.0.1.en-US.mac.dmg
ditto $work/mnt/Nightly.app $work/ours/Nightly.app
hdiutil detach -quiet $work/mnt
ours=$work/ours/Nightly.app/Contents
ver=$(sed -n 's/^Version=//p' $ours/Resources/application.ini)

if [ "$sign" = devid ]; then
  identity=$(security find-identity -v -p codesigning |
    sed -n "s/.*\"\(Developer ID Application: .*($team)\)\"/\1/p" | head -1)
  [ -n "$identity" ] || { echo "make-dmg: no Developer ID for $team" >&2; exit 1; }
  app=$work/stage/Nightly.app
  ditto $work/ours/Nightly.app $app
  $here/fix-helpers.sh $app > /dev/null
  plutil -replace LSEnvironment.MOZ_PURGE_CACHES -string 1 $app/Contents/Info.plist
  plutil -replace CFBundleShortVersionString -string "$ver split $stamp" $app/Contents/Info.plist
  mkdir -p $app/Contents/Resources/distribution
  echo '{"policies": {"DisableAppUpdate": true, "DisableTelemetry": true}}' \
    > $app/Contents/Resources/distribution/policies.json
  echo "$ver split $stamp" > $app/Contents/Resources/split-build.txt
  $here/run-guarded.sh 900 40 8000 -- $py ./mach macos-sign -s "$identity" \
    -e production-without-restricted -a $app > /tmp/ff-sign.log 2>&1
  codesign --verify --deep --strict -R="anchor apple generic and certificate leaf[subject.OU] = \"$team\"" $app

  ditto $app $work/dmgsrc/Nightly.app
  ln -s /Applications $work/dmgsrc/Applications
  rm -f "$out"
  hdiutil create -quiet -volname "Nightly Split $stamp" -srcfolder $work/dmgsrc -ov -format ULMO -fs HFS+ "$out"
  codesign --sign "$identity" --timestamp "$out"
  xcrun notarytool submit "$out" --keychain-profile nightly-notary --wait --timeout 30m > /tmp/ff-notary.log 2>&1
  grep -q "status: Accepted" /tmp/ff-notary.log || { cat /tmp/ff-notary.log >&2; exit 1; }
  xcrun stapler staple -q "$out"
  spctl --assess --type open --context context:primary-signature "$out"
  echo "$out"
  $here/install-dmg.sh "$out"
  exit 0
fi

official=~/.mozbuild/official-firefox/Firefox-$ver.dmg
if [ ! -f $official ]; then
  mkdir -p "$(dirname $official)"
  curl -sfL -o $official.part "https://archive.mozilla.org/pub/firefox/releases/$ver/mac/en-US/Firefox%20$ver.dmg"
  mv $official.part $official
fi
hdiutil attach -quiet -nobrowse -readonly -mountpoint $work/mnt $official
ditto $work/mnt/Firefox.app $work/stage/Nightly.app
hdiutil detach -quiet $work/mnt
app=$work/stage/Nightly.app
codesign --verify --deep --strict -R="$mozreq" $app

for bin in MacOS/XUL MacOS/firefox; do
  lipo -thin arm64 $app/Contents/$bin -output $work/cmp/official
  cp $ours/$bin $work/cmp/ours
  codesign --remove-signature $work/cmp/official
  codesign --remove-signature $work/cmp/ours 2> /dev/null || true
  # Removing a signature leaves __LINKEDIT sized for the signature that was
  # there, and Mozilla's signature is larger than the build's ad hoc one.
  for f in $work/cmp/official $work/cmp/ours; do
    $py - "$f" << 'EOF'
import struct, sys
with open(sys.argv[1], "r+b") as f:
    magic, _, _, _, ncmds = struct.unpack("<IiiII", f.read(20))
    assert magic == 0xFEEDFACF
    offset = 32
    for _ in range(ncmds):
        f.seek(offset)
        cmd, size = struct.unpack("<II", f.read(8))
        if cmd == 0x19 and f.read(16).rstrip(b"\0") == b"__LINKEDIT":
            f.seek(offset + 32)
            f.write(struct.pack("<Q", 0))
        offset += size
EOF
  done
  if ! cmp -s $work/cmp/official $work/cmp/ours; then
    echo "make-dmg: $bin differs from Mozilla's Firefox $ver" >&2
    exit 1
  fi
done

# Keep only the Apple Silicon half of each universal binary. Each half
# carries its own signature, so the running code keeps Mozilla's signature.
while IFS= read -r -d '' f; do
  archs=$(lipo -archs "$f" 2> /dev/null) || continue
  if [ "$archs" != arm64 ] && [[ " $archs " == *" arm64 "* ]]; then
    lipo -thin arm64 "$f" -output "$f.thin"
    mv "$f.thin" "$f"
  fi
done < <(find $app -type f -print0)
codesign --verify --strict -R="$mozreq" $app/Contents/MacOS/XUL

cp $ours/Resources/omni.ja $app/Contents/Resources/omni.ja
cp $ours/Resources/browser/omni.ja $app/Contents/Resources/browser/omni.ja
touch $app/Contents/Resources/browser/.purgecaches
mkdir -p $app/Contents/Resources/distribution
cat > $app/Contents/Resources/distribution/policies.json << 'EOF'
{"policies": {"DisableAppUpdate": true, "DisableTelemetry": true}}
EOF
echo "$ver split $stamp" > $app/Contents/Resources/split-build.txt

ditto $app $work/dmgsrc/Nightly.app
ln -s /Applications $work/dmgsrc/Applications
rm -f "$out"
hdiutil create -quiet -volname "Nightly Split $stamp" -srcfolder $work/dmgsrc -ov -format ULMO -fs HFS+ "$out"
echo "$out"

# Install right away so the change can be tried at once.
$here/install-dmg.sh "$out"
