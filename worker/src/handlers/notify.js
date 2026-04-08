// Notify handler: notify_manager → Slack webhook

export async function handleNotifyManager(params, env, log) {
  const reason = params.reason || "No reason provided";
  const phone = params.caller_phone || "Unknown";
  const name = params.caller_name || "Unknown";
  const urgency = params.urgency || "medium";

  const urgencyEmoji = { low: "\u2139\ufe0f", medium: "\u26a0\ufe0f", high: "\ud83d\udea8" }[urgency] || "\u26a0\ufe0f";

  log.info("Notifying manager", { reason, phone, urgency });

  if (!env.SLACK_WEBHOOK_URL) {
    log.warn("SLACK_WEBHOOK_URL not configured, skipping notification");
    return Response.json({ results: [{ result: "I've noted that for Jay. He'll follow up with you." }] });
  }

  const slackMessage = {
    text: `${urgencyEmoji} *Manager Alert* — Legacy Voice Agent\n>*Reason:* ${reason}\n>*Caller:* ${name} (${phone})\n>*Urgency:* ${urgency}`,
  };

  try {
    await fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackMessage),
    });
  } catch (err) {
    log.error("Slack notification failed", { error: err.message });
  }

  return Response.json({ results: [{ result: "I've flagged that for Jay. He'll follow up with you shortly." }] });
}
