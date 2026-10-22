#!/bin/bash
# Installs a test DMG into /Applications and reopens Nightly.
# Nightly quits normally first so its session is saved; the script stops
# if Nightly does not quit, rather than killing it.
set -euo pipefail
dmg=${1:?usage: install-dmg.sh <dmg>}
app=/Applications/Nightly.app
mnt=$(mktemp -d /tmp/nightly-dmg.XXXX)

if pgrep -f "^$app/Contents/MacOS/firefox" > /dev/null; then
  # Nightly may ask to confirm closing tabs; wait for that answer.
  osascript -e "with timeout of 5 seconds" -e "tell application \"$app\" to quit" -e "end timeout" 2> /dev/null || true
  for _ in $(seq 300); do
    pgrep -f "^$app/Contents/MacOS/firefox" > /dev/null || break
    sleep 1
  done
  if pgrep -f "^$app/Contents/MacOS/firefox" > /dev/null; then
    echo "install-dmg: Nightly did not quit; not installing" >&2
    exit 1
  fi
fi

hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mnt" "$dmg"
rm -rf "$app"
ditto "$mnt/Nightly.app" "$app"
hdiutil detach -quiet "$mnt"
rmdir "$mnt"
xattr -dr com.apple.quarantine "$app" 2> /dev/null || true
open -a "$app"
cat "$app/Contents/Resources/split-build.txt"
