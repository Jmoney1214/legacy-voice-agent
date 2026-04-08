// Vapi Voice Agent Backend — Legacy Wine & Liquor
// Modular architecture with auth, structured logging, and retry logic

import { createLogger } from "./lib/logger.js";
import { createSupabaseClient } from "./lib/supabase.js";
import { verifyVapiAuth } from "./middleware/auth.js";
import { handleCheckInventory, handleSuggestAlternatives } from "./handlers/inventory.js";
import { handleLogCaller, handleLookupCustomer } from "./handlers/customer.js";
import { handleAddToWaitlist } from "./handlers/waitlist.js";
import { handleNotifyManager } from "./handlers/notify.js";
import { handleEndOfCall } from "./handlers/call.js";

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, x-vapi-secret",
        },
      });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "POST only" }, { status: 405 });
    }

    const requestId = crypto.randomUUID();
    const log = createLogger(requestId);

    // Authenticate request
    const auth = verifyVapiAuth(request, env);
    if (!auth.ok) {
      log.warn("Unauthorized request rejected");
      return auth.response;
    }

    try {
      const body = await request.json();
      const message = body.message;

      if (!message) {
        return Response.json({ error: "No message" }, { status: 400 });
      }

      const db = createSupabaseClient(env, log);

      // Handle function calls (legacy format)
      if (message.type === "function-call") {
        const fn = message.functionCall;
        const params = fn.parameters || {};
        log.info("Function call", { name: fn.name });
        return await routeFunctionCall(fn.name, params, message, db, env, log);
      }

      // Handle tool calls (current format)
      if (message.type === "tool-calls") {
        const toolCalls = message.toolCallList || message.toolCalls || [];
        const results = [];

        for (const tc of toolCalls) {
          const fn = tc.function || tc;
          const name = fn.name || "";
          const params =
            typeof fn.arguments === "string"
              ? JSON.parse(fn.arguments)
              : fn.arguments || fn.parameters || {};

          log.info("Tool call", { name, toolCallId: tc.id });
          const res = await routeFunctionCall(name, params, message, db, env, log);
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
        log.info("End of call report received");
        return await handleEndOfCall(message, db, env, log);
      }

      // Other Vapi message types (status-update, etc.)
      return Response.json({ ok: true });
    } catch (err) {
      log.error("Worker error", { error: err.message, stack: err.stack });
      return Response.json({
        results: [
          { result: "I'm having trouble looking that up right now. Can I have someone call you back?" },
        ],
      });
    }
  },
};

// Route function calls to the appropriate handler
async function routeFunctionCall(name, params, message, db, env, log) {
  switch (name) {
    case "check_inventory":
      return await handleCheckInventory(params, db, log);
    case "suggest_alternatives":
      return await handleSuggestAlternatives(params, db, log);
    case "log_caller":
      return await handleLogCaller(params, message.call || {}, db, log);
    case "lookup_customer":
      return await handleLookupCustomer(params, db, log);
    case "add_to_waitlist":
      return await handleAddToWaitlist(params, db, log);
    case "notify_manager":
      return await handleNotifyManager(params, env, log);
    default:
      log.warn("Unknown function call", { name });
      return Response.json({
        results: [{ result: "I don't have that function available. Let me connect you with our team." }],
      });
  }
}
