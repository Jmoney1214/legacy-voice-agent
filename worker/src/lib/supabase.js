// Supabase REST client with retry logic for Cloudflare Workers

const RETRY_DELAY_MS = 500;
const MAX_RETRIES = 1;

export function createSupabaseClient(env, log) {
  const baseUrl = env.SUPABASE_URL;
  const headers = {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };

  async function request(url, options, retries = MAX_RETRIES) {
    try {
      const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });

      if (!res.ok && res.status >= 500 && retries > 0) {
        log.warn("Supabase 5xx, retrying", { status: res.status, url, retriesLeft: retries });
        await sleep(RETRY_DELAY_MS);
        return request(url, options, retries - 1);
      }

      return res;
    } catch (err) {
      if (retries > 0) {
        log.warn("Supabase network error, retrying", { error: err.message, retriesLeft: retries });
        await sleep(RETRY_DELAY_MS);
        return request(url, options, retries - 1);
      }
      throw err;
    }
  }

  return {
    // GET with query string (e.g. /rest/v1/inventory?select=...&description=ilike.*)
    async query(path) {
      return request(`${baseUrl}/rest/v1/${path}`, { method: "GET" });
    },

    // POST to RPC function
    async rpc(fnName, params) {
      return request(`${baseUrl}/rest/v1/rpc/${fnName}`, {
        method: "POST",
        body: JSON.stringify(params),
      });
    },

    // INSERT into table
    async insert(table, data) {
      return request(`${baseUrl}/rest/v1/${table}`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(data),
      });
    },

    // PATCH (update) with filter
    async update(table, filter, data) {
      return request(`${baseUrl}/rest/v1/${table}?${filter}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(data),
      });
    },

    // Upsert with conflict resolution
    async upsert(table, data, onConflict) {
      return request(`${baseUrl}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          Prefer: "return=minimal,resolution=merge-duplicates",
          ...(onConflict ? { "on-conflict": onConflict } : {}),
        },
        body: JSON.stringify(data),
      });
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
