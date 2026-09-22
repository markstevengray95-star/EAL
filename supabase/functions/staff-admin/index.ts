import { authContext, membership as currentMembership } from "../_shared/auth.ts";
import { handleOptions, json } from "../_shared/http.ts";

async function userMap(admin: any) {
  const map = new Map<string, string>();
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const user of data.users || []) map.set(user.id, user.email || "");
    if (!data.users || data.users.length < 200) break;
    page++;
    if (page > 20) break;
  }
  return map;
}

async function findUserByEmail(admin: any, email: string) {
  const target = email.trim().toLowerCase();
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = (data.users || []).find((u: any) => String(u.email || "").toLowerCase() === target);
    if (found) return found;
    if (!data.users || data.users.length < 200) return null;
    page++;
    if (page > 20) return null;
  }
}

const roles = ["administrator", "eal_coordinator", "teacher", "senior_leadership", "read_only"];

async function ensureAnotherAdministrator(admin: any, schoolId: string, targetUserId: string) {
  const target = await admin
    .from("school_memberships")
    .select("role")
    .eq("school_id", schoolId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (target.error) throw target.error;
  if (target.data?.role !== "administrator") return;

  const admins = await admin
    .from("school_memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("school_id", schoolId)
    .eq("role", "administrator");
  if (admins.error) throw admins.error;
  if ((admins.count || 0) <= 1) throw new Error("Add another administrator before removing the last administrator account");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") return json(req, { error: "POST required" }, 405);

  try {
    const { user, admin } = await authContext(req);
    const body = await req.json();
    const schoolId = String(body.schoolId || "");
    if (!schoolId) throw new Error("schoolId required");

    const role = await currentMembership(admin, user.id, schoolId);
    const action = String(body.action || "list");

    if (action === "list") {
      if (!["administrator", "eal_coordinator"].includes(role)) {
        return json(req, { error: "Staff access list requires administrator or EAL coordinator access" }, 403);
      }
      const { data, error } = await admin
        .from("school_memberships")
        .select("user_id,role,created_at")
        .eq("school_id", schoolId)
        .order("created_at");
      if (error) throw error;

      const emails = await userMap(admin);
      return json(req, {
        members: (data || []).map((m: any) => ({
          userId: m.user_id,
          email: emails.get(m.user_id) || "",
          role: m.role,
          createdAt: m.created_at,
          isCurrentUser: m.user_id === user.id,
        })),
      });
    }

    if (role !== "administrator") {
      return json(req, { error: "Only a school administrator can change staff access" }, 403);
    }

    if (action === "add") {
      const email = String(body.email || "").trim().toLowerCase();
      const newRole = String(body.role || "teacher");
      if (!email) throw new Error("email required");
      if (!roles.includes(newRole)) throw new Error("invalid role");
      const allowedDomain = (Deno.env.get("AUTH_ALLOWED_EMAIL_DOMAIN") || "").trim().replace(/^@/, "").toLowerCase();
      if (allowedDomain && (email.split("@")[1] || "") !== allowedDomain) {
        return json(req, { error: "Staff access is restricted to the authorised school email domain" }, 400);
      }

      const target = await findUserByEmail(admin, email);
      if (!target) {
        return json(
          req,
          { error: "That staff account has not signed in yet. Ask them to sign in once, then add them here." },
          404,
        );
      }

      const { error } = await admin.from("school_memberships").upsert({
        school_id: schoolId,
        user_id: target.id,
        role: newRole,
      });
      if (error) throw error;

      return json(req, { ok: true, userId: target.id, email, role: newRole });
    }

    if (action === "update") {
      const targetUserId = String(body.userId || "");
      const newRole = String(body.role || "");
      if (!targetUserId || !roles.includes(newRole)) throw new Error("userId and valid role required");
      if (newRole !== "administrator") await ensureAnotherAdministrator(admin, schoolId, targetUserId);

      const { error } = await admin
        .from("school_memberships")
        .update({ role: newRole })
        .eq("school_id", schoolId)
        .eq("user_id", targetUserId);
      if (error) throw error;

      return json(req, { ok: true });
    }

    if (action === "remove") {
      const targetUserId = String(body.userId || "");
      if (!targetUserId) throw new Error("userId required");
      if (targetUserId === user.id) {
        return json(req, { error: "You cannot remove your own administrator access from this screen." }, 400);
      }
      await ensureAnotherAdministrator(admin, schoolId, targetUserId);

      const { error } = await admin
        .from("school_memberships")
        .delete()
        .eq("school_id", schoolId)
        .eq("user_id", targetUserId);
      if (error) throw error;

      return json(req, { ok: true });
    }

    return json(req, { error: "Unknown action" }, 400);
  } catch (e) {
    return json(req, { error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
