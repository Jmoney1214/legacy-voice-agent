#!/usr/bin/env bash
# deploy-vapi.sh — push vapi-export.json (assistant + check_inventory tool) to Vapi.
#
# Usage:
#   VAPI_API_KEY=xxx ./scripts/deploy-vapi.sh                # apply both
#   VAPI_API_KEY=xxx ./scripts/deploy-vapi.sh assistant      # assistant only
#   VAPI_API_KEY=xxx ./scripts/deploy-vapi.sh tool           # check_inventory only
#
# Reads vapi-export.json at repo root. Requires `jq` and `curl`.

set -euo pipefail

if [[ -z "${VAPI_API_KEY:-}" ]]; then
  echo "VAPI_API_KEY not set" >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel)"
EXPORT="$ROOT/vapi-export.json"

if [[ ! -f "$EXPORT" ]]; then
  echo "Missing $EXPORT" >&2
  exit 1
fi

ASSISTANT_ID="$(jq -r '.assistant.id' "$EXPORT")"
INVENTORY_TOOL_ID="$(jq -r '.tools[] | select(.function.name=="check_inventory") | .id' "$EXPORT")"

target="${1:-all}"

patch_assistant() {
  echo "PATCH /assistant/$ASSISTANT_ID"
  jq '.assistant
      | del(.id, .orgId, .createdAt, .updatedAt, .isServerUrlSecretSet)' "$EXPORT" \
    | curl -fsS -X PATCH "https://api.vapi.ai/assistant/$ASSISTANT_ID" \
        -H "Authorization: Bearer $VAPI_API_KEY" \
        -H "Content-Type: application/json" \
        --data-binary @- \
    | jq '{id, name, voice: .voice.model, analysisPlanEnabled: (.analysisPlan != null), voicemailEnabled: (.voicemailDetection != null)}'
}

patch_inventory_tool() {
  echo "PATCH /tool/$INVENTORY_TOOL_ID"
  jq --arg id "$INVENTORY_TOOL_ID" '
    .tools[] | select(.id==$id)
    | del(.id, .orgId, .createdAt, .updatedAt)
  ' "$EXPORT" \
    | curl -fsS -X PATCH "https://api.vapi.ai/tool/$INVENTORY_TOOL_ID" \
        -H "Authorization: Bearer $VAPI_API_KEY" \
        -H "Content-Type: application/json" \
        --data-binary @- \
    | jq '{id, name: .function.name, messageTypes: [.messages[]?.type]}'
}

case "$target" in
  assistant) patch_assistant ;;
  tool)      patch_inventory_tool ;;
  all)       patch_assistant; patch_inventory_tool ;;
  *)         echo "unknown target: $target" >&2; exit 2 ;;
esac
