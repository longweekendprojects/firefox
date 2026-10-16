#!/bin/bash
# Runs a command in its own process group and kills the whole group when it
# exceeds a time limit, a descendant process count, or a total RSS cap.
# Usage: run-guarded.sh <timeout-seconds> <max-procs> <max-rss-mb> -- cmd args...
set -u
LIMIT=$1; MAXP=$2; MAXRSS=$3; shift 4

descendants() {
  local pids=$1 all=$1 next
  while [ -n "$pids" ]; do
    next=$(pgrep -P "$(echo $pids | tr ' ' ',')" 2>/dev/null | tr '\n' ' ')
    all="$all $next"; pids=$next
  done
  echo $all
}

set -m
"$@" &
PID=$!
set +m
START=$(date +%s)
REASON=""
while kill -0 "$PID" 2>/dev/null; do
  sleep 1
  ALL=$(descendants "$PID")
  N=$(echo $ALL | wc -w | tr -d ' ')
  RSS=$(ps -o rss= -p "$(echo $ALL | tr ' ' ',')" 2>/dev/null | awk '{s+=$1} END {print int(s/1024)}')
  NOW=$(date +%s)
  if [ $((NOW - START)) -ge "$LIMIT" ]; then REASON="timeout ${LIMIT}s"; fi
  if [ "$N" -gt "$MAXP" ]; then REASON="process count $N > $MAXP"; fi
  if [ "${RSS:-0}" -gt "$MAXRSS" ]; then REASON="rss ${RSS}MB > ${MAXRSS}MB"; fi
  if [ -n "$REASON" ]; then
    echo "run-guarded: killing ($REASON)" >&2
    for p in $(descendants "$PID"); do kill -TERM "$p" 2>/dev/null; done
    kill -TERM -- "-$PID" 2>/dev/null
    sleep 3
    for p in $(descendants "$PID"); do kill -KILL "$p" 2>/dev/null; done
    kill -KILL -- "-$PID" 2>/dev/null
    wait "$PID" 2>/dev/null
    exit 124
  fi
done
wait "$PID"
