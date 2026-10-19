#!/bin/bash
# Starts the local build on a dedicated dev profile under the resource guard.
# Usage: tools/recursive-split/run-dev.sh [minutes]   (default 60)
set -eu
cd "$(dirname "$0")/../.."
PROFILE="$PWD/obj-artifact/dev-profile"
mkdir -p "$PROFILE"
MINUTES=${1:-60}
# Artifact builds misname the GPU helper; without this, drawing is slow.
tools/recursive-split/fix-helpers.sh obj-artifact/dist/Nightly.app
# Caps: 60 processes, 12 GB total RSS. The guard kills the whole tree on breach.
exec tools/recursive-split/run-guarded.sh $((MINUTES * 60)) 60 12000 -- \
  nice -n 5 obj-artifact/dist/Nightly.app/Contents/MacOS/firefox \
  -no-remote -purgecaches -profile "$PROFILE"
