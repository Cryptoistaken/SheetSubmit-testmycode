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

// Base URL of the backend API. The static server injects it at container start via
// /config.js (window.APP_CONFIG.apiBase ← VITE_API_BASE env var on the web service),
// so no URL is baked into the build. Falls back to a build-time VITE_API_BASE (for
// anyone building manually), then to relative /api (local dev → vite proxy).
const RUNTIME_BASE = (window.APP_CONFIG?.apiBase ?? import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");
// Runtime config injected by the static server via /config.js (see server.js).
declare global {
  interface Window {
    APP_CONFIG?: { apiBase?: string };
  }
}

const BASE = RUNTIME_BASE + "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const res = await fetch(BASE + path, {
    ...init,
    credentials: "include",
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
  getLogs: (id: string) => request<unknown[]>(`/files/${id}/logs`),
  getUndo: (fileId: string) => request<HistoryResult>(`/files/${fileId}/undo`),
  getCrossDups: (fileId?: string) =>
    request<CrossDupResult>(`/cross-dups${fileId ? `?fileId=${fileId}` : ""}`),
  pageCheck: (cookie: string) =>
    request<{ eligible?: boolean; error?: string | null; banReason?: string | null; pageName?: string | null; linkedNumber?: string | null }>("/fb/page-check", {
      method: "POST",
      body: JSON.stringify({ cookie }),
    }),
  fbCheck: (uids: string[]) =>
    request<{ valid: string[]; dead: string[]; uncertain: string[] }>("/fb/check", {
      method: "POST",
      body: JSON.stringify({ uids }),
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
