// Admin routes — ported from the old server (API contract unchanged).
import { Router } from "express";
import type { Row, StoredFile } from "../lib/shared";
import { createForkFile } from "../services/files";
import {
  delHistoryKeys,
  getHistoryMeta,
  histMetaKey,
  materializeVersion,
  pruneHistory,
  snapshotHistory,
} from "../services/history";
import { delKey, getJSON, key, redis, setJSON } from "../services/redis";
import {
  findAllUserIds,
  findFileAcrossUsers,
  requireAdmin,
  requireAuth,
} from "../middleware/auth";

export const adminRouter = Router();

// ── Stats ──
adminRouter.get("/stats", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const userIds = await findAllUserIds();
    const totalUsers = userIds.length;
    let totalFiles = 0;
    if (userIds.length > 0) {
      const p = redis.pipeline();
      userIds.forEach((id) => p.get(key("files:" + id)));
      const results = (await p.exec()) || [];
      results.forEach((r) => {
        if (r[1]) {
          try {
            const files = JSON.parse(r[1] as string);
            if (Array.isArray(files)) totalFiles += files.length;
          } catch {
            // ignore
          }
        }
      });
    }
    res.json({ totalUsers, totalFiles });
  } catch (e) {
    console.error("[Admin Stats] error:", (e as Error).message);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

// ── Users ──
adminRouter.get("/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const userIds = await findAllUserIds();
    console.log("[Admin Users] userIds:", JSON.stringify(userIds));
    const users: Record<string, any>[] = [];
    if (userIds.length > 0) {
      const p = redis.pipeline();
      userIds.forEach((id) => {
        p.get(key("user:" + id));
        p.get(key("files:" + id));
        p.get(key("archive:" + id));
        p.get(key("ban:" + id));
      });
      const results = (await p.exec()) || [];
      for (let i = 0; i < userIds.length; i++) {
        const userData = results[i * 4][1];
        console.log(
          "[Admin Users] id=" + userIds[i] +
          " userData=" + (userData ? "exists" : "null") +
          " filesData=" + (results[i * 4 + 1][1] ? "exists" : "null"),
        );
        if (!userData) continue;
        let user: Record<string, any>;
        try {
          user = JSON.parse(userData as string);
        } catch (e) {
          console.log("[Admin Users] parse error for", userIds[i]);
          continue;
        }
        const filesData = results[i * 4 + 1][1];
        const files = filesData ? (() => {
          try {
            return JSON.parse(filesData as string);
          } catch {
            return [];
          }
        })() : [];
        const archivedData = results[i * 4 + 2][1];
        const archived = archivedData ? (() => {
          try {
            return JSON.parse(archivedData as string);
          } catch {
            return [];
          }
        })() : [];
        const banData = results[i * 4 + 3][1];
        user.fileCount = files.length;
        user.archivedCount = archived.length;
        user.banned = !!banData;
        user.photoUrl = user.fileId ? "/api/auth/photo/" + user.id : null;
        users.push(user);
      }
    }
    users.sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0));
    console.log("[Admin Users] returning " + users.length + " users");
    res.json(users);
  } catch (e) {
    console.error("[Admin Users] error:", (e as Error).message);
    res.status(500).json({ error: "Failed to get users" });
  }
});

adminRouter.get("/users/search", requireAuth, requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || "").toLowerCase().trim();
    const userIds = await findAllUserIds();
    const users: Record<string, any>[] = [];
    if (userIds.length > 0) {
      const p = redis.pipeline();
      userIds.forEach((id) => {
        p.get(key("user:" + id));
        p.get(key("files:" + id));
        p.get(key("ban:" + id));
      });
      const results = (await p.exec()) || [];
      for (let i = 0; i < userIds.length; i++) {
        const userData = results[i * 3][1];
        if (!userData) continue;
        let user: Record<string, any>;
        try {
          user = JSON.parse(userData as string);
        } catch {
          continue;
        }
        if (q) {
          const name = ((user.firstName || "") + " " + (user.lastName || "")).toLowerCase();
          const uname = (user.username || "").toLowerCase();
          const uid = String(user.id);
          if (name.indexOf(q) === -1 && uname.indexOf(q) === -1 && uid.indexOf(q) === -1) continue;
        }
        const filesData = results[i * 3 + 1][1];
        const files = filesData ? (() => {
          try {
            return JSON.parse(filesData as string);
          } catch {
            return [];
          }
        })() : [];
        const banData = results[i * 3 + 2][1];
        user.fileCount = files.length;
        user.banned = !!banData;
        user.photoUrl = user.fileId ? "/api/auth/photo/" + user.id : null;
        users.push(user);
      }
    }
    users.sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0));
    res.json(users);
  } catch (e) {
    console.error("[Admin Search] error:", (e as Error).message);
    res.status(500).json({ error: "Failed to search users" });
  }
});

