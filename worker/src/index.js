// Vapi Voice Agent Backend — Legacy Wine & Liquor
// Handles function calls from Vapi: check_inventory, log_caller, add_to_waitlist

let cachedToken = null;
let tokenExpiry = 0;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "POST only" }, { status: 405 });
    }

    try {
      const body = await request.json();
      const message = body.message;

      if (!message) {
        return Response.json({ error: "No message" }, { status: 400 });
      }

      // Handle function calls from Vapi (both old "function-call" and new "tool-calls" format)
      if (message.type === "function-call") {
        const fn = message.functionCall;
        const params = fn.parameters || {};
        return await routeFunctionCall(fn.name, params, message, env);
      }

      if (message.type === "tool-calls") {
        const toolCalls = message.toolCallList || message.toolCalls || [];
        const results = [];
        for (const tc of toolCalls) {
          const fn = tc.function || tc;
          const name = fn.name || "";
          const params = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : (fn.arguments || fn.parameters || {});
          const res = await routeFunctionCall(name, params, message, env);
          const resBody = await res.clone().json();
          results.push({
            toolCallId: tc.id || tc.toolCallId || "",
            result: resBody.results ? resBody.results[0].result : JSON.stringify(resBody),
          });
        }
        return Response.json({ results });
      }

      // Handle end-of-call report
      if (message.type === "end-of-call-report") {
        return await handleEndOfCall(message, env);
      }

      // Handle other Vapi message types (status-update, etc.)
      return Response.json({ ok: true });
    } catch (err) {
      console.error("Worker error:", err.message, err.stack);
      return Response.json({
        results: [{ result: "I'm having trouble looking that up right now. Can I have someone call you back?" }],
      });
    }
  },
};

// --- Lightspeed OAuth Token ---

