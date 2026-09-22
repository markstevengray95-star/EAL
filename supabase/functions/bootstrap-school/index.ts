import { authContext } from "../_shared/auth.ts";
import { assertAllowedOrigin, handleOptions, json } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") return json(req, { error: "POST required" }, 405);

  try {
    assertAllowedOrigin(req);
    const { user, admin } = await authContext(req);
    const email = String(user.email || "").trim().toLowerCase();
    const bootstrapEmail = (Deno.env.get("BOOTSTRAP_ADMIN_EMAIL") || "").trim().toLowerCase();
    if (!bootstrapEmail) return json(req, { error: "First administrator is not configured" }, 501);
    if (email !== bootstrapEmail) {
      return json(req, { error: "Your account is waiting for a school administrator to grant access" }, 403);
    }

    const existing = await admin
      .from("school_memberships")
      .select("school_id,role")
      .eq("user_id", user.id)
      .limit(1);
    if (existing.error) throw existing.error;
    if (existing.data?.length) {
      return json(req, { ok: true, membership: existing.data[0], created: false });
    }

    const schoolName = (Deno.env.get("BOOTSTRAP_SCHOOL_NAME") || "School").trim();
    const schools = await admin.from("schools").select("id,name").eq("name", schoolName).limit(1);
    if (schools.error) throw schools.error;

    let school = schools.data?.[0];
    if (!school) {
      const created = await admin.from("schools").insert({ name: schoolName }).select("id,name").single();
      if (created.error) throw created.error;
      school = created.data;
    }

    const membership = {
      school_id: school.id,
      user_id: user.id,
      role: "administrator",
    };
    const added = await admin.from("school_memberships").insert(membership);
    if (added.error) throw added.error;

    try {
      await admin.from("central_audit_log").insert({
        school_id: school.id,
        user_id: user.id,
        action: "bootstrap_school_administrator",
        detail: { email, school_name: school.name },
      });
    } catch {
      // Access creation must not be rolled back by an optional audit insert failure.
    }

    return json(req, {
      ok: true,
      membership: { school_id: school.id, role: "administrator" },
      created: true,
    });
  } catch (error) {
    return json(req, { error: String(error instanceof Error ? error.message : error) }, 400);
  }
});
