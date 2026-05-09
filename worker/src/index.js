// Vapi Voice Agent Backend — Legacy Wine & Liquor
// Handles function calls from Vapi: check_inventory, log_caller, add_to_waitlist

const FETCH_TIMEOUT_MS = 4000;
const FALLBACK_RESULT = "I'm having trouble looking that up right now. Can I have someone call you back?";

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return Response.json({ error: "POST only" }, { status: 405 });
    }

    if (env.VAPI_WEBHOOK_SECRET) {
      const provided = request.headers.get("x-vapi-secret") || request.headers.get("x-vapi-signature");
      if (provided !== env.VAPI_WEBHOOK_SECRET) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
    }

    let message;
    try {
      const body = await request.json();
      message = body.message;
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }

    if (!message) {
      return Response.json({ error: "No message" }, { status: 400 });
    }

    try {
      if (message.type === "function-call") {
        const fn = message.functionCall || {};
        const params = fn.parameters || {};
        return await routeFunctionCall(fn.name, params, message, env);
      }

      if (message.type === "tool-calls") {
        const toolCalls = message.toolCallList || message.toolCalls || [];
        const results = [];
        for (const tc of toolCalls) {
          const toolCallId = tc.id || tc.toolCallId || "";
          try {
            const fn = tc.function || tc;
            const name = fn.name || "";
            const rawArgs = fn.arguments ?? fn.parameters ?? {};
            const params = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
            const res = await routeFunctionCall(name, params, message, env);
            const resBody = await res.clone().json();
            const result = resBody.results?.[0]?.result ?? FALLBACK_RESULT;
            results.push({ toolCallId, result });
          } catch (err) {
            console.error("tool-call failed:", toolCallId, err.message);
            results.push({ toolCallId, result: FALLBACK_RESULT });
          }
        }
        return Response.json({ results });
      }

      if (message.type === "end-of-call-report") {
        return await handleEndOfCall(message, env);
      }

      return Response.json({ ok: true });
    } catch (err) {
      console.error("Worker error:", message.type, err.message, err.stack);
      // For tool/function paths, return a graceful fallback. For other types, ok:true
      // so we don't poison Vapi's expected shape for status updates etc.
      if (message.type === "function-call" || message.type === "tool-calls") {
        return Response.json({ results: [{ result: FALLBACK_RESULT }] });
      }
      return Response.json({ ok: true });
    }
  },
};

// --- Fetch helper with timeout ---

async function timedFetch(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- Route function calls ---

async function routeFunctionCall(name, params, message, env) {
  switch (name) {
    case "check_inventory":
      return await handleCheckInventory(params, env);
    case "log_caller":
      return await handleLogCaller(params, message.call || {}, env);
    case "add_to_waitlist":
      return await handleAddToWaitlist(params, message.call || {}, env);
    default:
      return Response.json({
        results: [{ result: "I don't have that function available. Let me connect you with our team." }],
      });
  }
}

// --- check_inventory (Supabase — fast, 16,797 items) ---

async function handleCheckInventory(params, env) {
  const product = params.product_name || params.product || "";
  if (!product) {
    return Response.json({
      results: [{ result: "What product are you looking for? I can check our inventory." }],
    });
  }

  const searchTerm = product.replace(/[^a-zA-Z0-9\s]/g, "").trim();
  const keywords = searchTerm.split(/\s+/).filter((w) => w.length > 1);
  const searchQuery = keywords.join(" ");

  // Primary: Supabase RPC search_inventory() — punctuation-stripped ILIKE in SQL.
  let items;
  const rpcRes = await timedFetch(`${env.SUPABASE_URL}/rest/v1/rpc/search_inventory`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ search_query: searchQuery }),
  });
  if (rpcRes.ok) {
    items = await rpcRes.json();
  }

  if (!items || items.length === 0) {
    // Fallback: ILIKE with price filter, strip trailing 's' so "Titos" matches "TITO'S".
    let fallbackUrl = `${env.SUPABASE_URL}/rest/v1/inventory?select=description,price,qoh,in_stock,category&price=gt.0&order=in_stock.desc,qoh.desc.nullslast&limit=5`;
    for (const kw of keywords) {
      const root = kw.replace(/s$/i, "");
      fallbackUrl += `&description=ilike.*${encodeURIComponent(root)}*`;
    }

    const fallbackRes = await timedFetch(fallbackUrl, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
    });
    if (fallbackRes.ok) {
      items = await fallbackRes.json();
    }
  }

  if (!items || items.length === 0) {
    return Response.json({
      results: [{
        result: `I don't see ${product} in our current inventory. I can add you to our notification list so you're the first to know when it comes in. Can I get your name and number?`,
      }],
    });
  }

  const lines = [];
  for (const item of items.slice(0, 3)) {
    const name = item.description || "Unknown";
    const price = item.price && parseFloat(item.price) > 0
      ? `$${parseFloat(item.price).toFixed(2)}`
      : "price not listed";
    const qoh = item.qoh || 0;
    lines.push(qoh > 0
      ? `${name} — ${price}, ${qoh} in stock`
      : `${name} — ${price}, currently out of stock`);
  }

  let response;
  if (lines.length === 1) {
    const qoh = items[0].qoh || 0;
    response = qoh > 0
      ? `Yes, we have ${lines[0]}. Want me to set one aside for you?`
      : `We have ${items[0].description} but it's currently out of stock. I can add you to our notification list so you're the first to know when it comes in. Can I get your name and number?`;
  } else {
    response = `Here's what I found: ${lines.join(". ")}. Any of those sound right?`;
  }

  return Response.json({ results: [{ result: response }] });
}

