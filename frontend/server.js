// Minimal static file server for the built SPA (no nginx, no proxy — all API
// calls go straight to the backend public URL baked in at build time).
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(import.meta.dir, "dist");
const PORT = Number(process.env.PORT || 80);

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
  fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      /* keep as-is */
    }
    const clean = normalize(pathname).replace(/[\\/]+\.\.[\\/]/g, "/");
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