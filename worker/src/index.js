// Vapi Voice Agent Backend — Legacy Wine & Liquor
//
// Handles every server-side webhook from Vapi:
//   - assistant-request   personalize per caller (returning customer greeting)
//   - tool-calls          check_inventory / log_caller / add_to_waitlist
//   - function-call       legacy single-tool format (kept for compat)
//   - end-of-call-report  call_logs upsert, customer upsert, SMS follow-up,
//                         n8n forward driven by Vapi structuredData
//
// Single data layer: Supabase. Inventory matching is pure Postgres
// (pg_trgm + tsvector via the search_inventory RPC); no KV cache, no
// external embedding service.

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
      switch (message.type) {
        case "assistant-request":
          return await handleAssistantRequest(message, env);
        case "function-call": {
          const fn = message.functionCall || {};
          return await routeFunctionCall(fn.name, fn.parameters || {}, message, env);
        }
        case "tool-calls":
          return await handleToolCalls(message, env);
        case "end-of-call-report":
          return await handleEndOfCall(message, env);
        default:
          return Response.json({ ok: true });
      }
    } catch (err) {
      console.error("Worker error:", message.type, err.message, err.stack);
      if (message.type === "function-call" || message.type === "tool-calls") {
        return Response.json({ results: [{ result: FALLBACK_RESULT }] });
      }
      return Response.json({ ok: true });
    }
  },
};

// ===========================================================================
// assistant-request: personalize per caller
// ===========================================================================

async function handleAssistantRequest(message, env) {
  const phone = message.call?.customer?.number || null;
  const baseAssistantId = env.VAPI_ASSISTANT_ID;

  if (!phone || !baseAssistantId) {
    return Response.json(baseAssistantId ? { assistantId: baseAssistantId } : { ok: true });
  }

  const customer = await lookupCustomer(phone, env);
  const firstName = pickFirstName(customer?.name);
  const isReturning = !!customer && (customer.call_count ?? 0) > 0;

  const firstMessage = isReturning && firstName
    ? `Hey ${firstName}, welcome back to Legacy. What can I help you find today?`
    : isReturning
      ? "Welcome back to Legacy Wine and Liquor. What can I help you find today?"
      : "Thanks for calling Legacy Wine and Liquor. How can I help you today?";

  return Response.json({
    assistantId: baseAssistantId,
    assistantOverrides: {
      firstMessage,
      variableValues: {
        caller_name: firstName || "",
        is_returning: isReturning ? "yes" : "no",
        last_products: (customer?.last_products_discussed || []).join(", "),
      },
    },
  });
}

