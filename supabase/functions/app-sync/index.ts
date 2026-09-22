import { authContext, membership } from "../_shared/auth.ts";
import { handleOptions, json } from "../_shared/http.ts";

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
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") return json(req, { error: "POST required" }, 405);

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
        const { data: core, error: coreError } = await admin
          .from("students_core")
          .select("external_id,name,preferred_name,dob,year_group,form_group,admission_date,first_language,attendance_percent")
          .eq("school_id", schoolId)
          .eq("archived", false)
          .order("name");
        if (coreError) throw coreError;

        return json(req, {
          ok: true,
          state: null,
          revision: 0,
          updatedAt: null,
          updatedBy: null,
          role,
          studentsCore: core || [],
        });
      }

      const { data: core, error: coreError } = await admin
        .from("students_core")
        .select("external_id,name,preferred_name,dob,year_group,form_group,admission_date,first_language,attendance_percent")
        .eq("school_id", schoolId)
        .eq("archived", false)
        .order("name");
      if (coreError) throw coreError;

      return json(req, {
        ok: true,
        state: data.state_data,
        revision: Number(data.revision || 0),
        updatedAt: data.updated_at,
        updatedBy: data.updated_by,
        role,
        studentsCore: core || [],
      });
    }

    if (action !== "save") return json(req, { error: "Unknown action" }, 400);

    if (!["administrator", "eal_coordinator", "teacher"].includes(role)) {
      return json(req, { error: "Your role is read-only." }, 403);
    }

    const expectedRevision = Number(body.expectedRevision || 0);
    const stateData = body.state;
    if (!stateData || typeof stateData !== "object") {
      return json(req, { error: "state object required" }, 400);
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
        req,
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

    return json(req, {
      ok: true,
      revision,
      updatedAt: saved[0].updated_at,
      role,
    });
  } catch (e) {
    return json(req, { error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
