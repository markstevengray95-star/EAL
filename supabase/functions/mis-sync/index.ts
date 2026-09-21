import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function authContext(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing auth token");
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authClient = createClient(url, anon, { global: { headers: { Authorization: "Bearer " + token } } });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid user");
  return { user: data.user, admin: createClient(url, service) };
}

async function assertSyncRole(admin: any, userId: string, schoolId: string) {
  const { data, error } = await admin.from("school_memberships").select("role").eq("school_id", schoolId).eq("user_id", userId).maybeSingle();
  if (error || !data) throw new Error("No school membership");
  if (!["administrator","eal_coordinator"].includes(data.role)) throw new Error("MIS sync requires administrator or EAL coordinator access");
  return data.role;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const { user, admin } = await authContext(req);
    const body = await req.json();
    const schoolId = String(body.schoolId || "");
    if (!schoolId) throw new Error("schoolId required");
    await assertSyncRole(admin, user.id, schoolId);

    const adapterUrl = Deno.env.get("MIS_SYNC_URL");
    const apiToken = Deno.env.get("MIS_API_TOKEN");
    if (!adapterUrl || !apiToken) return json({ error: "MIS server adapter is not configured." }, 501);

    const upstream = await fetch(adapterUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiToken },
      body: JSON.stringify({ provider: body.provider, action: body.action || "sync", schoolId, requestedBy: user.id }),
    });
    if (!upstream.ok) return json({ error: "MIS adapter returned " + upstream.status }, 502);
    const data = await upstream.json();
    const students = Array.isArray(data.students) ? data.students : [];

    await admin.from("integration_sync_log").insert({
      school_id: schoolId,
      integration: "MIS:" + String(body.provider || "Unknown"),
      status: "success",
      summary: { count: students.length },
      run_by: user.id,
    });

    return json({ students });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
