// Apply the normalizer at the boundary of every tool that touches a phone.
//
// This shows the lookup_customer tool. Same shape works for log_caller and
// add_to_waitlist — normalize on read (lookup by bare digits) and on write
// (store as bare digits).

import { toBareDigits } from "../util/phone";

// ElevenLabs passes the caller phone in the tool's `system` context. The
// exact field path depends on your tool wiring; in the ConvAI agent runtime
// it's typically `req.body.conversation_initiation_client_data.dynamic_variables.system__caller_id`
// or accessible via `context.caller.phone` if you've already extracted it.
//
// Wherever you currently do something like:
//
//   const phone = body.caller_phone;
//   const { data } = await supabase.from("customers").select("*").eq("phone", phone).single();
//
// Change to:

export async function lookupCustomerByPhone(rawPhone: string, supabase: SupabaseClient) {
  const phone = toBareDigits(rawPhone);
  if (!phone) return null;

  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone, email, rfm_tier, last_seen_at, preferences:customer_preferences(*)")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    console.error("customer lookup failed:", error.message);
    return null;
  }
  return data;
}

// And for writes (log_caller, add_to_waitlist, customer upsert):
export async function upsertCustomerFromCall(rawPhone: string, fields: object, supabase: SupabaseClient) {
  const phone = toBareDigits(rawPhone);
  if (!phone) return;
  await supabase
    .from("customers")
    .upsert({ phone, ...fields, last_seen_at: new Date().toISOString() }, { onConflict: "phone" });
}

// SupabaseClient is just a stand-in here — import the real one from your existing setup.
type SupabaseClient = any;
