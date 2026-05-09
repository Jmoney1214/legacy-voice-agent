-- Tier 2 schema upgrades for the voice agent. Pure Supabase / Postgres.
-- Run in the Supabase SQL editor (or `supabase db push`). Re-runnable.
--
-- Inventory matching uses pg_trgm (typo tolerance) + tsvector (word reordering)
-- instead of pgvector + external embeddings. Same UX, no Cloudflare AI / KV
-- dependency, all state lives in Supabase.

-- =========================================================================
-- 0. Drop the previous pgvector experiment if present (idempotent)
-- =========================================================================

DROP FUNCTION IF EXISTS search_inventory_semantic(vector, int, float);
DROP INDEX IF EXISTS inventory_embedding_hnsw_idx;
ALTER TABLE inventory DROP COLUMN IF EXISTS embedding;
DROP EXTENSION IF EXISTS vector;

-- =========================================================================
-- 1. Smarter inventory search: pg_trgm + tsvector
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Trigram index for fuzzy / typo-tolerant similarity().
CREATE INDEX IF NOT EXISTS inventory_description_trgm_idx
  ON inventory
  USING gin (description gin_trgm_ops);

-- Full-text index for plainto_tsquery() word matching.
CREATE INDEX IF NOT EXISTS inventory_description_fts_idx
  ON inventory
  USING gin (to_tsvector('simple', unaccent(coalesce(description, ''))));

-- Combined match: tsvector for word boundaries, trigram for typos.
-- Returns up to 5 priced rows ranked by best signal between the two.
-- Replaces the older ILIKE-based search_inventory.
CREATE OR REPLACE FUNCTION search_inventory(search_query text)
RETURNS TABLE(
  description text,
  price numeric,
  qoh integer,
  in_stock boolean,
  category text,
  score float
)
LANGUAGE sql STABLE
AS $$
  WITH q AS (
    SELECT
      regexp_replace(unaccent(lower(coalesce(search_query, ''))), '[^a-z0-9 ]', ' ', 'g') AS clean,
      plainto_tsquery('simple', unaccent(coalesce(search_query, ''))) AS tsq
  )
  SELECT
    i.description,
    i.price,
    i.qoh,
    i.in_stock,
    i.category,
    GREATEST(
      ts_rank_cd(to_tsvector('simple', unaccent(coalesce(i.description, ''))), q.tsq),
      similarity(unaccent(lower(i.description)), q.clean)
    )::float AS score
  FROM inventory i, q
  WHERE i.price > 0
    AND (
      to_tsvector('simple', unaccent(coalesce(i.description, ''))) @@ q.tsq
      OR unaccent(lower(i.description)) % q.clean
    )
  ORDER BY score DESC, i.in_stock DESC, i.qoh DESC NULLS LAST
  LIMIT 5;
$$;

-- Trigram similarity threshold tuning. 0.3 default is too loose for product
-- names (matches "vodka" against "votive"). 0.4 is a tighter fit.
ALTER DATABASE postgres SET pg_trgm.similarity_threshold = 0.4;

-- =========================================================================
-- 2. Idempotent call_logs (no more worker/n8n duplicate inserts)
-- =========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS call_logs_vapi_call_id_key
  ON call_logs (vapi_call_id)
  WHERE vapi_call_id IS NOT NULL;

ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS structured_data jsonb,
  ADD COLUMN IF NOT EXISTS sentiment text,
  ADD COLUMN IF NOT EXISTS lead_signal text,
  ADD COLUMN IF NOT EXISTS success_score text;

-- =========================================================================
-- 3. Customers — phone uniqueness + history columns
-- =========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_key
  ON customers (phone)
  WHERE phone IS NOT NULL;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS call_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_call_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_products_discussed text[];

-- =========================================================================
-- 4. SMS suppression list (DNC / opt-outs)
-- =========================================================================

CREATE TABLE IF NOT EXISTS sms_opt_outs (
  phone text PRIMARY KEY,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
