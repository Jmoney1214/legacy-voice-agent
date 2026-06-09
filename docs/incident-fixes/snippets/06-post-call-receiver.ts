// Hono route handler for ElevenLabs post-call webhooks.
//
// Drop into legacy-elevenlabs-agent under src/routes/post-call.ts (or wherever
// you mount routes) and register: app.post("/post-call", postCallHandler).
//
// Key behaviors that prevent ElevenLabs from auto-disabling the webhook after
// 10 consecutive failures:
//   1. Always return 200 unless the HMAC signature is genuinely invalid AND we
//      have a configured secret (return 401 only then). Unknown event types
//      are 200 with body {ok:true,ignored:true} so they don't tax the budget.
//   2. Body is parsed defensively — ElevenLabs has shipped >1 payload shape.
//   3. Slack post + DB write run in ctx.waitUntil(...) so the 200 response is
//      not blocked on either side effect; the connection closes fast.

import type { Context } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";

interface Env {
  ELEVENLABS_WEBHOOK_SECRET?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SLACK_WEBHOOK_URL?: string;
}

type EventType =
  | "post_call_transcription"
  | "post_call_audio"
  | "call_initiation_failure";

interface PostCallEvent {
  type: EventType;
  event_timestamp: number;
  data: Record<string, any>;
}

export async function postCallHandler(c: Context<{ Bindings: Env }>) {
  const raw = await c.req.text();
  const sig = c.req.header("elevenlabs-signature") ?? "";

  if (c.env.ELEVENLABS_WEBHOOK_SECRET) {
    if (!verifySignature(raw, sig, c.env.ELEVENLABS_WEBHOOK_SECRET)) {
      return c.json({ ok: false, error: "bad signature" }, 401);
    }
  }

  let event: PostCallEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    // Acknowledge so ElevenLabs doesn't retry → auto-disable us.
    return c.json({ ok: true, ignored: "non-json" });
  }

  // Fan-out side effects in waitUntil so the 200 ack is fast.
  c.executionCtx.waitUntil(handleEvent(event, c.env));

  return c.json({ ok: true });
}

async function handleEvent(event: PostCallEvent, env: Env): Promise<void> {
  try {
    switch (event.type) {
      case "post_call_transcription":
        await persistTranscription(event, env);
        await notifySlack(event, env);
        break;
      case "call_initiation_failure":
        await notifySlackFailure(event, env);
        break;
      case "post_call_audio":
        // We don't currently store audio. No-op.
        break;
      default:
        console.warn("unknown post-call event type:", (event as any).type);
    }
  } catch (err) {
    console.error("post-call handler error:", (err as Error).message);
  }
}

// ---- Slack ----
async function notifySlack(event: PostCallEvent, env: Env): Promise<void> {
  if (!env.SLACK_WEBHOOK_URL) return;
  const d = event.data ?? {};
  const meta = d.metadata ?? {};
  const analysis = d.analysis ?? {};
  const caller = meta.caller_phone || meta.phone_number || "(unknown)";
  const summary = analysis.transcript_summary || d.summary || "(no summary)";
  const sentiment = analysis.evaluation_criteria_results?.sentiment ?? "—";
  const products = analysis.data_collection_results?.products_discussed ?? [];
  const text =
    `*New call summary*  •  ${caller}  •  ${meta.call_duration_secs ?? "?"}s\n` +
    `*Sentiment:* ${sentiment}  *Products:* ${Array.isArray(products) ? products.join(", ") || "—" : "—"}\n` +
    `> ${String(summary).slice(0, 700)}`;
  await fetch(env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

async function notifySlackFailure(event: PostCallEvent, env: Env): Promise<void> {
  if (!env.SLACK_WEBHOOK_URL) return;
  await fetch(env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `:warning: Call initiation failure — ${JSON.stringify(event.data).slice(0, 700)}`,
    }),
  });
}

// ---- Supabase persist ----
async function persistTranscription(event: PostCallEvent, env: Env): Promise<void> {
  const d = event.data ?? {};
  const meta = d.metadata ?? {};
  const body = {
    conversation_id: d.conversation_id,
    agent_id: d.agent_id,
    caller_phone: meta.caller_phone || meta.phone_number || null,
    duration_secs: meta.call_duration_secs ?? null,
    status: d.status ?? null,
    transcript: d.transcript ?? null,
    analysis: d.analysis ?? null,
    received_at: new Date().toISOString(),
  };
  await fetch(`${env.SUPABASE_URL}/rest/v1/call_logs?on_conflict=conversation_id`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(body),
  });
}

// ---- HMAC ----
function verifySignature(payload: string, header: string, secret: string): boolean {
  // ElevenLabs ships header like:  t=1234567890,v0=hexdigest
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k?.trim() ?? "", v?.trim() ?? ""];
    }),
  );
  const ts = parts.t;
  const got = parts.v0;
  if (!ts || !got) return false;
  // Replay guard — 5-minute window.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const mac = createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(mac, "hex"));
  } catch {
    return false;
  }
}