async function lookupCustomer(phone, env) {
  try {
    const url = `${env.SUPABASE_URL}/rest/v1/customers?phone=eq.${encodeURIComponent(phone)}&select=name,call_count,last_products_discussed&limit=1`;
    const res = await timedFetch(url, { headers: supabaseHeaders(env) });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch (err) {
    console.error("customer lookup failed:", err.message);
    return null;
  }
}

function pickFirstName(name) {
  if (!name) return null;
  const first = String(name).trim().split(/\s+/)[0];
  return first && first.length > 1 ? first : null;
}

// ===========================================================================
// tool-calls: per-call try/catch so one bad arguments JSON doesn't drop batch
// ===========================================================================

async function handleToolCalls(message, env) {
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

// ===========================================================================
// check_inventory: search_inventory RPC (pg_trgm + tsvector)
//                  -> embed-query Edge Function (concept search)
//                  -> ILIKE fallback
// ===========================================================================

async function handleCheckInventory(params, env) {
  const product = (params.product_name || params.product || "").trim();
  if (!product) {
    return Response.json({
      results: [{ result: "What product are you looking for? I can check our inventory." }],
    });
  }

  // 1. Lexical: pg_trgm + tsvector. Fast, free, handles SKU/typo queries.
  let items = await rpcSearch(product, env);

  // 2. Concept-level fallback when lexical produces nothing — e.g.
  //    "something smooth and sweet" -> cream liqueurs.
  if (!items?.length) {
    items = await semanticSearch(product, env);
  }

  // 3. Last-ditch ILIKE so we don't go silent if both RPCs are missing.
  if (!items?.length) {
    const keywords = product.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/).filter((w) => w.length > 1);
    items = await ilikeSearch(keywords, env);
  }

  if (!items?.length) {
    const response = `I don't see ${product} in our current inventory. I can add you to our notification list so you're the first to know when it comes in. Can I get your name and number?`;
    return Response.json({ results: [{ result: response }] });
  }

  return Response.json({ results: [{ result: formatInventoryResponse(items) }] });
}

async function semanticSearch(query, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  try {
    const res = await timedFetch(`${env.SUPABASE_URL}/functions/v1/embed-query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        apikey: env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, match_count: 5, min_similarity: 0.4 }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json?.matches) ? json.matches : null;
  } catch (err) {
    console.error("semanticSearch failed:", err.message);
    return null;
  }
}

async function rpcSearch(searchQuery, env) {
  try {
    const res = await timedFetch(`${env.SUPABASE_URL}/rest/v1/rpc/search_inventory`, {
      method: "POST",
      headers: { ...supabaseHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({ search_query: searchQuery }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("rpcSearch failed:", err.message);
    return null;
  }
}

async function ilikeSearch(keywords, env) {
  if (!keywords?.length) return null;
  let url = `${env.SUPABASE_URL}/rest/v1/inventory?select=description,price,qoh,in_stock,category&price=gt.0&order=in_stock.desc,qoh.desc.nullslast&limit=5`;
  for (const kw of keywords) {
    const root = kw.replace(/s$/i, "");
    url += `&description=ilike.*${encodeURIComponent(root)}*`;
  }
  try {
    const res = await timedFetch(url, { headers: supabaseHeaders(env) });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("ilikeSearch failed:", err.message);
    return null;
  }
}

function formatInventoryResponse(items) {
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

  if (lines.length === 1) {
    const qoh = items[0].qoh || 0;
    return qoh > 0
      ? `Yes, we have ${lines[0]}. Want me to set one aside for you?`
      : `We have ${items[0].description} but it's currently out of stock. I can add you to our notification list so you're the first to know when it comes in. Can I get your name and number?`;
  }
  return `Here's what I found: ${lines.join(". ")}. Any of those sound right?`;
}

// ===========================================================================
// log_caller, add_to_waitlist
// ===========================================================================

async function handleLogCaller(params, callInfo, env) {
  const payload = {
    caller_phone: params.phone_number || callInfo?.customer?.number || null,
    caller_name: params.caller_name || null,
    summary: params.reason || null,
    outcome: params.callback_requested ? "callback_requested" : "info_provided",
    wants_notification: false,
    transferred: false,
    vapi_call_id: callInfo?.id || null,
    created_at: new Date().toISOString(),
  };
  await insertCallLog(payload, env);
  return Response.json({ results: [{ result: "Got it, I've noted that down." }] });
}

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
    headers: { ...supabaseHeaders(env), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      customer_phone: phone,
      customer_name: params.caller_name || params.name || null,
      product_requested: product,
    }),
  });
  if (!res.ok) console.error("Supabase restock insert failed:", res.status);

  return Response.json({
    results: [{ result: `Done — I've added you to the notification list for ${product}. You'll be the first to know when it comes in.` }],
  });
}

// ===========================================================================
// end-of-call-report: idempotent log + Vapi structuredData → SMS / customer
// ===========================================================================

async function handleEndOfCall(message, env) {
  const call = message.call || {};
  const customer = call.customer || {};
  const analysis = message.analysis || {};
  const sd = (analysis.structuredData && typeof analysis.structuredData === "object")
    ? analysis.structuredData
    : {};

  const startedAt = call.startedAt ? new Date(call.startedAt) : null;
  const endedAt = call.endedAt ? new Date(call.endedAt) : null;
  const duration = (typeof message.durationSeconds === "number")
    ? message.durationSeconds
    : (startedAt && endedAt ? Math.round((endedAt - startedAt) / 1000) : null);

  await upsertCallLog({
    vapi_call_id: call.id || null,
    caller_phone: customer.number || null,
    caller_name: sd.caller_name || null,
    call_duration: duration,
    summary: analysis.summary || message.summary || null,
    transcript: message.transcript || null,
    recording_url: message.recordingUrl || null,
    cost: call.cost || null,
    ended_reason: message.endedReason || null,
    success_score: typeof analysis.successEvaluation === "string" ? analysis.successEvaluation : null,
    structured_data: sd,
    sentiment: sd.sentiment || null,
    lead_signal: sd.lead_signal || null,
    created_at: new Date().toISOString(),
  }, env);

  if (customer.number) {
    await upsertCustomer(customer.number, sd, env);
  }

  await maybeSendFollowUpSms(customer.number, sd, env);

  if (env.N8N_WEBHOOK_URL) {
    timedFetch(env.N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }).catch((e) => console.error("n8n forward failed:", e.message));
  }

  return Response.json({ ok: true });
}

