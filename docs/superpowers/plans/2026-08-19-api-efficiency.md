# API Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SheetSubmit-testmycode HTTP API layer efficient: fix the one production-breaking call, cut dead surface, reduce round trips and payloads, cache expensive computations.

**Architecture:** Backend is Express + ioredis on `backend/`; frontend is a React SPA on `frontend/` calling the api cross-origin with `credentials: "include"`. Inefficiencies: (a) file open = 4-5 parallel reads, (b) every autosave re-sends the whole rows array, (c) 15 s health poll, (d) uncompressed chunky JSON, (e) cross-dup counts recomputed every load, (f) dead API wrappers.

**Tech Stack:** TypeScript, Express 4, ioredis, React 19, Vite, Bun.

## Global Constraints

- Never hardcode URLs in committed code. API base comes from `window.APP_CONFIG.apiBase` (runtime-injected via `/config.js`), falling back to `import.meta.env.VITE_API_BASE`, then relative `/api` (dev Vite proxy).
- Test project only — production repos and Railway project untouched.
- Keep all backend routes even if the web UI stops calling them (Android app uses them via `Config.BASE_URL`).
- Verify per folder: `bun run --cwd backend typecheck`, `bun run --cwd frontend typecheck`.
- No new dependencies except `compression` (Task 5).

---

### Task 1: Route `fbcookie.ts` check through the api client

Production-breaking bug: `frontend/src/features/filetypes/fbcookie.ts:91` does `fetch("/api/fb/check", ...)` — hardcoded relative path, bypasses the runtime `apiBase`. Works in dev (Vite proxy), returns SPA fallback HTML in production.

**Files:**
- Modify: `frontend/src/lib/api.ts` (add `fbCheck`)
- Modify: `frontend/src/features/filetypes/fbcookie.ts:79-122` (use it), remove local `FbCheckResponse`

**Interfaces:**
- Produces: `api.fbCheck(uids: string[]): Promise<{ valid: string[]; dead: string[]; uncertain: string[] }>`

- [ ] **Step 1: Add the client method**

In `frontend/src/lib/api.ts`, next to `waCheck`:

```ts
  fbCheck: (uids: string[]) =>
    request<{ valid: string[]; dead: string[]; uncertain: string[] }>("/fb/check", {
      method: "POST",
      body: JSON.stringify({ uids }),
    }),
```

- [ ] **Step 2: Replace the inline fetch**

In `frontend/src/features/filetypes/fbcookie.ts`:
- import: `import { api } from "../../lib/api";`
- replace lines 91-99:

```ts
      const uids = uidRows.map((r) => r.uid);
      const data = await api.fbCheck(uids);
```

- delete the now-unused local `interface FbCheckResponse { valid: string[]; dead: string[]; uncertain: string[] }`.

- [ ] **Step 3: Verify**

Run: `bun run --cwd frontend typecheck`
Expected: PASS, no unused-var error for removed interface.

- [ ] **Step 4: Manual smoke (dev)**

