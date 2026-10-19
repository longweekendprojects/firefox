#!/bin/bash
# Renames the GPU and media helper executables in a Mac app bundle to the
# names the engine expects.
#
# Artifact builds download a compiled engine branded "Firefox", but name the
# helper executables after the local branding ("Nightly GPU Helper"). The
# engine then cannot start its GPU process and falls back to slow software
# drawing. Run this after every build and before signing a package.
#
# Usage: tools/recursive-split/fix-helpers.sh <path/to/App.app>
set -eu
APP=$1
MACOS="$APP/Contents/MacOS"
for kind in "GPU Helper:gpu-helper" "Media Plugin Helper:media-plugin-helper"; do
  suffix=${kind%%:*}
  bundle="$MACOS/${kind##*:}.app"
  expected=$(strings -a "$MACOS/XUL" | grep -m1 -E "^[A-Za-z]+ $suffix\$" || true)
  [ -n "$expected" ] && [ -d "$bundle" ] || continue
  plist="$bundle/Contents/Info.plist"
  current=$(plutil -extract CFBundleExecutable raw "$plist")
  [ "$current" = "$expected" ] && continue
  mv "$bundle/Contents/MacOS/$current" "$bundle/Contents/MacOS/$expected"
  plutil -replace CFBundleExecutable -string "$expected" "$plist"
  echo "fix-helpers: $current -> $expected"
done
