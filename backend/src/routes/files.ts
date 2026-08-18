// Files & data routes — ported from the old server (API contract unchanged).
import { Router } from "express";
import type { Row, StoredFile } from "../lib/shared";
import { getDedupKey, getUserFiles, updateUserFilesAtomic } from "../services/files";
import { delHistoryKeys, pruneHistory, snapshotHistory } from "../services/history";
import { delKey, getJSON, key, redis, setJSON, setJSONex } from "../services/redis";
import { migrateListKey, migrateLogKey, requireAuth, requireFileAccess } from "../middleware/auth";

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
  const seqRaw = await redis.get(key("seq:" + fileId));
  let curSeq = seqRaw ? parseInt(seqRaw, 10) : 0;
  if (isNaN(curSeq)) curSeq = 0;
  const newSeq = curSeq + 1;
  await migrateListKey(key("undo:" + fileId));
  await migrateListKey(key("redo:" + fileId));
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
  pipeline.set(key("seq:" + fileId), String(newSeq));
  pipeline.set(key("meta:dirty"), String(Date.now()));
  pipeline.del(key("crossdups:" + req.userId));
  if (body.logs !== undefined && body.logs.length >= serverLogLen) {
    const logKey = key("logs:" + fileId);
    pipeline.del(logKey);
    body.logs.forEach((l) => pipeline.rpush(logKey, JSON.stringify(l)));
  }
  if (body.undo !== undefined) {
    const undoKey = key("undo:" + fileId);
    pipeline.del(undoKey);
    body.undo.forEach((u) => pipeline.rpush(undoKey, JSON.stringify(u)));
    pipeline.ltrim(undoKey, -100, -1);
  }
  if (body.redo !== undefined) {
    const redoKey = key("redo:" + fileId);
    pipeline.del(redoKey);
    body.redo.forEach((r) => pipeline.rpush(redoKey, JSON.stringify(r)));
    pipeline.ltrim(redoKey, -100, -1);
  }
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
  res.json({ ok: true, seq: newSeq, file: persistedFile || req.file });
});

