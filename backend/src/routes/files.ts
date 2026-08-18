// Files & data routes — ported from the old server (API contract unchanged).
import { Router } from "express";
import type { Row, StoredFile } from "../lib/shared";
import { getDedupKey, getUserFiles, updateUserFilesAtomic } from "../services/files";
import { delHistoryKeys, pruneHistory, snapshotHistory } from "../services/history";
import { delKey, getJSON, key, redis, setJSON, setJSONex } from "../services/redis";
import { migrateLogKey, requireAuth, requireFileAccess } from "../middleware/auth";

export const filesRouter = Router();
export const archiveRouter = Router();
export const crossDupsRouter = Router();

// ── Files CRUD ──
filesRouter.get("/", requireAuth, async (req, res) => {
  const files = await getUserFiles(req.userId || "");
  res.json(files);
});

filesRouter.get("/:id", requireAuth, requireFileAccess, async (req, res) => {
  res.json(req.file);
});

filesRouter.post("/", requireAuth, async (req, res) => {
  const file = req.body as StoredFile;
  file.userId = req.userId;
  file.createdAt = Date.now();
  file.updatedAt = Date.now();
  await updateUserFilesAtomic(req.userId || "", (files) => {
    files.unshift(file);
    return files;
  });
  await redis.set(key("meta:dirty"), String(Date.now()));
  res.json(file);
});

filesRouter.put("/:id", requireAuth, requireFileAccess, async (req, res) => {
  const updates = req.body as Record<string, unknown>;
  const updated = await updateUserFilesAtomic(req.userId || "", (files) => {
    const idx = files.findIndex((f) => f.id === req.params.id);
    if (idx === -1) return null;
    Object.keys(updates).forEach((k) => { files[idx][k] = updates[k]; });
    files[idx].updatedAt = Date.now();
    return files[idx];
  });
  if (updated === null) { res.status(404).json({ error: "file not found" }); return; }
  await redis.set(key("meta:dirty"), String(Date.now()));
  res.json(updated);
});

filesRouter.delete("/:id", requireAuth, requireFileAccess, async (req, res) => {
  const removed = await updateUserFilesAtomic(req.userId || "", (files) => {
    const idx = files.findIndex((f) => f.id === req.params.id);
    if (idx === -1) return null;
    return files.splice(idx, 1)[0];
  });
  if (removed === null) { res.status(404).json({ error: "file not found" }); return; }
  removed.deletedAt = Date.now();
  const archived = (await getJSON<StoredFile[]>("archive:" + req.userId)) || [];
  archived.unshift(removed);
  await setJSON("archive:" + req.userId, archived);
  await redis.set(key("meta:dirty"), String(Date.now()));
  res.json({ ok: true });
});

// ── Batch persist ──
filesRouter.put("/:id/persist", requireAuth, requireFileAccess, async (req, res) => {
  const body = req.body as {
    rows?: Row[];
    action?: string;
    logs?: unknown[];
    undo?: unknown[];
    redo?: unknown[];
    dataCount?: number;
  };
  const fileId = req.params.id;
  let persistedFile: StoredFile | null = null;
  const serverLogLen = body.logs !== undefined ? await redis.llen(key("logs:" + fileId)) : -1;
  const pipeline = redis.pipeline();
  if (body.rows !== undefined) {
    // Snapshot the *current* rows before overwriting, only when a discrete
    // action finished (replace/append/merge/restore/check/sync/import).
    if (body.action) {
      const curRows = await getJSON<Row[]>("rows:" + fileId);
      if (curRows === null || curRows.length === 0) {
        // First action on a fresh/empty file: record the incoming data
        await snapshotHistory(fileId, body.action, body.rows);
      } else {
        await snapshotHistory(fileId, body.action, curRows);
      }
      void pruneHistory(fileId);
    }
    pipeline.set(key("rows:" + fileId), JSON.stringify(body.rows));
  }
  pipeline.set(key("meta:dirty"), String(Date.now()));
  pipeline.del(key("crossdups:" + req.userId));
  if (body.logs !== undefined && body.logs.length >= serverLogLen) {
    const logKey = key("logs:" + fileId);
    pipeline.del(logKey);
    body.logs.forEach((l) => pipeline.rpush(logKey, JSON.stringify(l)));
  }
  if (body.undo !== undefined) pipeline.set(key("undo:" + fileId), JSON.stringify(body.undo));
  if (body.redo !== undefined) pipeline.set(key("redo:" + fileId), JSON.stringify(body.redo));
  try {
    const results = await pipeline.exec(); if (!results) { console.error("[Persist] pipeline error: exec returned null"); res.status(500).json({ error: "Failed to persist data" }); return; }
    const failedCmd = results.find((r) => r[0] !== null);
    if (failedCmd) {
      console.error("[Persist] pipeline command error:", failedCmd[0]);
      res.status(500).json({ error: "Partial persist failure" });
      return;
    }
  } catch (e) {
    console.error("[Persist] pipeline error:", (e as Error).message);
    res.status(500).json({ error: "Failed to persist data" });
    return;
  }
  if (body.dataCount !== undefined) {
    persistedFile = await updateUserFilesAtomic(req.userId || "", (files) => {
      const idx = files.findIndex((f) => f.id === fileId);
      if (idx === -1) return null;
      files[idx].dataCount = body.dataCount;
      files[idx].updatedAt = Date.now();
      return files[idx];
    });
    if (persistedFile === null) { res.status(500).json({ error: "Failed to persist data" }); return; }
  }
  res.json({ ok: true, file: persistedFile || req.file });
});

