import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "supabase", "config.toml");
const migrationsPath = path.join(root, "supabase", "migrations");
const functionsPath = path.join(root, "supabase", "functions");

const fail = (message) => {
  throw new Error(`Supabase configuration error: ${message}`);
};

if (!existsSync(configPath)) fail("supabase/config.toml is missing");
const config = readFileSync(configPath, "utf8");
const functionNames = ["bootstrap-school", "app-sync", "staff-admin", "evidence-storage", "mis-sync"];

for (const name of functionNames) {
  if (!existsSync(path.join(functionsPath, name, "index.ts"))) fail(`function ${name} is missing index.ts`);
  if (!config.includes(`[functions.${name}]`)) fail(`function ${name} is missing from config.toml`);
  const section = config.split(`[functions.${name}]`)[1]?.split("\n[")[0] || "";
  if (!/verify_jwt\s*=\s*false/.test(section)) fail(`${name} must use its in-function authentication checks`);
}

const migrations = readdirSync(migrationsPath)
  .filter((name) => statSync(path.join(migrationsPath, name)).isFile())
  .sort();
if (migrations.length < 3) fail("the three EAL database migrations are required");
for (const name of migrations) {
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) fail(`invalid migration filename: ${name}`);
  const sql = readFileSync(path.join(migrationsPath, name), "utf8");
  if (!sql.trim()) fail(`migration ${name} is empty`);
}

const envExample = path.join(functionsPath, ".env.example");
if (!existsSync(envExample)) fail("supabase/functions/.env.example is missing");
const env = readFileSync(envExample, "utf8");
for (const name of [
  "AUTH_ALLOWED_EMAIL_DOMAIN",
  "APP_ALLOWED_ORIGINS",
  "BOOTSTRAP_ADMIN_EMAIL",
  "GOOGLE_DRIVE_FOLDER_ID",
  "ISAMS_STUDENTS_URL",
  "ISAMS_API_KEY",
]) {
  if (!env.includes(`${name}=`)) fail(`local secret template is missing ${name}`);
}

const committedConfiguration = [
  config,
  readFileSync(path.join(root, ".env.example"), "utf8"),
  env,
].join("\n");
for (const pattern of [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AIza[0-9A-Za-z_-]{20,}/,
  /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\./,
]) {
  if (pattern.test(committedConfiguration)) fail("a value resembling a private credential was found");
}

console.log(`Supabase configuration passed (${migrations.length} migrations, ${functionNames.length} functions).`);
