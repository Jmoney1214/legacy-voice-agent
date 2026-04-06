# Agent Handoff Rules

## Routing Logic (Triage Agent decides)

### → Product Specialist
- "Do you have [product]?"
- "What's a good [category]?"
- "How much is [product]?"
- "What do you recommend for [occasion]?"
- "What's similar to [product]?"
- Any product availability, pricing, or recommendation question

### → Order Support
- "Where's my order?"
- "My package is late"
- "I got the wrong item"
- "The bottle arrived broken"
- "I need to change my order"
- "I never received my delivery"
- Any order status, tracking, or fulfillment issue

### → Retention Agent
- "That's too expensive" (after Product Specialist quotes price)
- "I'll think about it"
- "I'm not sure"
- "I saw it cheaper at [competitor]"
- "You're always out of what I want"
- "I'm done ordering from you"
- Any hesitation, price objection, or churn signal

### → VIP Agent
- "I need bottles for a wedding/event"
- "Do you have Pappy/allocated bottles?"
- "I want to place a corporate order"
- "I need 10+ cases"
- "I'm a collector looking for..."
- Any premium, event, corporate, or bulk inquiry

### → Human (Jay at 407-878-7003)
- Caller explicitly asks for Jay/owner/manager
- Complaint that Retention can't resolve
- Legal/compliance issue
- Wholesale account inquiry
- Any situation where the agent is uncertain

## Handoff Protocol
1. Agent announces handoff: "I'm going to connect you with our [specialist/owner] who can help with that."
2. Session context transfers to next agent (caller stays on line)
3. Next agent picks up with context: "Hey [name], I understand you're looking for [context]. Let me help."
4. No cold transfers. Always warm with context.

## Escalation Ladder
```
Triage → Specialist → Retention → Human
         ↘ VIP →    Human
         ↘ Support → Retention → Human
```

## Rules
- Maximum 2 handoffs per call (caller frustration increases after 2)
- If 2 handoffs already happened, next handoff goes to human
- Retention agent is ALWAYS the last AI stop before human escalation
- VIP agent can go directly to human for allocated bottle discussions
