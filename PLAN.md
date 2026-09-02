# PLAN.md — SheetSubmit-testmycode

> Source of truth for project state, phases, and handoff. Read §5 first every task.

## 1. Project overview
- **Test deployment** of SheetSubmit — isolated from production (`SheetSubmit-Shadcnui` + Railway prod).
- Stack: React 19 + Vite + Tailwind v4 + shadcn/ui (frontend), Express + ioredis (backend), bun, 2 Docker images (`popyog/sheetsubmit-testmycode-*`), Redis.
- Auth: Telegram login → `session=` cookie, `ss:userIds` / `ss:files:<userId>` / `ss:rows:<fileId>` etc.

## 2. Commands
```bat
bun install                          :: root + frontend + backend
bun run dev:web     :: frontend vite
bun run dev:server  :: backend watch
bun run build       :: frontend build
bun run typecheck   :: both
bun test            :: backend + frontend
redeploy.bat        :: build + push both images + POST /__redeploy (needs deploy.env)
```

## 3. Deploy
- Images: `popyog/sheetsubmit-testmycode-backend:latest`, `popyog/sheetsubmit-testmycode-frontend:latest`
- Railway project has 3 services (web, api, db). No auto-deploy — `redeploy.bat` triggers it.
- Frontend calls API via `VITE_API_BASE` → `/config.js` runtime.

## 4. Phases

### Phase 0 — Pools spec & planning ✅  (2026-09-01)
- **Goal:** Lock spec for the Pools feature before writing prod code.
- **Deliverables:** this PLAN.md §4.1 + `pools-spec.html` (interactive spec with mock UI & flows).
- **Done criteria:** Admin + user flows for 3 pools agreed, data model sketched, download/claim semantics defined, demo plan ready.

### 4.1 Pools feature — spec summary
> Full interactive spec: [`pools-spec.html`](./pools-spec.html) (open in browser). Summary below.

**Pools (3 types × 2 passwords = 6 logical pools, 2 shown):**
| Pool type | Display label | Full rule | Badge | Eligibility (per password) |
|-----------|---------------|-----------|-------|----------------------------|
| `cookies_only` | **Cookies** | `cookies` valid, `twofakey` empty, page empty | `Cookies` | same for each password |
| `cookies_2fa` | **2FA** | `cookies` + `twofakey`, page empty | `2FA` | same for each password |
| `page` | **Page** | `cookies` + `twofakey` + `wa_status === "eligible"` (green dot) | `Page` | same for each password |
| **Password dimension:** `dgddigital` (default, shown) / `L0VE@12345` (shown) / `custom` (exists in model + file creation but **hidden in Pools UI for now**). Each type exists per password, e.g. `pool:dgddigital:cookies_only`, `pool:L0VE@12345:cookies_only`. Only the 2 shown passwords have UI; custom is stored but not rendered.

> Tooltip/full name: "Cookies without 2FA" / "Cookies with 2FA key" / "Cookies + 2FA + Page (green dot)". IDs stay `cookies_only` / `cookies_2fa` / `page`.

> Pools are progressive: Page requires 2FA, 2FA requires cookies. Content is the same account row shape + eligibility filter. See "Filtering" below.

**What a "pool" is:** An **auto-classified** collection of **accounts (rows)** — every row a user creates is **auto-evaluated on save** and placed into the matching pool **for its file's password** if it passes filters. Pools are admin-only to view, but auto-populated from all users. Once in a pool, a row is visible to admin aggregated across users; admin can claim/download; claimed rows leave the pool and are marked taken (blue lock).

**Auto-pooling + live promotion + password dimension (from your answers):**
- On `POST /api/files`, `PUT /:id/persist`, `PUT /:id/append` (any save/modify) server runs `classifyRow(row, file.password)` → decides pool `cookies_only / cookies_2fa / page` **within that password's namespace** or none (invalid/ineligible/taken). Example: `pool:dgddigital:cookies_only:available` vs `pool:L0VE@12345:cookies_only:available` (custom password namespace exists but hidden in UI). No manual "Add to Pool" — it's automatic.
- **Passwords shown in Pools UI:** `dgddigital` / `L0VE@12345` — simple **password switch** at top of Pools page (two pills, default `dgddigital`). `Custom` password files are stored (flexible) but **not shown** in Pools UI for now (hidden). File creation dialog offers `dgddigital` (default) / `L0VE@12345` / `Custom…` (hidden input, still creates file with custom string).
- **Page is derived from Page Check (green dot / WA `eligible`)**, not a new column. So `page` eligibility = `cookies` valid + `twofakey` present + `wa_status === "eligible"` (green dot). Page without 2FA is ineligible.
- **Row updates auto-transfer:** if user edits a row (adds 2FA → Cookies→2FA, green dot → Page, or becomes dead/bad/invalid), server **removes it from old pool's `available` (within its password)** and **inserts into new pool's `available`** (or removes from pools entirely if invalid/dead/taken). Same on `wa_status` change. If dedup key in `taken:global:<password>` (now per-password global), it is `skippedTaken` and never re-enters that password's pools.
- **No cross-password mixing:** `dgddigital` rows never appear in `L0VE@12345` pools and vice versa. Global taken is per-password (`taken:global:dgddigital` vs `taken:global:L0VE@12345`).

