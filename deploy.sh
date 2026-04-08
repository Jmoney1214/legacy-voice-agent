#!/bin/bash
# ============================================
# Legacy Voice Agent — Deploy & Configure
# Run this from the legacy-voice-agent directory
# ============================================

echo "=== Step 1: Deploy new worker ==="
cd worker
npx wrangler deploy
echo ""

echo "=== Step 2: Set VAPI_SECRET ==="
echo "Enter a strong secret (will be shared with Vapi dashboard):"
npx wrangler secret put VAPI_SECRET
echo ""

echo "=== Step 3: Set SLACK_WEBHOOK_URL ==="
echo "Create an incoming webhook at https://api.slack.com/apps → Incoming Webhooks"
echo "Paste the webhook URL when prompted:"
npx wrangler secret put SLACK_WEBHOOK_URL
echo ""

echo "=== Step 4: Register new tools in Vapi ==="
echo "Go to https://dashboard.vapi.ai → Your assistant (Riley) → Tools"
echo "Add these 3 new function tools with server URL: https://vapi-agent.legacywineandliquor.workers.dev"
echo ""
echo "See tool definitions below, or use the Vapi API calls in deploy-vapi-tools.sh"
echo ""

echo "=== Step 5: Set server secret in Vapi ==="
echo "Go to Vapi Dashboard → Phone Numbers → +1 (407) 250-7267 → Server URL settings"
echo "Set 'Server Secret' to the SAME value you used for VAPI_SECRET above"
echo "Also set it on the Assistant (Riley) → Advanced → Server Secret"
echo ""

echo "=== Done! Test by calling +1 (407) 250-7267 ==="
