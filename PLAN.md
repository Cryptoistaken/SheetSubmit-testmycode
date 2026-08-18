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
| Deploy target | Single image `popyog/sheetsubmit-shadcnui:latest` (Railway, production) | **2 images** — `popyog/sheetsubmit-testmycode-api:latest` + `popyog/sheetsubmit-testmycode-web:latest` (separate Railway project) |
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
| **2 — Railway separate project** (3 services: web, api, database; env wiring; test bot webhook) | ⬜ | `REDIS_URL` = private URL; `BACKEND_URL` on web service; `FRONTEND_URL` on api; separate bot token |
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
| `frontend/.env.web` | Railway **web** service → Variables | `BACKEND_URL` (api service URL — private `http://<svc>.railway.internal:3000` or public `https://<api>.up.railway.app`) |

`FRONTEND_URL` on the api **must be the web service's public URL** (bot login links go
through nginx → same-origin cookies). The api may have its own public domain for the
Telegram webhook — backend auto-registers the webhook to its own `RAILWAY_PUBLIC_DOMAIN`,
or to `WEBHOOK_URL` if set, else `FRONTEND_URL + /webhook/tg`.

---

## 4. Gotchas & decisions

- **Test bot token only.** `TG_BOT_TOKEN` in `.env` is the TEST bot. Never point this
  project at the production bot — registering its webhook here would hijack the live app.
- **`.env` is gitignored** — the token stays local. (This copy has no `.git`; git is a
  clean slate if you want to init later.)
- **Web image proxies `/api/*` and `/webhook/tg`** to the API service, so cookies stay
  same-origin — no CORS/auth changes needed (matches the "2 Docker images" plan).
- **`BACKEND_URL` env var** on the Railway web service = the api service's URL (private
  `http://<svc>.railway.internal:3000` or public `https://...`). The nginx template
  envsubst's it at container start.
- **`FRONTEND_URL` env var** on the Railway api service = the **web** service's public URL
  (`https://<web>.up.railway.app`). Always used for bot login links. **`WEBHOOK_URL`** or the
  api's own `RAILWAY_PUBLIC_DOMAIN` drive webhook registration (`telegram.ts:199`), so the
  api may expose a public domain for Telegram without breaking same-origin auth.
- **Env files live in their folders**: `backend/.env` (local), `backend/.env.api` (api svc),
  `frontend/.env.web` (web svc). All gitignored/dockerignored.
- **Backend still references `STATIC_ROOT`** (serves `dist/` if present). In the api image
  there is no web dist, so non-`/api` routes just 404 there — harmless, since nginx owns
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
- **Env rename:** `APP_URL` → `FRONTEND_URL` (web URL, always for login links); `WEBHOOK_URL`
  (optional webhook override); api's own `RAILWAY_PUBLIC_DOMAIN` auto-used for webhook.
  Env files moved into folders: `backend/.env`, `backend/.env.api`, `frontend/.env.web`.
  Webhook auto-registers at boot when `WEBHOOK_URL`, api public domain, or `FRONTEND_URL`
  present (`telegram.ts:199`).
- Phase 0 + 1 done; both Docker images build clean (no-cache verified) and were pushed.
- **Not yet done:** Railway project + 3 services (web, api, database) + env wiring
  (`REDIS_URL`, `BACKEND_URL`, `FRONTEND_URL`), test-bot webhook registration, end-to-end smoke.
- Resume: do Phase 2 → 3 in order, updating this file as you go.
