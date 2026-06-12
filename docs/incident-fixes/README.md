# Riley voice agent — end-to-end fix plan

Symptoms from the production dashboard ("Known issues"):

1. **Inventory search returns nothing** — every `check_inventory` call gets back zero rows
2. **Riley says "technical difficulties" on every call** — downstream of #1 + #3
3. **Customer lookup fails for known caller** — phone format mismatch (Supabase = bare digits; ElevenLabs sends E.164)
4. **No Slack messages arriving after calls** — post-call webhook stale or not registered

## Repository map (real production)

| Concern | Repo | Lang |
|---|---|---|
| Voice agent worker (Riley) | `Jmoney1214/legacy-elevenlabs-agent` | Hono + TypeScript |
| Inventory sync (Lightspeed → Supabase) | `legacy-inventory-sync` (local: `~/Projects/legacy-inventory-sync`) | TypeScript Worker, cron every 15 min |
| Dashboard | `Jmoney1214/liquordash` (branch `voice-agent-standalone`) | — |
| Data layer | Supabase project `rffvoreqcpkqqxwprosg` (liquorhub) | Postgres |

This repo (`legacy-voice-agent`) was an earlier Vapi-based slice and is **not** the live worker. Don't apply patches here.

## Fastest path: apply-fixes.sh

If you have local clones of both production repos:

```bash
./docs/incident-fixes/apply-fixes.sh \
    --inventory-sync   ~/Projects/legacy-inventory-sync \
    --elevenlabs-agent ~/Projects/legacy-elevenlabs-agent
```

The script edits files in-place but does NOT commit or push — review with `git diff` first. It's idempotent: re-running on already-fixed checkouts is a no-op.

Phone-helper test (run anywhere, no deps):
```bash
node docs/incident-fixes/snippets/02-phone.test.mjs
# 19 pass, 0 fail
```

## Fix order (do in this sequence)

1. **`legacy-inventory-sync` — Lightspeed User-Agent fix** (root cause of #1, cascades to #2)
2. **`legacy-elevenlabs-agent` — phone normalization** (fixes #3)
3. **`legacy-elevenlabs-agent` — graceful inventory miss** (removes #2 even when #1 is briefly stale)
4. **ElevenLabs ConvAI — post-call webhook re-registration** (fixes #4)

Each step has a drop-in snippet under `./snippets/`.

## Verification after each fix

```bash
# 1. Inventory sync — freshness check (should be < 15 min)
curl -s "https://rffvoreqcpkqqxwprosg.supabase.co/rest/v1/inventory?select=synced_at&order=synced_at.desc&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY" | jq

# 2. Phone normalization — simulate a known caller lookup
curl -s "https://rffvoreqcpkqqxwprosg.supabase.co/rest/v1/customers?phone=eq.4078787003&select=name,phone&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY"

# 3. Make a test call to +1 (407) 250-7267 → ask "do you have Buffalo Trace?"
#    Should return a price + stock count, no "technical difficulties".

# 4. End the test call → check Slack #voice-agent within 30s for the post-call summary.
```

## What I still need to write production patches

The two drop-ins below are best-effort — I haven't seen the actual `legacy-elevenlabs-agent/src/` files. If you paste me:

- `legacy-elevenlabs-agent/src/tools/lookup_customer.ts` (or equivalent)
- `legacy-elevenlabs-agent/src/tools/check_inventory.ts`
- `legacy-elevenlabs-agent/src/agent-config.ts` (or wherever ElevenLabs agent webhooks are wired)

…I can cut PR-ready diffs against them instead of generic snippets.
