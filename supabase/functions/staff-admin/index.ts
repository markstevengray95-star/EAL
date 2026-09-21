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

  return { user: data.user, admin: createClient(url, service) };
}

async function currentMembership(admin: any, userId: string, schoolId: string) {
  const { data, error } = await admin
    .from("school_memberships")
    .select("role")
    .eq("school_id", schoolId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("No school membership");
  return data.role as string;
}

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const { user, admin } = await authContext(req);
    const body = await req.json();
    const schoolId = String(body.schoolId || "");
    if (!schoolId) throw new Error("schoolId required");

    const role = await currentMembership(admin, user.id, schoolId);
    const action = String(body.action || "list");

    if (action === "list") {
      if (!["administrator", "eal_coordinator"].includes(role)) {
        return json({ error: "Staff access list requires administrator or EAL coordinator access" }, 403);
      }
      const { data, error } = await admin
        .from("school_memberships")
        .select("user_id,role,created_at")
        .eq("school_id", schoolId)
        .order("created_at");
      if (error) throw error;

      const emails = await userMap(admin);
      return json({
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
      return json({ error: "Only a school administrator can change staff access" }, 403);
    }

    if (action === "add") {
      const email = String(body.email || "").trim().toLowerCase();
      const newRole = String(body.role || "teacher");
      if (!email) throw new Error("email required");
      if (!roles.includes(newRole)) throw new Error("invalid role");

      const target = await findUserByEmail(admin, email);
      if (!target) {
        return json(
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

      return json({ ok: true, userId: target.id, email, role: newRole });
    }

    if (action === "update") {
      const targetUserId = String(body.userId || "");
      const newRole = String(body.role || "");
      if (!targetUserId || !roles.includes(newRole)) throw new Error("userId and valid role required");

      const { error } = await admin
        .from("school_memberships")
        .update({ role: newRole })
        .eq("school_id", schoolId)
        .eq("user_id", targetUserId);
      if (error) throw error;

      return json({ ok: true });
    }

    if (action === "remove") {
      const targetUserId = String(body.userId || "");
      if (!targetUserId) throw new Error("userId required");
      if (targetUserId === user.id) {
        return json({ error: "You cannot remove your own administrator access from this screen." }, 400);
      }

      const { error } = await admin
        .from("school_memberships")
        .delete()
        .eq("school_id", schoolId)
        .eq("user_id", targetUserId);
      if (error) throw error;

      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 400);
  }
});
