#!/usr/bin/env node
// embed-inventory.mjs — one-time (and on-demand) backfill of inventory.embedding.
//
// Reads inventory rows missing an embedding, calls Cloudflare Workers AI
// (bge-base-en-v1.5, 768-dim), and writes the vector back via PostgREST.
//
// Usage:
//   SUPABASE_URL=...                    \
//   SUPABASE_SERVICE_ROLE_KEY=...       \
//   CF_ACCOUNT_ID=...                   \
//   CF_AI_TOKEN=...                     \
//   node scripts/embed-inventory.mjs [--limit 1000] [--batch 50]
//
// Requires Node >= 18 (built-in fetch). Service-role key (NOT anon) so we can
// update rows. Re-runnable: only fills NULL embeddings.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const LIMIT = parseInt(args.limit ?? "100000", 10);
const BATCH = parseInt(args.batch ?? "50", 10);

const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CF_ACCOUNT_ID", "CF_AI_TOKEN"];
for (const k of need) {
  if (!process.env[k]) {
    console.error(`missing env: ${k}`);
    process.exit(1);
  }
}

const supabaseHeaders = {
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function fetchBatch(offset, limit) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/inventory?select=id,description&embedding=is.null&order=id&limit=${limit}`;
  const res = await fetch(url, { headers: supabaseHeaders });
  if (!res.ok) throw new Error(`fetchBatch ${res.status}: ${await res.text()}`);
  return res.json();
}

async function embedAll(texts) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/baai/bge-base-en-v1.5`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CF_AI_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: texts }),
  });
  if (!res.ok) throw new Error(`embedAll ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.result?.data || [];
}

async function writeEmbedding(id, vec) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/inventory?id=eq.${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { ...supabaseHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ embedding: vec }),
  });
  if (!res.ok) throw new Error(`writeEmbedding ${id}: ${res.status} ${await res.text()}`);
}

let total = 0;
while (total < LIMIT) {
  const remaining = Math.min(BATCH, LIMIT - total);
  const rows = await fetchBatch(0, remaining);
  if (!rows.length) {
    console.log("done — no rows left without embedding");
    break;
  }
  const vecs = await embedAll(rows.map((r) => r.description || ""));
  for (let i = 0; i < rows.length; i++) {
    await writeEmbedding(rows[i].id, vecs[i]);
  }
  total += rows.length;
  console.log(`embedded ${total} (last id ${rows[rows.length - 1].id})`);
}

console.log(`finished. total embedded: ${total}`);
