import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertAllowedOrigin } from "./http.ts";

export type SchoolRole = "administrator" | "eal_coordinator" | "teacher" | "senior_leadership" | "read_only";

function requiredEnv(name: string) {
  const value = Deno.env.get(name) || "";
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function assertSchoolEmail(email: string) {
  const allowed = (Deno.env.get("AUTH_ALLOWED_EMAIL_DOMAIN") || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!allowed) return;
  const domain = email.trim().toLowerCase().split("@")[1] || "";
  if (domain !== allowed) throw new Error("Use an authorised school account");
}

export async function authContext(req: Request) {
  assertAllowedOrigin(req);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing auth token");

  const url = requiredEnv("SUPABASE_URL");
  const anon = requiredEnv("SUPABASE_ANON_KEY");
  const service = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const authClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid user");
  assertSchoolEmail(data.user.email || "");

  return {
    user: data.user,
    admin: createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

export async function membership(admin: any, userId: string, schoolId: string): Promise<SchoolRole> {
  const { data, error } = await admin
    .from("school_memberships")
    .select("role")
    .eq("school_id", schoolId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("No school membership");
  return data.role as SchoolRole;
}

export function requireRole(role: SchoolRole, allowed: SchoolRole[], message = "Insufficient role") {
  if (!allowed.includes(role)) throw new Error(message);
}

