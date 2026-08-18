# SheetSubmit-testmycode — Agent Rules

## Read this first
**Read `PLAN.md` before doing anything.** It is the single source of truth for this
project's state, phases, commands, gotchas, and handoff. Keep it updated — never leave it stale.

## Project quick facts
- **This is a TEST project** — a separate, isolated deployment of SheetSubmit. Nothing here
  may affect the production app (`B:\Studio\Tools\SheetSubmit-Shadcnui` + its Railway deploy).
- Monorepo (npm workspaces: `frontend`, `backend`, `packages/*`; plus `android/` Gradle),
  package manager is **bun**. No `node_modules` or `.git` in this copy yet — `bun install` first.
- Frontend: React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui (Nova preset, lucide, Geist).
- Backend: TypeScript Express + ioredis.
- Deploy: **2 Docker images** — `popyog/sheetsubmit-testmycode-backend:latest` (Express API, has its own public domain for the Telegram webhook) and
  `popyog/sheetsubmit-testmycode-frontend:latest` (bun static server serving `frontend/dist`, **no nginx/proxy** — the SPA calls the api directly via CORS,
  API base = `VITE_API_BASE` env var on the web service, injected at runtime via `/config.js`). `redeploy.bat` builds + pushes both, then calls each service's
  `POST /__redeploy` to trigger the Railway redeploy (Railway does **not** auto-deploy on push). Separate Railway project: 3 services (web, api, database/Redis).
- Telegram bot: **TEST token** in `backend/.env` (gitignored). NEVER use the production bot token here.

## Rules
1. Start every task by reading `PLAN.md` §5 (handoff) — assess real state first, don't trust memory.
2. Work on the first phase marked ⬜ in the phase table. Verify against its done-criteria.
3. **Production isolation is sacred** — test bot token only, this project's own images and
   Railway project. Never register the production bot's webhook here, never push to
   `popyog/sheetsubmit-shadcnui:*`.
4. After `npx shadcn add`, the CLI writes to a literal `frontend/@/` folder in this
   monorepo — move files into `src/` and delete `@/`.
5. Use tokens/CSS variables for colors — no hardcoded hex.
6. Commit after each completed phase with a `Phase N: …` message, then update `PLAN.md`
   (status, commit hash, gotchas). (git not initialized yet — init first if committing.)
7. The production repos (`B:\Studio\Tools\SheetSubmit` and
   `B:\Studio\Tools\SheetSubmit-Shadcnui`) are protected — do not touch them unless the task
   explicitly requires it.
8. **Deploy flow:** Railway does **not** auto-deploy on image push. `redeploy.bat` (repo root) builds + pushes both images, then calls each service's `POST /__redeploy` endpoint to trigger the Railway redeploy itself. Needs `deploy.env` (gitignored: `RAILWAY_TOKEN` + both service URLs) and `RAILWAY_TOKEN` set as a variable on both Railway services. Do not skip it; ask first only if the user hasn't asked to ship.
9. **Android — NEVER build locally, CI only.** Android lives in the main repo's
   `.github/workflows/build-android.yml` (CI builds). This test project does not own Android
   CI; keep `Config.BASE_URL` unchanged unless told otherwise.
