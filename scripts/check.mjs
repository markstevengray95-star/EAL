import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync("index.html", "utf8");
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.trim());

if (!inlineScripts.length) throw new Error("No inline application script found.");
for (const source of inlineScripts) new vm.Script(source);

const required = [
  "centralSignIn",
  "resolveSchoolMembership",
  "bootstrapSchoolMembership",
  "runMisSync",
  "testMisConnection",
  "testStorageConnection",
  "linkDriveEvidence"
];
for (const name of required) {
  if (!html.includes(name)) throw new Error(`Missing required integration function: ${name}`);
}

const forbidden = [
  /SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*["'][A-Za-z0-9]/,
  /GOOGLE_CLIENT_SECRET\s*[=:]\s*["'][A-Za-z0-9]/,
  /ISAMS_API_KEY\s*[=:]\s*["'][A-Za-z0-9]/
];
for (const pattern of forbidden) {
  if (pattern.test(html)) throw new Error(`Possible server secret embedded in index.html: ${pattern}`);
}

console.log(`Static integration checks passed (${inlineScripts.length} inline script block${inlineScripts.length === 1 ? "" : "s"}).`);