adminRouter.get("/user/:userId", requireAuth, requireAdmin, async (req, res) => {
  const user = await getJSON<Record<string, any>>("user:" + req.params.userId);
  if (!user) {
    res.status(404).json({ error: "user not found" });
    return;
  }
  const files = (await getJSON<StoredFile[]>("files:" + req.params.userId)) || [];
  const archived = (await getJSON<StoredFile[]>("archive:" + req.params.userId)) || [];
  user.photoUrl = user.fileId ? "/api/auth/photo/" + user.id : null;
  user.fileCount = files.length;
  user.archivedCount = archived.length;
  user.banned = !!(await getJSON("ban:" + req.params.userId));
  user.files = files;
  res.json(user);
});

adminRouter.get("/user/:userId/files", requireAuth, requireAdmin, async (req, res) => {
  const files = (await getJSON<StoredFile[]>("files:" + req.params.userId)) || [];
  res.json(files);
});

adminRouter.get("/user/:userId/archive", requireAuth, requireAdmin, async (req, res) => {
  const archived = (await getJSON<StoredFile[]>("archive:" + req.params.userId)) || [];
  res.json(archived);
});

adminRouter.post("/user/:userId/archive/:fileId/restore", requireAuth, requireAdmin, async (req, res) => {
  const archived = (await getJSON<StoredFile[]>("archive:" + req.params.userId)) || [];
  const idx = archived.findIndex((f) => f.id === req.params.fileId);
  if (idx === -1) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const file = archived.splice(idx, 1)[0];
  delete file.deletedAt;
  const files = (await getJSON<StoredFile[]>("files:" + req.params.userId)) || [];
  files.unshift(file);
  await setJSON("archive:" + req.params.userId, archived);
  await setJSON("files:" + req.params.userId, files);
  res.json({ ok: true });
});

adminRouter.delete("/user/:userId/archive/:fileId", requireAuth, requireAdmin, async (req, res) => {
  const archived = (await getJSON<StoredFile[]>("archive:" + req.params.userId)) || [];
  const idx = archived.findIndex((f) => f.id === req.params.fileId);
  if (idx === -1) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const file = archived.splice(idx, 1)[0];
  await setJSON("archive:" + req.params.userId, archived);
  const delPromises: Promise<unknown>[] = [];
  delPromises.push(delKey("rows:" + file.id));
  delPromises.push(delKey("undo:" + file.id));
  delPromises.push(delKey("redo:" + file.id));
  delPromises.push(delKey("sync:" + file.id));
  delPromises.push(delKey("logs:" + file.id));
  delPromises.push(delHistoryKeys(file.id));
  await Promise.all(delPromises);
  res.json({ ok: true });
});

// ── Cross-user file ops ──
adminRouter.get("/file/:fileId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const found = await findFileAcrossUsers(req.params.fileId);
    if (!found) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    res.json(found.file);
  } catch (e) {
    console.error("[Admin Get File] error:", (e as Error).message);
    res.status(500).json({ error: "Failed to get file" });
  }
});

adminRouter.put("/file/:fileId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const found = await findFileAcrossUsers(req.params.fileId);
    if (!found) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    const updates = req.body as Record<string, unknown>;
    Object.keys(updates).forEach((k) => {
      found.files[found.idx][k] = updates[k];
    });
    found.files[found.idx].updatedAt = Date.now();
    await setJSON("files:" + found.userId, found.files);
    res.json(found.files[found.idx]);
  } catch (e) {
    console.error("[Admin Update File] error:", (e as Error).message);
    res.status(500).json({ error: "Failed to update file" });
  }
});

