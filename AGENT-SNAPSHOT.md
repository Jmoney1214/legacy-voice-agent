# Lily — Legacy Wine & Liquor Voice Agent
# WORKING SNAPSHOT — May 9, 2026 (Phase 1.5: hardened + Tier-2)
# Real-time inventory across 16,797 products w/ semantic search,
# personalized greetings, structured post-call analysis, SMS follow-ups.

## Status: LIVE AND WORKING

Phone: +1 (407) 250-7267
Assistant ID: 804091b2-a558-49cf-b1f8-d534cc52f26a
Phone Number ID: c062ff21-217e-46e0-be20-a9a257433b45

## Voice & Model Stack

| Component | Provider | Model/ID | Settings |
|-----------|----------|----------|----------|
| LLM | OpenAI | gpt-4o-mini | temp 0.7, max 250 tokens |
| Voice | ElevenLabs | Lily (pFZP5JQG7iQjIQuC4Bku) | **eleven_flash_v2_5** (~75 ms TTFB), speed 0.95, stability 0.5, speaker boost, optimizeStreamingLatency 3 |
| Transcriber | Deepgram | nova-3 | English |
| Lexical inventory matcher | Supabase Postgres | pg_trgm + tsvector | `search_inventory` RPC; trigram + FTS GIN indexes |
| Concept inventory matcher | OpenAI via Supabase Edge Function | text-embedding-3-small @ 768d | `embed-query` function -> `search_inventory_semantic` RPC; HNSW index. Fires only when lexical returns 0 rows. |

## Voice Details
- **Name:** Lily — "Velvety Actress"
- **Accent:** British female
- **Personality:** Confident, warm, unhurried
- **Speed:** 0.95 (slightly below default for natural pacing)
- **Stability:** 0.5
- **Similarity Boost:** 0.75

## Tools (4 total, all working)

| Tool | ID | Server | What It Does |
|------|----|--------|-------------|
| check_inventory | f0986cdd-8f27-4f7e-bd5c-cc53bf29f651 | Cloudflare Worker | Queries Supabase inventory (16,797 items) — instant results |
| log_caller | f4a7bede-5161-48d3-88fb-878a87543d4e | Cloudflare Worker | Logs caller info to Supabase call_logs |
| add_to_waitlist | 66416617-815d-4186-afa0-9e5d9cb58413 | Cloudflare Worker | Adds to Supabase restock_interest table |
| transfer_to_jay | b71f4298-d9ba-45ab-891b-de9316f4a0a9 | Vapi built-in | Transfers to Jay at +14078787003 |

## Backend Architecture

```
Caller -> Vapi (Lily voice, GPT-4o-mini brain, Deepgram ears)
  |
  v (tool-calls)
Cloudflare Worker: vapi-agent.legacywineandliquor.workers.dev
  |
  |-- check_inventory -> Supabase RPC search_inventory()
  |   (strips punctuation, fuzzy match, price>0 filter, in-stock first)
  |
  |-- log_caller -> Supabase call_logs INSERT
  |-- add_to_waitlist -> Supabase restock_interest INSERT
  |-- end-of-call -> Supabase call_logs + customer upsert + n8n webhook
  |
  v (post-call)
n8n Workflow: thZVbwBdNQdfNyXN
  |-- Supabase call_logs
  |-- Slack #instagram-content notification
  |-- Conditional restock_interest tracking
```

## Inventory Search (the key feature)

- **Source:** Supabase `inventory` table (16,797 items synced from Lightspeed POS)
- **Method:** Supabase RPC `search_inventory()` function
- **How it works:**
  1. Strips all punctuation from search query AND product descriptions
  2. Uses ILIKE with `%keyword%` pattern matching
  3. Filters out items with price = 0 (junk/discontinued)
  4. Orders by in_stock DESC, qoh DESC
  5. Returns top 5 matches
- **Fallback:** If RPC fails, uses ILIKE directly with trailing-s stripping
- **Speed:** 0.3-1.4 seconds (vs 30+ seconds when querying Lightspeed API directly)
- **Handles:** "Titos" -> TITO'S, "Blantons" -> BLANTON'S, "1942" -> Don Julio 1942

## Supabase Function

