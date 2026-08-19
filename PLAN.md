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
| **API efficiency plan** (6 tasks in `docs/superpowers/plans/2026-08-19-api-efficiency.md`) | ✅ Done + deployed | fbCheck fix, 9 dead wrappers removed, health poll 30s+hidden-pause, `GET /files/:id/full` single-trip open, gzip, cross-dup cache + no-op persist guard. Commits `7e5cbb7`→`e7fdc2d` |
| **3 — Verify** (login via test bot, CRUD, checks, bubble) | ⬜ | Full smoke against the test deployment |

---

## 3. Commands

> **Docs:** full endpoint inventory in `API.md` (deleted — obsolete; endpoint list now lives in
> `AUDIT-ISSUES.md` + `backend/src/routes/*`); API-efficiency work plan was in
> `docs/superpowers/plans/2026-08-19-api-efficiency.md` (deleted after landing).

```bash
# Install/build per folder (each fully independent):
bun install --cwd frontend        # frontend/bun.lock
bun install --cwd backend         # backend/bun.lock
bun run --cwd frontend dev        # Vite dev server
bun run --cwd backend dev         # backend on :3000
bun run --cwd frontend build      # typecheck + build web → frontend/dist
bun run --cwd backend typecheck   # backend typecheck

# Deploy (builds + pushes BOTH images, then calls each service's /__redeploy to redeploy)
.\redeploy.bat   # needs deploy.env (gitignored): RAILWAY_TOKEN + FRONTEND_URL + BACKEND_URL
```

### Env files (3, inside their own folders)
| File | Where it goes | Purpose |
|---|---|---|
| `backend/.env` | Local dev | Full local var set — test token + all defaults |
| `backend/.env.api` | Railway **api** service → Variables | `TG_BOT_TOKEN`, `ADMIN_IDS`, `FRONTEND_URL` (= **web** URL), `REDIS_URL` (private), optional `WEBHOOK_URL`, history/backup knobs |
| `frontend/.env.web` | Railway **web** service → Variables | `VITE_API_BASE` (api service public URL — read at container start, injected into the page via `/config.js`; not baked at build, not in code) |

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
  `VITE_API_BASE` (runtime-injected via `/config.js`). Cookies are cross-site-safe: `SameSite=None; Secure`
  behind HTTPS (`auth.ts`), CORS allow-lists exactly `FRONTEND_URL` (`app.ts`).
- **Self-redeploy endpoints:** Railway does **not** auto-deploy on image push. Each service
  exposes `POST /__redeploy` (frontend in `server.js`, backend in `routes/deploy.ts`) which
  calls the Railway GraphQL `serviceInstanceRedeploy` mutation for ITSELF using
  `RAILWAY_TOKEN` (env var on the service) + Railway-injected `RAILWAY_SERVICE_ID` /
  `RAILWAY_ENVIRONMENT_ID`. Requires `Authorization: Bearer <RAILWAY_TOKEN>` (else 401).
  `redeploy.bat` builds+pushes both images, then hits both endpoints.
- **`RAILWAY_TOKEN`** (account/workspace token, `Authorization: Bearer`) must be set as a
  variable on **both** services, and in local `deploy.env` (gitignored; see
  `deploy.env.example`) for redeploy.bat.
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
    now uses `VITE_API_BASE` (runtime-injected via `/config.js`) + `credentials: "include"`.
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
- **Runtime config + self-redeploy (just done):** no URLs hardcoded anywhere. Frontend
  reads `VITE_API_BASE` at container start (`server.js` → `/config.js` → `window.APP_CONFIG`).
  Both services expose `POST /__redeploy` (self-redeploy via `RAILWAY_TOKEN` +
  `RAILWAY_SERVICE_ID`/`RAILWAY_ENVIRONMENT_ID`). `redeploy.bat` builds+pushes then calls
  both endpoints. `RAILWAY_TOKEN` set on both services + in local `deploy.env`.
  **Verified live:** `/config.js` serves the api base; cross-origin API 200; both
  `/__redeploy` endpoints return `{"ok":true,...}` and 401 without the token.