// ── Rows / sync / undo / cell / logs ──
filesRouter.get("/:id/rows", requireAuth, requireFileAccess, async (req, res) => {
  const rows = await getJSON<Row[]>("rows:" + req.params.id);
  res.json(rows || []);
});

// Single round-trip open: file meta + rows + logs + undo/redo in one pipelined read.
filesRouter.get("/:id/full", requireAuth, requireFileAccess, async (req, res) => {
  const id = req.params.id;
  const logKey = key("logs:" + id);
  const pipe = redis.pipeline();
  pipe.get(key("rows:" + id));
  pipe.lrange(logKey, 0, -1);
  pipe.get(key("undo:" + id));
  pipe.get(key("redo:" + id));
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

filesRouter.get("/:id/sync", requireAuth, requireFileAccess, async (req, res) => {
  const sync = await getJSON("sync:" + req.params.id);
  res.json(sync || { enabled: false });
});

filesRouter.get("/:id/undo", requireAuth, requireFileAccess, async (req, res) => {
  const undo = (await getJSON("undo:" + req.params.id)) || [];
  const redo = (await getJSON("redo:" + req.params.id)) || [];
  res.json({ undo, redo });
});

filesRouter.put("/:id/sync", requireAuth, requireFileAccess, async (req, res) => {
  await setJSON("sync:" + req.params.id, req.body);
  res.json({ ok: true });
});

filesRouter.put("/:id/cell", requireAuth, requireFileAccess, async (req, res) => {
  const rows = (await getJSON<Row[]>("rows:" + req.params.id)) || [];
  const r = req.body as { rowIdx?: number; colKey?: string; value?: string };
  if (r.rowIdx !== undefined && r.colKey !== undefined) {
    while (rows.length <= r.rowIdx) rows.push({});
    rows[r.rowIdx][r.colKey] = r.value;
    await setJSON("rows:" + req.params.id, rows);
  }
  res.json({ ok: true });
});

filesRouter.post("/:id/log", requireAuth, requireFileAccess, async (req, res) => {
  try {
    const logKey = key("logs:" + req.params.id);
    await migrateLogKey(logKey);
    await redis.rpush(logKey, JSON.stringify((req.body as { log?: unknown }).log));
    await redis.ltrim(logKey, -500, -1);
    res.json({ ok: true });
  } catch (e) {
    console.error("[Log] Error:", (e as Error).message);
    res.status(500).json({ error: "Failed to append log" });
  }
});

filesRouter.get("/:id/logs", requireAuth, requireFileAccess, async (req, res) => {
  try {
    const logKey = key("logs:" + req.params.id);
    await migrateLogKey(logKey);
    const logs = await redis.lrange(logKey, 0, -1);
    const parsed: unknown[] = [];
    logs.forEach((l) => {
      try {
        parsed.push(JSON.parse(l));
      } catch {
        // skip malformed entries
      }
    });
    res.json(parsed);
  } catch (e) {
    console.error("[Logs] Error:", (e as Error).message);
    res.status(500).json({ error: "Failed to read logs" });
  }
});

// ── Archive ──
archiveRouter.get("/", requireAuth, async (req, res) => {
  const archived = (await getJSON<StoredFile[]>("archive:" + req.userId)) || [];
  res.json(archived);
});

archiveRouter.post("/:id/restore", requireAuth, async (req, res) => {
  const archived = (await getJSON<StoredFile[]>("archive:" + req.userId)) || [];
  const idx = archived.findIndex((f) => f.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const file = archived.splice(idx, 1)[0];
  delete file.deletedAt;
  await updateUserFilesAtomic(req.userId || "", (files) => {
    files.unshift(file);
    return files;
  });
  await setJSON("archive:" + req.userId, archived);
  await redis.set(key("meta:dirty"), String(Date.now()));
  res.json({ ok: true });
});

archiveRouter.post("/batch-restore", requireAuth, async (req, res) => {
  const ids = (req.body as { ids?: string[] }).ids;
  if (!ids || !ids.length) {
    res.status(400).json({ error: "no ids" });
    return;
  }
  let archived = (await getJSON<StoredFile[]>("archive:" + req.userId)) || [];
  const restoredFiles: StoredFile[] = [];
  let restored = 0;
  archived = archived.filter((f) => {
    if (ids.indexOf(f.id) !== -1) {
      delete f.deletedAt;
      restoredFiles.unshift(f);
      restored++;
      return false;
    }
    return true;
  });
  await updateUserFilesAtomic(req.userId || "", (files) => {
    restoredFiles.forEach((f) => files.unshift(f));
    return files;
  });
  await setJSON("archive:" + req.userId, archived);
  await redis.set(key("meta:dirty"), String(Date.now()));
  res.json({ restored });
});

archiveRouter.delete("/:id", requireAuth, async (req, res) => {
  let archived = (await getJSON<StoredFile[]>("archive:" + req.userId)) || [];
  const existed = archived.some((f) => f.id === req.params.id);
  if (!existed) {
    res.status(404).json({ error: "not found" });
    return;
  }
  archived = archived.filter((f) => f.id !== req.params.id);
  await setJSON("archive:" + req.userId, archived);
  await redis.set(key("meta:dirty"), String(Date.now()));
  const delPromises: Promise<unknown>[] = [];
  delPromises.push(delKey("rows:" + req.params.id));
  delPromises.push(delKey("undo:" + req.params.id));
  delPromises.push(delKey("redo:" + req.params.id));
  delPromises.push(delKey("sync:" + req.params.id));
  delPromises.push(delKey("logs:" + req.params.id));
  delPromises.push(delHistoryKeys(req.params.id));
  await Promise.all(delPromises);
  res.json({ ok: true });
});

archiveRouter.post("/batch-delete", requireAuth, async (req, res) => {
  const ids = (req.body as { ids?: string[] }).ids;
  if (!ids || !ids.length) {
    res.status(400).json({ error: "no ids" });
    return;
  }
  let archived = (await getJSON<StoredFile[]>("archive:" + req.userId)) || [];
  const idSet: Record<string, boolean> = {};
  ids.forEach((id) => {
    idSet[id] = true;
  });
  // Security fix (kept from old server): only delete data keys for files that
  // actually exist in this user's archive (IDOR protection).
  const ownedIds = archived.filter((f) => idSet[f.id]).map((f) => f.id);
  archived = archived.filter((f) => !idSet[f.id]);
  await setJSON("archive:" + req.userId, archived);
  await redis.set(key("meta:dirty"), String(Date.now()));
  const delPromises: Promise<unknown>[] = [];
  ownedIds.forEach((id) => {
    delPromises.push(delKey("rows:" + id));
    delPromises.push(delKey("undo:" + id));
    delPromises.push(delKey("redo:" + id));
    delPromises.push(delKey("sync:" + id));
    delPromises.push(delKey("logs:" + id));
    delPromises.push(delHistoryKeys(id));
  });
  await Promise.all(delPromises);
  res.json({ deleted: ownedIds.length });
});

// ── Cross-file duplicates ──
crossDupsRouter.get("/", requireAuth, async (req, res) => {
  try {
    const fileId = req.query.fileId ? String(req.query.fileId) : null;
    const cacheKey = "crossdups:" + req.userId;
    if (!fileId) {
      const cached = await getJSON(cacheKey);
      if (cached) { res.json(cached); return; }
    }
    const files = await getUserFiles(req.userId || "");
    const typeFiles: Record<string, StoredFile[]> = {};
    files.forEach((f) => {
      if (!typeFiles[f.type]) typeFiles[f.type] = [];
      typeFiles[f.type].push(f);
    });
    const allDups: Record<string, { fileId: string; fileName: string; rowIdx: number }[]> = {};
    const counts: Record<string, number> = {};
    files.forEach((f) => {
      counts[f.id] = 0;
    });

    for (const typeKey in typeFiles) {
      const tf = typeFiles[typeKey];
      if (tf.length < 2) continue;
      const p = redis.pipeline();
      tf.forEach((f) => p.get(key("rows:" + f.id)));
      const results = (await p.exec()) || [];
      const uidMap: Record<string, { fileId: string; fileName: string; rowIdx: number }[]> = {};
      tf.forEach((f, i) => {
        let rows: Row[] = [];
        try {
          rows = (JSON.parse(results[i][1] as string) as Row[]) || [];
        } catch {
          // ignore unparseable rows
        }
        rows.forEach((row, ri) => {
          const dk = getDedupKey(typeKey, row);
          if (!dk) return;
          if (!uidMap[dk]) uidMap[dk] = [];
          uidMap[dk].push({ fileId: f.id, fileName: f.name, rowIdx: ri });
        });
      });
      for (const uid in uidMap) {
        if (uidMap[uid].length > 1) {
          allDups[uid] = uidMap[uid];
          const seen: Record<string, boolean> = {};
          uidMap[uid].forEach((e) => {
            if (!seen[e.fileId]) {
              seen[e.fileId] = true;
              counts[e.fileId]++;
            }
          });
        }
      }
    }

    if (fileId) {
      const filtered: Record<string, { fileId: string; fileName: string; rowIdx: number }[]> = {};
      for (const uid in allDups) {
        const affected = allDups[uid].filter((e) => e.fileId === fileId);
        if (affected.length > 0) filtered[uid] = allDups[uid];
      }
      res.json({ counts, dups: filtered });
    } else {
      await setJSONex(cacheKey, { counts }, 60000);
      res.json({ counts });
    }
  } catch (e) {
    console.error("[CrossDups] error:", (e as Error).message);
    res.status(500).json({ error: "Failed to check cross-file duplicates" });
  }
});
