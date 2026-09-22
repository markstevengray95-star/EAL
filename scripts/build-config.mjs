import { writeFileSync } from "node:fs";

const value = (name, fallback = "") => String(process.env[name] ?? fallback).trim();
const bool = (name, fallback) => {
  const raw = value(name);
  return raw ? /^(1|true|yes|on)$/i.test(raw) : fallback;
};

const supabaseUrl = value("EAL_SUPABASE_URL").replace(/\/$/, "");
const supabaseAnonKey = value("EAL_SUPABASE_ANON_KEY");
const config = {
  supabaseUrl,
  supabaseAnonKey,
  allowedEmailDomain: value("EAL_ALLOWED_EMAIL_DOMAIN", "adcoteschool.co.uk").replace(/^@/, "").toLowerCase(),
  requireSignIn: bool("EAL_REQUIRE_SIGN_IN", Boolean(supabaseUrl && supabaseAnonKey)),
  schoolName: value("EAL_SCHOOL_NAME", "Adcote School for Girls")
};

writeFileSync("config.js", `window.EAL_CONFIG = ${JSON.stringify(config, null, 2)};\n`, "utf8");
console.log(`Created public runtime configuration for ${config.schoolName}.`);
