// embed-query — runtime concept search.
//
// POST { "query": "something smooth and sweet", "match_count": 5, "min_similarity": 0.4 }
//   -> { "matches": [{ description, price, qoh, in_stock, category, similarity }] }
//
// Calls OpenAI text-embedding-3-small (dimensions=768), then RPC
// search_inventory_semantic. Auth via Supabase JWT (anon key is fine).
//
// Required Edge Function secrets:
//   OPENAI_API_KEY                — OpenAI key with embeddings access
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIMS = 768;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "POST only" }, 405);
  }

  let body: { query?: string; match_count?: number; min_similarity?: number };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }

  const query = (body.query ?? "").trim();
  if (!query) return jsonResponse({ error: "query required" }, 400);

  const matchCount = clamp(body.match_count ?? 5, 1, 20);
  const minSim = clampFloat(body.min_similarity ?? 0.4, 0, 1);

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!openaiKey || !supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "function not configured" }, 500);
  }

  // 1. Embed
  const embRes = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: query,
      dimensions: EMBED_DIMS,
    }),
  });
  if (!embRes.ok) {
    return jsonResponse(
      { error: "embed failed", status: embRes.status },
      502,
    );
  }
  const embJson = await embRes.json();
  const vector = embJson?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBED_DIMS) {
    return jsonResponse({ error: "unexpected embedding shape" }, 502);
  }

  // 2. Postgres semantic search
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase.rpc("search_inventory_semantic", {
    query_embedding: vector,
    match_count: matchCount,
    min_similarity: minSim,
  });
  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ matches: data ?? [] });
});

function clamp(n: unknown, lo: number, hi: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.trunc(v)));
}

function clampFloat(n: unknown, lo: number, hi: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}
