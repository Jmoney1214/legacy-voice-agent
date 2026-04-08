// End-of-call report handler: log call + upsert customer + forward to n8n

export async function handleEndOfCall(message, db, env, log) {
  const call = message.call || {};
  const customer = call.customer || {};

  const startedAt = call.startedAt ? new Date(call.startedAt) : null;
  const endedAt = call.endedAt ? new Date(call.endedAt) : null;
  const duration = startedAt && endedAt ? Math.round((endedAt - startedAt) / 1000) : null;

  log.info("End of call", {
    phone: customer.number,
    duration,
    cost: call.cost,
    endedReason: message.endedReason,
  });

  // 1. Log call to call_logs
  const callPayload = {
    caller_phone: customer.number || null,
    call_duration: duration,
    summary: message.summary || null,
    transcript: message.transcript || null,
    recording_url: message.recordingUrl || null,
    cost: call.cost || null,
    ended_reason: message.endedReason || null,
    vapi_call_id: call.id || null,
    created_at: new Date().toISOString(),
  };

  const logRes = await db.insert("call_logs", callPayload);
  if (!logRes.ok) {
    log.error("Call log insert failed", { status: logRes.status });
  }

  // 2. Upsert customer (append interests instead of overwriting)
  if (customer.number) {
    await upsertCustomer(customer.number, message.summary, db, log);
  }

  // 3. Forward to n8n webhook for Slack notifications + additional processing
  try {
    await fetch("https://legacywineandliquor.app.n8n.cloud/webhook/vapi-call-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch (err) {
    log.error("n8n webhook forward failed", { error: err.message });
  }

  return Response.json({ ok: true });
}

async function upsertCustomer(phone, summary, db, log) {
  // Check if customer exists
  const checkRes = await db.query(`customers?phone=eq.${encodeURIComponent(phone)}&limit=1`);

  if (!checkRes.ok) {
    log.error("Customer lookup failed during upsert", { status: checkRes.status });
    return;
  }

  const existing = await checkRes.json();

  if (existing.length > 0) {
    // Append to product_interests instead of overwriting
    const current = existing[0].product_interests || "";
    const updated = summary
      ? current
        ? `${current} | ${summary}`
        : summary
      : current;

    const res = await db.update("customers", `phone=eq.${encodeURIComponent(phone)}`, {
      source: "phone_call",
      product_interests: updated,
      updated_at: new Date().toISOString(),
    });

    if (!res.ok) {
      log.error("Customer update failed", { status: res.status });
    }
  } else {
    // Insert new customer — no placeholder email
    const res = await db.insert("customers", {
      phone,
      source: "phone_call",
      product_interests: summary || null,
    });

    if (!res.ok) {
      log.error("Customer insert failed", { status: res.status });
    }
  }
}
