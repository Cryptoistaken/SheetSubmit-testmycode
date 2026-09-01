# ASK.md — Pools: what we need from you (no filler)

Only questions that change data model, UX or permissions. No aesthetics/naming — locked to **Cookies / 2FA / Page (ids: cookies_only / cookies_2fa / page)**.

### 1) How do rows enter a pool? (decides add API)
- **A) Admin manual:** Admin opens any user's file → selects rows → `Add to Pool ▾` → pool. (Current plan.)
- **B) Auto on upload:** Any row that passes filters is auto-classified into the matching pool (`cookies → Cookies`, `cookies+2fa → 2FA`, `cookies+2fa+page → Page`).
- **C) Both.**  
**Need:** Pick one. If A-only, do users ever self-pool? If B, should Admin be able to move a row between pools?

### 2) Who is allowed to add to a pool?
- Current spec = **admin-only** (Pools is admin-only). Confirm: should a normal user ever see `Add to Pool` on their own file, or is pooling 100% admin-curated?

### 3) Global taken blocklist — scope? (decides Redis key + filter)
We set **global permanent**: once `uid/c_user` is claimed from *any* pool, it can never re-enter *any* pool — even if same user deletes file/row and re-uploads, or another user uploads it. Key: `taken:global` (never expires).
- Confirm: **global** is what you want? Or per-pool only (same account could re-enter a different pool)?

### 4) Page column — where does "page / green dot" live? (decides sheet columns)
Today file has `cookies / 2fa key / uid`. Page needs a flag.
- **A)** New sheet column `page` (text, empty for Cookies/2FA, `green dot`/`link` for Page). Import/export includes it.
- **B)** Derived from WA/Page Check result (green dot) — not a column, just computed.  
**Need:** A or B? If A, what header label: `page` or `page link`? If B, which WA field maps to eligible?

### 5) Download output — which columns per pool? (decides XLSX)
When admin does `Download 50 from Page`:
- **Cookies:** `uid, cookies`?
- **2FA:** `uid, cookies, 2fa key`?
- **Page:** `uid, cookies, 2fa key, page`?  
Confirm columns per pool, or always export same 4 columns (empty where not applicable)?

### 6) View file from pools — read-only or editable? (decides route + guard)
Clicking `⋯ → View file` in pools user list opens the file like ` /admin/user/:userId/file/:fileId`.
- Should that file be **read-only** for pool context, or admin can still edit/delete rows there? (Editing a taken-locked row is blocked anyway.)

### 7) Admin guard — hide delete/ban for other admins + badge everywhere? (decides UI guard)
You said: don't show delete/ban for other admin users; show **Admin badge** everywhere user list appears (Pools, Admin panel, etc).
- Confirm source is `ADMIN_IDS` env? And rule: if `user.isAdmin === true`, hide Delete/Ban actions in **all** admin user lists (Pools + Admin view), but still show Download/View.

### 8) Scale — how many users/rows per pool do you expect? (decides pagination)
- Rough max: e.g. 100 users × 500 rows vs 1000 users × 10k rows? Tells us whether to add search + pagination now or keep simple table.

---

**Reply format (copy/paste):**
```
1) A/B/C -
2) admin-only / also users -
3) global / per-pool -
4) A(page column: label?) / B(WA field?) -
5) columns per pool -
6) read-only / editable -
7) confirm ADMIN_IDS + hide for admins: yes/no -
8) approx users & rows -
```

Nothing else needed — once you answer these, Phase 1 demo → backend can start without rework.
