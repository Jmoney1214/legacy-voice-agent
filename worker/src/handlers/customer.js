// Customer handlers: log_caller + lookup_customer

export async function handleLogCaller(params, callInfo, db, log) {
  const callbackRequested = params.callback_requested === true || params.callback_requested === "true";

  const payload = {
    caller_phone: params.phone_number || callInfo?.customer?.number || null,
    caller_name: params.caller_name || null,
    summary: params.reason || null,
    outcome: callbackRequested ? "callback_requested" : "info_provided",
    wants_notification: false,
    transferred: false,
    created_at: new Date().toISOString(),
  };

  log.info("Logging caller", { phone: payload.caller_phone, outcome: payload.outcome });

  const res = await db.insert("call_logs", payload);
  if (!res.ok) {
    log.error("Failed to log caller", { status: res.status });
  }

  return Response.json({ results: [{ result: "Got it, I've noted that down." }] });
}

export async function handleLookupCustomer(params, db, log) {
  const phone = params.phone || params.phone_number || "";
  if (!phone) {
    return Response.json({ results: [{ result: "I need a phone number to look up the customer." }] });
  }

  log.info("Looking up customer", { phone });

  const res = await db.query(`customers?phone=eq.${encodeURIComponent(phone)}&limit=1`);
  if (!res.ok) {
    log.error("Customer lookup failed", { status: res.status });
    return Response.json({ results: [{ result: "I couldn't look that up right now." }] });
  }

  const customers = await res.json();
  if (!customers || customers.length === 0) {
    return Response.json({ results: [{ result: `No customer record found for ${phone}. This is a new caller.` }] });
  }

  const c = customers[0];
  const parts = [`Customer: ${c.name || c.phone}`];
  if (c.product_interests) parts.push(`Past interests: ${c.product_interests}`);
  if (c.source) parts.push(`Source: ${c.source}`);
  if (c.updated_at) parts.push(`Last contact: ${c.updated_at.split("T")[0]}`);

  return Response.json({ results: [{ result: parts.join(". ") }] });
}
