const defaultOrigins = [
  "https://markstevengray95-star.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

function allowedOrigins() {
  const configured = (Deno.env.get("APP_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return configured.length ? configured : defaultOrigins;
}

export function assertAllowedOrigin(req: Request) {
  const origin = (req.headers.get("Origin") || "").replace(/\/$/, "");
  if (origin && !allowedOrigins().includes(origin)) {
    throw new Error("Request origin is not allowed");
  }
}

export function corsHeaders(req: Request) {
  const origin = (req.headers.get("Origin") || "").replace(/\/$/, "");
  const allowed = allowedOrigins();
  return {
    "Access-Control-Allow-Origin": origin && allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-eal-sync-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function handleOptions(req: Request) {
  try {
    assertAllowedOrigin(req);
    return new Response("ok", { headers: corsHeaders(req) });
  } catch {
    return json(req, { error: "Request origin is not allowed" }, 403);
  }
}

