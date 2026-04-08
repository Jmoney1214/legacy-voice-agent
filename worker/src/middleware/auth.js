// Vapi webhook authentication via shared secret
// Set VAPI_SECRET in Cloudflare Worker secrets and in Vapi's server.secret config

export function verifyVapiAuth(request, env) {
  // Skip auth if no secret configured (backward compatible)
  if (!env.VAPI_SECRET) {
    return { ok: true };
  }

  const secret = request.headers.get("x-vapi-secret");
  if (secret === env.VAPI_SECRET) {
    return { ok: true };
  }

  return {
    ok: false,
    response: Response.json({ error: "Unauthorized" }, { status: 401 }),
  };
}
