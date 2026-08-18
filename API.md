# SheetSubmit-testmycode — API Reference

Backend: TypeScript Express + ioredis (Redis). Single SPA frontend talks to it cross-origin.

## Base URLs

| | URL |
|---|---|
| Backend API | `https://sealbackend.up.railway.app` (api service; `VITE_API_BASE` on web service) |
| Frontend | `https://seal.up.railway.app` |
| API base path | `{VITE_API_BASE}/api` — injected at runtime via `/config.js` (`window.APP_CONFIG.apiBase`) |

Local dev: Vite proxy forwards `/api` → `http://localhost:3000`.

## Auth model

| Mechanism | How | Used by |
|---|---|---|
| Public | no cookie required | health, auth callbacks, bot, webhook, deploy |
| Session | `session=` cookie → `session:<id>` in Redis; 403 if `ban:<userId>` | all user data routes |
| File owner | session + file `:id` owned by user (`requireFileAccess`) | `files`, `history` routes |
| Admin | session + userId in `ADMIN_IDS` env | all `/api/admin/*` |
| Deploy | `Authorization: Bearer <RAILWAY_TOKEN>` | `POST /__redeploy` |

CORS: only origin === `FRONTEND_URL`, credentials allowed, preflight → 204. Session cookie is `SameSite=None; Secure` (HTTPS).

## Public routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Redis readiness (`ok` only when Redis ready) |
| GET | `/api/bot/info` | bot username (route exists only when bot enabled) |
| POST | `/webhook/tg` | Telegram update webhook (root mount, bot enabled only) |
| POST | `/__redeploy` | self-redeploy via Railway API (Bearer token auth) |
| GET | `/api/auth/telegram?token=` | Telegram login callback → sets session cookie, 302 → frontend |
| GET | `/api/auth/photo/:userId` | 302 → Telegram profile photo |
| GET | `/api/auth/logout` | clear session cookie + Redis session |
| GET | `/api/auth/me` | current user or `null` |
| GET | `/api/auth/device?token=` | Android device-login session poll |

## User routes (session cookie)

### Files — `/api/files`

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/files` | list my files |
| GET | `/api/files/:id` | single file meta |
| GET | `/api/files/:id/full` | file meta + rows + logs + undo + redo + `seq` in one pipelined read |
| POST | `/api/files` | create file |
| PUT | `/api/files/:id` | update file fields (rename) |
| DELETE | `/api/files/:id` | soft-delete → archive |
| PUT | `/api/files/:id/persist` | full save rows/logs/undo/redo/dataCount; returns `seq` |
| PUT | `/api/files/:id/append` | delta save: `{base, ops[]}` seq-versioned cell changes; 409 on stale base |
| GET | `/api/files/:id/rows` | read rows |
| GET | `/api/files/:id/logs` | read logs |
| GET | `/api/files/:id/undo` | undo/redo stacks |
| GET | `/api/files/:id/sync` | read sync config |
| PUT | `/api/files/:id/sync` | write sync config |
| PUT | `/api/files/:id/cell` | set one cell |
| POST | `/api/files/:id/log` | append log entry |

### History — `/api/files/:id/history`

| Method | Path | Purpose |
|---|---|---|
| GET | `.../history` | version list |
| GET | `.../history/:v` | materialize version `v` |
| POST | `.../history/:v/restore` | restore version (snapshots current first) |
| POST | `.../history/:v/name` | name a version |
| POST | `.../history/:v/fork` | fork version → new file |

### Archive — `/api/archive`

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/archive` | list archived files |
| POST | `/api/archive/:id/restore` | restore one |
| POST | `/api/archive/batch-restore` | restore many |
| DELETE | `/api/archive/:id` | permanent delete (purges data keys) |
| POST | `/api/archive/batch-delete` | permanent delete many |

### Cross-dups — `/api/cross-dups`

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cross-dups?fileId=` | duplicate-row detection counts across my files |

### WA / Facebook — `/api`

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/fb/check` | batch FB account status check (batches of 20, 2 providers) |
| POST | `/api/fb/page-check` | page ownership + linked number scrape |
| POST | `/api/fb/wa-check` | WA onboarding eligibility check |
| GET | `/api/wa/cache?uids=` | read WA eligibility cache |

