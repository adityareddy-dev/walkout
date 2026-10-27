#!/usr/bin/env bash
# Copies the records of finished rounds into evidence/ so they can be checked
# from the repo: round.json, each shopper's run.json (steps, model usage per
# step, findings, sentence), and the fix. Screenshots and raw telemetry stay
# in runs/ (about 300 MB).
#   scripts/save-evidence.sh <round id> [...]
set -euo pipefail
cd "$(dirname "$0")/.."
for r in "$@"; do
  mkdir -p "evidence/$r"
  for f in round.json fix.json fix.diff; do [ -f "runs/$r/$f" ] && cp "runs/$r/$f" "evidence/$r/"; done
  for d in runs/$r/*/; do
    [ -f "$d/run.json" ] || continue
    mkdir -p "evidence/$r/$(basename "$d")"
    cp "$d/run.json" "evidence/$r/$(basename "$d")/"
  done
done