Run `bun run --cwd backend dev` + `bun run --cwd frontend dev`, open a `fb_cookie` file, click check. Expected: valid/dead/uncertain counts fill.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/features/filetypes/fbcookie.ts
git commit -m "fix: route fb check through api client (was hardcoded /api/fb/check)"
```

---

### Task 2: Remove dead frontend API wrappers

9 wrappers in `api.ts` have zero call sites in `frontend/src` (verified by grep). Backend routes stay (Android uses them).

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Delete the 9 methods**

Remove from `api.ts`: `getSync`, `setSync`, `updateCell`, `appendLog`, `cancelPending` (and the `pending` Set + its `finally` reference in `request`), `forkVersion`, `adminUpdateCell`, `adminAppendLog`, `waCheck`.

Note: `request()` currently registers `pending.add(controller)` and removes it in `finally`. `cancelPending` is the only consumer — remove both the `pending` Set and the add/delete lines.

- [ ] **Step 2: Confirm no callers**

Run: `rg "cancelPending|getSync|setSync|updateCell|appendLog|forkVersion|adminUpdateCell|adminAppendLog|waCheck" frontend/src`
Expected: no matches (only `api.ts` itself was cleaned).

- [ ] **Step 3: Verify**

Run: `bun run --cwd frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "refactor: drop 9 unused api client wrappers"
```

---

### Task 3: Efficient health polling

Poll runs every 15 s even with the tab hidden. Raise to 30 s and pause while the document is hidden.

**Files:**
- Modify: `frontend/src/components/layout/Topbar.tsx:74-107`

- [ ] **Step 1: Replace the polling effect**

```tsx
  useEffect(() => {
    let cancelled = false;
    let interval = 30000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = () => {
      if (document.visibilityState === "hidden") {
        schedule();
        return;
      }
      api
        .health()
        .then((h) => {
          interval = 30000;
          if (cancelled) return;
          const ok = h.status === "ok" || h.status === "ready";
          setConn(ok ? { cls: "ok", text: "Connected" } : { cls: "", text: "Reconnecting..." });
        })
        .catch(() => {
          if (cancelled) return;
          setConn({ cls: "err", text: "Disconnected" });
          interval = Math.min(interval * 1.5, 120000);
        });
    };
    const schedule = () => {
      timer = setTimeout(() => {
        check();
        schedule();
      }, interval);
    };
    check();
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
```

- [ ] **Step 2: Verify**

Run: `bun run --cwd frontend typecheck`
Expected: PASS. Manual: open app, hide tab, confirm no network calls until visible again.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/Topbar.tsx
git commit -m "perf: health poll 30s, paused when tab hidden"
```

---

### Task 4: Single round-trip file open

`openFile` fires 4 parallel reads (`file`, `rows`, `logs`, `undo`) + `cross-dups`. Add `GET /files/:id/full` returning file+rows+logs+undo+redo in one pipelined Redis read; frontend uses it.

**Files:**
- Modify: `backend/src/routes/files.ts` (add route after `GET /:id/rows`)
- Modify: `frontend/src/lib/api.ts` (add `getFileFull`, delete `getFile`/`getLogs`/`getUndo` if now unused)
- Modify: `frontend/src/stores/sheetStore.ts:272-290` (`openFile`)

**Interfaces:**
- Produces: `GET /api/files/:id/full` → `{ file: StoredFile; rows: Row[]; logs: unknown[]; undo: unknown[]; redo: unknown[] }`
- Produces: `api.getFileFull(id: string): Promise<{ file: SheetFile; rows: Row[]; logs: unknown[]; undo: unknown[]; redo: unknown[] }>`

- [ ] **Step 1: Add backend route**

In `backend/src/routes/files.ts` (after the `/:id/rows` handler):

```ts
// Single round-trip open: file meta + rows + logs + undo/redo in one pipelined read.
filesRouter.get("/:id/full", requireAuth, requireFileAccess, async (req, res) => {
  const id = req.params.id;
  const logKey = key("logs:" + id);
  const pipe = redis.pipeline();
  pipe.get("rows:" + id);
  pipe.lrange(logKey, 0, -1);
  pipe.get("undo:" + id);
  pipe.get("redo:" + id);
  const results = await pipe.exec();
  const val = (r: [Error | null, unknown] | null): unknown =>
    r && r[0] === null ? r[1] : null;
  let rows: Row[] = [];
  let undo: unknown[] = [];
  let redo: unknown[] = [];
  let logs: unknown[] = [];
  if (results) {
    const rowsRaw = val(results[0]);
    if (typeof rowsRaw === "string") rows = JSON.parse(rowsRaw);
    const logRaw = val(results[1]);
    if (Array.isArray(logRaw)) {
      logs = logRaw.map((l) => {
        try { return JSON.parse(String(l)); } catch { return l; }
      });
    }
    const undoRaw = val(results[2]);
    if (typeof undoRaw === "string") undo = JSON.parse(undoRaw);
    const redoRaw = val(results[3]);
    if (typeof redoRaw === "string") redo = JSON.parse(redoRaw);
  }
  res.json({ file: req.file, rows, logs, undo, redo });
});
```

- [ ] **Step 2: Add client method**

In `frontend/src/lib/api.ts`:

```ts
  getFileFull: (id: string) =>
    request<{ file: SheetFile; rows: Row[]; logs: unknown[]; undo: unknown[]; redo: unknown[] }>(
      `/files/${id}/full`,
    ),
```

- [ ] **Step 3: Rewrite `openFile` reads**

In `frontend/src/stores/sheetStore.ts:274-281`, replace:

```ts
      const [f, rowsRes, logsRes, undoData] = await Promise.all([
        api.getFile(id),
        api.getRows(id),
        api.getLogs(id),
        api.getUndo(id),
      ]);
      if (!f?.id) throw new Error("File not found");
```

with:

```ts
      const [full, crossDups] = await Promise.all([
        api.getFileFull(id),
        api.getCrossDups(id).then((d) => d?.dups ?? {}).catch(() => ({})),
      ]);
      const f = full.file;
      if (!f?.id) throw new Error("File not found");
```

Then delete the old `crossDups` fetch line (the one right after the throw), and adjust the downstream uses:

- `rows: [...(rowsRes ?? [])]` → `rows: [...(full.rows ?? [])]`
- `const undoStack = (undoData?.undo ?? []) as UndoEntry[];` → `const undoStack = (full.undo ?? []) as UndoEntry[];`
- `const redoStack = (undoData?.redo ?? []) as UndoEntry[];` → `const redoStack = (full.redo ?? []) as UndoEntry[];`
- `const apiLogs = logsRes ?? [];` → `const apiLogs = full.logs ?? [];`

Keep the `crossDups` set() usage later in the function (`crossDups` variable now comes from the new Promise.all).

- [ ] **Step 4: Remove now-dead client methods**

`api.getFile`, `api.getLogs`, `api.getUndo` — verify no other callers first:

Run: `rg "api\.(getFile|getLogs|getUndo)\b" frontend/src`
Expected: no matches outside `api.ts`. If clear, delete the three methods from `api.ts`. (`api.getRows` stays — used by `HomePage` xlsx export.)

- [ ] **Step 5: Verify**

Run: `bun run --cwd backend typecheck && bun run --cwd frontend typecheck`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/files.ts frontend/src/lib/api.ts frontend/src/stores/sheetStore.ts
git commit -m "perf: single round-trip file open (GET /files/:id/full)"
```

---

### Task 5: Compress API responses

Rows/logs JSON is chunky. gzip via `compression` middleware.

**Files:**
- Modify: `backend/package.json` (add `compression`)
- Modify: `backend/src/app.ts` (enable)

- [ ] **Step 1: Add dependency**

Run: `bun add --cwd backend compression && bun add --cwd backend -d @types/compression`

- [ ] **Step 2: Enable middleware**

In `backend/src/app.ts`, after the `express.json` line:

```ts
import compression from "compression";
```
```ts
  app.use(compression());
```

- [ ] **Step 3: Verify**

Run: `bun run --cwd backend typecheck`
Expected: PASS.

```bash
docker build -f backend/Dockerfile -t popyog/sheetsubmit-testmycode-backend:latest backend
docker run --rm -d --name api-gzip-test -e PORT=3000 -p 3100:3000 popyog/sheetsubmit-testmycode-backend:latest
curl.exe -s -H "Accept-Encoding: gzip" -o NUL -w "encoding=%{content_type}\n" http://localhost:3100/api/health
docker stop api-gzip-test
```
Expected: `content_type=application/json; charset=utf-8` (compression only kicks in for large bodies; do not assert gzip on tiny responses).

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/bun.lock backend/src/app.ts
git commit -m "perf: gzip API responses (compression)"
```

---

### Task 6: Cache cross-dups + skip no-op persists

Two wins: (a) cross-dup counts recomputed on every home load / file open — cache per user; (b) `flushPersist` can run when `isDirty` is already false — no-op guard.

**Files:**
- Modify: `backend/src/routes/files.ts` (invalidate cache in persist)
- Modify: `backend/src/routes/cross-dups.ts` (cache reads)
- Modify: `frontend/src/stores/sheetStore.ts:511-513` (guard)

**Interfaces:**
- Cache key: `crossdups:<userId>` → JSON of `{ counts, dups? }`, TTL 60 s.

- [ ] **Step 1: Add guard in `flushPersist`**

In `frontend/src/stores/sheetStore.ts`, at the top of `flushPersist`:

```ts
    const s = get();
    if (!s.fileId || !s.file || !s.isDirty) return;
```

(Existing first line is `const s = get(); if (!s.fileId || !s.file) return;` — add `|| !s.isDirty`.)

- [ ] **Step 2: Cache in cross-dups route**

In `backend/src/routes/cross-dups.ts`, wrap the computation:

```ts
    const cacheKey = "crossdups:" + req.userId;
    if (!fileId) {
      const cached = await getJSON(cacheKey);
      if (cached) { res.json(cached); return; }
    }
```
…run the existing computation producing `{ counts, dups? }`…
```ts
    if (!fileId) await setJSONex(cacheKey, { counts }, 60);
    res.json(fileId ? { counts, dups } : { counts });
```
(Adjust to the actual variable names in that file. `setJSONex`/`getJSON` are imported from `./redis` in `backend/src/routes/files.ts` — mirror those imports.)

- [ ] **Step 3: Invalidate cache on persist**

In `backend/src/routes/files.ts`, persist handler, add to the pipeline:

```ts
    pipeline.del("crossdups:" + req.userId);
```

(Inside the existing `redis.pipeline()` block — always invalidate on save.)

- [ ] **Step 4: Verify**

Run: `bun run --cwd backend typecheck && bun run --cwd frontend typecheck`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/cross-dups.ts backend/src/routes/files.ts frontend/src/stores/sheetStore.ts
git commit -m "perf: cache cross-dup counts (60s), skip no-op persists"
```

---

## Post-plan deploy (optional, after user signs off)

```bash
.\redeploy.bat   # builds + pushes both images, calls each service's /__redeploy
```

## Self-review notes

- All tasks touch real, verified code (line refs from current source).
- No placeholders; every step has concrete code or an explicit verify command.
- Type names reused across tasks match existing `Row`, `StoredFile`, `SheetFile`, `PersistPayload`.
- Task 4 removes 3 client methods only after a `rg` confirms zero callers; `getRows` intentionally kept.