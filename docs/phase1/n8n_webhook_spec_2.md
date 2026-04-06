# n8n Post-Call Webhook Spec

## Overview
n8n workflow that receives Vapi's end-of-call webhook and routes data to Supabase + Slack.

## Webhook URL
Create in n8n: `https://legacywineandliquor.app.n8n.cloud/webhook/vapi-call-complete`

Set this as the Vapi **Server URL** or configure as an end-of-call webhook in Vapi assistant settings.

## Vapi End-of-Call Payload
Vapi sends this when a call ends:
```json
{
  "message": {
    "type": "end-of-call-report",
    "endedReason": "customer-ended-call",
    "call": {
      "id": "call-uuid",
      "type": "inboundPhoneCall",
      "startedAt": "2026-04-06T14:30:00Z",
      "endedAt": "2026-04-06T14:32:15Z",
      "cost": 0.28,
      "customer": {
        "number": "+14075551234"
      }
    },
    "transcript": "Agent: Thanks for calling Legacy Wine and Liquor...\nUser: Do you have Blanton's?\nAgent: We carry a great selection of bourbon...",
    "summary": "Caller asked about bourbon availability. Agent recommended several options.",
    "recordingUrl": "https://..."
  }
}
```

## n8n Workflow Nodes

### Node 1: Webhook Trigger
- Type: Webhook
- Method: POST
- Path: /vapi-call-complete

### Node 2: Extract Data (Code Node)
```javascript
const msg = $input.first().json.message;
const call = msg.call;
const customer = call.customer;

return {
  caller_phone: customer.number,
  call_duration: Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000),
  transcript: msg.transcript,
  summary: msg.summary,
  cost: call.cost,
  ended_reason: msg.endedReason,
  timestamp: call.startedAt
};
```

### Node 3: Supabase Insert
- Table: `customers`
- Operation: Upsert (match on phone)
- Fields:
  - phone = caller_phone
  - source = "phone_call"
  - product_interests = (extract from summary)
  - updated_at = NOW()

### Node 4: Slack Notification
- Channel: #instagram-content (C0AQNJU7C3U)
- Message:
```
📞 New call to Legacy AI Agent
Phone: {caller_phone}
Duration: {call_duration}s
Summary: {summary}
Cost: ${cost}
```

### Node 5: Conditional — Restock Interest
- If summary contains "waitlist" or "notification" or "out of stock"
- Then: Insert into Supabase `restock_interest` table (create this table in Phase 3)

## Supabase Table: restock_interest (Phase 3)
```sql
CREATE TABLE restock_interest (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_phone TEXT,
  customer_name TEXT,
  product_requested TEXT,
  notified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```
