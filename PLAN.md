# SheetSubmit-testmycode — Master Plan & Handoff

> **Read this first.** This is the single source of truth for the **test project** —
> a separate, isolated deployment of the SheetSubmit app. Any person, session, or AI
> model continuing this work starts here.

---

## 0. What this project is

A **test/scratch deployment** of SheetSubmit, copied from the main repo
(`B:\Studio\Tools\SheetSubmit-Shadcnui`). It exists so new backend/frontend work can be
deployed and verified **without touching the live production app**.

Key differences vs the main repo:

| | Main repo | This test project |
|---|---|---|
| Location | `B:\Studio\Tools\SheetSubmit-Shadcnui` | `B:\Studio\Tools\SheetSubmit-testmycode` |
| Deploy target | Single image `popyog/sheetsubmit-shadcnui:latest` (Railway, production) | **2 images** — `popyog/sheetsubmit-testmycode-backend:latest` + `popyog/sheetsubmit-testmycode-frontend:latest` (separate Railway project) |
| Telegram bot | Production token | **TEST bot** token (in `.env`, gitignored) — never register the production bot here |
| Data / users | Real Redis | Fresh, empty Redis — no real users, no data migration concerns |

**Rule: nothing in this project may affect the production app.** Test bot token only, its
own Docker images, its own Railway project. The old repo `B:\Studio\Tools\SheetSubmit` and
the main repo remain protected.

---

## 1. Stack (locked)

- **Monorepo → isolated folders:** `frontend/` (React+Vite web), `backend/` (Express API),
  `android/` (Gradle). **No npm workspaces, no shared package** — each folder is
  self-contained with its own `package.json`, `bun.lock`, `Dockerfile`, `.dockerignore`,
  and Docker build context. Deploy either independently.
- **Frontend:** React 19 + TS + Vite + Tailwind v4 + shadcn/ui. Built with `vite build` →
  `frontend/dist`.
- **Backend:** TypeScript Express + ioredis (Redis). Serves the API only. Shared types are
  inlined at `backend/src/lib/shared.ts`.
- **Deploy shape (target):** 3 Railway services —
  1. **web** (image from `frontend/Dockerfile`, nginx serving `frontend/dist`, proxies
     `/api/*` + `/webhook/tg` to the API)
  2. **api** (Express image, port 3000)
  3. **database** (Redis)

---

## 2. Phases & status

| Phase | Status | Notes |
|---|---|---|
| **0 — Copy + test-project scaffold** (folder copy, test-bot `.env`, fresh PLAN.md, 2-image deploy files) | ✅ Done | Test bot token, deploy files, restructure to `frontend/` `backend/` `android/` + `packages/` |
| **1 — 2-image split** (`backend/Dockerfile`, `frontend/Dockerfile` + nginx, redeploy.bat pushes both) | ✅ Done | Both images build clean (no-cache verified) + pushed to Docker Hub |
| **2 — Railway separate project** (3 services: web, api, database; env wiring; test bot webhook) | ✅ Done | `REDIS_URL` = private URL; api has `FRONTEND_URL` + public domain (webhook registered); web static-only, no proxy |
| **3 — Verify** (login via test bot, CRUD, checks, bubble) | ⬜ | Full smoke against the test deployment |

---

## 3. Commands

```bash
# Install/build per folder (each fully independent):
bun install --cwd frontend        # frontend/bun.lock
bun install --cwd backend         # backend/bun.lock
bun run --cwd frontend dev        # Vite dev server
bun run --cwd backend dev         # backend on :3000
bun run --cwd frontend build      # typecheck + build web → frontend/dist
bun run --cwd backend typecheck   # backend typecheck

# Deploy (builds + pushes BOTH images → Railway auto-deploys)
.\redeploy.bat
```

### Env files (3, inside their own folders)
| File | Where it goes | Purpose |
|---|---|---|
| `backend/.env` | Local dev | Full local var set — test token + all defaults |
| `backend/.env.api` | Railway **api** service → Variables | `TG_BOT_TOKEN`, `ADMIN_IDS`, `FRONTEND_URL` (= **web** URL), `REDIS_URL` (private), optional `WEBHOOK_URL`, history/backup knobs |
| `frontend/.env.web` | Build arg → web image | `VITE_API_BASE` (api service public URL, baked into the bundle at build — `redeploy.bat` passes it via `--build-arg`) |

**No nginx proxy.** The api has its own public domain, so the SPA calls the api directly
(cross-origin, `credentials: "include"`). The backend:
- allows CORS for exactly `FRONTEND_URL` (origin), credentials enabled;
- sets the session cookie as `SameSite=None; Secure` (HTTPS) or `SameSite=Lax` (local HTTP);
- sends bot login links to the api's own public URL (`LOGIN_BASE` = `WEBHOOK_URL` → api
  `RAILWAY_PUBLIC_DOMAIN` → `FRONTEND_URL`), then redirects login back to `FRONTEND_URL`.

