# Phase 2 — Cloudflare Worker Backend for Vapi

## Purpose
Build a Cloudflare Worker that handles Vapi function calls for real-time Lightspeed inventory lookups and Supabase caller logging.

## Worker URL
Deploy at: `https://vapi-agent.legacywineandliquor.com/function`

Set this as the **Server URL** in Vapi Phone Numbers settings for +1 (407) 250-7267.

## How Vapi Function Calls Work

When the assistant needs to call a function, Vapi POSTs to the Server URL:

```json
{
  "message": {
    "type": "function-call",
    "functionCall": {
      "name": "check_inventory",
      "parameters": {
        "product": "Blanton's"
      }
    },
    "call": {
      "id": "call-id",
      "phoneNumber": {
        "number": "+14072507267"
      },
      "customer": {
        "number": "+14075551234"
      }
    }
  }
}
```

The Worker must respond with:
```json
{
  "results": [
    {
      "result": "We have Blanton's in stock. Current price is $64.99. We have 3 bottles available."
    }
  ]
}
```

## Worker Logic

### 1. Token Refresh (Lightspeed OAuth)
```
POST https://cloud.merchantos.com/oauth/access_token.php
Body: {
  grant_type: "refresh_token",
  client_id: "<CLIENT_ID>",
  client_secret: "<CLIENT_SECRET>",
  refresh_token: "<REFRESH_TOKEN>"
}
```
Cache the access token (expires in 1 hour).

### 2. Inventory Search
```
GET https://api.merchantos.com/API/Account/222537/Item.json?description=~,Blanton&load_relations=["ItemShops"]
Headers: Authorization: Bearer <access_token>
```

Parse response for:
- `Item.description` (product name)
- `Item.Prices.ItemPrice[0].amount` (price)
- `Item.ItemShops.ItemShop[0].qoh` (quantity on hand)

### 3. Supabase Caller Logging
After each call, POST caller data to Supabase:
```
POST https://rffvoreqcpkqqxwprosg.supabase.co/rest/v1/customers
Headers: 
  apikey: <SUPABASE_ANON_KEY>
  Authorization: Bearer <SUPABASE_ANON_KEY>
  Content-Type: application/json
Body: {
  "email": null,
  "phone": "+14075551234",
  "first_name": "John",
  "source": "phone_call",
  "product_interests": "bourbon, whiskey"
}
```

## Cloudflare Worker Environment Variables
Set these as secrets in Cloudflare:
- `LIGHTSPEED_CLIENT_ID`
- `LIGHTSPEED_CLIENT_SECRET`
- `LIGHTSPEED_REFRESH_TOKEN`
- `SUPABASE_URL` = https://rffvoreqcpkqqxwprosg.supabase.co
- `SUPABASE_ANON_KEY` = (get from Supabase dashboard → Settings → API)

## DNS Setup
Add CNAME record in Cloudflare:
- Name: `vapi-agent`
- Target: Worker route
- Proxied: Yes

## Testing
1. Deploy Worker
2. Test with curl: `curl -X POST https://vapi-agent.legacywineandliquor.com/function -d '{"message":{"type":"function-call","functionCall":{"name":"check_inventory","parameters":{"product":"Blantons"}}}}'`
3. Set Server URL in Vapi Phone Numbers
4. Add function tools back to assistant
5. Publish and test call
