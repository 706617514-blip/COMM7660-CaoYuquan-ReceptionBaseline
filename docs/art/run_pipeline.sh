#!/usr/bin/env bash
# Full post-generation pipeline for the protagonist asset set.
#
# Runs once the ARK batch in docs/art/generated/ is complete: normalise every
# raw render to the frozen spec, verify each one against that spec, and build
# the review contact sheets. Kept as one script because the three steps always
# run together and because a partial run (normalise without verify) is exactly
# how the earlier batch shipped three sprites with enclosed white holes.
#
# Usage: bash docs/art/run_pipeline.sh
# Safe to re-run: normalisation overwrites, verification is read-only,
# contact sheets overwrite.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

RAW=docs/art/generated
SPR=docs/art/sprites
SHEET=docs/art/sheet

echo "=== 1/4 normalise ==============================================="
python3 docs/art/normalize_sprites.py --indir "$RAW" --outdir "$SPR" 2>&1 \
  | grep -v 'DeprecationWarning\|opaque = sum' || true

echo
echo "=== 2/4 verify spec ============================================="
# --expect is inferred per file from its eq_ prefix, so hero sprites get the
# figure checks and gear layers additionally get the self-support and
# no-wearer checks. Verification must be able to fail the pipeline: the point
# is that a defect stops the batch instead of reaching the sheets.
if ! python3 docs/art/verify_sprites.py "$SPR" --quiet; then
  echo "SPEC FAILURES PRESENT - fix before shipping" >&2
  VERIFY_FAILED=1
else
  VERIFY_FAILED=0
fi

echo
echo "=== 3/4 third-party QA gate ====================================="
GATE=/private/tmp/gamedev-skills/skills/disciplines/create-game-assets/scripts/asset_report.py
if [ -f "$GATE" ]; then
  fail=0
  for f in "$SPR"/*.png; do
    python3 "$GATE" "$f" --expect-size 96x144 --require-alpha --max-colors 32 \
      >/dev/null 2>&1 || { echo "GATE FAIL $f"; fail=$((fail+1)); }
  done
  echo "gate: $fail failure(s)"
else
  echo "gate script not found, skipped: $GATE"
fi

echo
echo "=== 4/4 contact sheets ========================================="
python3 docs/art/make_contact_sheet.py --indir "$SPR" --outdir "$SHEET" --group all

echo
if [ "$VERIFY_FAILED" -ne 0 ]; then
  echo "pipeline complete WITH SPEC FAILURES - see stage 2" >&2
  exit 1
fi
echo "pipeline complete, all sprites on spec"