## Admin routes (session + `ADMIN_IDS`) — `/api/admin`

| Group | Endpoints |
|---|---|
| Stats | `GET /stats`, `GET /users`, `GET /users/search?q=` |
| User | `GET /user/:userId`, `PUT /user/:userId`, `DELETE /user/:userId`, `GET /user/:userId/files`, `GET /user/:userId/archive`, `POST /user/:userId/archive/:fileId/restore`, `DELETE /user/:userId/archive/:fileId`, `POST /user/:userId/ban`, `POST /user/:userId/unban` |
| File | `GET/PUT/DELETE /file/:fileId`, `GET /file/:fileId/rows`, `GET /file/:fileId/undo`, `GET /file/:fileId/logs`, `PUT /file/:fileId/persist`, `PUT /file/:fileId/cell`, `POST /file/:fileId/log` |
| History | `GET /file/:fileId/history`, `GET /file/:fileId/history/:v`, `POST /file/:fileId/history/:v/restore`, `POST /file/:fileId/history/:v/name`, `POST /file/:fileId/history/:v/fork` |

## Frontend usage map

- All browser calls go through `frontend/src/lib/api.ts` (`api.*` object, one `request<T>()` fetch wrapper with `credentials: "include"`).
- `openFile` = 2 round trips: `GET /files/:id/full` (file+rows+logs+undo+redo) + `cross-dups`.
- Autosave: 300 ms debounce. **Cell edits are sent as delta ops** via `PUT /files/:id/append` — `{ base: lastSeq, ops: [{rowIdx, cols}] }` — not the whole file. Every file has a `seq` counter (returned by `/full`, `/persist`, `/append`). Structural/action saves (merge/replace/append/clean/bubble, undo/redo, paste, removeEmptyRows, admin) still use the full `/persist` path. On append `409 version conflict` the client refetches `/full`, re-applies its unsent ops onto the server rows (local edits survive), bumps `lastSeq`, and re-appends.
- Health poll: `Topbar` pings `/api/health` every 30 s (1.5× backoff to 120 s on failure), paused while the tab is hidden.
- Cross-dup counts cached per user for 60 s (`crossdups:<userId>`, invalidated on persist).
- WA eligibility cache keyed `wa:<userId>:<c_user>` (scoped to the acting user, written/read by the same user).
- Autosaves serialized through a single promise chain (`saveChain`); `isDirty` cleared only when rows are unchanged since the save started. `closeFile` commits the open draft and awaits the final flush; `refreshSheet` skips while dirty; `beforeunload`/`pagehide`/`visibilitychange:hidden` flush with `keepalive`.
- Every write to a user's file list goes through `updateUserFilesAtomic` (Redis WATCH/MULTI, 5 retries) — rename/persist/create/restore/archive can no longer clobber each other.
- Sessions tracked in `ss:userSessions:<userId>` (added on login, removed on logout); admin user-delete kills all live sessions.
- API responses gzip-compressed (`compression` middleware).
- WA checks: concurrency 3, cache prefill via `/wa/cache`, then live `pageCheck` per row.

### Removed frontend wrappers (deleted, never called)

`getSync`, `setSync`, `updateCell`, `appendLog`, `cancelPending`, `forkVersion`, `adminUpdateCell`, `adminAppendLog`, `waCheck` were removed from `api.ts`. Corresponding backend routes stay — the Android app may use them via `Config.BASE_URL`.

## Known issues

1. ~~`frontend/src/features/filetypes/fbcookie.ts:91` — hardcoded relative `fetch("/api/fb/check")`~~ **Fixed** — now routed through `api.fbCheck()` (runtime `apiBase`).
2. `res.redirect` after Telegram login hits `FRONTEND_URL` — correct only when `FRONTEND_URL` is set on the api service.

## Method totals (backend, 63 routes)

GET 38 · POST 16 · PUT 8 · DELETE 5 · OPTIONS (implicit preflight). 26 admin, 24 session-cookie, 9 public, rest ops/bot.