// --- log_caller ---

async function handleLogCaller(params, callInfo, env) {
  const payload = {
    caller_phone: params.phone_number || callInfo?.customer?.number || null,
    caller_name: params.caller_name || null,
    summary: params.reason || null,
    outcome: params.callback_requested ? "callback_requested" : "info_provided",
    wants_notification: false,
    transferred: false,
    created_at: new Date().toISOString(),
  };

  await insertCallLog(payload, env);

  return Response.json({
    results: [{ result: "Got it, I've noted that down." }],
  });
}

// --- add_to_waitlist ---

async function handleAddToWaitlist(params, callInfo, env) {
  const phone = params.phone_number || params.phone || callInfo?.customer?.number || null;
  const product = params.product || params.product_name || null;

  if (!phone) {
    return Response.json({
      results: [{ result: "I just need a phone number to add you to the notification list. What's the best number to reach you?" }],
    });
  }
  if (!product) {
    return Response.json({
      results: [{ result: "Which product would you like to be notified about?" }],
    });
  }

  const res = await timedFetch(`${env.SUPABASE_URL}/rest/v1/restock_interest`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      customer_phone: phone,
      customer_name: params.caller_name || params.name || null,
      product_requested: product,
    }),
  });

  if (!res.ok) {
    console.error("Supabase restock insert failed:", res.status);
  }

  return Response.json({
    results: [{ result: `Done — I've added you to the notification list for ${product}. You'll be the first to know when it comes in.` }],
  });
}

// --- End of Call Report ---

async function handleEndOfCall(message, env) {
  const call = message.call || {};
  const customer = call.customer || {};

  const startedAt = call.startedAt ? new Date(call.startedAt) : null;
  const endedAt = call.endedAt ? new Date(call.endedAt) : null;
  const duration = message.durationSeconds
    ?? (startedAt && endedAt ? Math.round((endedAt - startedAt) / 1000) : null);

  const payload = {
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

  await insertCallLog(payload, env);

  if (customer.number) {
    await upsertCustomer(customer.number, env);
  }

  if (env.N8N_WEBHOOK_URL) {
    try {
      await timedFetch(env.N8N_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
    } catch (e) {
      console.error("n8n webhook forward failed:", e.message);
    }
  }

  return Response.json({ ok: true });
}

// --- Supabase Helpers ---

async function insertCallLog(payload, env) {
  const res = await timedFetch(`${env.SUPABASE_URL}/rest/v1/call_logs`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("Supabase call_logs insert failed:", res.status);
  }
}

// Single-statement upsert keyed on phone — avoids the check-then-insert race.
// Requires a UNIQUE constraint on customers.phone.
async function upsertCustomer(phone, env) {
  const res = await timedFetch(
    `${env.SUPABASE_URL}/rest/v1/customers?on_conflict=phone`,
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        phone,
        source: "phone_call",
        updated_at: new Date().toISOString(),
      }),
    }
  );
  if (!res.ok) {
    console.error("Supabase customers upsert failed:", res.status);
  }
}
