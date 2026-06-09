#!/usr/bin/env bash
# Diagnose + reset the ElevenLabs post-call webhook for the Riley agent.
#
# Post-call webhooks live at the WORKSPACE level, not per-agent. ElevenLabs
# auto-disables a webhook after 10 consecutive non-200 responses (current
# policy), which is the single most likely cause of "no Slack messages
# arriving after calls" once you've ruled out a stale URL.
#
# Usage:
#   ELEVENLABS_API_KEY=sk_...                                       \
#   WEBHOOK_URL=https://legacy-elevenlabs-agent.YOURACCT.workers.dev/post-call \
#   ./05-elevenlabs-webhook-check.sh
#
# Requires: curl, jq

set -euo pipefail
: "${ELEVENLABS_API_KEY:?ELEVENLABS_API_KEY not set}"
: "${WEBHOOK_URL:?WEBHOOK_URL not set}"

API="https://api.elevenlabs.io/v1"
HDR=(-H "xi-api-key: $ELEVENLABS_API_KEY")

echo "== Workspace webhooks =="
curl -fsS "${HDR[@]}" "$API/workspace/webhooks" | jq '.webhooks[] | {webhook_id, name, webhook_url, usage, disabled, disabled_reason, most_recent_failure_error_code}'

echo
echo "== Synthetic test POST to your receiver =="
SAMPLE='{"type":"post_call_transcription","event_timestamp":'$(date +%s)',"data":{"conversation_id":"test_diag","agent_id":"diag","status":"done","transcript":[],"metadata":{}}}'
echo "$SAMPLE" | jq -C .

http_code="$(curl -s -o /tmp/webhook_resp -w '%{http_code}' -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "ElevenLabs-Signature: t=0,v0=diagnostic-not-a-real-signature" \
  --data-raw "$SAMPLE")"

echo
echo "Receiver responded: HTTP $http_code"
cat /tmp/webhook_resp; echo
if [[ "$http_code" != "200" ]]; then
  echo "FAIL: receiver did not return 200 — ElevenLabs will auto-disable after 10 such responses."
  echo "Likely causes:"
  echo "  - Worker rejecting unknown HMAC signatures (good — but make sure real ElevenLabs traffic verifies cleanly)"
  echo "  - Worker route /post-call is missing or 404s"
  echo "  - Worker is rejecting non-JSON or unknown 'type' values"
  exit 1
fi

echo "OK: receiver returns 200. If the workspace webhook above is 'disabled': true, re-enable it"
echo "in the ElevenAgents → Settings → Webhooks dashboard (auto-disable can only be cleared from the UI)."
