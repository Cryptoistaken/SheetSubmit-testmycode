# Analysis — SheetSubmit-testmycode

> Generated 2026-09-02 from 5 parallel subagent reviews. Scale: ~5-10 users now, max ~100 users, 5-10 files, 100 rows/file — no hard cap needed, so O(N) scans not critical.

## Summary
Pools feature largely works. Critical blockers are data-loss on `promoteRow` and claim/revert atomicity, plus 3 server privilege gaps. UI fixes for admin badge, pool-switch and search placement already shipped. Download flow now uses server blob + history + revert.

## Pools Backend (services/pools.ts, routes/pools.ts)
- **Critical** `services/pools.ts:185-216` `promoteRow` removes source before `isDup(next)` — if target has dup, row vanishes from all pools. Fix: check `isDup` before `removeFromPool`.
- **Critical** claim not atomic beyond `availKey` (`routes/pools.ts:35-62` `WATCH availKey` only, `63-104` rows `_taken` outside `MULTI`) → crash after `EXEC` leaves `taken`/`claimed` set but `rows:_taken` not marked. Add `WATCH` on `taken:global`/`dedup`/`users` or move row marking into same `MULTI` pipeline with rollback.
- **Critical** revert `routes/pools.ts:394-464` not atomic: two `POST /downloads/:id/revert` pass `reverted==="1"` guard, both push `rawSlice` back → double `available`, double `HINCRBY users`. Add `WATCH pool:download:<id>` + `HSETNX` guard + `MULTI` retry.
- `services/pools.ts:99-133` `h len` users not decremented on remove (`void h`), rebuild without `WATCH` → counts drift.
- `services/pools.ts:42` `isInvalidRow` counts `_*` fields → after claim empty-cookie row appears valid. Exclude `key.startsWith("_")`.
- `services/pools.ts:63,147,200,266` `wa_status` vs `waStatus` inconsistent → Page promotion via `waStatus` ignored. Normalize to `wa_status`.
- `services/pools.ts:22` `pwdOf` returns untrimmed password → `" dgddigital "` creates distinct `pool: dgddigital :` key. Trim + sanitize `[^a-zA-Z0-9_-]` and reject `:`/`*`.
- `routes/pools.ts:106` download record `rows` unbounded — add `slice(0,1000)` guard. `routes/pools.ts:354` `GET /downloads` parses full `rows` JSON per record — heavy; return `rowsCount` only, fetch `?format=json` on demand.
- `routes/pools.ts:18,143` `password` not allow-listed — `/:password/:poolId` with `password=../` creates arbitrary keys. Allow-list `dgddigital|L0VE@12345` + `/^[a-zA-Z0-9_-]{1,64}$/` for custom.
- `services/pools.ts:35-62` `hincrby users -1` can go negative on concurrent claim — guard `WATCH users`.
- `services/pools.ts:80-90` `isDup/isTaken` swallow Redis errors → fallback `includes` returns false → dup resurrect. Throw instead.

## Frontend UI (PoolsView, AdminView, SheetGrid)
- Badge: `PoolsView.tsx:286` `admin-wrap` vs `AdminView.tsx:506` `admin-user-avatar-wrap` vs `pool.html:133` `avatar-wrap` — fragmented. Uses inline `AdminView.tsx:235` dot vs global `app.css:986` — unify to single `.admin-wrap`/`.admin-dot` class.
- `PoolsView.tsx:287` img no `onError` fallback (broken photo collapses wrap).
- `AdminView.tsx:255` gate hides Ban/Delete for admins but also hides `Unban` for banned admin — banned admin cannot be unbanned via UI.
- Pool switch: `PoolsView.tsx:188` inline duplicate of `app.css:1082`, hardcoded pastel `#eef2ff` breaks dark mode; `PoolsView.tsx:198` media query targets `.pools-switch` (with s) but DOM uses `pool-switch` → mobile stack never applies.
- `AdminView.tsx:277` Files|Archive `pool-switch` now global — ok, but missing `aria-pressed`.
- Search: `PoolsView.tsx:244` now top-of-list right-aligned (separate from download), `AdminView.tsx:462` right-aligned with `N users` left — per your ask (pool before-download left, admin after-download right). Both `width:240 maxWidth:48vw` may overlap at 320px.
- Custom qty `PoolsView.tsx:252,356` `placeholder={focused?"":"Custom"}` + `onFocus select` correct; `width:72` not flex on mobile → misaligned with `.pools-qty{width:100%}`. `inputMode` missing, `0` shows `Download 0`.
- Download: `PoolsView.tsx:28-47` `triggerBlobDownload` missing `reader.onerror`, `1000ms revoke` may abort; fallback `XLSX.writeFile` diverges from blob path.
- History `PoolsView.tsx:335` `td{display:flex}` invalid on `td` — use inner div.
- `PoolsView.tsx:299` `⋯` menu no `aria-label`, no outside-click/Escape close.

