// Phone format normalization helpers for legacy-elevenlabs-agent.
//
// Problem (per dashboard "Known issues"):
//   Supabase customers.phone stores BARE digits (e.g. "4078787003")
//   ElevenLabs ConvAI sends the caller's number in E.164      (e.g. "+14078787003")
//   The lookup_customer tool does an equality match, so every known caller
//   is treated as a new caller.
//
// Drop this file at: legacy-elevenlabs-agent/src/util/phone.ts
// Then in every tool that touches a phone number, normalize on the boundary.

/**
 * Convert any caller phone string into the canonical bare-digit form used by
 * Supabase. Strips a leading "+", "1-" country code for US numbers, and any
 * formatting characters (spaces, dashes, parens, dots).
 *
 * Examples:
 *   "+14078787003"     -> "4078787003"
 *   "+1 (407) 878-7003" -> "4078787003"
 *   "407-878-7003"     -> "4078787003"
 *   "4078787003"       -> "4078787003"   (idempotent)
 *   "+447911123456"    -> "447911123456" (non-US preserved)
 */
export function toBareDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D+/g, "");
  if (!digits) return null;
  // Strip the US country code "1" only when it produces a 10-digit NANP number.
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

/**
 * Convert bare digits back to E.164. Currently US-only; extend if you sell
 * across borders. Returns null on bad input rather than throwing so callers
 * can decide.
 *
 *   "4078787003" -> "+14078787003"
 */
export function toE164(phone: string | null | undefined, defaultCountry = "1"): string | null {
  const digits = toBareDigits(phone);
  if (!digits) return null;
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  return `+${digits}`;
}

/**
 * Lookup-friendly variants. Use this when querying Supabase so a row stored
 * either way still matches. Returns an array of unique candidates ordered
 * from most-canonical to least.
 *
 *   "+14078787003" -> ["4078787003", "14078787003", "+14078787003"]
 */
export function phoneLookupCandidates(phone: string | null | undefined): string[] {
  const out = new Set<string>();
  const bare = toBareDigits(phone);
  if (bare) out.add(bare);
  const digits = String(phone ?? "").replace(/\D+/g, "");
  if (digits) out.add(digits);
  if (phone) out.add(String(phone));
  return [...out];
}