```sql
CREATE OR REPLACE FUNCTION search_inventory(search_query text)
RETURNS TABLE(description text, price numeric, qoh integer, in_stock boolean, category text)
LANGUAGE sql STABLE
AS $$
  SELECT i.description, i.price, i.qoh, i.in_stock, i.category
  FROM inventory i
  WHERE i.price > 0
    AND regexp_replace(i.description, '[^a-zA-Z0-9 ]', '', 'g')
        ILIKE '%' || regexp_replace(
          regexp_replace(search_query, '[^a-zA-Z0-9 ]', '', 'g'),
          '\s+', '%', 'g'
        ) || '%'
  ORDER BY i.in_stock DESC, i.qoh DESC NULLS LAST
  LIMIT 5;
$$;
```

## System Prompt Summary

- Identity: "Legacy" — voice concierge, knowledgeable bartender vibe
- Off-topic guardrail: Redirects non-store questions
- Product lookups: MUST use check_inventory tool
- Fallback inventory: Hardcoded bourbon + tequila prices if tool fails
- Caller psychology: Adapts to rushed/confused/skeptical/premium/angry callers
- Transfer rules: Jay for complaints, large orders, allocated, wholesale
- Waitlist: Offers notification list for out-of-stock items
- Rules: Under 25 words, never make up prices, capture name/phone

## Advanced Settings

| Setting | Value |
|---------|-------|
| First Message | "Thanks for calling Legacy Wine and Liquor. How can I help you today?" |
| Silence Timeout | 30 seconds |
| Max Duration | 600 seconds (10 min) |
| End Call Phrases | goodbye, that's all, have a good one, thanks bye, talk to you soon |
| End Call Message | "Thanks for calling Legacy. We appreciate you." |
| Voicemail | Store hours + website + shipping info |
| End Call Function | Enabled |
| Dial Keypad | Enabled |
| Server URL | https://vapi-agent.legacywineandliquor.workers.dev |
| Forwarding | +14078787003 (Jay) |

## Critical Implementation Notes

1. **Vapi sends `tool-calls` not `function-call`** when tools are in `model.toolIds`. Worker handles BOTH formats; tool-calls are wrapped per-call in try/catch so a malformed `arguments` JSON only drops one entry.
2. **Phone number `server.url`** was previously overriding assistant with a stale Supabase Edge Function. Must point to Cloudflare Worker.
3. **ElevenLabs requires Creator plan** — free plan blocks Vapi integration.
4. **Lightspeed API is too slow for voice** (30+ seconds paginating). Use Supabase inventory instead.
5. **`model` object in Vapi PATCH requests** can wipe toolIds and messages if not included. Always send complete model object.
6. **eleven_flash_v2_5** is the right model for realtime — same voice quality as turbo_v2_5 with ~75 ms TTFB. **eleven_v3 is NOT for realtime** (higher latency, character cap).
7. **Webhook auth**: worker checks `x-vapi-secret` against `VAPI_WEBHOOK_SECRET`. Vapi sends this when assistant `server.secret` is set. If the env var is unset, the worker is OPEN — set both before deploying publicly.
8. **Personalized greeting**: requires the phone number's `assistantId` to be unset so Vapi posts `assistant-request` to the worker. With it set, the worker's personalization is bypassed.
9. **Idempotent end-of-call**: partial UNIQUE on `call_logs.vapi_call_id` lets the worker upsert via PostgREST `on_conflict=vapi_call_id&Prefer: resolution=merge-duplicates`. Drop the matching n8n insert step.
10. **Inventory matching is two-stage, all in Supabase**: lexical first (`search_inventory` RPC: pg_trgm typo tolerance + tsvector word reorder + unaccent) → if no hits, concept search via `embed-query` Edge Function (OpenAI text-embedding-3-small @ 768d → `search_inventory_semantic` RPC) → ILIKE fallback. Worker only ever calls Supabase URLs; the OpenAI key lives in Supabase secrets.
11. **Twilio SMS** is gated on `TWILIO_*` secrets being set AND `structuredData.next_action` being `sms_link` or `sms_waitlist_confirm`. Suppression list (`sms_opt_outs`) honored.

## Files

| File | What |
|------|------|
| `vapi-export.json` | Complete Vapi assistant + phone + tools config (restorable) |
| `worker/src/index.js` | Cloudflare Worker source code |
| `worker/wrangler.toml` | Worker deployment config |
| `credentials.md` | All API keys (gitignored) |
| `docs/phase1/` | All Phase 1 specification docs |
| `docs/phase2/` | Future multi-agent architecture specs |
