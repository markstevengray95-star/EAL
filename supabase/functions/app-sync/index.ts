import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function authContext(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing auth token");

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authClient = createClient(url, anon, {
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid user");

  return {
    user: data.user,
    admin: createClient(url, service),
  };
}

async function membership(admin: any, userId: string, schoolId: string) {
  const { data, error } = await admin
    .from("school_memberships")
    .select("role")
    .eq("school_id", schoolId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) throw new Error("No school membership");
  return data.role as string;
}

function safeDate(value: unknown) {
  const s = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function mirrorStudents(admin: any, schoolId: string, userId: string, state: any) {
  const students = Array.isArray(state?.students) ? state.students : [];
  if (!students.length) return;

  const rows = students.map((s: any) => ({
    school_id: schoolId,
    app_student_id: String(s.id || crypto.randomUUID()),
    external_id: s.externalId ? String(s.externalId) : null,
    name: String(s.name || "Unnamed pupil"),
    preferred_name: s.preferredName ? String(s.preferredName) : null,
    dob: safeDate(s.dob),
    year_group: s.year ? String(s.year) : null,
    form_group: s.form ? String(s.form) : null,
    admission_date: safeDate(s.admissionDate),
    first_language: s.firstLanguage ? String(s.firstLanguage) : null,
    attendance_percent:
      s.attendance && s.attendance.percent !== "" && s.attendance.percent != null
        ? Number(s.attendance.percent)
        : null,
    archived: Boolean(s.archived),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await admin
    .from("students_core")
    .upsert(rows, { onConflict: "school_id,app_student_id" });

  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const { user, admin } = await authContext(req);
    const body = await req.json();
    const schoolId = String(body.schoolId || "");
    if (!schoolId) throw new Error("schoolId required");

    const role = await membership(admin, user.id, schoolId);
    const action = String(body.action || "load");

    if (action === "load") {
      const { data, error } = await admin
        .from("app_snapshots")
        .select("state_data,revision,updated_at,updated_by")
        .eq("school_id", schoolId)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return json({
          ok: true,
          state: null,
          revision: 0,
          updatedAt: null,
          updatedBy: null,
        });
      }

      return json({
        ok: true,
        state: data.state_data,
        revision: Number(data.revision || 0),
        updatedAt: data.updated_at,
        updatedBy: data.updated_by,
      });
    }

    if (action !== "save") return json({ error: "Unknown action" }, 400);

    if (!["administrator", "eal_coordinator", "teacher"].includes(role)) {
      return json({ error: "Your role is read-only." }, 403);
    }

    const expectedRevision = Number(body.expectedRevision || 0);
    const stateData = body.state;
    if (!stateData || typeof stateData !== "object") {
      return json({ error: "state object required" }, 400);
    }

    const { data: saved, error: saveError } = await admin.rpc("save_app_snapshot", {
      p_school_id: schoolId,
      p_state_data: stateData,
      p_expected_revision: expectedRevision,
      p_updated_by: user.id,
    });
    if (saveError) throw saveError;

    if (!saved || !saved.length) {
      const { data: current } = await admin
        .from("app_snapshots")
        .select("revision,updated_at,updated_by")
        .eq("school_id", schoolId)
        .maybeSingle();

      return json(
        {
          error: "conflict",
          message: "Central data changed since this browser last loaded it.",
          currentRevision: Number(current?.revision || 0),
          updatedAt: current?.updated_at || null,
          updatedBy: current?.updated_by || null,
        },
        409,
      );
    }

    const revision = Number(saved[0].revision || expectedRevision + 1);
    await mirrorStudents(admin, schoolId, user.id, stateData);

    await admin.from("central_audit_log").insert({
      school_id: schoolId,
      user_id: user.id,
      action: "save",
      revision,
      detail: {
        student_count: Array.isArray(stateData.students) ? stateData.students.length : 0,
        source: "web_app",
      },
    });

    return json({
      ok: true,
      revision,
      updatedAt: saved[0].updated_at,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