`FRONTEND_URL` on the api **must be the web service's public URL** (redirect target after
login + CORS allow-list). The api **must have a public domain** (`RAILWAY_PUBLIC_DOMAIN`) so
Telegram can hit `/webhook/tg` — backend auto-registers the webhook to
`RAILWAY_PUBLIC_DOMAIN + /webhook/tg`, or to `WEBHOOK_URL` if set.

---

## 4. Gotchas & decisions

- **Test bot token only.** `TG_BOT_TOKEN` in `.env` is the TEST bot. Never point this
  project at the production bot — registering its webhook here would hijack the live app.
- **`.env` is gitignored** — the token stays local.
- **No nginx / no same-origin proxy.** The SPA calls the api directly at
  `VITE_API_BASE` (baked at build). Cookies are cross-site-safe: `SameSite=None; Secure`
  behind HTTPS (`auth.ts`), CORS allow-lists exactly `FRONTEND_URL` (`app.ts`).
- **`VITE_API_BASE` build arg** = the api service public URL; `redeploy.bat` passes it.
  Frontend image is a tiny bun static server (`frontend/server.js`) — no env, no crash risk.
- **`FRONTEND_URL` env var** on the Railway api service = the **web** service's public URL
  (`https://<web>.up.railway.app`) — CORS origin + post-login redirect target. **The api
  must have a public domain** so Telegram can hit the webhook: backend auto-registers to
  `RAILWAY_PUBLIC_DOMAIN + /webhook/tg`, or to `WEBHOOK_URL` if set (`telegram.ts:199`).
- **Env files live in their folders**: `backend/.env` (local), `backend/.env.api` (api svc),
  `frontend/.env.web` (build-time `VITE_API_BASE`). All gitignored/dockerignored.
- **Backend still references `STATIC_ROOT`** (serves `dist/` if present). In the api image
  there is no web dist, so non-`/api` routes just 404 there — harmless, the web service owns
  static. Removing the static middleware from the server is an optional cleanup.
- **shadcn CLI caveat (if used):** in this monorepo it writes to a literal `frontend/@/`
  folder — move files into `src/` and delete `@/`.
- **Android:** not built in this project's scope; `Config.BASE_URL` unchanged.

---

## 5. Handoff — current state

- **Layout:** 3 top-level folders — `frontend/` (React+Vite web), `backend/` (Express API),
  `android/` (Gradle). **Fully isolated deploy:** no npm workspaces, no shared package; each
  folder has own `package.json`/`bun.lock`/`Dockerfile`/`.dockerignore` and Docker build
  context. Backend inlines shared types (`backend/src/lib/shared.ts`). Git initialized,
  all committed (125 files, `.env*` ignored). Backups: `SheetSubmit-testmycode-backup`,
  `SheetSubmit-testmycode-backup2`.
- **Theme fix:** light-by-default (pre-paint script in `index.html`, `theme.ts`), no OS-pref
  fallback; saved dark choice respected.
- **Env rename:** `APP_URL` → `FRONTEND_URL` (web URL — CORS origin + login redirect);
  `WEBHOOK_URL` (optional webhook override); api's own `RAILWAY_PUBLIC_DOMAIN` auto-used for
  webhook. Env files moved into folders: `backend/.env`, `backend/.env.api`, `frontend/.env.web`.
- **No-nginx / cross-origin refactor (just done):**
  - **Root cause found:** web service `BACKEND_URL` was set without `https://` →
    `proxy_pass ;` → nginx `[emerg] invalid URL prefix` crash-loop. Fixed by setting the
    scheme; then removed nginx entirely per decision.
  - Frontend: nginx removed → `frontend/server.js` (bun static, SPA fallback); `api.ts`
    now uses `VITE_API_BASE` (baked at build) + `credentials: "include"`.
  - Backend: CORS middleware (allow `FRONTEND_URL` only, credentials) + `trust proxy` in
    `app.ts`; session cookie `SameSite=None; Secure` when HTTPS else `SameSite=Lax`
    (`auth.ts`); login links use `LOGIN_BASE` (= `WEBHOOK_URL` → api public URL →
    `FRONTEND_URL`) and post-login redirect → `FRONTEND_URL`; webhook → api public URL only.
  - Railway vars: `BACKEND_URL` deleted from web service; api has `FRONTEND_URL`
    `https://seal.up.railway.app`, `REDIS_URL` (private), `WEBHOOK_URL` empty (webhook =
    `https://sealbackend.up.railway.app/webhook/tg`, verified registered).
  - **Verified live:** SPA serves (200), cross-origin `/api/health` + `/api/auth/me` with
    `credentials:include` → 200 from `seal.up.railway.app` → `sealbackend.up.railway.app`;
    webhook registered to api direct URL.
- Phase 0 + 1 done; both Docker images build clean + pushed.
- **Not yet done:** end-to-end login smoke (click the test bot's login link → land on web,
  cookie flows). That's the final Phase 3 item.
- Resume: run Phase 3 smoke (login via test bot, CRUD, checks, bubble), updating this file.