**Core states for a pooled account (row):**
```
available  →  claimed (takenBy admin, claimedAt)  →  taken (blue locked row)
```
- `available`: in pool, admin can still claim.
- `claimed`: removed from pool's available set; stays in audit log + user's file shows **blue cell + white text + blue dot**, row locked (unmodifiable, can't edit). No "Taken" text in cell — long-press dot shows "Taken on 2026-09-01" + existing dot info (status, page, etc).
- **No re-entry ever:** once taken, that account's dedup key (`uid`/`c_user`) is added to a **global permanent blocklist** (`taken:global` + per-pool `taken` set). Even if owner deletes row/file and re-adds same cookies, or any other user uploads same account, it is rejected as `skippedTaken` and never re-enters any pool. No expiry.

**Filtering (applies on every save — auto-pooling):**
- **Invalid/dead filter:** empty row, `cookies` missing/empty, `cookies` doesn't contain `c_user=`, `uid` missing, whitespace-only, or `status === "bad"` / dead (Page Check fails) — **dead rows are auto-removed from any pool they were in** and never re-enter (reported as `skippedInvalid` on add, `removedDead` on promotion cleanup).
- **Password filter (now: pools per password, 2 shown):** file has `password` (`dgddigital` default / `L0VE@12345` / custom string) + `poolEnabled` toggle (default ON). Each password has its own 3 pools (e.g. `dgddigital:Cookies`, `L0VE:Cookies`). Pools UI shows only `dgddigital` + `L0VE@12345` via simple switch; **custom password pools exist in model but are hidden in UI for now**. If `poolEnabled === false`, file's rows are `skippedFiltered` (never enter its password's pools) regardless of password. Previously filtered L0VE/Custom entirely — now they have their own pools (you asked for 2 passworded pools).
- **Global Taken blocklist per password (checked first, permanent, cross-pool, cross-user within same password):** if dedup key exists in `taken:global:<password>` (e.g. `taken:global:dgddigital`), skip as `skippedTaken` — never re-enters that password's pools, even after delete/re-upload or by another user. Cross-password re-entry is still allowed (same cookies with different password is considered different pool namespace).
- **Duplicate filter (per-pool dedup):** key = `uid || c_user` via `getDedupKey`. If key already in that pool's `available`/`claimed`, `skippedDuplicate`. Cross-pool dup allowed only via promotion (row moves pools on update, not duplicate insertion).
- **Pool eligibility filter:** row must match pool's content rule (see table). **Page = `cookies` + `twofakey` + `wa_status === "eligible"` (green dot) — page without 2FA is `skippedIneligible` for Page. If row matches none (e.g. no cookies), it stays outside pools.
- All filters run server-side on every persist/append/Check; bulk adds return `{added, skippedDuplicate, skippedInvalid, skippedIneligible, skippedTaken, skippedFiltered}`. Promotion (Cookies→2FA→Page) removes from old pool + adds to new; dead/invalid removes from pools entirely; delete removes from pools if not yet taken.
- **Delete → remove if not taken:** if user deletes a row or whole file (archive) and that row is still `available` (not yet claimed), it is **removed from its pool's `available`** (and `dedup` set). If already `taken`/`claimed`, it stays in `taken:global` + ledger forever (not resurrected).
- **No manual unpool except:** pool opt-out toggle / password filter / delete — otherwise **claim is the only removal** from Available. `taken:global` is the permanent exit otherwise.
- **Backfill disabled (per your last answer):** **no migration for old files** — files already created **without password on create time** are left as-is (no password assigned, never enter pools, `skippedFiltered`). Only **files created from now** (with password picked via 2-card selector `dgddigital` / `L0VE@12345`) are auto-pooled. Previously planned name-based backfill (`L0VE@12345` in name → L0VE else dgddigital) is **not executed**.

