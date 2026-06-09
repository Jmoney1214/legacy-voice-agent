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
Vapi (Lily) — Deepgram Nova-3 STT, GPT-4o-mini, ElevenLabs flash_v2_5 TTS
   + voicemail detection, smart endpointing, background denoising,
     analysisPlan (summary + structuredData + Checklist success rubric)
    |
    |-- assistant-request (per call ring) --\
    |                                        |
    |                                        v
    |                              Cloudflare Worker — assistant-request handler
    |                              ↳ lookup customer by phone
    |                              ↳ return assistantOverrides w/ personalized firstMessage
    |                                        |
    |<---------------------------------------/
    |
    v  (tool-calls)
Cloudflare Worker — vapi-agent.legacywineandliquor.workers.dev
   + x-vapi-secret auth, 4s fetch timeouts. Stateless: all data lives in Supabase.
    |
    |-- check_inventory --> 1) Supabase search_inventory RPC
    |                          (pg_trgm fuzzy + tsvector word match)
    |                       2) embed-query Edge Function (concept search:
    |                          OpenAI text-embedding-3-small @ 768d → pgvector)
    |                       3) ILIKE fallback
    |                       (filler audio: "Let me check that for you.")
    |-- log_caller -------> Supabase call_logs (mid-call)
    |-- add_to_waitlist --> Supabase restock_interest
    |-- end-of-call ------> idempotent upsert (vapi_call_id) →
    |                       customer upsert →
    |                       Twilio SMS follow-up (driven by structuredData.next_action) →
    |                       n8n forward (optional, env-gated)
    |
    v  (post-call automation, optional)
