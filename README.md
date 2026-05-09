# Legacy Wine & Liquor — AI Voice Agent

AI phone agent for Legacy Wine & Liquor (Sanford, FL) that handles inbound calls with real-time inventory lookup, product recommendations, caller logging, waitlist management, and call transfers.

## Live System

| Component | URL / ID |
|-----------|----------|
| **Phone Number** | +1 (407) 250-7267 |
| **Vapi Assistant** | Riley — `804091b2-a558-49cf-b1f8-d534cc52f26a` |
| **Cloudflare Worker** | `https://vapi-agent.legacywineandliquor.workers.dev` |
| **n8n Workflow** | `https://legacywineandliquor.app.n8n.cloud/workflow/thZVbwBdNQdfNyXN` |
| **Supabase Project** | `rffvoreqcpkqqxwprosg` (liquorhub) |

## Architecture

```
Caller dials +1 (407) 250-7267
    |
    v
Vapi (Riley) — Deepgram Nova-3 STT, GPT-4o-mini, ElevenLabs Lily TTS
    |
    v  (function calls)
Cloudflare Worker — vapi-agent.legacywineandliquor.workers.dev
    |
    |-- check_inventory --> Supabase (16,797 items, instant lookup)
    |-- log_caller -------> Supabase call_logs table
    |-- add_to_waitlist --> Supabase restock_interest table
    |-- end-of-call ------> Supabase + n8n webhook
    |
    v  (post-call automation)
n8n Workflow
    |-- Log to Supabase call_logs
    |-- Slack notification (#instagram-content)
    |-- Conditional restock interest tracking
```

## Tools

| Tool | Type | What It Does |
|------|------|-------------|
| `check_inventory` | function | Queries Supabase inventory — returns product name, price, stock |
| `log_caller` | function | Logs caller name, phone, reason to Supabase call_logs |
| `add_to_waitlist` | function | Adds caller to Supabase restock_interest for out-of-stock notifications |
| `transfer_to_jay` | transferCall | Transfers call to Jay (owner) at +1 (407) 878-7003 |

## Vapi Configuration

| Setting | Value |
|---------|-------|
| Model | GPT-4o-mini (OpenAI) |
| Voice | ElevenLabs Lily (eleven_turbo_v2_5, speed 0.95, British female) |
| Transcriber | Deepgram Nova-3 |
| First Message | "Thanks for calling Legacy Wine and Liquor. How can I help you today?" |
| Max Duration | 600 seconds (10 min) |
| Silence Timeout | 30 seconds |
| Max Tokens | 250 |
| Temperature | 0.7 |
| End Call Phrases | "goodbye", "that's all", "have a good one", "thanks bye", "talk to you soon" |
| End Call Message | "Thanks for calling Legacy. We appreciate you." |

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `inventory` | 16,797 products synced from Lightspeed POS (description, price, qoh, category) |
| `customers` | 293 customers with RFM scoring, product interests, source tracking |
| `call_logs` | Every call logged with phone, duration, transcript, summary, cost, recording URL |
| `restock_interest` | Waitlist entries — phone, name, product requested, notified status |

## Project Structure

```
legacy-voice-agent/
|-- README.md                  # This file
|-- credentials.md             # API keys (gitignored)
|-- .gitignore
|-- worker/
|   |-- wrangler.toml          # Cloudflare Worker config
|   |-- src/
|       |-- index.js           # Worker code — handles all Vapi function calls
|-- docs/
|   |-- phase1/                # Current Vapi single-agent specs
|   |   |-- system_prompt_vapi.md      # Active system prompt (deployed)
|   |   |-- vapi_settings.md           # Vapi configuration settings
|   |   |-- full_agent_spec_1.md       # Complete agent specification
|   |   |-- vapi_phone_agent_spec.md   # Phone agent config + cost estimates
|   |   |-- vapi_agent_prompt.md       # Original prompt with n8n integration
|   |   |-- n8n_webhook_spec_2.md      # n8n post-call webhook workflow spec
|   |   |-- phase2_server_url_1.md     # Cloudflare Worker backend spec
|   |   |-- system_prompt_1.md         # Earlier system prompt version
|   |-- phase2/                # Future multi-agent system specs
|       |-- architecture.md            # 6-agent architecture (OpenAI Realtime API)
|       |-- tool_schemas.md            # 12+ tool definitions for all agents
|       |-- handoff_rules.md           # Agent routing and escalation logic
|       |-- caller_psychology.md       # Behavior detection and response adaptation
|       |-- system_prompt_vapi_2.md    # Enhanced prompt with real inventory
|       |-- vapi_settings_3.md         # Optimized Vapi settings
|-- n8n/                       # n8n workflow exports (future)
```

## Store Information

- **Name:** Legacy Wine & Liquor
- **Address:** 200 South French Avenue, Sanford, Florida 32771
- **Phone:** (407) 878-7003
- **Hours:** Open daily, 10 AM to 2 AM
- **Website:** legacywineandliquor.com
- **Owner:** Jay

## Phase Roadmap

### Phase 1 — Vapi Single Agent (CURRENT)
- [x] Vapi assistant Riley deployed with ElevenLabs voice
- [x] Cloudflare Worker backend for function calls
- [x] Real-time inventory lookup via Supabase (16,797 items)
- [x] Caller logging to Supabase
- [x] Waitlist/restock interest tracking
- [x] Call transfer to Jay
- [x] n8n post-call automation (Supabase + Slack)
- [x] Caller psychology adaptation in system prompt
- [x] Advanced settings (silence timeout, max duration, max tokens)
- [ ] SMS follow-ups via Twilio
- [ ] notify_manager Slack alerts for high-value leads

### Phase 2 — OpenAI Realtime Multi-Agent System (FUTURE)
- [ ] 6 specialized agents: Triage, Product Specialist, Order Support, Retention, VIP, Compliance
- [ ] Multi-agent handoffs within single call session
- [ ] Caller psychology detection and real-time adaptation
- [ ] Customer history lookup from Supabase
- [ ] SMS follow-ups after calls
- [ ] Outbound callback workflows
- [ ] Proactive restock notifications

## Deployment

### Cloudflare Worker
```bash
cd worker
wrangler deploy
```

Secrets (set via `wrangler secret put`):
- `SUPABASE_ANON_KEY` — required
- `VAPI_WEBHOOK_SECRET` — required; must match Vapi `server.secret`. Worker rejects requests with mismatched `x-vapi-secret` header.
- `N8N_WEBHOOK_URL` — optional; end-of-call report is forwarded here when set

### Vapi
Configured via Vapi MCP or dashboard.vapi.ai. Assistant ID: `804091b2-a558-49cf-b1f8-d534cc52f26a`

### n8n
Workflow ID: `thZVbwBdNQdfNyXN` on `legacywineandliquor.app.n8n.cloud`
