import { authContext, membership, requireRole } from "../_shared/auth.ts";
import { handleOptions, json } from "../_shared/http.ts";

const editableRoles = ["administrator", "eal_coordinator", "teacher"] as const;
const maxBytes = 8 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "text/plain",
  "text/csv",
]);

function requiredEnv(name: string) {
  const value = Deno.env.get(name) || "";
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function b64ToBytes(value: string) {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 180);
}

async function googleAccessToken() {
  const body = new URLSearchParams({
    client_id: requiredEnv("GOOGLE_CLIENT_ID"),
    client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    refresh_token: requiredEnv("GOOGLE_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Google token refresh failed (${response.status})`);
  const data = await response.json();
  if (!data.access_token) throw new Error("Google access token missing");
  return data.access_token as string;
}

async function googleJson(path: string, init: RequestInit = {}) {
  const token = await googleAccessToken();
  const response = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google Drive request failed (${response.status})`);
  return data;
}

async function googleFolderHealth() {
  const folderId = requiredEnv("GOOGLE_DRIVE_FOLDER_ID");
  const folder = await googleJson(`/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed,webViewLink&supportsAllDrives=true`);
  if (folder.trashed || folder.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("Configured Google Drive destination is not an active folder");
  }
  return folder;
}

async function ensureGoogleFolder(parentId: string, name: string) {
  const escaped = name.replace(/'/g, "\\'");
  const query = `'${parentId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const found = await googleJson(`/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  if (found.files?.[0]?.id) return found.files[0];
  return await googleJson("/drive/v3/files?fields=id,name,webViewLink&supportsAllDrives=true", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
}

async function uploadGoogle(schoolId: string, studentId: string, fileName: string, mimeType: string, bytes: Uint8Array) {
  const rootId = requiredEnv("GOOGLE_DRIVE_FOLDER_ID");
  const schoolFolder = await ensureGoogleFolder(rootId, `school-${schoolId}`);
  const studentFolder = await ensureGoogleFolder(schoolFolder.id, `student-${studentId}`);
  const access = await googleAccessToken();
  const boundary = `eal_${crypto.randomUUID().replaceAll("-", "")}`;
  const metadata = { name: fileName, parents: [studentFolder.id] };
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink&supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: concatBytes([head, bytes, tail]),
  });
  if (!response.ok) throw new Error(`Google Drive upload failed (${response.status})`);
  const data = await response.json();
  return { id: data.id as string, name: data.name as string, mimeType: data.mimeType as string, url: data.webViewLink as string | undefined };
}

function googleFileId(value: string) {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.pathname.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] || url.searchParams.get("id") || "";
  } catch {
    return "";
  }
}

async function linkGoogleFile(value: string) {
  const id = googleFileId(value);
  if (!id) throw new Error("Enter a valid Google Drive file link or ID");
  const file = await googleJson(`/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,webViewLink,trashed&supportsAllDrives=true`);
  if (file.trashed) throw new Error("That Google Drive file is in the bin");
  return { id: file.id as string, name: file.name as string, mimeType: file.mimeType as string, url: file.webViewLink as string | undefined };
}

async function graphAccessToken() {
  const tenant = requiredEnv("MS_TENANT_ID");
  const body = new URLSearchParams({
    client_id: requiredEnv("MS_CLIENT_ID"),
    client_secret: requiredEnv("MS_CLIENT_SECRET"),
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Microsoft token request failed (${response.status})`);
  const data = await response.json();
  if (!data.access_token) throw new Error("Microsoft access token missing");
  return data.access_token as string;
}

async function uploadOneDrive(fileName: string, bytes: Uint8Array) {
  const access = await graphAccessToken();
  const driveId = requiredEnv("ONEDRIVE_DRIVE_ID");
  const root = (Deno.env.get("ONEDRIVE_BASE_PATH") || "EAL").replace(/^\/+|\/+$/g, "");
  const safePath = `${root.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(fileName)}`;
  const response = await fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/root:/${safePath}:/content`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  if (!response.ok) throw new Error(`OneDrive upload failed (${response.status})`);
  const data = await response.json();
  return { id: data.id as string, name: data.name as string, mimeType: data.file?.mimeType || "", url: data.webUrl as string | undefined };
}

async function storeEvidence(admin: any, values: Record<string, unknown>) {
  const { data, error } = await admin.from("evidence_files").insert(values).select().single();
  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") return json(req, { error: "POST required" }, 405);

  try {
    const { user, admin } = await authContext(req);
    const body = await req.json();
    const schoolId = String(body.schoolId || "");
    if (!schoolId) throw new Error("schoolId required");
    const role = await membership(admin, user.id, schoolId);
    const action = String(body.action || "health");
    const provider = String(body.provider || "Google Drive");

    if (action === "health") {
      if (provider === "Google Drive") {
        const folder = await googleFolderHealth();
        return json(req, { ok: true, configured: true, provider, destination: { id: folder.id, name: folder.name, url: folder.webViewLink } });
      }
      if (provider === "OneDrive") {
        await graphAccessToken();
        return json(req, { ok: true, configured: true, provider });
      }
      return json(req, { error: "Choose a storage provider" }, 400);
    }

    if (action === "list") {
      const studentId = String(body.studentId || "");
      if (!studentId) throw new Error("studentId required");
      const { data, error } = await admin
        .from("evidence_files")
        .select("id,provider,provider_file_id,file_name,mime_type,storage_path,created_at,uploaded_by")
        .eq("school_id", schoolId)
        .eq("student_id", studentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json(req, { ok: true, files: data || [] });
    }

    requireRole(role, [...editableRoles], "Your role cannot add evidence files");
    const studentId = String(body.studentId || "");
    if (!studentId) throw new Error("studentId required");

    if (action === "link") {
      if (provider !== "Google Drive") return json(req, { error: "Linking currently supports Google Drive" }, 400);
      const linked = await linkGoogleFile(String(body.fileUrl || body.fileId || ""));
      const row = await storeEvidence(admin, {
        school_id: schoolId,
        student_id: studentId,
        provider,
        provider_file_id: linked.id,
        file_name: linked.name,
        mime_type: linked.mimeType || null,
        storage_path: linked.url || null,
        uploaded_by: user.id,
      });
      return json(req, { ok: true, file: row, providerFile: linked });
    }

    if (action !== "upload") return json(req, { error: "Unknown action" }, 400);
    const fileName = safeFileName(String(body.fileName || ""));
    const mimeType = String(body.mimeType || "application/octet-stream").toLowerCase();
    if (!fileName || !body.contentBase64) throw new Error("fileName and contentBase64 are required");
    if (!allowedMimeTypes.has(mimeType)) return json(req, { error: "That file type is not allowed" }, 415);
    const bytes = b64ToBytes(String(body.contentBase64));
    if (bytes.length > maxBytes) return json(req, { error: "File must be 8 MB or smaller" }, 413);

    const uploaded = provider === "Google Drive"
      ? await uploadGoogle(schoolId, studentId, fileName, mimeType, bytes)
      : provider === "OneDrive"
        ? await uploadOneDrive(fileName, bytes)
        : null;
    if (!uploaded) return json(req, { error: "Storage provider not configured" }, 400);

    const row = await storeEvidence(admin, {
      school_id: schoolId,
      student_id: studentId,
      provider,
      provider_file_id: uploaded.id,
      file_name: fileName,
      mime_type: mimeType,
      storage_path: uploaded.url || null,
      uploaded_by: user.id,
    });
    return json(req, { ok: true, file: row, providerFile: uploaded });
  } catch (error) {
    return json(req, { error: String(error instanceof Error ? error.message : error) }, 400);
  }
});