n8n Workflow
    |-- Slack notification (#instagram-content)
    |-- Conditional restock interest tracking
    |   (call_logs insert step now redundant — worker writes idempotently)
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
| Model | GPT-4o-mini (OpenAI), temp 0.7, max 250 tokens |
| Voice | ElevenLabs Lily (`eleven_flash_v2_5`, speed 0.95, speaker boost on, optimizeStreamingLatency 3) |
| Transcriber | Deepgram Nova-3 |
| First Message | Dynamic — personalized via `assistant-request` webhook for returning callers |
| Max Duration | 600 seconds (10 min) |
| Silence Timeout | 30 seconds |
| Voicemail Detection | Vapi (5s start, 5s frequency, 3 retries) |
| Background Denoising | Enabled |
| Smart Endpointing | LiveKit |
| Stop Speaking | numWords 2, voiceSeconds 0.3, backoffSeconds 1.5 |
| End Call Phrases | "goodbye", "that's all", "have a good one", "thanks bye", "talk to you soon" |
| End Call Message | "Thanks for calling Legacy. We appreciate you." |
| Analysis | summary + structuredData (12 fields) + Checklist success rubric |

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `inventory` | 16,797 products synced from Lightspeed POS (description, price, qoh, category, **embedding vector(768)**). Trigram + FTS GIN-indexed for fuzzy search; HNSW-indexed for semantic search. |
| `customers` | 293+ customers with RFM scoring, product interests, source tracking, `last_call_at`, `call_count`, `last_products_discussed` |
| `call_logs` | Every call logged with phone, duration, transcript, summary, cost, recording URL, **structured_data (jsonb), sentiment, lead_signal, success_score** |
| `restock_interest` | Waitlist entries — phone, name, product requested, notified status |
| `sms_opt_outs` | DNC list — Twilio SMS follow-ups skip these phone numbers |

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

## Claude Code MCP

`.mcp.json` at the repo root registers four official MCP servers so Claude Code sessions on this project can drive the whole stack:

| Server | Package | What you can do from Claude Code |
|---|---|---|
| [ElevenLabs](https://github.com/elevenlabs/elevenlabs-mcp) | `uvx elevenlabs-mcp` | Text-to-speech preview, voice search, voice cloning, transcribe recordings, conversational-AI agent management |
| [Supabase](https://www.npmjs.com/package/@supabase/mcp-server) | `npx -y @supabase/mcp-server` | Query/migrate the `liquorhub` project — list_tables, execute_sql, apply_migration, get_logs, deploy edge functions |
| [Twilio](https://github.com/twilio-labs/mcp) | `npx -y @twilio-alpha/mcp` | Send test SMS, list call logs, inspect/import phone numbers, fetch message status |
| [Slack](https://www.npmjs.com/package/@modelcontextprotocol/server-slack) | `npx -y @modelcontextprotocol/server-slack` | Read/post `#voice-agent` summaries, search history, react to threads |

All credentials are referenced via `${ENV_VAR}` in `.mcp.json` — none of them land in git.

```bash
# Set in your shell rc (or ~/.claude/.env), then restart Claude Code
export ELEVENLABS_API_KEY=sk_...
export SUPABASE_ACCESS_TOKEN=sbp_...          # from supabase.com/dashboard/account/tokens
export TWILIO_ACCOUNT_SID=AC...
export TWILIO_API_KEY=SK...                   # twilio.com/console/runtime/api-keys (not auth token)
export TWILIO_API_SECRET=...
export SLACK_BOT_TOKEN=xoxb-...               # from your Slack app's OAuth & Permissions page
export SLACK_TEAM_ID=T...                     # the T-prefixed workspace id
```

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

### Phase 1.5 — Hardening + Tier-2 capability (CURRENT)
- [x] Webhook auth (`x-vapi-secret` → `VAPI_WEBHOOK_SECRET`)
- [x] Per-tool-call try/catch, fetch timeouts, idempotent call_logs
- [x] ElevenLabs `eleven_flash_v2_5` (~75 ms latency vs ~250 ms turbo)
- [x] Tool `messages.request-start/failed/response-delayed` filler audio
- [x] Vapi `analysisPlan` — summary + structuredData + Checklist success rubric
- [x] Vapi voicemail detection
- [x] Background denoising + tuned `startSpeakingPlan`/`stopSpeakingPlan`
- [x] Personalized greeting per caller via `assistant-request` webhook
- [x] Smarter inventory matching: pg_trgm + tsvector in `search_inventory` RPC (typo and word-order tolerant)
- [x] Concept-level fallback: OpenAI text-embedding-3-small (768d) via Supabase Edge Function `embed-query` → `search_inventory_semantic` RPC (handles "something smooth and sweet")
- [x] Twilio SMS follow-ups driven by `structuredData.next_action`
- [x] SMS opt-out suppression (`sms_opt_outs` table)
- [ ] notify_manager Slack alerts for high-value leads (separate from n8n)
- [ ] Lightspeed → Supabase nightly inventory sync (Cron Worker)

### Phase 2 — OpenAI Realtime Multi-Agent System (FUTURE)
- [ ] 6 specialized agents: Triage, Product Specialist, Order Support, Retention, VIP, Compliance
- [ ] Multi-agent handoffs within single call session
- [ ] Caller psychology detection and real-time adaptation
- [ ] Customer history lookup from Supabase
- [ ] SMS follow-ups after calls
- [ ] Outbound callback workflows
- [ ] Proactive restock notifications

## Deployment

### 1. Apply the SQL migrations

In the Supabase SQL editor (or `supabase db push`), run in order:

- `worker/migrations/001_inventory_search.sql` — `pg_trgm` + `unaccent`, trigram + FTS GIN indexes on `inventory.description`, smarter `search_inventory()` RPC, partial UNIQUE on `call_logs.vapi_call_id`, `customers.phone` UNIQUE + history columns, `sms_opt_outs` table.
- `worker/migrations/002_inventory_semantic.sql` — `vector` extension, `inventory.embedding vector(768)`, HNSW index, `search_inventory_semantic()` RPC.

### 2. Deploy Supabase Edge Functions

```bash
# JWT-verified runtime function (uses anon key from worker)
supabase functions deploy embed-query

# Public-but-secret-gated backfill (--no-verify-jwt; protected by BACKFILL_SECRET header)
supabase functions deploy embed-inventory-backfill --no-verify-jwt

supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set BACKFILL_SECRET=$(openssl rand -hex 32)
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected into the function env by Supabase.

### 3. Backfill embeddings (one-time, ~16,797 rows)

```bash
SUPABASE_URL=https://<ref>.supabase.co \
BACKFILL_SECRET=<the-value-you-set> \
./scripts/backfill-embeddings.sh
```

Loops the `embed-inventory-backfill` Edge Function in 50-row batches until `remaining=0`. Re-runnable; only fills rows with `embedding IS NULL`. Total OpenAI cost: well under $0.10.

### 4. Cloudflare Worker

```bash
cd worker
wrangler deploy
```

Secrets (`wrangler secret put <NAME>`):

| Secret | Purpose |
|--------|---------|
| `SUPABASE_ANON_KEY` | PostgREST + RPC + Edge Function auth (required) |
| `VAPI_WEBHOOK_SECRET` | Must match Vapi `server.secret`. Worker rejects mismatched `x-vapi-secret`. (required) |
| `TWILIO_ACCOUNT_SID` | SMS follow-ups (required if SMS enabled) |
| `TWILIO_AUTH_TOKEN` | SMS follow-ups |
| `TWILIO_FROM` | E.164 sender number (e.g. `+14072507267`) |
| `N8N_WEBHOOK_URL` | Optional end-of-call forward |

The worker is stateless: search, embeddings, caller history, opt-outs all live in Supabase.

### 5. Push Vapi config

```bash
VAPI_API_KEY=vapi_... ./scripts/deploy-vapi.sh
```

Pushes the assistant config + the `check_inventory` tool messages from `vapi-export.json` (voice → `eleven_flash_v2_5`, voicemail detection, `analysisPlan` for summary/structured data/success rubric, denoising on, smart endpointing, request-start/failed/delayed filler audio).

Set Vapi → assistant settings → server → secret to the same value as `VAPI_WEBHOOK_SECRET`. Set the phone number's `assistantId` to **null** so Vapi calls the worker's `assistant-request` endpoint and gets per-caller personalization. (To disable that, leave the assistant ID set.)

### n8n

Workflow ID: `thZVbwBdNQdfNyXN` on `legacywineandliquor.app.n8n.cloud`. With the Cloudflare Worker now writing `call_logs` idempotently keyed on `vapi_call_id`, the n8n workflow's `call_logs` insert step can be removed (or it'll silently be merged into the same row).
