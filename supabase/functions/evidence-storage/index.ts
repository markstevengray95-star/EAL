import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function b64ToBytes(value: string) {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
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

async function assertMembership(admin: any, userId: string, schoolId: string) {
  const { data, error } = await admin.from("school_memberships").select("role").eq("school_id", schoolId).eq("user_id", userId).maybeSingle();
  if (error || !data) throw new Error("No school membership");
  if (!["administrator","eal_coordinator","teacher"].includes(data.role)) throw new Error("Insufficient role");
  return data.role;
}

async function googleAccessToken() {
  const body = new URLSearchParams({
    client_id: Deno.env.get("GOOGLE_CLIENT_ID") || "",
    client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") || "",
    refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN") || "",
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error("Google token refresh failed");
  const data = await r.json();
  if (!data.access_token) throw new Error("Google access token missing");
  return data.access_token as string;
}

async function uploadGoogle(fileName: string, mimeType: string, bytes: Uint8Array, folderId?: string) {
  const access = await googleAccessToken();
  const boundary = "eal_" + crypto.randomUUID().replaceAll("-", "");
  const meta: Record<string, unknown> = { name: fileName };
  const folder = folderId || Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");
  if (folder) meta.parents = [folder];
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = concatBytes([head, bytes, tail]);
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: { Authorization: "Bearer " + access, "Content-Type": "multipart/related; boundary=" + boundary },
    body,
  });
  if (!r.ok) throw new Error("Google Drive upload failed: " + r.status);
  const data = await r.json();
  return { id: data.id as string, name: data.name as string, url: data.webViewLink as string | undefined };
}

async function graphAccessToken() {
  const tenant = Deno.env.get("MS_TENANT_ID") || "";
  const body = new URLSearchParams({
    client_id: Deno.env.get("MS_CLIENT_ID") || "",
    client_secret: Deno.env.get("MS_CLIENT_SECRET") || "",
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) throw new Error("Microsoft token request failed");
  const data = await r.json();
  if (!data.access_token) throw new Error("Microsoft access token missing");
  return data.access_token as string;
}

async function uploadOneDrive(fileName: string, bytes: Uint8Array, basePath?: string) {
  const access = await graphAccessToken();
  const driveId = Deno.env.get("ONEDRIVE_DRIVE_ID") || "";
  if (!driveId) throw new Error("ONEDRIVE_DRIVE_ID is not configured");
  const root = (basePath || Deno.env.get("ONEDRIVE_BASE_PATH") || "EAL").replace(/^\/+|\/+$/g, "");
  const safePath = root.split("/").map(encodeURIComponent).join("/") + "/" + encodeURIComponent(fileName);
  const r = await fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/root:/${safePath}:/content`, {
    method: "PUT", headers: { Authorization: "Bearer " + access, "Content-Type": "application/octet-stream" }, body: bytes,
  });
  if (!r.ok) throw new Error("OneDrive upload failed: " + r.status);
  const data = await r.json();
  return { id: data.id as string, name: data.name as string, url: data.webUrl as string | undefined };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const { user, admin } = await authContext(req);
    const body = await req.json();
    const schoolId = String(body.schoolId || "");
    if (!schoolId) throw new Error("schoolId required");
    await assertMembership(admin, user.id, schoolId);
    const provider = String(body.provider || "");

    if (body.action === "health") {
      const configured = provider === "Google Drive"
        ? Boolean(Deno.env.get("GOOGLE_CLIENT_ID") && Deno.env.get("GOOGLE_CLIENT_SECRET") && Deno.env.get("GOOGLE_REFRESH_TOKEN"))
        : provider === "OneDrive"
          ? Boolean(Deno.env.get("MS_TENANT_ID") && Deno.env.get("MS_CLIENT_ID") && Deno.env.get("MS_CLIENT_SECRET") && Deno.env.get("ONEDRIVE_DRIVE_ID"))
          : false;
      return json({ ok: true, provider, configured });
    }

    if (body.action !== "upload") return json({ error: "Unknown action" }, 400);
    const fileName = String(body.fileName || "");
    const studentId = String(body.studentId || "");
    const mimeType = String(body.mimeType || "application/octet-stream");
    if (!fileName || !studentId || !body.contentBase64) throw new Error("studentId, fileName and contentBase64 are required");
    const bytes = b64ToBytes(String(body.contentBase64));
    const maxBytes = 8 * 1024 * 1024;
    if (bytes.length > maxBytes) return json({ error: "This prototype upload endpoint is limited to 8 MB per file." }, 413);

    let uploaded;
    if (provider === "Google Drive") uploaded = await uploadGoogle(fileName, mimeType, bytes, body.driveFolderId);
    else if (provider === "OneDrive") uploaded = await uploadOneDrive(fileName, bytes, body.oneDrivePath);
    else return json({ error: "Storage provider not configured" }, 400);

    const { data: row, error: dbError } = await admin.from("evidence_files").insert({
      school_id: schoolId,
      student_id: studentId,
      provider,
      provider_file_id: uploaded.id,
      file_name: fileName,
      mime_type: mimeType,
      storage_path: uploaded.url || null,
      uploaded_by: user.id,
    }).select().single();
    if (dbError) throw dbError;
    return json({ ok: true, file: row, providerFile: uploaded });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
