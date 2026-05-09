-- Tier-2 follow-on: concept-level semantic inventory search.
-- Adds pgvector + embedding column on top of the lexical search from 001.
-- The lexical (pg_trgm + tsvector) RPC remains primary; semantic fires as a
-- fallback when lexical returns nothing (e.g. "something smooth and sweet").
--
-- Embeddings are produced by the embed-query / embed-inventory-backfill
-- Supabase Edge Functions, which call OpenAI text-embedding-3-small with
-- dimensions=768 and write rows back to inventory.embedding. No external
-- service ever touches Postgres directly — all state lives in Supabase.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS embedding vector(768);

-- HNSW for read-heavy / write-light. Inventory only changes on Lightspeed sync.
CREATE INDEX IF NOT EXISTS inventory_embedding_hnsw_idx
  ON inventory
  USING hnsw (embedding vector_cosine_ops);

-- Concept-level semantic search. Cosine distance, score = 1 - distance.
-- min_similarity 0.4 is the floor below which we consider a result irrelevant.
CREATE OR REPLACE FUNCTION search_inventory_semantic(
  query_embedding vector(768),
  match_count int DEFAULT 5,
  min_similarity float DEFAULT 0.4
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
  SELECT
    i.description,
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
