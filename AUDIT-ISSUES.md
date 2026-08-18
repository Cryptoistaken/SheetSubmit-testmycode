# Audit Issues — Backlog for Next Session

> Status of the repo at audit time (2026-08-19). Two parallel explore subagents audited the
> backend and frontend. All findings are verified against the code with real line numbers.
> **All 40 issues were fixed on 2026-08-19 (backend BE-1..BE-21, frontend FE-1..FE-19) via 7 parallel
> fix agents; every item below is ✅. 50 tests pass (34 backend + 16 frontend), both typechecks
> clean, frontend build clean, oxlint warnings-only.** Work from the highest batch down. Update the
> `Status` column as items are resolved, and keep `PLAN.md` §5 handoff in sync. Severity:
> HIGH / MEDIUM / LOW. Effort: tiny / small / medium / large.

---

## Already shipped (do NOT re-report these)

- gzip (`compression`) on all API responses
- `/files/:id/full` single-round-trip open (file + rows + logs + undo + redo + `seq`)
- cross-dup counts cached 60 s per user, invalidated on persist
- no-op persist guard (`isDirty`)
- autosave delta: `/append` (seq-versioned cell ops) + incremental logs/undo/redo (`newLogs`/`undoNew`/`redoNew`, LIST storage, legacy-blob migration, LTRIM caps 500/100/100)
- 409 conflict → client refetches `/full`, re-applies journal (cross-device merge)
- WATCH/MULTI atomic files-list updates (`updateUserFilesAtomic`, 5 retries)
- pruneHistory aborts if oldest retained delta cannot be materialized
- admin persist = single pipeline with error check
- admin DELETE /file = true archive (data keys kept)
- session index (`ss:userSessions:<userId>`) → admin user-delete kills live sessions
- `wa:` eligibility cache scoped per user
- `meta:dirty` backup triggers on create/rename/delete/archive ops
- confirm dialogs + toasts + xlsx-import rollback
- versionCache does not cache failed fetches

## Verified non-issues (auditors checked, no action)

- No grid re-render storms — every zustand consumer uses granular selectors; GridRow/GridCell are `memo`'d
- `lucide-react` named imports are tree-shakable
- `closeFile` coverage complete (SheetPage, VersionDiffPage, BubbleMode) + `openSeq` race guard
- BubbleMode already its own Vite chunk
- persist timers safe after closeFile

---

# Backend

## HIGH

### BE-1. IDOR: client-controlled `id` on `POST /files` grants access to any other user's file data
- **File:** `backend/src/routes/files.ts:24-28` + `backend/src/middleware/auth.ts:64-72`
- **Problem:** `file.id` is taken verbatim from the client. The entry lands in the *attacker's* list, so `requireFileAccess` (id present in own list) passes, and every `/files/:id/*` route (rows, full, logs, undo, append, persist) now operates on `rows:<victimId>` / `logs:<victimId>`. File ids are guessable (timestamp+rand, visible in URLs).
- **Why it matters:** full read/write/delete of another user's file data.
- **Fix:** server-generate the id (`genFileId()`, `lib/ids.ts:3`) and ignore the client's, or reject creation when the id already exists anywhere.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### BE-2. DoS: unbounded `rowIdx` in `/append` (and `/cell`) → OOM / Redis kill
- **File:** `backend/src/routes/files.ts:157-171` (validation), `:196` (`while (rows.length <= op.rowIdx) rows.push({})`), `:345` (dead `/cell`)
- **Problem:** validation checks `Number.isInteger(op.rowIdx) && op.rowIdx >= 0` with **no upper bound**. A single request with `rowIdx: 1e9` allocates a ~1B-element array, then `JSON.stringify` + `p.set rows:` → server OOM crash and/or Redis OOM.
- **Fix:** cap `rowIdx` (e.g. 100_000) and `ops.length` in the validation block; also cap rows growth.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### BE-3. Mass assignment on `PUT /files/:id` (and admin user/file PUT)
- **File:** `backend/src/routes/files.ts:37-44`; `admin.ts:256`; `admin.ts:621-623` (only guards `id`)
- **Problem:** `Object.keys(updates).forEach(k => files[idx][k] = updates[k])` — client can set `id` (orphans data keys from the list), `userId` (mis-attribution in admin), `deletedAt` (fake-deleted while still live), `columns` (arbitrary JSON → grid/XSS surface).
- **Fix:** whitelist mutable fields (e.g. `name`, `type`, `columns`) on both routes.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### BE-4. Express 4: async handler rejections are not caught → process crash / hung responses
- **File:** `backend/package.json:15` (express ^4.18.2); `error.ts:5-8` (only catches sync throws / `next(err)`); ~20 handlers have no internal try/catch around `redis.*` calls that can reject — e.g. `files.ts:147-256` append (`redis.watch`/`redis.get` outside the try), `files.ts:265-314` /full, `files.ts:36-48` PUT, `admin.ts:582-612` user-delete `smembers`, `admin.ts:193-208` restore, `wa.ts:17-139`.
- **Problem:** a Redis blip mid-write rejects the promise → Bun/Node throws by default → crashes the whole API (Railway restart) or the request hangs with `res` never sent.
- **Fix:** wrap handlers with a small `asyncRoute` helper and add `process.on("unhandledRejection")` as a safety net.
- **Effort:** small
- **Status:** ✅ resolved (2026-08-19)

