const siteOrigin = "https://hwangbl.github.io";
const bodyLimit = 8_192;
const pageSize = 20;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readSubmission(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let json = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > bodyLimit) {
        await reader.cancel();
        return null;
      }
      json += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(json + decoder.decode());
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

Deno.serve(async (req) => {
  const headers = {
    "Access-Control-Allow-Origin": siteOrigin,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { headers, status });

  if (req.method === "OPTIONS") return new Response(null, { headers, status: 204 });
  if (req.method !== "GET" && req.method !== "POST") return reply({ error: "method" }, 405);
  if (req.method === "POST" && req.headers.get("Origin") !== siteOrigin) {
    return reply({ error: "origin" }, 403);
  }

  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const project = Deno.env.get("SUPABASE_URL");
  if (!key || !project) return reply({ error: "unavailable" }, 503);
  const dbHeaders = { apikey: key, Authorization: "Bearer " + key };
  try {
    if (req.method === "GET") {
      const before = new URL(req.url).searchParams.get("before");
      if (before !== null && (!/^\d{1,15}$/.test(before) || Number(before) < 1)) {
        return reply({ error: "invalid" }, 400);
      }
      const url = new URL(project + "/rest/v1/cupet_comments");
      url.searchParams.set("select", "id,nickname,message,created_at");
      url.searchParams.set("status", "eq.approved");
      url.searchParams.set("order", "id.desc");
      url.searchParams.set("limit", String(pageSize + 1));
      if (before !== null) url.searchParams.set("id", "lt." + before);
      const response = await fetch(url, { headers: dbHeaders });
      if (!response.ok) return reply({ error: "unavailable" }, 503);
      const rows = await response.json();
      const comments = rows.slice(0, pageSize);
      return reply({ comments, nextBefore: rows.length > pageSize ? comments.at(-1).id : null });
    }

    if (req.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
      return reply({ error: "invalid" }, 415);
    }
    const data = await readSubmission(req);
    const message = typeof data?.message === "string" ? data.message.trim() : "";
    const nickname = typeof data?.nickname === "string" ? data.nickname.trim() : "";
    if (!message || message.length > 1000 || nickname.length > 30 ||
        /[\u0000\uD800-\uDFFF]/u.test(message + nickname) ||
        typeof data?.requestId !== "string" || !uuidPattern.test(data.requestId)) {
      return reply({ error: "invalid" }, 400);
    }
    const response = await fetch(project + "/rest/v1/rpc/submit_cupet_comment", {
      method: "POST",
      headers: { ...dbHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_request_id: data.requestId,
        p_nickname: nickname || "匿名访客",
        p_message: message,
      }),
    });
    if (!response.ok) return reply({ error: "unavailable" }, 503);
    const result = await response.json();
    if (result === "busy") return reply({ error: "busy" }, 429);
    if (result !== "accepted") return reply({ error: "unavailable" }, 503);
    return reply({ status: "pending" }, 202);
  } catch {
    return reply({ error: "unavailable" }, 503);
  }
});
