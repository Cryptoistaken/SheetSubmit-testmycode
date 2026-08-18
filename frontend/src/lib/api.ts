import type {
  AdminUser,
  ArchiveFile,
  CrossDupResult,
  FileType,
  HistoryResult,
  Row,
  SheetFile,
  User,
  VersionMeta,
} from "./types";

const BASE = "/api";

const pending = new Set<AbortController>();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  pending.add(controller);
  try {
    const res = await fetch(BASE + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body?.error ?? JSON.stringify(body);
      } catch {
        detail = await res.text().catch(() => "");
      }
      throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
    }
    return res.json() as Promise<T>;
  } finally {
    pending.delete(controller);
  }
}

interface PersistPayload {
  rows?: Row[];
  dataCount?: number;
  action?: string;
  logs?: unknown[];
  undo?: unknown[];
  redo?: unknown[];
  userId?: string;
}

interface VersionResult {
  v: number;
  rows: Row[];
  action: string | null;
  ts: number | null;
}

export const api = {
  cancelPending: () => {
    for (const c of pending) c.abort();
    pending.clear();
  },

  // ── Files ──
  getFiles: () => request<SheetFile[]>("/files"),
  getFile: (id: string) => request<SheetFile>(`/files/${id}`),
  createFile: (data: { id: string; name: string; type: FileType }) =>
    request<SheetFile>("/files", { method: "POST", body: JSON.stringify(data) }),
  updateFile: (id: string, data: Record<string, unknown>) =>
    request<SheetFile>(`/files/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteFile: (id: string) => request<{ ok: boolean }>(`/files/${id}`, { method: "DELETE" }),
  getRows: (id: string) => request<Row[]>(`/files/${id}/rows`),
  persist: (id: string, data: PersistPayload) =>
    request<{ ok: boolean; file?: SheetFile }>(`/files/${id}/persist`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  health: () => request<{ status: string }>("/health"),
  getArchive: () => request<ArchiveFile[]>("/archive"),
  restoreFile: (id: string) => request<{ ok: boolean }>(`/archive/${id}/restore`, { method: "POST" }),
  permanentDelete: (id: string) => request<{ ok: boolean }>(`/archive/${id}`, { method: "DELETE" }),
  batchRestore: (ids: string[]) =>
    request<{ restored: number }>("/archive/batch-restore", { method: "POST", body: JSON.stringify({ ids }) }),
  batchDelete: (ids: string[]) =>
    request<{ deleted: number }>("/archive/batch-delete", { method: "POST", body: JSON.stringify({ ids }) }),
  getSync: (id: string) => request<Record<string, unknown>>(`/files/${id}/sync`),
  setSync: (id: string, data: unknown) =>
    request<{ ok: boolean }>(`/files/${id}/sync`, { method: "PUT", body: JSON.stringify(data) }),
  updateCell: (id: string, data: { rowIdx: number; colKey: string; value?: string }) =>
    request<{ ok: boolean }>(`/files/${id}/cell`, { method: "PUT", body: JSON.stringify(data) }),
  appendLog: (id: string, data: { log?: unknown }) =>
    request<{ ok: boolean }>(`/files/${id}/log`, { method: "POST", body: JSON.stringify(data) }),
  getLogs: (id: string) => request<unknown[]>(`/files/${id}/logs`),
  getUndo: (fileId: string) => request<HistoryResult>(`/files/${fileId}/undo`),
  getCrossDups: (fileId?: string) =>
    request<CrossDupResult>(`/cross-dups${fileId ? `?fileId=${fileId}` : ""}`),
  waCheck: (cookie: string) =>
    request<{ eligible?: boolean; error?: string | null; banReason?: string | null; linkedNumber?: string | null }>("/fb/wa-check", {
      method: "POST",
      body: JSON.stringify({ cookie }),
    }),
  pageCheck: (cookie: string) =>
    request<{ eligible?: boolean; error?: string | null; banReason?: string | null; pageName?: string | null; linkedNumber?: string | null }>("/fb/page-check", {
      method: "POST",
      body: JSON.stringify({ cookie }),
    }),
  getWaCache: (uids: string[]) =>
    request<{ cache: Record<string, unknown> }>(`/wa/cache?uids=${encodeURIComponent(uids.join(","))}`),

  // ── Admin ──
  adminStats: () => request<{ totalUsers: number; totalFiles: number }>("/admin/stats"),
  adminUsers: () => request<AdminUser[]>("/admin/users"),
  adminSearchUsers: (q: string) => request<AdminUser[]>(`/admin/users/search?q=${encodeURIComponent(q)}`),
  adminUser: (userId: string) => request<AdminUser>(`/admin/user/${userId}`),
  adminUserArchive: (userId: string) => request<ArchiveFile[]>(`/admin/user/${userId}/archive`),
  adminRestoreArchived: (userId: string, fileId: string) =>
    request<{ ok: boolean }>(`/admin/user/${userId}/archive/${fileId}/restore`, { method: "POST" }),
  adminDeleteArchived: (userId: string, fileId: string) =>
    request<{ ok: boolean }>(`/admin/user/${userId}/archive/${fileId}`, { method: "DELETE" }),
  adminFile: (fileId: string) => request<SheetFile>(`/admin/file/${fileId}`),
  adminUpdateFile: (fileId: string, data: Record<string, unknown>) =>
    request<SheetFile>(`/admin/file/${fileId}`, { method: "PUT", body: JSON.stringify(data) }),
  adminDeleteFile: (fileId: string) => request<{ ok: boolean }>(`/admin/file/${fileId}`, { method: "DELETE" }),
  adminFileRows: (fileId: string) => request<Row[]>(`/admin/file/${fileId}/rows`),
  adminPersist: (fileId: string, data: PersistPayload) =>
    request<{ ok: boolean }>(`/admin/file/${fileId}/persist`, { method: "PUT", body: JSON.stringify(data) }),
  adminUpdateCell: (fileId: string, data: { rowIdx: number; colKey: string; value?: string }) =>
    request<{ ok: boolean }>(`/admin/file/${fileId}/cell`, { method: "PUT", body: JSON.stringify(data) }),
  adminAppendLog: (fileId: string, data: { log?: unknown }) =>
    request<{ ok: boolean }>(`/admin/file/${fileId}/log`, { method: "POST", body: JSON.stringify(data) }),
  adminFileLogs: (fileId: string) => request<unknown[]>(`/admin/file/${fileId}/logs`),
  adminUndo: (fileId: string) => request<HistoryResult>(`/admin/file/${fileId}/undo`),

  // ── Version history ──
  getHistory: (id: string) => request<VersionMeta[]>(`/files/${id}/history`),
  getVersion: (id: string, v: number) => request<VersionResult>(`/files/${id}/history/${v}`),
  restoreVersion: (id: string, v: number) =>
    request<{ ok: boolean; v: number; rows: Row[] }>(`/files/${id}/history/${v}/restore`, { method: "POST" }),
  adminGetHistory: (fileId: string) => request<VersionMeta[]>(`/admin/file/${fileId}/history`),
  adminGetVersion: (fileId: string, v: number) =>
    request<VersionResult>(`/admin/file/${fileId}/history/${v}`),
  adminRestoreVersion: (fileId: string, v: number) =>
    request<{ ok: boolean; v: number; rows: Row[] }>(`/admin/file/${fileId}/history/${v}/restore`, {
      method: "POST",
    }),
  nameVersion: (id: string, v: number, name: string) =>
    request<{ ok: boolean; meta: VersionMeta[] }>(`/files/${id}/history/${v}/name`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  forkVersion: (id: string, v: number) =>
    request<{ ok: boolean; file: SheetFile; rows: Row[] }>(`/files/${id}/history/${v}/fork`, {
      method: "POST",
    }),
  adminNameVersion: (fileId: string, v: number, name: string) =>
    request<{ ok: boolean; meta: VersionMeta[] }>(`/admin/file/${fileId}/history/${v}/name`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  adminForkVersion: (fileId: string, v: number) =>
    request<{ ok: boolean; file: SheetFile; rows: Row[] }>(`/admin/file/${fileId}/history/${v}/fork`, {
      method: "POST",
    }),
  adminDeleteUser: (userId: string) => request<{ ok: boolean }>(`/admin/user/${userId}`, { method: "DELETE" }),
  adminBanUser: (userId: string) => request<{ ok: boolean }>(`/admin/user/${userId}/ban`, { method: "POST" }),
  adminUnbanUser: (userId: string) => request<{ ok: boolean }>(`/admin/user/${userId}/unban`, { method: "POST" }),

  // ── Auth & bot (not in old api.js; used directly by the UI) ──
  me: () => request<User | null>("/auth/me"),
  logout: () => request<{ ok: boolean }>("/auth/logout"),
  botInfo: () => request<{ username: string }>("/bot/info"),
};