## Security / Auth
- **High** `admin.ts:569,620,605` admin-on-admin delete/ban/update only checks self — `if(isAdmin(targetId)) 403` needed.
- **High** `admin.ts:470` `PUT /admin/file/:id/persist` IDOR via `body.userId` attacker-controlled — add `findFileAcrossUsers` lookup.
- `middleware/auth.ts:142` `findAllUserIds` + `findFileAcrossUsers` O(N*M) scan each admin file request — ok at 100 users, add rate-limit.
- `routes/pools.ts:109,338,391` filename `Content-Disposition` injection via raw `password` — sanitize `[^a-zA-Z0-9_-]`.
- `middleware/auth.ts:22` `cookie.match(/session=([^;]+)/)` fragile — split `;` + trim `session=` prefix.
- `middleware/auth.ts:12` `BAN_CACHE_TTL 15s` + `SESSION_CACHE_TTL 5m` lets newly banned retain 15s.
- `config/env.ts:19` fallback `ADMIN_IDS="8447133985,1772093705"` hardcoded — warn only, silent if env missing.
- `app.ts:33` CORS `origin===FRONTEND_URL` strict — preview domains fail (proxy makes it dead code).
- `AuthContext.tsx:14` `localStorage ss_auth_user` persists `isAdmin` — revoked admin sees UI for ~4.5s until server blocks.

## Deployment / Infra
- `scripts/redeploy.ts:73` `isShared` matches any `frontend/package.json` suffix → triggers both images — should be root only.
- `scripts/redeploy.ts:78` `onlyDocs` treats `scripts/redeploy.ts` as docs → `exit 0` skips build on code change.
- `scripts/redeploy.ts:65` clean tree builds both — should be no-op unless `--all`.
- `redeploy.bat:22` `for /f %%a in ("deploy.env")` mishandles `#` comments/quotes vs `redeploy.ts:19` correct.
- `deploy.env.example` deleted (D) — template lost.
- `backend/bun.lock` modified (xlsx) not committed — `frontend/Dockerfile:9` layer stale (10 days) — next `--frozen-lockfile` from clean checkout will fail until committed.
- `frontend/server.js` vs docs (`AGENTS.md:15`/`PLAN.md:24` claim `VITE_API_BASE` via `/config.js`, code sets `apiBase:""` and proxies `/api`) — docs stale.

## File / Pool Edge
- `HomePage.tsx:258,263,291` picker hardcodes `poolEnabled:true` for `L0VE/Custom` — spec says `false` unless toggle. Backend `files.ts:34` is correct, frontend defeats it.
- `app.css:1520` taken row blue lock correctly `left:36 right:36` cut, `Sheets:691` `pointerEvents:"none"` blocks edit — ok, but `SheetGrid.tsx:718` `styles?.color` can override white 72%.
- `FileCard.tsx:95` badge `password===undefined` fallback `dgd` shows pooled badge though `skippedFiltered` — cosmetic.
- `routes/files.ts:440` archive permanent delete never calls `removeFileRowsFromPools` → orphan `available` leak; `440-468` batch-delete same.

## Recommendations (next)
1. Fix `promoteRow` dup check before remove + move `_taken` marking into `MULTI` or add compensation on failure.
2. Add server guards: admin-on-admin block, `persist` `findFileAcrossUsers`, filename sanitization, `password` allow-list.
3. Make revert `WATCH` atomic + `HSETNX` guard.
4. Commit `backend/bun.lock` + restore `deploy.env.example` + fix `redeploy.ts` `isShared`/`onlyDocs` + `redeploy.bat` parsing.
5. Optional `poolEnabled` toggle in picker for `L0VE/Custom` (or at least set `L0VE=>false`).
6. Update `PLAN.md` handoff + `AGENTS.md` monorepo docs.

> All findings are non-blocking at 5-10 users; prior critical data-loss on promotion/revert should be patched before next pool-heavy usage.