**Navigation (proposed — see spec HTML):**
```
My Files | Archive | Pools ▾(admin-only) | Admin | Tools
            password switch: [dgddigital | L0VE@12345]  ← simple pill, default dgddigital; Custom hidden
            pool tabs:       [Cookies | 2FA | Page]     (within selected password)
```
> No "All Pools" — pools open directly to one password+pool. `/pools` redirects to `/pools/dgddigital/cookies_only` (default).
- **Pools is admin-only** (`requireAdmin`). Non-admin never sees Pools.
- **Password switch (simple, as you requested):** top of Pools page has two pills `dgddigital` / `L0VE@12345` (Custom hidden). Switching password swaps the 3 pools data (counts, user tables) without page reload. URL reflects password: `/pools/:password/:poolId`.
- Admin: per-pool dashboard: users in pool, per-user counts (`Available / Claimed`), **⋯ menu per user: View file / Download** (no horizontal scroll), pool-wide Download with quantity selector (primary). All actions scoped to selected password+pool.
- **⋯ View file** opens the file exactly like **Admin → User → File** (`/admin/user/:userId/file/:fileId`), not inline — same sheet grid (`cookies / 2fa key / uid / dot`), read-only view. Taken rows inside file are blue-locked with whole-row white cut; long-press dot shows date (per-password global).
- Non-admin visibility: taken rows in own file are **blue cell + white text + blue dot, whole-row cut, locked (can't edit)**. No "Taken" text in cell — long-press dot shows "Taken on <date>" + dot info (via `_taken`/`_takenAt` on `rows:<fileId>`). No pool browsing for users.
- **Admin guard everywhere:** any user list (Pools, Admin panel, etc) shows **Admin badge** for admin users and **never shows Delete/Ban** for them (`isAdmin(userId)` hides those buttons).

**User flows (auto-pooling + password filter):**
1. *Create file (user):* Dialog asks **Select password: `dgddigital` (default) / `L0VE@12345` / `Custom…`** (flexible). `dgddigital` = pools enabled (default ON). `L0VE@12345` or any **Custom** password → pools **disabled by default** (all rows `skippedFiltered`, never enter any pool). Custom input is free-text password (no validation beyond non-empty). Shows **"Include in Pools" toggle** (default ON for dgddigital, OFF for others; user can flip). If filtered or toggle OFF, file never pools.
2. *Upload/Edit/Promote (user):* Any save → server **auto-classifies each row** into `Cookies / 2FA / Page` (or none if invalid/taken/dead/filtered). If user later edits row (adds 2FA → Cookies→2FA, green dot → Page) row **auto-moves** between pools; if account dies → auto-removed. `L0VE@12345` files never move. If user deletes a row/file while still `available`, it is **removed from pool** (dedup + available). If already `taken`, stays in `taken:global` forever.
3. *Toggle pooling after creation:* In file header, **"Include in Pools" switch** (file-level). Flipping OFF → bulk-remove all its `available` rows from pools; flipping ON → re-evaluate and bulk-add eligible rows (still blocked by `taken:global` + dup/invalid).
4. *View as user:* No Pools page. User only sees taken rows as **blue lock** (white text + whole-row cut + blue dot, locked). Long-press dot reveals "Taken on <date>". Controls file's password/toggle at creation and the Include switch.
5. *View as admin:* Pools → Pool detail: header stats, table `User | Available | Claimed | ⋯ (View file / Download)` (Admin badge, no Delete/Ban for admins). Pool-wide Download (primary). View file opens `/admin/user/:userId/file/:fileId` read-only sheet. Admin sees password for file but does not change it.
6. *Download as admin:* Admin picks `N` or All (pool-wide or per-user `⋯ → Download` → modal). Atomically claims N FIFO rows, adds to `taken:global`, marks source rows `_taken` (blue lock), generates XLSX per pool cols (`Cookies 1-col: cookies`, `2FA/Page 2-col: cookies+2fa`, file name differs), returns file. Download is primary action.
7. *Download as user (own data):* No change — existing per-file download still works. Pool download is admin-only.

**Suggested improvements (from your answers):**
- **Auto-pooling on every save** — no manual Add to Pool; row promotion (Cookies→2FA→Page) and demotion/removal (dead/invalid) are automatic on edit/Check.
- **Page = Page Check green dot (`wa_status === "eligible"`)**, not a new sheet column. So Page pool = `cookies` + `twofakey` + `wa_status === "eligible"` (you noted we already have it).
- **Download columns per pool (as you specified):** `Cookies` → **1 column** (e.g. `cookies` only); `2FA` → **2 columns** (`cookies, 2fa key`); `Page` → **2 columns** (same as 2FA, `cookies, 2fa key`) **but file name differs** (`cookies_pool.xlsx` / `2fa_pool.xlsx` / `page_pool.xlsx`). UID is implicit in cookies (`c_user`) so not separate column in exports.
- Quantity selector: stepper + presets [10, 50, 100, All] + live preview "You will claim 50 of 1,243 available".
- Claim is **atomic + idempotent**: Lua/WATCH; two admins cannot claim same row; also blocked by `taken:global`.
- Audit: `pool:<id>:ledger` (append-only claimed records) for admin export; auto-transfer of promoted rows is logged as remove+add.
- Don't delete claimed rows — hide from Available, keep in ledger and mark in source file for user visibility (blue lock).
- Server validated filters: duplicates + invalids + taken-ever + pool eligibility + dead check — all server-side.
- Rate-limit admin downloads; log `adminId + poolId + count + timestamp`.

**Data model (Redis — proposed):**
```
pool:meta              Hash  { cookies_only, cookies_2fa, page } → {name, label, badge, rule, cols}
  cookies_only: cols=[cookies]          filename=cookies_pool.xlsx (1-col)
  cookies_2fa:  cols=[cookies, twofakey] filename=2fa_pool.xlsx (2-col)
  page:         cols=[cookies, twofakey] filename=page_pool.xlsx (2-col, name differs)
password dimension: dgddigital | L0VE@12345 | custom (custom hidden in UI)
pool:<password>:<id>:available  List/Set — JSON {uid, dedupKey, cookies, twofakey, wa_status, password, srcUserId, srcFileId, srcRowIdx, addedAt}
pool:<password>:<id>:claimed    List — same + {claimedBy, claimedAt}
pool:<password>:<id>:ledger     List — audit (promotions + deletes + filtered + toggle)
pool:<password>:<id>:users      Hash  userId → {available, claimed}
pool:<password>:<id>:dedup      Set — per-pool dedup keys (per password)
taken:global:<password>         Set — dedup keys ever claimed for that password (permanent, cross-pool/user within password)
taken:pool:<password>:<id>      Set — per-pool taken mirror
files:<userId>         StoredFile[] — includes {password: string ("dgddigital" default | "L0VE@12345" | custom), poolEnabled: boolean} (default true; L0VE/custom pools into their own password namespace when enabled)
rows:<fileId>          JSON array — enriched with {_pool, _taken:boolean, _takenAt:number, wa_status} (drives blue lock + long-press popup + auto-eligibility + password guard)
```
- Enrich `rows:<fileId>` JSON rows with `_pool` + `_taken` + `_takenAt` + `wa_status` — drives pools + taken lock + Page eligibility (wa_status). No manual pool keys needed; auto-classify keeps it minimal.

**API (proposed):**
```
POST   /api/files                          body {name, type, password: string ("dgddigital" default | "L0VE@12345" | custom), poolEnabled?: boolean} → StoredFile (default dgddigital/true; Custom hidden in UI but stored; L0VE/Custom pools into own password namespace when enabled)
PUT    /api/files/:id                      body {poolEnabled?: boolean, password?: string} → toggle include / change password (triggers bulk add/remove across its password pools)
GET    /api/pools                          → list pools with totals + per-pool cols/filename (admin only, totals per password)
GET    /api/pools/:password/:poolId        → pool detail + per-user breakdown (admin only, password-scoped; e.g. /api/pools/dgddigital/cookies_only) — also supports legacy /api/pools/:poolId as alias for dgddigital
GET    /api/pools/:password/:poolId/rows   → paginated available rows ?userId=&limit=&offset= (admin only, password-scoped)
POST   /api/pools/:password/:poolId/claim  → body {count: number | "all", userId?: string}  (admin only, password-scoped) → {claimed, xlsxUrl} (1-col vs 2-col per pool type)
GET    /api/pools/:password/:poolId/ledger → admin audit log (admin only, includes auto-promotions + deletes + filtered)
GET    /api/pools/:password/:poolId/download → alias for claim+download (streams xlsx, password-scoped)
— No manual Add-to-Pool: pooling is auto on Files persist/append (server classifies each row, respects file password/poolEnabled + wa_status). Delete of row/file auto-removes from its password's pools if still available.
```
- All pool routes behind `requireAuth + requireAdmin`.
- File rows enrichment on `GET /api/files/:id/rows` & `/full` adds `_taken`/`_takenAt` for the `Taken ✓` badge — visible to the row's owner (non-admin sees only own taken state, not pool internals).

**Frontend routes + file password badge (locked):**
```
/pools                                      → redirect to /pools/dgddigital/cookies_only (default password+pool) — admin only
/pools/:password/:poolId                    → Pool detail — per-user table + quantity download (⋯ View file / Download) + password switch [dgddigital | L0VE@12345] + pool tabs [Cookies | 2FA | Page] — admin only (Custom password route exists but not linked in UI)
Create file dialog: password selector [dgddigital | L0VE@12345 | Custom…] (Custom input hidden until picked; default dgddigital; Custom not shown in Pools UI, only stored)
File card badge (My Files / Archive / Admin file list): tiny password pill next to file type badge — `dgd` (gray, var(--bg3)), `L0VE` (amber #fffbeb/#b45309), `custom:<value>` (violet var(--fb-bg)/var(--fb), truncated). Also shown in file header when opened (`Facebook 2026-09-01 • dgd`). Tooltip shows full password. Optional filter chips [All | dgd | L0VE | Custom] above grid (one-click filter).
/pools/:password/:poolId/user/:userId      → admin drilling into one user's rows in that pool (optional modal) — admin only, password-scoped
```
> Pools user list **never shows Delete/Ban for admin users**; admin users show **Admin badge** everywhere (Pools, Admin panel, Tools). Guard: `isAdmin(userId)` hides those actions.
Topbar tabs: add `Pools` between Archive and Admin. `Pools` tab is admin-only (hidden for non-admin, like Admin/Tools). Route guard redirects non-admin to `/`.

**Claim atomicity:** Lua script `CLAIM_N password poolId N [userId]` — pops N entries from `pool:<password>:<id>:available` filtered by userId if given, pushes to `claimed`, adds dedup keys to `taken:global:<password>` + `taken:pool:<password>:<id>`, updates counters, writes `_taken`/`_takenAt` onto source rows (blue lock + whole-row cut + blue dot). Returns claimed entries. Prevents double-claim. No re-entry path — even WATCH+MULTI re-add is rejected by `taken:global:<password>` check (per-password permanent).

**UI badges / row lock:** Available = default cell. Taken = **blue cell + white text + whole-row white cut (single line across row, ::after) + blue dot (white ring), pointer-events none (locked, can't edit)**. No "Taken" text in cell — long-press dot shows popup: "Taken on 2026-09-01" + existing dot info. `⋯ → View file` opens `/admin/user/:userId/file/:fileId` (same grid, not inline pool rows). Claimed rows stay in pool detail under "Claimed" tab, not in "Available".

**File grid long-press (My Files / Archive / any file cards):** long-press = enter multi-select, **must not** select/highlight file name text. Fix: `user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;` on card + name, `touch-action: manipulation`, suppress `selectstart` during hold.

### Phase 1 — Mini demo: pools overview (no backend) ⬜
- Static `pools-demo.html` / route with mocked data: 3 pool cards, totals, per-user table, taken badges. Validate UX with stakeholder.
- Done: spec signed off visually.

### Phase 2 — Backend: auto-pooling ⬜
- Redis keys (`pool:meta`, `pool:<password>:<id>:available/dedup`, `taken:global:<password>`, `rows:<fileId>` enrichment), auto-classify on `persist`/`append`/`wa_check`, dead/invalid filtering (dead auto-removed), promotion (Cookies→2FA→Page) + per-password global taken guard, **no backfill for old files** (files without `password` on create time are never pooled, as you just specified).
- No manual add/remove — **claim is the only removal** from pools (plus delete/toggle/password-filter). Old files stay outside pools entirely.
- Done: only new files (2-card password picker `dgddigital`/`L0VE@12345`) auto-pool; dead rows auto-removed; admin sees pools in `GET /api/pools/:password/:poolId`; promotion moves rows automatically.

### Phase 3 — Admin claim & download ⬜
- `POST /api/pools/:poolId/claim` (atomic Lua), XLSX gen, ledger, `_taken` marking, per-user + pool-wide quantity selector wired.
- Done: admin can download N or All; claimed rows disappear from available and show Taken badge to user; double-claim returns 0.

### Phase 4 — Polish & integrate ⬜
- Frontend pools pages (real data), Topbar nav, pagination, search, presets [10/50/100/All], audit view, empty states, tests, race-condition test.
- **UX fix (all file grids):** My Files / Archive / Pools user list long-press = multi-select file — must **not** select text (file name). Add `user-select: none; -webkit-user-select: none; touch-action: manipulation; -webkit-touch-callout: none;` on `.file-card` + name element, prevent `selectstart` during hold. Applies to My Files, Archive, and any file card list (including pool detail if file cards reused).
- Done: typecheck + `bun test` green, manual QA: contribute → admin claim → user sees Taken (blue lock + long-press dot) → admin re-claim doesn't duplicate → long-press file selects file, no text highlight.

### Phase 5 — Ship ⬜
- `redeploy.bat` (both images), verify prod isolation (test bot token only), docs.

## 5. Handoff
- **Current state (2026-09-02):** Pools implemented (services/pools.ts + routes/pools.ts). Backend test suite covers it: `test/pools-service.test.ts` (classifyRow, handleFileSave auto-pooling, promotion, taken-blocklist, per-password isolation) and `test/pools-routes.test.ts` (claim/revert over HTTP). `bun test` green. `backend/.env` has test bot token (do not use prod token).
- **Next step:** Review `pools-spec.html` in browser, confirm pool names/tiers and quantity UX, then Phase 1 demo.
- **UX sweep (2026-09-02):** papercut fixes shipped in a PR — sheet tab title shows the file name, autosave status ("Saving… / Saved / Saved offline") in the sheet toolbar, Escape while editing no longer yanks cell selection, multi-file selection resets when switching home tabs, "Give back" in Pools and "Delete dead" in the quick-edit bar now use the app's confirm dialog instead of acting instantly. Frontend verified: typecheck, lint, 43 tests, build, browser QA (stub API at localhost:3000 + vite dev). Local preview run script recorded in `.hoplite/settings.json` (port 5173).
- **Gotchas:**
  - `npx shadcn add` writes to `frontend/@/` — move to `src/` and delete `@/`.
  - Long-press on `.file-card` was selecting name text — ensure `user-select: none` + `touch-action: manipulation` + prevent selection, for My Files / Archive / any file grid (Pools user list uses `⋯` menu so not affected, but same rule if file cards appear there).
  - Colors via CSS variables only.
  - Android CI only — never build locally.
  - Existing file type is single `fb_cookie` — pools will need either new FileTypes or treat pools as orthogonal to FileType (row-level pool tag). Spec proposes orthogonal tagging (simpler, no FileType explosion).
  - `getDedupKey` currently only for `fb_cookie` by `uid`/`c_user` — reuse for pool dedup.
  - Backend tests: bun keeps one `mock.module` registry per process — two test files mocking the same module path must register an IDENTICAL factory (see `installAuthMock()`/`redis-mock.ts`), or the last registration wins and earlier files crash with missing exports.

## 6. Decisions log
| Date | Decision | Why |
|------|----------|-----|
| 2026-09-01 | Pools are row-level, not file-level | Admin needs N-of-many across users; file-level too coarse |
| 2026-09-01 | Claimed rows removed from available, not deleted | Audit + user visibility ("Taken") |
| 2026-09-01 | Orthogonal `poolId` tag on rows vs new FileTypes | Keeps FileType simple; pools can accept any row shape |
| 2026-09-01 | Lua/transaction for claim | Prevent double-claim under concurrent admin downloads |
| 2026-09-01 | Pools admin-only | Per user request — pools tab/pages gated by requireAdmin; users only see Taken badge on own rows |
| 2026-09-01 | 3 pools = Cookies Only / Cookies+2FA / Page (green dot) | User clarified: pools map to download options; progressive eligibility |
| 2026-09-01 | Per-pool dedup + invalid + eligibility filter | Prevent garbage/duplicate accounts in pools; report skip counts |
| 2026-09-01 | Taken = blue lock + global permanent blocklist | User requested: taken rows blue/white/blue-dot, locked, long-press dot shows date, never re-enter pool even after delete/re-add by any user |
| 2026-09-01 | Dead→remove, backfill existing rows, claim-only removal | 9) dead auto-removed from pools 10) rollout backfills existing rows 11) no unpool, claim is only removal |