adminRouter.delete("/file/:fileId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const found = await findFileAcrossUsers(req.params.fileId);
    if (!found) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    const file = found.files.splice(found.idx, 1)[0];
    file.deletedAt = Date.now();
    const archived = (await getJSON<StoredFile[]>("archive:" + found.userId)) || [];
    archived.unshift(file);
    await setJSON("files:" + found.userId, found.files);
    await setJSON("archive:" + found.userId, archived);
    const delPromises: Promise<unknown>[] = [];
    delPromises.push(delKey("rows:" + file.id));
    delPromises.push(delKey("undo:" + file.id));
    delPromises.push(delKey("redo:" + file.id));
    delPromises.push(delKey("sync:" + file.id));
    delPromises.push(delKey("logs:" + file.id));
    delPromises.push(delHistoryKeys(file.id));
    await Promise.all(delPromises);
    res.json({ ok: true });
  } catch (e) {
    console.error("[Admin Delete File] error:", (e as Error).message);
    res.status(500).json({ error: "Failed to delete file" });
  }
});

adminRouter.get("/file/:fileId/rows", requireAuth, requireAdmin, async (req, res) => {
  const rows = await getJSON<Row[]>("rows:" + req.params.fileId);
  res.json(rows || []);
});

adminRouter.get("/file/:fileId/undo", requireAuth, requireAdmin, async (req, res) => {
  const found = await findFileAcrossUsers(req.params.fileId);
  if (!found) {
    res.status(404).json({ error: "file not found" });
    return;
  }
  const undo = (await getJSON("undo:" + req.params.fileId)) || [];
  const redo = (await getJSON("redo:" + req.params.fileId)) || [];
  res.json({ undo, redo });
});

adminRouter.get("/file/:fileId/history", requireAuth, requireAdmin, async (req, res) => {
  try {
    const found = await findFileAcrossUsers(req.params.fileId);
    if (!found) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    const meta = await getHistoryMeta(req.params.fileId);
    console.log("[Hist] admin list file=" + req.params.fileId + " versions=" + meta.length);
    res.json(meta);
  } catch (e) {
    console.error("[Hist] admin list error file=" + req.params.fileId + ":", (e as Error).message);
    res.status(500).json({ error: "Failed to read history" });
  }
});

adminRouter.get("/file/:fileId/history/:v", requireAuth, requireAdmin, async (req, res) => {
  try {
    const found = await findFileAcrossUsers(req.params.fileId);
    if (!found) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    const v = parseInt(req.params.v, 10);
    if (isNaN(v)) {
      res.status(400).json({ error: "invalid version" });
      return;
    }
    const rows = await materializeVersion(req.params.fileId, v);
    if (rows === null) {
      res.status(404).json({ error: "version not found" });
      return;
    }
    const meta = await getHistoryMeta(req.params.fileId);
    const rec = meta.find((m) => m.v === v);
    console.log("[Hist] admin materialize file=" + req.params.fileId + " v" + v + " rows=" + rows.length);
    res.json({ v, rows, action: rec ? rec.action : null, ts: rec ? rec.ts : null });
  } catch (e) {
    console.error("[Hist] admin materialize error file=" + req.params.fileId + ":", (e as Error).message);
    res.status(500).json({ error: "Failed to read version" });
  }
});

adminRouter.post("/file/:fileId/history/:v/restore", requireAuth, requireAdmin, async (req, res) => {
  try {
    const found = await findFileAcrossUsers(req.params.fileId);
    if (!found) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    const v = parseInt(req.params.v, 10);
    if (isNaN(v)) {
      res.status(400).json({ error: "invalid version" });
      return;
    }
    const rows = await materializeVersion(req.params.fileId, v);
    if (rows === null) {
      res.status(404).json({ error: "version not found" });
      return;
    }
    const curRows = await getJSON<Row[]>("rows:" + req.params.fileId);
    await snapshotHistory(req.params.fileId, "restore", curRows || []);
    await setJSON("rows:" + req.params.fileId, rows);
    if (found.userId) {
      const files = await getJSON<StoredFile[]>("files:" + found.userId);
      if (files) {
        const idx = files.findIndex((f) => f.id === req.params.fileId);
        if (idx !== -1) {
          files[idx].updatedAt = Date.now();
          await setJSON("files:" + found.userId, files);
        }
      }
    }
    console.log("[Hist] admin restore file=" + req.params.fileId + " v" + v + " rows=" + rows.length);
    res.json({ ok: true, v, rows });
  } catch (e) {
    console.error("[Hist] admin restore error file=" + req.params.fileId + ":", (e as Error).message);
    res.status(500).json({ error: "Failed to restore version" });
  }
});

