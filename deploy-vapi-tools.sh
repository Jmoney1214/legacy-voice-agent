#!/bin/bash
# ============================================
# Register 3 new tools in Vapi via API
# Requires: VAPI_API_KEY environment variable
# Get your API key from https://dashboard.vapi.ai → Account → API Keys
# ============================================

VAPI_API_KEY="${VAPI_API_KEY:?Set VAPI_API_KEY first: export VAPI_API_KEY=your-key}"
ASSISTANT_ID="804091b2-a558-49cf-b1f8-d534cc52f26a"
SERVER_URL="https://vapi-agent.legacywineandliquor.workers.dev"

echo "=== Creating suggest_alternatives tool ==="
curl -s -X POST https://api.vapi.ai/tool \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "function",
    "function": {
      "name": "suggest_alternatives",
      "description": "Find similar in-stock products when the requested item is unavailable. Use when a product is out of stock to offer the caller alternatives in the same category and price range.",
      "parameters": {
        "type": "object",
        "properties": {
          "category": {
            "type": "string",
            "description": "Product category: BOURBON, AMERICAN WHISKEY, SCOTCH WHISKEY, VODKA, TEQUILA, COGNAC, GIN, RUM, WINE"
          },
          "price_range_low": {
            "type": "number",
            "description": "Minimum price in dollars"
          },
          "price_range_high": {
            "type": "number",
            "description": "Maximum price in dollars"
          },
          "max_results": {
            "type": "number",
            "description": "Number of alternatives to suggest (default 3)"
          }
        },
        "required": ["category"]
      }
    },
    "server": {
      "url": "'"$SERVER_URL"'"
    }
  }' | tee /dev/stderr | echo ""

echo ""
echo "=== Creating lookup_customer tool ==="
curl -s -X POST https://api.vapi.ai/tool \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "function",
    "function": {
      "name": "lookup_customer",
      "description": "Look up a customer by phone number to check if they are a returning caller and see their past product interests and history.",
      "parameters": {
        "type": "object",
        "properties": {
          "phone": {
            "type": "string",
            "description": "The caller phone number in E.164 format, e.g. +14075551234"
          }
        },
        "required": ["phone"]
      }
    },
    "server": {
      "url": "'"$SERVER_URL"'"
    }
  }' | tee /dev/stderr | echo ""

echo ""
echo "=== Creating notify_manager tool ==="
curl -s -X POST https://api.vapi.ai/tool \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "function",
    "function": {
      "name": "notify_manager",
      "description": "Send a Slack notification to Jay the store owner for high-value leads, complaints, large orders over $500, allocated bottle requests, or wholesale inquiries.",
      "parameters": {
        "type": "object",
        "properties": {
          "reason": {
            "type": "string",
            "description": "Why the manager is being notified"
          },
          "caller_phone": {
            "type": "string",
            "description": "The caller phone number"
          },
          "caller_name": {
            "type": "string",
            "description": "The caller name if known"
          },
          "urgency": {
            "type": "string",
            "description": "low, medium, or high"
          }
        },
        "required": ["reason"]
      }
    },
    "server": {
      "url": "'"$SERVER_URL"'"
    }
  }' | tee /dev/stderr | echo ""

echo ""
echo "=== Now attach tools to assistant ==="
echo "Get the tool IDs from the responses above, then run:"
echo ""
echo "curl -X PATCH https://api.vapi.ai/assistant/$ASSISTANT_ID \\"
echo "  -H 'Authorization: Bearer \$VAPI_API_KEY' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"model\": {\"toolIds\": [\"EXISTING_TOOL_ID_1\", \"EXISTING_TOOL_ID_2\", \"EXISTING_TOOL_ID_3\", \"EXISTING_TOOL_ID_4\", \"NEW_SUGGEST_ID\", \"NEW_LOOKUP_ID\", \"NEW_NOTIFY_ID\"]}}'"
echo ""
echo "Existing tool IDs:"
echo "  check_inventory:  f0986cdd-8f27-4f7e-bd5c-cc53bf29f651"
echo "  log_caller:       f4a7bede-5161-48d3-88fb-878a87543d4e"
echo "  add_to_waitlist:  66416617-815d-4186-afa0-9e5d9cb58413"
echo "  transfer_to_jay:  b71f4298-d9ba-45ab-891b-de9316f4a0a9"
