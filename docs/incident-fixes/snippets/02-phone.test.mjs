// Quick sanity tests for the phone helpers. Run with:
//   node docs/incident-fixes/snippets/02-phone.test.mjs
//
// Mirrors 02-phone.ts in vanilla JS so it runs without a TS toolchain.
// If a case here fails, the helpers won't fix "customer lookup fails for
// known caller" — every assertion below is one observed input shape from
// real ElevenLabs / Twilio / Supabase traffic.

function toBareDigits(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function toE164(phone, defaultCountry = "1") {
  const digits = toBareDigits(phone);
  if (!digits) return null;
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  return `+${digits}`;
}

function phoneLookupCandidates(phone) {
  const out = new Set();
  const bare = toBareDigits(phone);
  if (bare) out.add(bare);
  const digits = String(phone ?? "").replace(/\D+/g, "");
  if (digits) out.add(digits);
  if (phone) out.add(String(phone));
  return [...out];
}

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`\x1b[32m✓\x1b[0m ${label}`); }
  else    { fail++; console.log(`\x1b[31m✗\x1b[0m ${label}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
}

// --- toBareDigits ---
eq("E.164 US strips +1",            toBareDigits("+14078787003"),         "4078787003");
eq("formatted US strips chrome",    toBareDigits("+1 (407) 878-7003"),    "4078787003");
eq("dashed bare 10-digit",          toBareDigits("407-878-7003"),         "4078787003");
eq("already-bare 10-digit",         toBareDigits("4078787003"),           "4078787003");
eq("leading 1 only stripped at 11", toBareDigits("14078787003"),          "4078787003");
eq("12-digit international kept",   toBareDigits("+447911123456"),        "447911123456");
eq("null in -> null out",           toBareDigits(null),                   null);
eq("empty string -> null",          toBareDigits(""),                     null);
eq("alpha only -> null",            toBareDigits("abc"),                  null);
eq("dot-formatted",                 toBareDigits("407.878.7003"),         "4078787003");

// --- toE164 ---
eq("bare 10 -> +1",                 toE164("4078787003"),                 "+14078787003");
eq("E.164 idempotent",              toE164("+14078787003"),               "+14078787003");
eq("formatted -> E.164",            toE164("(407) 878-7003"),             "+14078787003");
eq("non-US 12-digit -> +",          toE164("+447911123456"),              "+447911123456");
eq("null -> null",                  toE164(null),                         null);

// --- phoneLookupCandidates ---
// Any of these candidates against `phone=eq.${cand}` should hit if a stored
// row used any of these representations. Order = best canonical first.
eq("E.164 yields all 3 variants",
   phoneLookupCandidates("+14078787003"),
   ["4078787003", "14078787003", "+14078787003"]);
eq("bare yields just the bare form",
   phoneLookupCandidates("4078787003"),
   ["4078787003"]);
eq("formatted dedupes correctly",
   phoneLookupCandidates("+1 (407) 878-7003"),
   ["4078787003", "14078787003", "+1 (407) 878-7003"]);
eq("null -> empty array",           phoneLookupCandidates(null),           []);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
