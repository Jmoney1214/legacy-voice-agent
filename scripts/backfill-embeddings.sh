#!/usr/bin/env bash
# backfill-embeddings.sh — drain inventory rows missing an embedding by looping
# the embed-inventory-backfill Supabase Edge Function until remaining=0.
#
# Usage:
#   SUPABASE_URL=https://<ref>.supabase.co     \
#   BACKFILL_SECRET=<shared-secret>            \
#   ./scripts/backfill-embeddings.sh
#
# Optional: BATCH (default 50, max 100), SLEEP_MS (default 200) between calls
# to avoid OpenAI rate limits.

set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL not set}"
: "${BACKFILL_SECRET:?BACKFILL_SECRET not set}"
BATCH="${BATCH:-50}"
SLEEP_MS="${SLEEP_MS:-200}"

URL="${SUPABASE_URL%/}/functions/v1/embed-inventory-backfill"
total=0

while :; do
  resp="$(curl -fsS -X POST "$URL" \
    -H "X-Backfill-Secret: $BACKFILL_SECRET" \
    -H "Content-Type: application/json" \
    -d "{\"batch\": $BATCH}")"

  processed="$(printf '%s' "$resp" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("processed",0))')"
  remaining="$(printf '%s' "$resp" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("remaining",0))')"
  total=$((total + processed))

  printf 'processed=%s total=%s remaining=%s\n' "$processed" "$total" "$remaining"

  if [[ "$remaining" == "0" ]]; then
    echo "done — total embedded: $total"
    break
  fi

  if [[ "$processed" == "0" ]]; then
    echo "stuck (processed=0 with remaining>0) — bailing" >&2
    exit 1
  fi

  sleep "$(awk -v ms="$SLEEP_MS" 'BEGIN { printf "%.3f", ms/1000 }')"
done
