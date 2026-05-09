-- Tier 2 schema upgrades for the voice agent.
-- Run these in the Supabase SQL editor (or via `supabase db push`).
-- Re-runnable: every statement is idempotent.

-- =========================================================================
-- 1. pgvector for semantic inventory search
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Approximate-NN index. HNSW is the right choice for read-heavy / write-light;
-- our inventory only changes on Lightspeed sync.
CREATE INDEX IF NOT EXISTS inventory_embedding_hnsw_idx
  ON inventory
  USING hnsw (embedding vector_cosine_ops);

-- Semantic search RPC. Caller passes a 768-dim embedding produced by
-- Workers AI bge-base-en-v1.5; we return the top N priced rows above a
-- similarity floor, ordered by cosine distance.
CREATE OR REPLACE FUNCTION search_inventory_semantic(
  query_embedding vector(768),
  match_count int DEFAULT 5,
  min_similarity float DEFAULT 0.55
)
RETURNS TABLE(
  description text,
  price numeric,
  qoh integer,
  in_stock boolean,
  category text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT i.description,
         i.price,
         i.qoh,
         i.in_stock,
         i.category,
         1 - (i.embedding <=> query_embedding) AS similarity
  FROM inventory i
  WHERE i.embedding IS NOT NULL
    AND i.price > 0
    AND 1 - (i.embedding <=> query_embedding) > min_similarity
  ORDER BY i.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- =========================================================================
-- 2. Idempotent call_logs (drop the worker/n8n duplicate-insert problem)
-- =========================================================================

-- Partial UNIQUE so log_caller mid-call (no vapi_call_id yet) still works.
CREATE UNIQUE INDEX IF NOT EXISTS call_logs_vapi_call_id_key
  ON call_logs (vapi_call_id)
  WHERE vapi_call_id IS NOT NULL;

-- Optional columns for richer end-of-call analysis.
ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS structured_data jsonb,
  ADD COLUMN IF NOT EXISTS sentiment text,
  ADD COLUMN IF NOT EXISTS lead_signal text,
  ADD COLUMN IF NOT EXISTS success_score text;

-- =========================================================================
-- 3. Customers — phone uniqueness + history columns
-- =========================================================================

-- Required for the worker's PostgREST upsert (on_conflict=phone).
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
