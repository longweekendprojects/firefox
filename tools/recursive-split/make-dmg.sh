#!/bin/bash
# Builds a test DMG on the Desktop, then installs it into /Applications and
# reopens Nightly.
#
# The app is Mozilla's signed Firefox release with our interface files
# (omni.ja) swapped in. This is an artifact build, so its compiled code is
# Mozilla's own release build; the script checks that byte for byte. Keeping
# Mozilla's signature lets apps that trust Firefox by its signature, such as
# 1Password's Touch ID unlock, trust this build too. Those apps check the
# running code, which is unchanged; the swapped files break only the bundle's
# resource seal. So the app must be installed without the quarantine flag,
# which install-dmg.sh removes.
#
# The profile keeps the release build ID, so Firefox would keep running its
# cached copy of the old interface code. A .purgecaches flag makes Firefox
# rebuild that cache once after each install.
#
# A policy turns off app updates, which would replace the app with stock
# Firefox, and telemetry, which would report modified builds as Mozilla's.
set -euo pipefail
cd "$(dirname "$0")/../.."
here=tools/recursive-split
py=/opt/homebrew/bin/python3.13
work=/tmp/ffsign
stamp=$(date +%m%d-%H%M)
out=~/Desktop/Nightly-split-$stamp.dmg
mozreq='anchor apple generic and certificate leaf[subject.OU] = "43AQ936H96"'

$here/run-guarded.sh 1500 60 12000 -- nice -n 10 $py ./mach build -j8 > /tmp/ff-build-dmg.log 2>&1
$here/run-guarded.sh 1200 60 12000 -- nice -n 10 $py ./mach package > /tmp/ff-pkg.log 2>&1

rm -rf $work/ours $work/stage $work/dmgsrc $work/cmp
mkdir -p $work/mnt $work/ours $work/stage $work/dmgsrc $work/cmp
hdiutil attach -quiet -nobrowse -mountpoint $work/mnt obj-artifact/dist/firefox-157.0.1.en-US.mac.dmg
ditto $work/mnt/Nightly.app $work/ours/Nightly.app
hdiutil detach -quiet $work/mnt
ours=$work/ours/Nightly.app/Contents
ver=$(sed -n 's/^Version=//p' $ours/Resources/application.ini)

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
  if ! cmp -s $work/cmp/official $work/cmp/ours; then
    echo "make-dmg: $bin differs from Mozilla's Firefox $ver" >&2
    exit 1
  fi
done

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
hdiutil create -quiet -volname "Nightly Split $stamp" -srcfolder $work/dmgsrc -ov -format UDZO -fs HFS+ "$out"
echo "$out"

# Install right away so the change can be tried at once.
$here/install-dmg.sh "$out"