### BE-5. History snapshot version collision + retry-loop double-snapshot (data integrity)
- **File:** `backend/src/services/history.ts:123-124` (`v = meta.length ? meta[meta.length-1].v + 1 : 1`, non-atomic read), `:170` (write); `backend/src/routes/files.ts:199-205` (snapshot runs inside the WATCH/retry loop)
- **Problem:** two concurrent `/append` (same base) both compute the same `v`, both write `hist:<id>:v:<v>` + meta — last write wins, one payload clobbers the other (the loser still gets 409 but has already polluted history). Also an `exec()===null` retry re-snapshots the same version again; `snapshotHistory`'s write is outside the transaction (not rolled back).
- **Fix:** derive `v` from the seq counter (INCR, or `seq+1` inside the append MULTI) and move snapshot outside the retry loop.
- **Effort:** small-medium
- **Status:** ✅ resolved (2026-08-19)

## MEDIUM

### BE-6. TOCTOU on restore/batch-restore: `updateUserFilesAtomic` result unchecked → file lost from both lists
- **File:** `backend/src/routes/files.ts:400-406` (restore), `:427-433` (batch-restore), `admin.ts:202-207`
- **Problem:** the files-list update can return `null` after 5 WATCH conflicts, but the code still removes the file from `archive:` and returns 200 — the file reference is gone from both lists (data keys orphaned). Compare `files.ts:134-142` / `:243-254` which DO check.
- **Fix:** capture the result; on `null`, re-add to archive (or 409/500).
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### BE-7. Dead write routes bypass the seq-versioned model (reachable, unversioned RMW)
- **File:** `backend/src/routes/files.ts:336-339` PUT sync, `:341-350` PUT cell (non-atomic RMW on rows, no seq bump, no crossdups invalidation, no meta:dirty, unbounded rowIdx), `:352-363` POST log; admin twins `admin.ts:539-548` (cell), `admin.ts:550-560` (log)
- **Problem:** all frontend/Android wrappers were deleted; nothing calls them. They are the only write paths that corrupt the seq/append invariant.
- **Fix:** delete these 8 routes.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### BE-8. `void pruneHistory(fileId)` interleaves with concurrent `snapshotHistory`
- **File:** `backend/src/routes/files.ts:96`, `:205`, `admin.ts:485`; `backend/src/services/history.ts:280-341`
- **Problem:** prune reads meta (`:282`) then writes the pruned meta (`:325`) in its own transaction. If a snapshot lands between those, its meta entry is overwritten/lost — newest version unreachable from the list (blob still exists; only the fallback scan in `materializeVersion` can find it).
- **Fix:** serialize per-file (in-process mutex around snapshot+prune) or re-check meta version inside prune before writing.
- **Effort:** small
- **Status:** ✅ resolved (2026-08-19)

### BE-9. `/fb/check`: no rate limit, no uid-count cap, ~11 s sleeps between batches
- **File:** `backend/src/routes/wa.ts:17-22` (unbounded `uids`), `:30-79`, `:86-131` (loops external calls with retries + `sleep(2000)` / `sleep(11000)` between hitools batches)
- **Problem:** a large batch runs for minutes (hangs the HTTP response past any proxy timeout) and hammers third-party APIs. No rate limit anywhere on the app (append/persist/wa-check equally open).
- **Fix:** cap `uids` (e.g. 500) and batch count; add a cheap per-user in-memory rate limiter on `/fb/check`.
- **Effort:** small
- **Status:** ✅ resolved (2026-08-19)

