import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function authorisedUser(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing auth token");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const client = createClient(supabaseUrl, anon, { global: { headers: { Authorization: "Bearer " + token } } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid user");
  return { user: data.user, token };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const { user } = await authorisedUser(req);
    const body = await req.json();
    const provider = body.provider || "None";
    if (body.action === "health") {
      return json({
        ok: true,
        provider,
        configured:
          provider === "Google Drive"
            ? Boolean(Deno.env.get("GOOGLE_DRIVE_FOLDER_ID"))
            : provider === "OneDrive"
              ? Boolean(Deno.env.get("ONEDRIVE_DRIVE_ID"))
              : false,
      });
    }
    // File upload is intentionally server-side. Configure your approved provider
    // credentials as Edge Function secrets and implement the provider adapter here.
    // The web app should send: schoolId, studentId, fileName, mimeType, contentBase64.
    return json({
      ok: false,
      error: "Provider upload adapter is not configured for this school yet.",
      provider,
      user: user.id,
    }, 501);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 401);
  }
});
