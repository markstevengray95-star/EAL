import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function getUser(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing auth token");
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid user");
  return data.user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const user = await getUser(req);
    const body = await req.json();
    const adapterUrl = Deno.env.get("MIS_SYNC_URL");
    const apiToken = Deno.env.get("MIS_API_TOKEN");
    if (!adapterUrl || !apiToken) {
      return json({ error: "MIS server adapter is not configured." }, 501);
    }
    const upstream = await fetch(adapterUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiToken },
      body: JSON.stringify({ provider: body.provider, action: body.action || "sync", requestedBy: user.id }),
    });
    if (!upstream.ok) return json({ error: "MIS adapter returned " + upstream.status }, 502);
    const data = await upstream.json();
    return json({ students: Array.isArray(data.students) ? data.students : [] });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 401);
  }
});