### BE-10. `tg()` has no fetch timeout; webhook update is fire-and-forget
- **File:** `backend/src/services/telegram.ts:25`; `bot.ts:21-24`
- **Problem:** `await fetch(TG_API + "/" + method, opts)` with no `AbortSignal.timeout`. A stalled Telegram connection hangs the login path (`completeTelegramLogin`) and, via the webhook's fire-and-forget `void handleBotUpdate(...)`, leaks connections + unhandled rejection (process crash risk, see BE-4).
- **Fix:** add timeout (10-30 s); `.catch(console.error)` on webhook dispatch.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### BE-11. Backup: serial per-key round trips + overlapping runs
- **File:** `backend/src/services/backup.ts:33-82` (`copyKeys` does `type`, `ttl`, then `get`/`lrange`/`smembers`/`hgetall` per key — thousands of sequential round trips), `:167-175` (`startBackupLoop` has no in-flight guard)
- **Fix:** pipeline per scan batch; add a `running` flag to skip overlapping runs.
- **Effort:** small-medium
- **Status:** ✅ resolved (2026-08-19)

### BE-12. `ADMIN_IDS` silently falls back to two hardcoded ids
- **File:** `backend/src/config/env.ts:18-21` (default `"8447133985,1772093705"`)
- **Problem:** a misconfigured deploy (env missing) grants admin to those two Telegram accounts with no warning.
- **Fix:** no default; log loudly / fail startup when unset.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

## LOW

