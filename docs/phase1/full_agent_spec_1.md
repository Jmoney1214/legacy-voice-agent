# VAPI AI PHONE AGENT — FULL SPEC
# Legacy Wine & Liquor

## SYSTEM PROMPT
See `system_prompt.md` for the current clean prompt deployed in Vapi.

## VAPI CONFIGURATION

- **Assistant Name:** Riley
- **Model:** GPT-4o (or Claude 3.5 Sonnet)
- **Voice:** ElevenLabs warm natural American voice
- **First Message:** "Thanks for calling Legacy Wine and Liquor, Sanford's premium wine and spirits destination. How can I help you today?"
- **End Call Phrases:** "goodbye", "that's all", "have a good one", "thanks bye"
- **Max Call Duration:** 10 minutes (600 seconds)
- **Silence Timeout:** 30 seconds
- **Temperature:** 0.7
- **Forwarding Phone Number:** +14078787003 (Jay's direct line)
- **Dial Keypad Function:** Enabled
- **End Call Function:** Enabled

## FUNCTION CALLS (Phase 2 — requires Server URL)

### check_inventory
- **Trigger:** Caller asks about product availability or pricing
- **Input:** product name or category (string)
- **Backend:** Cloudflare Worker queries Lightspeed POS API
- **Returns:** product name, price, stock status, quantity
- **Response if in stock:** "Yes, we have [product] right now. It's [price]. Want me to set one aside for you?"
- **Response if out of stock:** "We don't have that in stock right now, but I can add you to our notification list. Can I get your name and number?"

### log_caller
- **Trigger:** After every call (end-of-call webhook)
- **Input:** caller phone, name, products discussed, outcome
- **Backend:** n8n webhook → Supabase insert
- **Logs:** caller_phone, caller_name, products_discussed, outcome, timestamp

### add_to_waitlist
- **Trigger:** Caller wants notification for out-of-stock item
- **Input:** caller name, phone, product requested
- **Backend:** n8n webhook → Supabase restock_interest table

### transfer_call
- **Trigger:** Escalation criteria met (complaint, large order, allocated bottles, wholesale)
- **Action:** Transfers to Jay at +1 (407) 878-7003

## POST-CALL WEBHOOK PAYLOAD

After every call, Vapi POSTs to n8n webhook:
```json
{
  "caller_phone": "+14075551234",
  "caller_name": "John",
  "call_duration": 120,
  "products_discussed": ["Blanton's", "Buffalo Trace"],
  "outcome": "will_visit_store",
  "wants_notification": false,
  "transferred": false,
  "timestamp": "2026-04-05T14:30:00Z"
}
```

## N8N POST-CALL WORKFLOW

1. Writes caller data to Supabase `customers` table
2. Sends Jay a Slack summary in #instagram-content (C0AQNJU7C3U)
3. If wants_notification = true → adds to `restock_interest` table
4. If transferred = true → logs escalation reason

## PRODUCT KNOWLEDGE BASE

### Whiskey/Bourbon
| Tier | Products |
|------|----------|
| Budget ($30-50) | Buffalo Trace, Maker's Mark, Woodford Reserve |
| Mid ($50-100) | Blanton's (limited), Angel's Envy, Knob Creek 12 |
| Premium ($100+) | Pappy Van Winkle (waitlist), Weller Full Proof, E.H. Taylor |

### Tequila
| Tier | Products |
|------|----------|
| Budget | Espolon, Olmeca Altos |
| Mid | Casamigos, Don Julio, Clase Azul Plata |
| Premium | Clase Azul Reposado, Don Julio 1942 |

### Wine
| Category | Products |
|----------|----------|
| Everyday Reds | Josh Cellars Cabernet, Meiomi Pinot Noir |
| Premium Reds | Caymus, Opus One (limited) |
| Sparkling | Veuve Clicquot, Moët, La Marca Prosecco |
| White | Kim Crawford Sauvignon Blanc, Rombauer Chardonnay |

### Other
| Category | Products |
|----------|----------|
| Vodka | Tito's, Grey Goose, Belvedere, Ciroc |
| Cognac | Hennessy VS/VSOP/XO, Rémy Martin, Courvoisier |

## UPSELL TRIGGERS

- Party/event → "10% off when you buy 6 or more bottles"
- Single bottle → suggest complementary product
- Any call → mention 47-state shipping
- Gift mention → "We can ship to 47 states if you want to send a bottle as a gift"

## TRANSFER CRITERIA

Transfer to Jay (+14078787003) when:
- Caller asks for Jay/owner/manager
- Large/corporate order (>$500)
- Complaint
- Allocated bottles or waitlist
- Wholesale/business accounts
