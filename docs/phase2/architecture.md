# Legacy Wine & Liquor — Multi-Agent Voice Architecture

## Platform: OpenAI Realtime API + Agents SDK (TypeScript)

## Why This Over Vapi

- Multi-agent handoffs in a single live call session
- Session updated in-place when agent switches (caller stays connected)
- Lower latency with WebSocket transport
- Tools, handoffs, and memory built into the SDK
- Cost: ~$0.06-0.10/min vs Vapi's $0.18-0.33/min

## Transport

- Phone calls: WebSocket (server-side)
- Website voice widget: WebRTC (browser-side)

## The 6 Agents

### 1. Triage / Front Desk Agent

**First voice the caller hears.**

- Greet naturally
- Identify intent fast (< 2 exchanges)
- Route to specialist agent
- Handle basic: hours, location, delivery, shipping
- Collect caller name + phone when needed

Personality: Fast, confident, short. Think receptionist at a high-end bar.

Handoff triggers:

- Product question → Product Specialist
- Order issue → Order Support
- Price objection / hesitation → Retention
- Premium / event / corporate → VIP
- Complaint → Order Support (then Retention if needed)

### 2. Product Specialist Agent

**Floor manager / whiskey nerd / wine consultant.**

- Query live inventory from Supabase (16,797 SKUs)
- Full-text search on product descriptions
- Answer brand, category, size, price questions
- Recommend substitutes for out-of-stock items
- Handle upsell and trade-up logic
- Create restock interest entries

Tools: search_inventory, get_product_details, get_price_and_stock, create_restock_interest, suggest_alternatives

Personality: Knowledgeable, passionate, speaks like they've tasted everything.

### 3. Order Support Agent

**Customer support desk.**

- Look up orders by phone/email
- Check delivery status
- Handle damaged/missing/wrong-item reports
- Trigger callbacks and tickets
- Send SMS follow-ups

Tools: lookup_order, get_tracking_status, open_support_case, send_sms_followup, request_manager_callback

Personality: Calm, in control, empathetic. Not robotic.

### 4. Retention / Save-the-Sale Agent

**Revenue recovery specialist.**

- Rescue hesitant buyers
- De-escalate unhappy customers
- Reduce abandoned purchase intent
- Offer better-fit alternatives
- Preserve margin while closing

Tools: offer_alternative_product, create_waitlist, offer_manager_followup, issue_store_credit_request, send_personalized_text, capture_abandoned_intent

Personality: Controlled choice architecture. Not gimmicky. Real retention psychology:

- Reduce friction
- Acknowledge emotion
- Present controlled options
- Protect trust
- Move toward commitment

### 5. VIP / High-Value Sales Agent

**Premium concierge.**

- Allocated bottles (Pappy, Weller, E.H. Taylor)
- Corporate gifting
- Event/wedding alcohol planning
- Collector inquiries
- Bulk orders

Tools: flag_vip_lead, schedule_manager_callback, capture_event_requirements, create_quote_request

Personality: Polished, premium, unhurried.

### 6. Compliance / Policy Agent

**Guardrails (runs in background, not a caller-facing agent).**

- Prevent false shipping claims
- Enforce age restrictions
- Avoid guaranteeing stock or delivery
- Block risky statements
- Validate state shipping eligibility

## Handoff Flow

```
Caller enters
→ Triage Agent (identifies intent in 1-2 exchanges)
→ Hands off to:
  ├── Product Specialist (availability, recommendations, pricing)
  ├── Order Support (where's my order, damaged, wrong item)
  ├── Retention Agent (hesitant, price objection, angry)
  ├── VIP Agent (allocated, corporate, events, bulk)
  └── Human escalation (Jay at 407-878-7003)
```

## Caller Psychology States

The system detects and adapts to:

| State | Voice Behavior |
|-------|---------------|
| Rushed | More direct, skip pleasantries |
| Confused | More consultative, slower pace |
| Skeptical | More reassuring, use social proof |
| Price-sensitive | Lead with value, offer alternatives |
| Premium buyer | More premium tone, exclusive language |
| Annoyed | De-escalate, acknowledge, action-first |
| Ready-to-buy | Concise, confirm, close |
| Browsing | Consultative, plant seeds |

## Memory Architecture

1. **Session memory** — What happened on this call (handled by RealtimeSession)
2. **Customer memory** — Past orders, preferences, prior issues (Supabase customers table)
3. **Business memory** — Store policies, shipping states, current promotions (embedded in prompts + Supabase)

## Build Phases

### Phase 1 (Week 1-2): 4 agents

- Triage, Product Specialist, Order Support, Retention

### Phase 2 (Week 3-4): Add 2 agents

- VIP/Event Sales, Compliance

### Phase 3 (Week 5-8): Automation

- Outbound callback workflows
- SMS recap after every call
- Proactive restock notifications
- Win-back sequences for frustrated callers