### BE-13. Dead read endpoints
- **Files:** `files.ts:19-21` (`GET /files/:id`), `:316-319` (`GET /files/:id/sync`), `:321-334` (`GET /files/:id/undo`), `:365-383` (`GET /files/:id/logs`), `admin.ts:183-186` (`GET /admin/user/:userId/files`), `wa.ts:262-385` (`POST /fb/wa-check`)
- **Problem:** no frontend/Android caller (wrappers deleted; wa-check never called; Android only polls `/auth/device`).
- **Fix:** delete to shrink attack surface.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### BE-14. `/cross-dups?fileId=` reads every file's rows
- **File:** `backend/src/routes/files.ts:508-541` (pipelines rows for all types), `:543-549` (filters)
- **Fix:** restrict the type loop when `fileId` given → fewer GETs.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### BE-15. Request logger prints tokens in query strings
- **File:** `backend/src/middleware/logging.ts:7` (logs `req.originalUrl`)
- **Problem:** `/api/auth/device?token=<did>` and `/api/auth/telegram?token=<login-token>` land in stdout logs.
- **Fix:** redact query values.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### BE-16. Per-request uncached ban check
- **File:** `backend/src/middleware/auth.ts:48` (`getJSON("ban:"+userId)` on every request even on cache hit)
- **Fix:** cache with short TTL; invalidate on ban/unban (`admin.ts:628-646`).
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### BE-17. `getJSON` silently swallows parse errors
- **File:** `backend/src/services/redis.ts:30-37` (returns `null` on corrupt JSON with no log)
- **Problem:** a corrupt `rows:` then gets snapshotted as empty and overwritten on next persist.
- **Fix:** log parse failures.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### BE-18. Unauthenticated photo endpoint
- **File:** `backend/src/routes/auth.ts:59-75` (serves any user's Telegram photo without auth)
- **Fix:** require auth or cache (Telegram API spam per hit).
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### BE-19. Admin console.log spam + data
- **File:** `backend/src/routes/admin.ts:57, 70-74, 108` (logs every user id/list on every `/admin/users` call)
- **Fix:** trim or move to debug level.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### BE-20. Admin persist doesn't bump `seq`
- **File:** `backend/src/routes/admin.ts:464-537` (writes rows but not `seq:`, silently desyncing the client's version counter)
- **Fix:** bump seq (and include in response).
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### BE-21. Small nits
- **Files:** `deploy.ts:21` (redeploy token compared with `!==` — use `timingSafeEqual`); `auth.ts:28-48` (login token not consumed on failed login — replayable until TTL); `auth.ts:13` (`_migratedLogKeys` set grows unbounded); `files.ts:28-31` (`POST /files` ignores `updateUserFilesAtomic` result — 200 but file not created under conflict); `files.ts:446-453, 474-483` + `admin.ts:219-227, 591-610` (batch deletes use `Promise.all` of individual `del` instead of one pipeline)
- **Status:** ✅ resolved (2026-08-19)

---

# Frontend

## HIGH

### FE-1. `xlsx` (~816KB source, ~70KB gzip) statically bundled into the main entry — biggest single win
- **File:** `frontend/src/lib/xlsx.ts:1` (`import * as XLSX from "xlsx"`), pulled by `HomePage.tsx:14`, `SheetToolbar.tsx:7`, `DownloadOverlay.tsx:3`, `AdminView.tsx:11`
- **Problem:** ~30% of the payload downloaded on every page load, only needed on upload/download/import. Confirmed in dist (`SheetNames`/`aoa_to_sheet` in main chunk).
- **Fix:** replace the static import with per-function `const XLSX = await import("xlsx")` (make the sync helpers async/Promise-returning). Vite emits a separate chunk loaded only on the interaction.
- **Effort:** small-medium
- **Status:** ✅ resolved (2026-08-19)

### FE-2. All one-page components + 75KB bones JSON eager in the main chunk
- **File:** `App.tsx:16, 62/64` (VersionDiffPage), `SheetToolbar.tsx:10-12, 446-448` (VersionHistory/DownloadOverlay/UploadOverlay), `HomePage.tsx:4-5` (AdminView/ArchiveView), `main.tsx:10` + `SheetPage.tsx:3` (bones registry `bones/sheet-grid.bones.json` 75,130 bytes + boneyard-js runtime)
- **Fix:** `lazy()` the VersionDiffPage route elements; lazy the three overlays; move the bones registry import + `Skeleton` into SheetPage via dynamic import. Combined with FE-1 removes roughly 30-40% of the main chunk.
- **Effort:** small
- **Status:** ✅ resolved (2026-08-19)

### FE-3. VersionHistory fires up to 50 parallel version-row fetches on open
- **File:** `frontend/src/components/sheet/VersionHistory.tsx:393-400` (`pageItems.forEach(... getVersionRows(...))` with `PAGE_SIZE = 50` at `:11`)
- **Fix:** cap concurrency (3-5 wide pool), or compute summaries lazily as the user scrolls/pages. (`versionCache` dedupes repeats but not the first burst.)
- **Effort:** small
- **Status:** ✅ resolved (2026-08-19)

### FE-4. VersionDiffPage downloads the entire file (rows + logs + undo + redo) to show a diff
- **File:** `frontend/src/pages/VersionDiffPage.tsx:68-75` (`openFile(fileId)` → heavy `/full`), `:81` (`getHistory`); DiffView only needs `columns` (`DiffView.tsx:146`)
- **Fix:** fetch file metadata only (or reuse version-history data); don't drive the sheet store on this route.
- **Effort:** small
- **Status:** ✅ resolved (2026-08-19)

## MEDIUM

### FE-5. AdminView double-fetches `adminStats` + `adminUsers` on every mount
- **File:** `frontend/src/components/home/AdminView.tsx:38-43` (`loadList()`), `:56-64` (deep-link effect calls `loadList()` again when `initialUserId` absent — the normal case)
- **Fix:** delete the mount effect (lines 38-43); let the `:56` effect handle both branches.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### FE-6. HomePage has no error state — a failed file/crossdup fetch renders a blank home
- **File:** `frontend/src/pages/HomePage.tsx:56-60` (`loadFiles()` no `.catch`), `:68-70` (effect)
- **Fix:** `.catch` → `setFiles([])` + toast, or an inline error/retry state.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### FE-7. Sheet grid is not keyboard-navigable (a11y)
- **File:** `frontend/src/components/sheet/SheetGrid.tsx` (cells 646-666, headers 353-362, corner, row-dot — no `tabIndex`/`role`); `SheetPage.tsx:72-107` handles Delete/Ctrl+A/Ctrl+C but no arrow-key movement
- **Fix:** `tabIndex={0}` + `role="gridcell"` on cells; arrow-key navigation in the global keydown (drive `selectRange`/`selectCellOnly`); Enter opens the editor.
- **Effort:** medium
- **Status:** ✅ resolved (2026-08-19)

### FE-8. BubbleMode 6s poll ignores tab visibility
- **File:** `frontend/src/components/bubble/BubbleMode.tsx:77-83` (`setInterval(refreshSheet, 6000)` only guarded by `isDirty`)
- **Fix:** skip when `document.visibilityState === "hidden"` (reschedule on visible).
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

## LOW

### FE-9. AdminView search has an unhandled rejection
- **File:** `frontend/src/components/home/AdminView.tsx:69-73` (`setUsers(await api.adminSearchUsers(query))` in async `setTimeout`, no try/catch)
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### FE-10. `window.confirm` used in 5 places while a proper dialog exists
- **Files:** `SheetPage.tsx:88` (Delete key), `SelectionBar.tsx:17`, `SheetToolbar.tsx:376` (Compact), `AdminView.tsx:92` + `:107` (Ban/Unban). `useConfirm()` returns a Promise and works in the keydown handler too.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### FE-11. Row status is color-only (a11y)
- **File:** `frontend/src/components/sheet/SheetGrid.tsx:576-587, 609` (row-dot encodes status purely via CSS classes `d-red/d-green/d-yellow/d-blue/d-spin`; dup state via `d-yellow`/`cell-dup`)
- **Fix:** add aria-label / title / visually-hidden text.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### FE-12. Modals lack focus traps and Escape handling
- **Files:** `confirm.tsx:35-52`, `VersionHistory.tsx:460+`, Topbar rename (354-390), HomePage rename (337-371)
- **Fix:** focus trap, `aria-modal`, Escape-to-close, focus restore on close.
- **Effort:** small
- **Status:** ✅ resolved (2026-08-19)

### FE-13. `changeJournal` grows unbounded during sustained offline/409-failure editing
- **File:** `frontend/src/stores/sheetStore.ts:512-515` (appends every commit; cleared only on successful flush `:625`)
- **Fix:** cap journal / coalesce per-row ops.
- **Effort:** small
- **Status:** ✅ resolved (2026-08-19)

### FE-14. `bubbleActiveRow` never reset across files
- **File:** `frontend/src/stores/sheetStore.ts:285-343` (openFile), `:345-390` (closeFile)
- **Fix:** reset `bubbleActiveRow` in openFile/closeFile.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### FE-15. AdminView download does 2 round-trips
- **File:** `frontend/src/components/home/AdminView.tsx:133-142` (fetches `adminFileRows` then `adminFile` just to learn `f.type`; caller at 244-320 already holds the full `SheetFile`)
- **Fix:** pass `f.type` into `downloadFile`.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### FE-16. Rename refetches global cross-dups unnecessarily
- **File:** `frontend/src/pages/HomePage.tsx:151` (`commitRename` → `loadFiles()` → `getFiles()` + `getCrossDups()`; a rename can't change dup counts)
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### FE-17. `recomputeMarks` is O(rows×cols) per edit + a `rows.slice()` clone per commit
- **File:** `frontend/src/stores/sheetStore.ts:70-110`, called from every commit/undo/redo/delete (`:523, 721, 771, 1071...`)
- **Problem:** fine at the 100-row floor; for 1k-10k-row sheets each keystroke-commit scans the whole table.
- **Fix:** for single-cell commits, recompute marks incrementally (affected row only); keep full recompute for bulk ops.
- **Effort:** medium
- **Status:** ✅ resolved (2026-08-19)

### FE-18. Dead code
- **File:** `frontend/src/hooks/useDebounce.ts` — zero callers.
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

### FE-19. ConfirmProvider single-resolver
- **File:** `frontend/src/components/ui/confirm.tsx:17-24` — two overlapping `confirm()` calls leave the first promise permanently unresolved (low risk, flows are sequential).
- **Effort:** tiny
- **Status:** ✅ resolved (2026-08-19)

---

# Suggested batching for next session

1. **Security sprint (backend):** BE-1, BE-2, BE-3, BE-4, BE-5, BE-6, BE-7, BE-10, BE-12, BE-15 (+ optional BE-13 dead routes, BE-16, BE-20).
2. **Bundle/perf (frontend):** FE-1, FE-2, FE-3, FE-4 (+ optional `manualChunks` vendor split in `vite.config.ts`).
3. **UX/a11y quick wins:** FE-5, FE-6, FE-8, FE-9, FE-10, FE-14, FE-15, FE-16, FE-18 (+ FE-7 keyboard nav, FE-12 modals, FE-11/17 as time allows).
4. **Backend leftovers:** BE-8, BE-9, BE-11, BE-14, BE-17, BE-18, BE-19, BE-21.

Baseline for measuring frontend work: main chunk `dist/assets/index-*.js` = **834.8KB min / 263.2KB gzip** (only BubbleMode split, no manualChunks).
> **After fix: main chunk 103.85KB min / 30.05KB gzip (~88% gzip reduction).** New chunks: `vendor-react` (react/react-dom/router, 279.5KB / 88.6), `xlsx` (lazy, 424.1 / 141.4), `registry` (bones, 19.6 / 3.3), `VersionDiffPage`, `AdminView`, `VersionHistory`, `ArchiveView`, `BubbleMode`, `DownloadOverlay`, `UploadOverlay`, `versionCache` — all lazy-split on first use.