- **Not yet done:** end-to-end login smoke (click the test bot's login link → land on web,
  cookie flows). That's the final Phase 3 item.
- **API efficiency plan (done, deployed in the delta-persistence redeploy):** `7e5cbb7` fix: fb check
  routed through `api.fbCheck()` (was hardcoded `/api/fb/check`); `c4c670f` refactor: dropped
  9 dead `api.ts` wrappers (`getSync`, `setSync`, `updateCell`, `appendLog`, `cancelPending`,
  `forkVersion`, `adminUpdateCell`, `adminAppendLog`, `waCheck`) + the `pending` AbortController
  Set; `0612f98` perf: health poll 30s + paused when tab hidden; `997e367` perf: single
  round-trip file open — new `GET /api/files/:id/full` (pipelined rows+logs+undo+redo), frontend
  `openFile` now 2 round trips, deleted `api.getFile/getLogs/getUndo`; `a39292d` perf: gzip via
  `compression` middleware; `e7fdc2d` perf: cross-dup counts cached 60s per user
  (`crossdups:<userId>`, invalidated in persist pipeline) + `flushPersist` no-op when not dirty.
- **Audit issues BE-1..21 + FE-1..19 (ALL resolved + deployed `c40607b` + follow-up `4d022b7`):**
  - Backend security: `POST /files` ignores client id (server `genFileId()`), append/cell `rowIdx`
    + `ops.length` caps (100k/10k), PUT whitelists (`MUTABLE_FILE_FIELDS`, `USER_MUTABLE_FIELDS`),
    every handler wrapped in `asyncRoute` + process-level `unhandledRejection`/`uncaughtException`
    net (`bootstrapProcessHandlers`), history snapshot `v` now collision-proof (WATCH/MULTI),
    snapshot+prune serialized per file (`withFileLock`), 6s ban cache + invalidation, login token
    consumed on failed login, `/__redeploy` token via `timingSafeEqual`, request logger redacts
    `token|did|session|code|key|secret|auth|password`, `/photo/:userId` cached 24h, `ADMIN_IDS`
    warns loudly when unset, `getJSON` logs parse errors (key only), 8 dead routes deleted
    (user+admin sync/cell/log, GET /:id, GET undo, GET logs, GET admin-user-files, fb/wa-check).
  - Backend robustness: restore/batch-restore TOCTOU → 409 + archive rollback, `/fb/check` capped
    (500 uids, 3/min/user), `tg()` fetch timeouts (20s / 60s getUpdates) + webhook `.catch`,
    backup copy now pipelined + non-overlapping, cross-dups `fileId` narrows the type scan, admin
    persist bumps `seq`, batch deletes → single pipelines, `_migratedLogKeys` capped.
  - Frontend perf: main chunk **834.8→103.9KB min / 263→30.1KB gzip** — `xlsx` lazy-imported,
    VersionDiffPage/overlays/AdminView/ArchiveView/bones-registry code-split, `vendor-react`
    chunk, VersionHistory fetch pool (4-wide), diff page fetches metadata only (no full `/full`).
  - Frontend UX/a11y: grid keyboard nav (arrows/Enter, roving tabindex, ARIA roles), row status
    labels (title/aria), modal focus-trap + Escape (`useModalA11y`), confirm resolver queue,
    `changeJournal` coalesce+cap 200, `bubbleActiveRow` reset, incremental `recomputeMarksForRow`,
    HomePage error toast + rename-only refresh, AdminView double-fetch/search/download fixes.
  - Verification: 50 tests (34 backend + 16 frontend), both typechecks clean, build clean,
    oxlint warnings-only. **Deployed `2026-08-19`** via redeploy.bat (backend digest
    `f13ad5ae`, frontend `9b10b0e9`); live smoke: `/api/health` 200, web 200, `/config.js` OK.
