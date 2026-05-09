// embed-inventory-backfill — fills inventory.embedding for rows missing it.
// Idempotent. Process up to `batch` rows per invocation (default 50, max 100)
// and return progress. The wrapper script loops until remaining=0.
//
// POST { "batch": 50 }
//   -> { "processed": N, "remaining": M }
//
// Auth: requires X-Backfill-Secret header to match BACKFILL_SECRET env, OR
// Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>. Deploy with
// `supabase functions deploy embed-inventory-backfill --no-verify-jwt` so
// this auth path is the only gate.
//
// Required Edge Function secrets:
//   OPENAI_API_KEY     — OpenAI key with embeddings access
//   BACKFILL_SECRET    — shared secret for invocation auth
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { jsonResponse } from "../_shared/cors.ts";

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIMS = 768;

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  // Auth — either the backfill secret header or a bearer-of-service-role.
  const headerSecret = req.headers.get("x-backfill-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const expectedSecret = Deno.env.get("BACKFILL_SECRET") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const okSecret = !!expectedSecret && headerSecret === expectedSecret;
  const okBearer = !!serviceKey && auth === `Bearer ${serviceKey}`;
  if (!okSecret && !okBearer) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !serviceKey || !openaiKey) {
    return jsonResponse({ error: "function not configured" }, 500);
  }

  const body = await req.json().catch(() => ({}));
  const batch = clamp(body?.batch ?? 50, 1, 100);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: rows, error: fetchErr } = await supabase
    .from("inventory")
    .select("id, description")
    .is("embedding", null)
    .gt("price", 0)
    .order("id", { ascending: true })
    .limit(batch);

  if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
  if (!rows || rows.length === 0) {
    return jsonResponse({ processed: 0, remaining: 0, done: true });
  }

  // Batch embed in one OpenAI call
  const inputs = rows.map((r) => (r.description ?? "").slice(0, 8000));
  const embRes = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: inputs,
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
  const embeddings: number[][] = (embJson.data ?? []).map(
    (d: { embedding: number[] }) => d.embedding,
  );

  // Update each row. We do this serially because PostgREST batch updates
  // can't set per-row embeddings; the row count is small per invocation.
  let processed = 0;
  for (let i = 0; i < rows.length; i++) {
    const vec = embeddings[i];
    if (!Array.isArray(vec) || vec.length !== EMBED_DIMS) continue;
    const { error } = await supabase
      .from("inventory")
      .update({ embedding: vec })
      .eq("id", rows[i].id);
    if (!error) processed++;
  }

  // Remaining count for the loop driver
  const { count } = await supabase
    .from("inventory")
    .select("*", { count: "exact", head: true })
    .is("embedding", null)
    .gt("price", 0);

  return jsonResponse({
    processed,
    remaining: count ?? 0,
    done: (count ?? 0) === 0,
  });
});

function clamp(n: unknown, lo: number, hi: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.trunc(v)));
}