async function getAccessToken(env) {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  const res = await fetch("https://cloud.merchantos.com/oauth/access_token.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.LIGHTSPEED_CLIENT_ID,
      client_secret: env.LIGHTSPEED_CLIENT_SECRET,
      refresh_token: env.LIGHTSPEED_REFRESH_TOKEN,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // Cache for 50 minutes (tokens last 1 hour)
  tokenExpiry = now + 50 * 60 * 1000;

  // If we got a new refresh token, log it (Lightspeed rotates them)
  if (data.refresh_token && data.refresh_token !== env.LIGHTSPEED_REFRESH_TOKEN) {
    console.log("NEW REFRESH TOKEN:", data.refresh_token);
  }

  return cachedToken;
}

// --- Route function calls ---

async function routeFunctionCall(name, params, message, env) {
  switch (name) {
    case "check_inventory":
      return await handleCheckInventory(params, env);
    case "log_caller":
      return await handleLogCaller(params, message.call || {}, env);
    case "add_to_waitlist":
      return await handleAddToWaitlist(params, env);
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

  // Build search — prioritize in-stock items with price, filter junk
  const searchTerm = product.replace(/[^a-zA-Z0-9\s]/g, "").trim();
  const keywords = searchTerm.split(/\s+/).filter((w) => w.length > 1);

  // PostgREST doesn't support fuzzy/apostrophe-aware search via ILIKE.
  // Use Supabase RPC to call a postgres function for better matching.
  // For now, use multiple ILIKE patterns — try with and without common endings (s, 's)
  // and use price > 0 to filter junk items.
  let url = `${env.SUPABASE_URL}/rest/v1/rpc/search_inventory`;
  const searchQuery = keywords.join(" ");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ search_query: searchQuery }),
  });

  // If RPC doesn't exist, fall back to ILIKE
  let items;
  if (res.ok) {
    items = await res.json();
  }

  if (!items || items.length === 0) {
    // Fallback: ILIKE with price filter, try each keyword separately
    let fallbackUrl = `${env.SUPABASE_URL}/rest/v1/inventory?select=description,price,qoh,in_stock,category&price=gt.0&order=in_stock.desc,qoh.desc.nullslast&limit=5`;
    for (const kw of keywords) {
      // Strip trailing 's' to handle "Titos" matching "TITO'S"
      const root = kw.replace(/s$/i, "");
      fallbackUrl += `&description=ilike.*${encodeURIComponent(root)}*`;
    }

    const fallbackRes = await fetch(fallbackUrl, {
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

  const results = [];
  for (const item of items.slice(0, 3)) {
    const name = item.description || "Unknown";
    const price = item.price && parseFloat(item.price) > 0
      ? `$${parseFloat(item.price).toFixed(2)}`
      : "price not listed";
    const qoh = item.qoh || 0;

    if (qoh > 0) {
      results.push(`${name} — ${price}, ${qoh} in stock`);
    } else {
      results.push(`${name} — ${price}, currently out of stock`);
    }
  }

  let response;
  if (results.length === 1) {
    const qoh = items[0].qoh || 0;
    if (qoh > 0) {
      response = `Yes, we have ${results[0]}. Want me to set one aside for you?`;
    } else {
      response = `We have ${items[0].description} but it's currently out of stock. I can add you to our notification list so you're the first to know when it comes in. Can I get your name and number?`;
    }
  } else {
    response = `Here's what I found: ${results.join(". ")}. Any of those sound right?`;
  }

  return Response.json({ results: [{ result: response }] });
}

function getQoh(item) {
  let qoh = 0;
  if (item.ItemShops && item.ItemShops.ItemShop) {
    const shops = Array.isArray(item.ItemShops.ItemShop)
      ? item.ItemShops.ItemShop
      : [item.ItemShops.ItemShop];
    for (const shop of shops) {
      qoh += parseInt(shop.qoh || 0, 10);
    }
  }
  return qoh;
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

async function handleAddToWaitlist(params, env) {
  const payload = {
    customer_phone: params.phone_number || params.phone || null,
    customer_name: params.caller_name || params.name || null,
    product_requested: params.product || params.product_name || null,
  };

  // Insert into restock_interest
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/restock_interest`, {
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
    console.error("Supabase restock insert failed:", await res.text());
  }

  return Response.json({
    results: [{ result: `Done — I've added you to the notification list for ${payload.product_requested || "that product"}. You'll be the first to know when it comes in.` }],
  });
}

// --- End of Call Report ---

async function handleEndOfCall(message, env) {
  const call = message.call || {};
  const customer = call.customer || {};

  const startedAt = call.startedAt ? new Date(call.startedAt) : null;
  const endedAt = call.endedAt ? new Date(call.endedAt) : null;
  const duration = startedAt && endedAt
    ? Math.round((endedAt - startedAt) / 1000)
    : null;

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

  // Also upsert into customers table if we have a phone number
  if (customer.number) {
    await upsertCustomer(customer.number, message.summary, env);
  }

  // Forward to n8n webhook for Slack notifications + additional processing
  try {
    await fetch("https://legacywineandliquor.app.n8n.cloud/webhook/vapi-call-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch (e) {
    console.error("n8n webhook forward failed:", e.message);
  }

  return Response.json({ ok: true });
}

// --- Supabase Helpers ---

async function insertCallLog(payload, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/call_logs`, {
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
    console.error("Supabase call_logs insert failed:", await res.text());
  }
}

async function upsertCustomer(phone, summary, env) {
  // Check if customer exists by phone
  const checkRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/customers?phone=eq.${encodeURIComponent(phone)}&limit=1`,
    {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
    }
  );

  if (checkRes.ok) {
    const existing = await checkRes.json();
    if (existing.length > 0) {
      // Update existing customer
      await fetch(
        `${env.SUPABASE_URL}/rest/v1/customers?phone=eq.${encodeURIComponent(phone)}`,
        {
          method: "PATCH",
          headers: {
            apikey: env.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            source: "phone_call",
            product_interests: summary,
            updated_at: new Date().toISOString(),
          }),
        }
      );
    } else {
      // Insert new customer
      await fetch(`${env.SUPABASE_URL}/rest/v1/customers`, {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          phone,
          source: "phone_call",
          product_interests: summary,
          email: `phone_${phone.replace(/\+/g, "")}@placeholder.local`,
        }),
      });
    }
  }
}
