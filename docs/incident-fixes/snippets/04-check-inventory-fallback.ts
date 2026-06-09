// Why Riley says "technical difficulties" on every call:
//
// When the inventory sync is stale (root-cause #1) OR when search_inventory
// returns zero rows for any reason, the tool currently throws / returns an
// error shape, and ElevenLabs reads that as a tool failure → the model
// surfaces the canned "I'm having technical difficulties" fallback.
//
// Fix: distinguish "we ran the search but found nothing" (200 with empty
// results — Riley says "I don't see that in stock, want me to add you to the
// waitlist?") from "the search itself failed" (502 — surfaces the error to
// Riley, who can recover with the in-prompt fallback list).

import { toBareDigits } from "../util/phone";

type Json = Record<string, unknown>;

interface InventoryRow {
  description: string;
  price: number | string | null;
  qoh: number | null;
  in_stock: boolean | null;
  category: string | null;
}

export async function checkInventoryTool(
  args: { product_name?: string; query?: string },
  ctx: { supabase: SupabaseClient },
): Promise<Json> {
  const query = (args.product_name ?? args.query ?? "").trim();
  if (!query) {
    return {
      ok: true,
      matches: [],
      narration:
        "What product are you looking for? I can check what we've got on the shelf.",
    };
  }

  let rows: InventoryRow[] = [];

  // 1. Smart RPC (pg_trgm + tsvector)
  try {
    const { data, error } = await ctx.supabase.rpc("search_inventory", {
      search_query: query,
    });
    if (error) throw error;
    if (Array.isArray(data)) rows = data as InventoryRow[];
  } catch (err) {
    console.error("search_inventory RPC failed:", (err as Error).message);
    // Fall through to ILIKE — don't error out the tool yet.
  }

  // 2. ILIKE fallback
  if (rows.length === 0) {
    try {
      const safe = query.replace(/[%_]/g, "");
      const { data } = await ctx.supabase
        .from("inventory")
        .select("description, price, qoh, in_stock, category")
        .ilike("description", `%${safe}%`)
        .gt("price", 0)
        .order("in_stock", { ascending: false })
        .order("qoh", { ascending: false, nullsFirst: false })
        .limit(5);
      if (Array.isArray(data)) rows = data as InventoryRow[];
    } catch (err) {
      console.error("ilike fallback failed:", (err as Error).message);
    }
  }

  // 3. Inventory sync staleness check — surfaces the real failure to Riley
  //    instead of pretending we just don't carry the product.
  if (rows.length === 0) {
    const stale = await inventoryIsStale(ctx.supabase);
    if (stale) {
      // Tool returns an error so the prompt's "fallback knowledge" branch
      // engages naturally — Riley can quote the in-prompt list.
      return {
        ok: false,
        error_code: "INVENTORY_STALE",
        narration:
          "I can't pull live stock right now — let me check from memory and have someone confirm.",
      };
    }
    return {
      ok: true,
      matches: [],
      narration: `I don't see ${query} in stock right now. Want me to add you to the notification list so you're first to know when it comes in?`,
    };
  }

  const formatted = rows.slice(0, 3).map((r) => ({
    name: r.description ?? "unknown",
    price:
      r.price && Number(r.price) > 0
        ? `$${Number(r.price).toFixed(2)}`
        : "price not listed",
    in_stock: (r.qoh ?? 0) > 0,
    qoh: r.qoh ?? 0,
  }));

  return {
    ok: true,
    matches: formatted,
    narration: formatNarration(formatted),
  };
}

function formatNarration(matches: { name: string; price: string; in_stock: boolean; qoh: number }[]): string {
  if (matches.length === 1) {
    const m = matches[0];
    return m.in_stock
      ? `Yes — ${m.name}, ${m.price}, ${m.qoh} in stock. Want me to set one aside?`
      : `We carry ${m.name} but it's currently out of stock. I can add you to the notification list — want me to?`;
  }
  const lines = matches.map((m) =>
    m.in_stock
      ? `${m.name} — ${m.price}, ${m.qoh} in stock`
      : `${m.name} — ${m.price}, out of stock`,
  );
  return `Here's what I found: ${lines.join(". ")}. Any of those sound right?`;
}

/**
 * Inventory is "stale" if the freshest synced_at is older than 30 minutes.
 * Cron runs every 15, so 30 min gives one missed run grace before we
 * surface the failure to the caller.
 */
async function inventoryIsStale(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("inventory")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const last = data?.synced_at ? new Date(data.synced_at as string).getTime() : 0;
    return Date.now() - last > 30 * 60 * 1000;
  } catch {
    return true;
  }
}

type SupabaseClient = any;
