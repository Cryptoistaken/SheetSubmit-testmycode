// User-file helpers — ported from the old server.
import type { ColumnDef, Row, StoredFile } from "../lib/shared";
import { genFileId } from "../lib/ids";
import { getJSON, setJSON } from "./redis";

export async function getUserFiles(userId: string): Promise<StoredFile[]> {
  return (await getJSON<StoredFile[]>("files:" + userId)) || [];
}

export async function findUserFile(
  userId: string,
  fileId: string,
): Promise<{ files: StoredFile[]; idx: number; file: StoredFile | null }> {
  const files = await getUserFiles(userId);
  const idx = files.findIndex((f) => f.id === fileId);
  return { files, idx, file: idx !== -1 ? files[idx] : null };
}

// Clone rows from a materialized version into a brand-new file for the user.
// Mirrors the shape POST /api/files accepts ({id, name, type} + extras).
export async function createForkFile(
  srcFile: StoredFile | null,
  rows: Row[],
  ownerId: string,
): Promise<StoredFile> {
  const type = (srcFile && srcFile.type) || "fb_cookie";
  const newId = genFileId();
  const file: StoredFile = {
    id: newId,
    name: "Fork of " + ((srcFile && srcFile.name) || "File"),
    type,
    userId: ownerId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rowCount: Array.isArray(rows) ? rows.length : 0,
    columns: (srcFile && srcFile.columns) || null,
  };
  const files = await getUserFiles(ownerId);
  files.unshift(file);
  await setJSON("files:" + ownerId, files);
  await setJSON("rows:" + newId, rows || []);
  await setJSON("undo:" + newId, []);
  await setJSON("redo:" + newId, []);
  return file;
}

export function countDataRows(rows: Row[], columns?: ColumnDef[] | null): number {
  if (!rows || !rows.length) return 0;
  const keys = columns ? columns.map((c) => c.key) : null;
  return rows.filter((row) => {
    if (keys) return keys.some((k) => row[k]);
    return Object.values(row).some((v) => v);
  }).length;
}

// Cross-file duplicates dedup key (per file type).
export function getDedupKey(type: string, row: Row): string | null {
  if (type === "fb_cookie") {
    return row.uid || (row.cookies ? (row.cookies.match(/c_user=(\d+)/) || [])[1] : null) || null;
  }
  return null;
}