// ── Delta append (seq-versioned cell changes) ──
filesRouter.put("/:id/append", requireAuth, requireFileAccess, async (req, res) => {
  const body = req.body as {
    base: number;
    ops: { rowIdx: number; cols: Record<string, string> }[];
    newLogs?: unknown[];
    undoNew?: unknown[];
    redoNew?: unknown[];
    dataCount?: number;
    action?: string;
  };
  if (
    typeof body.base !== "number" ||
    !Array.isArray(body.ops) ||
    body.ops.some(
      (op) =>
        !Number.isInteger(op.rowIdx) ||
        op.rowIdx < 0 ||
        !op.cols ||
        typeof op.cols !== "object" ||
        Array.isArray(op.cols),
    )
  ) {
    res.status(400).json({ error: "invalid append payload" });
    return;
  }
  const fileId = req.params.id;
  let updatedFile: StoredFile | null = null;
  const logKey = key("logs:" + fileId);
  const undoKey = key("undo:" + fileId);
  const redoKey = key("redo:" + fileId);
  await migrateListKey(logKey);
  await migrateListKey(undoKey);
  await migrateListKey(redoKey);
  let curSeq = 0;
  let committed = false;
  for (let attempt = 0; attempt < 5 && !committed; attempt++) {
    await redis.watch(key("seq:" + fileId));
    const seqRaw = await redis.get(key("seq:" + fileId));
    curSeq = seqRaw ? parseInt(seqRaw, 10) : 0;
    if (isNaN(curSeq)) curSeq = 0;
    if (curSeq !== body.base) {
      await redis.unwatch();
      res.status(409).json({ error: "version conflict", serverSeq: curSeq });
      return;
    }
    let curRows = await getJSON<Row[]>("rows:" + fileId);
    if (!Array.isArray(curRows)) curRows = [];
    const rows = curRows.slice();
    for (const op of body.ops) {
      while (rows.length <= op.rowIdx) rows.push({});
      rows[op.rowIdx] = { ...(rows[op.rowIdx] || {}), ...op.cols };
    }
    if (body.action) {
      if (curRows.length === 0) {
        await snapshotHistory(fileId, body.action, rows);
      } else {
        await snapshotHistory(fileId, body.action, curRows);
      }
      void pruneHistory(fileId);
    }
    const p = redis.pipeline();
    p.set(key("rows:" + fileId), JSON.stringify(rows));
    p.set(key("seq:" + fileId), String(curSeq + 1));
    p.set(key("meta:dirty"), String(Date.now()));
    p.del(key("crossdups:" + req.userId));
    if (Array.isArray(body.newLogs)) {
      body.newLogs.forEach((l) => p.rpush(logKey, JSON.stringify(l)));
      p.ltrim(logKey, -500, -1);
    }
    if (Array.isArray(body.undoNew)) {
      body.undoNew.forEach((u) => p.rpush(undoKey, JSON.stringify(u)));
      p.ltrim(undoKey, -100, -1);
    }
    if (Array.isArray(body.redoNew)) {
      body.redoNew.forEach((r) => p.rpush(redoKey, JSON.stringify(r)));
      p.ltrim(redoKey, -100, -1);
    }
    try {
      const results = await p.exec();
      if (results !== null) committed = true;
    } catch (e) {
      console.error("[Append] pipeline error:", (e as Error).message);
      res.status(500).json({ error: "Failed to append" });
      return;
    }
  }
  if (!committed) {
    try {
      await redis.unwatch();
    } catch {
      // ignore
    }
    res.status(500).json({ error: "Failed to append" });
    return;
  }
  if (body.dataCount !== undefined) {
    updatedFile = await updateUserFilesAtomic(req.userId || "", (files) => {
      const idx = files.findIndex((f) => f.id === fileId);
      if (idx === -1) return null;
      files[idx].dataCount = body.dataCount;
      files[idx].updatedAt = Date.now();
      return files[idx];
    });
    if (updatedFile === null) {
      res.status(500).json({ error: "Failed to append" });
      return;
    }
  }
  res.json({ ok: true, seq: curSeq + 1, file: updatedFile || req.file });
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
  const undoKey = key("undo:" + id);
  const redoKey = key("redo:" + id);
  await migrateListKey(undoKey);
  await migrateListKey(redoKey);
  const pipe = redis.pipeline();
  pipe.get(key("rows:" + id));
  pipe.lrange(logKey, 0, -1);
  pipe.lrange(undoKey, 0, -1);
  pipe.lrange(redoKey, 0, -1);
  pipe.get(key("seq:" + id));
  const results = await pipe.exec();
  const val = (r: [Error | null, unknown] | null): unknown =>
    r && r[0] === null ? r[1] : null;
  let rows: Row[] = [];
  let undo: unknown[] = [];
  let redo: unknown[] = [];
  let logs: unknown[] = [];
  let seq = 0;
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
    if (Array.isArray(undoRaw)) {
      undo = undoRaw.map((l) => {
        try { return JSON.parse(String(l)); } catch { return l; }
      });
    }
    const redoRaw = val(results[3]);
    if (Array.isArray(redoRaw)) {
      redo = redoRaw.map((l) => {
        try { return JSON.parse(String(l)); } catch { return l; }
      });
    }
    const seqRaw = val(results[4]);
    if (typeof seqRaw === "string") {
      seq = parseInt(seqRaw, 10);
      if (isNaN(seq)) seq = 0;
    }
  }
  res.json({ file: req.file, rows, logs, undo, redo, seq });
});

filesRouter.get("/:id/sync", requireAuth, requireFileAccess, async (req, res) => {
  const sync = await getJSON("sync:" + req.params.id);
  res.json(sync || { enabled: false });
});

filesRouter.get("/:id/undo", requireAuth, requireFileAccess, async (req, res) => {
  const undoKey = key("undo:" + req.params.id);
  const redoKey = key("redo:" + req.params.id);
  await migrateListKey(undoKey);
  await migrateListKey(redoKey);
  const parseList = (arr: string[]): unknown[] =>
    arr.map((l) => {
      try { return JSON.parse(l); } catch { return l; }
    });
  res.json({
    undo: parseList(await redis.lrange(undoKey, 0, -1)),
    redo: parseList(await redis.lrange(redoKey, 0, -1)),
  });
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
