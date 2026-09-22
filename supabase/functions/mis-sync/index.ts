import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.5.3";
import { authContext, membership, requireRole } from "../_shared/auth.ts";
import { assertAllowedOrigin, handleOptions, json } from "../_shared/http.ts";

type StudentRecord = {
  external_id: string;
  name: string;
  preferred_name?: string;
  dob?: string;
  year?: string;
  form?: string;
  admission_date?: string;
  first_language?: string;
  attendance_percent?: number | null;
};

function requiredEnv(name: string) {
  const value = Deno.env.get(name) || "";
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function normalDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)?.[0];
  if (iso) return iso;
  const uk = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (uk) return `${uk[3]}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString().slice(0, 10);
}

function scalar(value: unknown) {
  if (value == null) return "";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return scalar(record["#text"] ?? record.value ?? record.Value ?? "");
  }
  return String(value).trim();
}

function flattened(record: Record<string, unknown>) {
  const map = new Map<string, unknown>();
  const visit = (value: unknown, key = "") => {
    if (Array.isArray(value)) return;
    if (value && typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        const path = key ? `${key}.${childKey}` : childKey;
        map.set(path.toLowerCase(), childValue);
        map.set(childKey.toLowerCase(), childValue);
        visit(childValue, path);
      }
    }
  };
  visit(record);
  return map;
}

function first(map: Map<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = map.get(name.toLowerCase());
    const result = scalar(value);
    if (result) return result;
  }
  return "";
}

function normalizeStudent(record: Record<string, unknown>): StudentRecord | null {
  const map = flattened(record);
  const externalId = first(map, ["schoolid", "school_id", "pupilid", "pupil_id", "studentid", "student_id", "personid", "person_id", "id", "upn"]);
  const preferred = first(map, ["preferredname", "preferred_name", "knownas", "preferredforename"]);
  const firstName = first(map, ["forename", "firstname", "first_name", "givenname"]);
  const surname = first(map, ["surname", "lastname", "last_name", "familyname"]);
  const name = first(map, ["fullname", "full_name", "displayname", "name"]) || [firstName, surname].filter(Boolean).join(" ");
  if (!externalId || !name) return null;
  const attendanceRaw = first(map, ["attendancepercent", "attendance_percent", "attendancepercentage", "attendance"]);
  const attendance = attendanceRaw === "" ? null : Number(attendanceRaw.replace("%", ""));
  return {
    external_id: externalId,
    name,
    preferred_name: preferred || firstName || undefined,
    dob: normalDate(first(map, ["dob", "dateofbirth", "date_of_birth", "birthdate"])),
    year: first(map, ["yeargroup", "year_group", "nc year", "ncyear", "year"]),
    form: first(map, ["form", "formgroup", "form_group", "tutorgroup", "registrationgroup"]),
    admission_date: normalDate(first(map, ["admissiondate", "admission_date", "startdate", "dateofentry"])),
    first_language: first(map, ["firstlanguage", "first_language", "homelanguage", "native_language"]),
    attendance_percent: Number.isFinite(attendance) ? Math.max(0, Math.min(100, attendance)) : null,
  };
}

function valueAtPath(root: unknown, path: string) {
  return path.split(".").filter(Boolean).reduce((value: any, key) => value?.[key], root as any);
}

function objectArrays(root: unknown) {
  const arrays: Record<string, unknown>[][] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      if (value.some((item) => item && typeof item === "object" && !Array.isArray(item))) arrays.push(value as Record<string, unknown>[]);
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  visit(root);
  return arrays;
}

function extractRecords(payload: unknown) {
  const configuredPath = (Deno.env.get("ISAMS_RECORD_PATH") || "").trim();
  const configured = configuredPath ? valueAtPath(payload, configuredPath) : null;
  if (Array.isArray(configured)) return configured as Record<string, unknown>[];
  if (configured && typeof configured === "object") return [configured as Record<string, unknown>];

  const candidates = objectArrays(payload);
  let best: Record<string, unknown>[] = [];
  let bestScore = -1;
  for (const candidate of candidates) {
    const sample = candidate.slice(0, 5);
    const score = sample.filter((item) => normalizeStudent(item)).length * 100 + candidate.length;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

async function parsePayload(response: Response) {
  const text = await response.text();
  if (!text.trim()) throw new Error("iSAMS returned an empty response");
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("json") || /^[\s\r\n]*[\[{]/.test(text)) return JSON.parse(text);
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", trimValues: true }).parse(text);
}

async function fetchIsamsStudents() {
  const endpoint = new URL(requiredEnv("ISAMS_STUDENTS_URL"));
  const apiKey = requiredEnv("ISAMS_API_KEY");
  const mode = (Deno.env.get("ISAMS_AUTH_MODE") || "query").toLowerCase();
  const headers: Record<string, string> = { Accept: "application/json, application/xml;q=0.9, text/xml;q=0.8" };
  if (mode === "bearer") headers.Authorization = `Bearer ${apiKey}`;
  else if (mode === "header") headers[Deno.env.get("ISAMS_API_KEY_HEADER") || "X-API-Key"] = apiKey;
  else endpoint.searchParams.set(Deno.env.get("ISAMS_API_KEY_PARAM") || "apiKey", apiKey);

  const method = (Deno.env.get("ISAMS_HTTP_METHOD") || "GET").toUpperCase();
  const response = await fetch(endpoint, {
    method,
    headers: method === "POST" ? { ...headers, "Content-Type": "application/json" } : headers,
    body: method === "POST" ? JSON.stringify({ action: "students" }) : undefined,
  });
  if (!response.ok) throw new Error(`iSAMS returned ${response.status}`);
  const payload = await parsePayload(response);
  const students = extractRecords(payload).map(normalizeStudent).filter(Boolean) as StudentRecord[];
  if (!students.length) throw new Error("No usable pupil records were found in the iSAMS response; check ISAMS_RECORD_PATH and the enabled iSAMS fields");
  return students.slice(0, 5000);
}

async function fetchGenericAdapter(provider: string, schoolId: string, requestedBy: string) {
  const adapterUrl = requiredEnv("MIS_SYNC_URL");
  const apiToken = requiredEnv("MIS_API_TOKEN");
  const response = await fetch(adapterUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
    body: JSON.stringify({ provider, action: "sync", schoolId, requestedBy }),
  });
  if (!response.ok) throw new Error(`MIS adapter returned ${response.status}`);
  const data = await response.json();
  return (Array.isArray(data.students) ? data.students : []).map((row: Record<string, unknown>) => normalizeStudent(row) || row).filter(Boolean) as StudentRecord[];
}

async function stableAppId(student: StudentRecord) {
  const source = `isams|${student.external_id || `${student.name}|${student.dob || ""}`}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return `mis_${Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function mirrorStudents(admin: any, schoolId: string, userId: string | null, students: StudentRecord[]) {
  const ids = students.map((student) => student.external_id).filter(Boolean);
  const existing = ids.length
    ? await admin.from("students_core").select("external_id,app_student_id").eq("school_id", schoolId).in("external_id", ids)
    : { data: [], error: null };
  if (existing.error) throw existing.error;
  const known = new Map((existing.data || []).map((row: any) => [String(row.external_id), String(row.app_student_id)]));
  const rows = [];
  for (const student of students) {
    rows.push({
      school_id: schoolId,
      app_student_id: known.get(student.external_id) || await stableAppId(student),
      external_id: student.external_id,
      name: student.name,
      preferred_name: student.preferred_name || null,
      dob: student.dob || null,
      year_group: student.year || null,
      form_group: student.form || null,
      admission_date: student.admission_date || null,
      first_language: student.first_language || null,
      attendance_percent: student.attendance_percent ?? null,
      archived: false,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    });
  }
  const { error } = await admin.from("students_core").upsert(rows, { onConflict: "school_id,app_student_id" });
  if (error) throw error;
}

async function requestContext(req: Request, requestedSchoolId: string) {
  const scheduleSecret = Deno.env.get("MIS_SCHEDULE_SECRET") || "";
  const suppliedSecret = req.headers.get("x-eal-sync-secret") || "";
  if (scheduleSecret && suppliedSecret && suppliedSecret === scheduleSecret) {
    const url = requiredEnv("SUPABASE_URL");
    const service = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    return { userId: null, admin: createClient(url, service), schoolId: requestedSchoolId || requiredEnv("ISAMS_SCHOOL_ID"), scheduled: true };
  }
  assertAllowedOrigin(req);
  const { user, admin } = await authContext(req);
  if (!requestedSchoolId) throw new Error("schoolId required");
  const role = await membership(admin, user.id, requestedSchoolId);
  requireRole(role, ["administrator", "eal_coordinator"], "iSAMS sync requires administrator or EAL coordinator access");
  return { userId: user.id, admin, schoolId: requestedSchoolId, scheduled: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") return json(req, { error: "POST required" }, 405);

  let schoolId = "";
  let admin: any = null;
  let userId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const context = await requestContext(req, String(body.schoolId || ""));
    schoolId = context.schoolId;
    admin = context.admin;
    userId = context.userId;
    const provider = String(body.provider || "iSAMS");
    const action = String(body.action || "sync");
    const directIsams = provider.toLowerCase() === "isams" && Boolean(Deno.env.get("ISAMS_STUDENTS_URL"));

    if (action === "health") {
      const endpoint = directIsams ? new URL(requiredEnv("ISAMS_STUDENTS_URL")) : new URL(requiredEnv("MIS_SYNC_URL"));
      return json(req, { ok: true, configured: true, provider, mode: directIsams ? "direct" : "adapter", endpointHost: endpoint.host });
    }

    const students = directIsams
      ? await fetchIsamsStudents()
      : await fetchGenericAdapter(provider, schoolId, userId || "scheduled-sync");

    if (action === "test") {
      return json(req, {
        ok: true,
        provider,
        mode: directIsams ? "direct" : "adapter",
        count: students.length,
        fieldCoverage: {
          externalId: students.filter((student) => student.external_id).length,
          dob: students.filter((student) => student.dob).length,
          year: students.filter((student) => student.year).length,
          firstLanguage: students.filter((student) => student.first_language).length,
          attendance: students.filter((student) => student.attendance_percent != null).length,
        },
      });
    }

    if (action !== "sync") return json(req, { error: "Unknown action" }, 400);
    await mirrorStudents(admin, schoolId, userId, students);
    await admin.from("integration_sync_log").insert({
      school_id: schoolId,
      integration: `MIS:${provider}`,
      status: "success",
      summary: { count: students.length, mode: directIsams ? "direct" : "adapter", scheduled: context.scheduled },
      run_by: userId,
    });
    return json(req, { ok: true, students, count: students.length, mode: directIsams ? "direct" : "adapter", syncedAt: new Date().toISOString() });
  } catch (error) {
    if (admin && schoolId) {
      try {
        await admin.from("integration_sync_log").insert({
          school_id: schoolId,
          integration: "MIS:iSAMS",
          status: "failed",
          summary: { error: String(error instanceof Error ? error.message : error).slice(0, 300) },
          run_by: userId,
        });
      } catch {
        // The original integration error is more useful than a secondary logging failure.
      }
    }
    return json(req, { error: String(error instanceof Error ? error.message : error) }, 400);
  }
});