adminRouter.post("/file/:fileId/history/:v/name", requireAuth, requireAdmin, async (req, res) => {
  try {
    const found = await findFileAcrossUsers(req.params.fileId);
    if (!found) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    const v = parseInt(req.params.v, 10);
    if (isNaN(v)) {
      res.status(400).json({ error: "invalid version" });
      return;
    }
    const meta = (await getJSON<{ v: number; name: string | null }[]>(histMetaKey(req.params.fileId))) || [];
    let rec: { v: number; name: string | null } | null = null;
    for (let i = 0; i < meta.length; i++) {
      if (meta[i].v === v) {
        rec = meta[i];
        break;
      }
    }
    if (!rec) {
      res.status(404).json({ error: "version not found" });
      return;
    }
    rec.name = String((req.body as { name?: unknown }).name || "");
    await setJSON(histMetaKey(req.params.fileId), meta);
    console.log("[Hist] admin name file=" + req.params.fileId + " v" + v + " name=\"" + rec.name + "\"");
    res.json({ ok: true, meta });
  } catch (e) {
    console.error("[Hist] admin name error file=" + req.params.fileId + ":", (e as Error).message);
    res.status(500).json({ error: "Failed to name version" });
  }
});

adminRouter.post("/file/:fileId/history/:v/fork", requireAuth, requireAdmin, async (req, res) => {
  try {
    const found = await findFileAcrossUsers(req.params.fileId);
    if (!found) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    const v = parseInt(req.params.v, 10);
    if (isNaN(v)) {
      res.status(400).json({ error: "invalid version" });
      return;
    }
    const rows = await materializeVersion(req.params.fileId, v);
    if (rows === null) {
      res.status(404).json({ error: "version not found" });
      return;
    }
    const file = await createForkFile(found.file, rows, req.userId || "");
    console.log("[Hist] admin fork file=" + req.params.fileId + " v" + v + " → " + file.id + " rows=" + rows.length);
    res.json({ ok: true, file, rows });
  } catch (e) {
    console.error("[Hist] admin fork error file=" + req.params.fileId + ":", (e as Error).message);
    res.status(500).json({ error: "Failed to fork version" });
  }
});

adminRouter.put("/file/:fileId/persist", requireAuth, requireAdmin, async (req, res) => {
  const body = req.body as {
    rows?: Row[];
    action?: string;
    logs?: unknown[];
    undo?: unknown[];
    redo?: unknown[];
    dataCount?: number;
    userId?: string;
  };
  const promises: Promise<unknown>[] = [];
  if (body.rows !== undefined) {
    if (body.action) {
      const curRows = await getJSON<Row[]>("rows:" + req.params.fileId);
      if (curRows === null || curRows.length === 0) {
        await snapshotHistory(req.params.fileId, body.action, body.rows);
      } else {
        await snapshotHistory(req.params.fileId, body.action, curRows);
      }
      void pruneHistory(req.params.fileId);
    }
    promises.push(setJSON("rows:" + req.params.fileId, body.rows));
  }
  promises.push(redis.set(key("meta:dirty"), String(Date.now())));
  if (body.logs !== undefined) {
    const logKey = key("logs:" + req.params.fileId);
    const p = redis.pipeline();
    p.del(logKey);
    body.logs.forEach((l) => p.rpush(logKey, JSON.stringify(l)));
    promises.push(p.exec());
  }
  if (body.undo !== undefined) promises.push(setJSON("undo:" + req.params.fileId, body.undo));
  if (body.redo !== undefined) promises.push(setJSON("redo:" + req.params.fileId, body.redo));
  if (body.dataCount !== undefined && body.userId) {
    const files = await getJSON<StoredFile[]>("files:" + body.userId);
    if (files) {
      const idx = files.findIndex((f) => f.id === req.params.fileId);
      if (idx !== -1) {
        files[idx].dataCount = body.dataCount;
        files[idx].updatedAt = Date.now();
        promises.push(setJSON("files:" + body.userId, files));
      }
    }
  }
  try {
    await Promise.all(promises);
  } catch (e) {
    console.error("[Admin Persist] error:", (e as Error).message);
    res.status(500).json({ error: "Failed to persist" });
    return;
  }
  res.json({ ok: true });
});