// ===========================================================================
// Twilio SMS follow-up (driven by Vapi structuredData.next_action)
// ===========================================================================

async function maybeSendFollowUpSms(phone, sd, env) {
  if (!phone) return;
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) return;

  if (await isOptedOut(phone, env)) return;

  const next = sd.next_action || inferNextAction(sd);
  const footer = env.SMS_OPT_OUT_FOOTER || "Reply STOP to opt out.";
  const site = env.SITE_URL || "https://legacywineandliquor.com";

  let body = null;
  if (next === "sms_waitlist_confirm") {
    const product = (sd.products_out_of_stock || [])[0] || (sd.products_discussed || [])[0];
    if (product) {
      body = `Legacy: We'll text you the moment ${product} is back in stock. ${footer}`;
    }
  } else if (next === "sms_link") {
    const products = (sd.products_in_stock || sd.products_discussed || []).slice(0, 2).join(" + ");
    body = products
      ? `Legacy: Thanks for calling. Browse ${products} and order at ${site} — we ship to 47 states. ${footer}`
      : `Legacy: Thanks for calling. Browse and order at ${site} — we ship to 47 states. ${footer}`;
  }

  if (!body) return;
  await sendSms(phone, body, env);
}

function inferNextAction(sd) {
  if (sd.products_out_of_stock?.length && sd.waitlist_added) return "sms_waitlist_confirm";
  if ((sd.products_discussed?.length || 0) > 0) return "sms_link";
  return "no_action";
}

async function isOptedOut(phone, env) {
  try {
    const res = await timedFetch(
      `${env.SUPABASE_URL}/rest/v1/sms_opt_outs?phone=eq.${encodeURIComponent(phone)}&select=phone&limit=1`,
      { headers: supabaseHeaders(env) }
    );
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function sendSms(to, body, env) {
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  try {
    const res = await timedFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: body }),
    });
    if (!res.ok) {
      console.error("Twilio SMS failed:", res.status);
    }
  } catch (err) {
    console.error("Twilio SMS error:", err.message);
  }
}

// ===========================================================================
// Supabase helpers
// ===========================================================================

function supabaseHeaders(env) {
  return {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
  };
}

async function insertCallLog(payload, env) {
  const res = await timedFetch(`${env.SUPABASE_URL}/rest/v1/call_logs`, {
    method: "POST",
    headers: { ...supabaseHeaders(env), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error("call_logs insert failed:", res.status);
}

// Idempotent end-of-call write keyed on vapi_call_id (partial UNIQUE index).
// If vapi_call_id is null we fall back to a plain insert.
async function upsertCallLog(payload, env) {
  if (!payload.vapi_call_id) return insertCallLog(payload, env);
  const url = `${env.SUPABASE_URL}/rest/v1/call_logs?on_conflict=vapi_call_id`;
  const res = await timedFetch(url, {
    method: "POST",
    headers: {
      ...supabaseHeaders(env),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error("call_logs upsert failed:", res.status);
}

// Single-statement upsert keyed on phone — requires UNIQUE (phone) index.
async function upsertCustomer(phone, sd, env) {
  const body = {
    phone,
    source: "phone_call",
    last_call_at: new Date().toISOString(),
    last_products_discussed: Array.isArray(sd.products_discussed) ? sd.products_discussed : null,
    updated_at: new Date().toISOString(),
  };
  if (sd.caller_name) body.name = sd.caller_name;

  const res = await timedFetch(`${env.SUPABASE_URL}/rest/v1/customers?on_conflict=phone`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(env),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error("customers upsert failed:", res.status);
}

// ===========================================================================
// Fetch helper with timeout
// ===========================================================================

async function timedFetch(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
