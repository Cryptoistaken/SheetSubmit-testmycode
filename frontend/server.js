// Minimal static file server for the built SPA (no nginx, no proxy — all API
// calls go straight to the backend public URL injected at container start).
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(import.meta.dir, "dist");
const PORT = Number(process.env.PORT || 80);
const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

// Base URL of the backend API — read at container start (Railway web service
// Variables), never hardcoded. Normalized: scheme-less values get https://.
let apiBase = (process.env.VITE_API_BASE || "").replace(/\/+$/, "");
if (apiBase && !/^https?:\/\//i.test(apiBase)) apiBase = "https://" + apiBase;

const CONFIG_JS = "window.APP_CONFIG=" + JSON.stringify({ apiBase }) + ";\n";

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /__redeploy — redeploy THIS service on Railway (used by redeploy.bat after
// pushing the image). Self-redeploys via RAILWAY_TOKEN (env var on the service) +
// Railway's own injected RAILWAY_SERVICE_ID / RAILWAY_ENVIRONMENT_ID — no IDs or
// URLs hardcoded anywhere.
async function handleRedeploy(req) {
  const token = process.env.RAILWAY_TOKEN;
  const serviceId = process.env.RAILWAY_SERVICE_ID;
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
  if (!token || !serviceId || !environmentId) {
    return json(503, { ok: false, error: "RAILWAY_TOKEN / RAILWAY_SERVICE_ID / RAILWAY_ENVIRONMENT_ID not set" });
  }
  if (req.headers.get("authorization") !== "Bearer " + token) {
    return json(401, { ok: false, error: "unauthorized" });
  }
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      query:
        "mutation Redeploy($serviceId: String!, $environmentId: String!) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }",
      variables: { serviceId, environmentId },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) return json(502, { ok: false, errors: body.errors });
  return json(200, { ok: body.data?.serviceInstanceRedeploy === true, data: body.data });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain",
};

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      /* keep as-is */
    }
    const clean = normalize(pathname).replace(/[\\/]+\.\.[\\/]/g, "/");
    if (req.method === "POST" && clean === "/__redeploy") {
      return handleRedeploy(req);
    }
    if (clean === "/config.js") {
      return new Response(CONFIG_JS, { headers: { "Content-Type": "text/javascript" } });
    }
    let file = join(ROOT, clean);
    if (!file.startsWith(ROOT)) file = join(ROOT, "index.html");
    if (extname(file) === "") file = join(ROOT, "index.html"); // SPA fallback
    let body;
    try {
      body = readFileSync(file);
    } catch {
      try {
        body = readFileSync(join(ROOT, "index.html")); // unknown route → SPA
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    }
    return new Response(body, {
      headers: { "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream" },
    });
  },
});

console.log("[static] serving " + ROOT + " on :" + PORT);