adminRouter.put("/file/:fileId/cell", requireAuth, requireAdmin, async (req, res) => {
  const rows = (await getJSON<Row[]>("rows:" + req.params.fileId)) || [];
  const r = req.body as { rowIdx?: number; colKey?: string; value?: string };
  if (r.rowIdx !== undefined && r.colKey !== undefined) {
    while (rows.length <= r.rowIdx) rows.push({});
    rows[r.rowIdx][r.colKey] = r.value;
    await setJSON("rows:" + req.params.fileId, rows);
  }
  res.json({ ok: true });
});

adminRouter.post("/file/:fileId/log", requireAuth, requireAdmin, async (req, res) => {
  try {
    const logKey = key("logs:" + req.params.fileId);
    await redis.rpush(logKey, JSON.stringify((req.body as { log?: unknown }).log));
    await redis.ltrim(logKey, -500, -1);
    res.json({ ok: true });
  } catch (e) {
    console.error("[Log] Error:", (e as Error).message);
    res.status(500).json({ error: "Failed to append log" });
  }
});

adminRouter.get("/file/:fileId/logs", requireAuth, requireAdmin, async (req, res) => {
  try {
    const logKey = key("logs:" + req.params.fileId);
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

// ── User delete / update ──
adminRouter.delete("/user/:userId", requireAuth, requireAdmin, async (req, res) => {
  const user = await getJSON("user:" + req.params.userId);
  if (!user) {
    res.status(404).json({ error: "user not found" });
    return;
  }
  const files = (await getJSON<StoredFile[]>("files:" + req.params.userId)) || [];
  const archived = (await getJSON<StoredFile[]>("archive:" + req.params.userId)) || [];
  const allFiles = files.concat(archived);
  const delPromises: Promise<unknown>[] = [];
  allFiles.forEach((f) => {
    delPromises.push(delKey("rows:" + f.id));
    delPromises.push(delKey("undo:" + f.id));
    delPromises.push(delKey("redo:" + f.id));
    delPromises.push(delKey("sync:" + f.id));
    delPromises.push(delKey("logs:" + f.id));
    delPromises.push(delHistoryKeys(f.id));
  });
  delPromises.push(delKey("files:" + req.params.userId));
  delPromises.push(delKey("archive:" + req.params.userId));
  delPromises.push(delKey("user:" + req.params.userId));
  delPromises.push(redis.srem("ss:userIds", String(req.params.userId)));
  await Promise.all(delPromises);
  res.json({ ok: true });
});

adminRouter.put("/user/:userId", requireAuth, requireAdmin, async (req, res) => {
  const user = await getJSON<Record<string, any>>("user:" + req.params.userId);
  if (!user) {
    res.status(404).json({ error: "user not found" });
    return;
  }
  const updates = req.body as Record<string, unknown>;
  Object.keys(updates).forEach((k) => {
    if (k !== "id") user[k] = updates[k];
  });
  await setJSON("user:" + req.params.userId, user);
  res.json(user);
});

adminRouter.post("/user/:userId/ban", requireAuth, requireAdmin, async (req, res) => {
  const user = await getJSON("user:" + req.params.userId);
  if (!user) {
    res.status(404).json({ error: "user not found" });
    return;
  }
  await setJSON("ban:" + req.params.userId, { ts: Date.now() });
  res.json({ ok: true });
});

adminRouter.post("/user/:userId/unban", requireAuth, requireAdmin, async (req, res) => {
  const user = await getJSON("user:" + req.params.userId);
  if (!user) {
    res.status(404).json({ error: "user not found" });
    return;
  }
  await delKey("ban:" + req.params.userId);
  res.json({ ok: true });
});