- **Delta persistence (deployed):** cell edits autosave as ops (`/append`, seq-versioned), structural saves fall back to full `/persist`. Both return `seq`; 409 → client refetches + re-applies journal. **Part 2:** logs/undo/redo are now Redis LISTS synced incrementally (`newLogs`/`undoNew`/`redoNew` + client sync bases), migrated from legacy JSON blobs; full-replace only on structural saves.
- **Data-integrity hardening (deployed):** audit found data-loss bugs; fixed in
  `0bc9cbb` (autosaves serialized via `saveChain`, dirty cleared only when rows unchanged,
  `closeFile` commits draft + awaits final flush, `refreshSheet` skips when dirty, keepalive
  flush on beforeunload/pagehide/visibilitychange), `4611e2e` (confirm before delete-selected /
  compact-empty; versionCache no longer caches failed fetches), `232e0c6` (try/catch + toasts +
  xlsx-import rollback on home/archive/admin views; ban/unban confirm),
  `ea56835` (admin persist single pipeline + error check, admin DELETE /file now true archive —
  data keys kept, restore aborts 500 if pre-snapshot fails), `b836fb0` (persist only replaces
  logs when client list not stale, restore snapshot-check, `wa:` cache scoped per user
  `wa:<userId>:<c_user>`, meta:dirty backup triggers on create/rename/delete/archive ops).
  **Residual risk:** `files:<userId>` list RMW race eliminated via `updateUserFilesAtomic`
  (WATCH/MULTI, 5 retries) on every files-list write (files.ts, admin.ts, history.ts,
  createForkFile). pruneHistory now aborts if the oldest retained delta cannot be materialized
  (`44663d9`). Sessions tracked in `ss:userSessions:<userId>`; admin user-delete kills every live
  session + cache entry (`7d34a67`). **Still open:** undo/redo stacks remain device-local
  last-write-wins across devices; beforeunload keepalive flush capped at 64KB (very large sheets
  can still drop on hard tab-kill); `archive:` list itself still non-atomic (archive-vs-archive
  races are user-initiated single-action, accepted); session index accumulates stale tokens until
  next logout/user-delete (harmless).
- **Offline support (committed `0a0488f`, NOT deployed yet):** SPA loads + edits survive going offline.
  - `frontend/public/sw.js` + registration in `main.tsx` (prod only): install-time asset discovery + cache (`/`, `/config.js`, `/assets/*`); navigate = network-first→cached `/`; assets = cache-first; `/config.js` = stale-while-revalidate. API is cross-origin → never intercepted.
  - `frontend/src/offline/db.ts`: IndexedDB (`sheetsubmit-offline`/`queue`, auto-increment id) — enqueue/list/remove/count/clear/available; graceful no-op when IndexedDB missing (private mode / tests).
  - `frontend/src/offline/sync.ts`: `createOfflineSync({db, api})` + singleton `offlineSync`. `queueSave` on network failure, `flush` drains oldest→newest via `api.append`/`api.persist`; append 409 → refetch `getFileFull` + re-apply ops + full `persist` (reuses the seq-conflict idea); network error stops the drain; `online` event auto-flushes; `typeof window` guard for bun tests.
  - `sheetStore.ts`: `offlineDirty` state; `flushPersist` catch → on network error (`TypeError` or `!navigator.onLine`) queues the payload instead of swallowing; 409 merge path unchanged; success clears `offlineDirty`; subscribe → on reconnect drains journal + IDB queue.
  - `OfflineBanner.tsx` (in Layout): fixed pill — offline = "changes saved locally"; online+pending = "Syncing… N" + Sync now. Token-only CSS.
  - Tests: 7 new sync tests (fake db + fake api, no mocking) → **23 frontend pass**. Backend untouched (append/persist/seq already replay-friendly). Verdict vs estimate: backend change = 0 (was the highest-risk item).
  - **Known v1 limits:** full `persist` queue entries replay as whole-sheet replaces; only cell ops (append) get merge-on-409; pending count poll is 5s; login still needs network.
- Resume: run Phase 3 smoke (login via test bot, CRUD, checks, bubble), then deploy offline work, updating this file.
