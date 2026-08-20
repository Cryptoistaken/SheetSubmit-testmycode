/** File types supported by the app. */
export type FileType = "fb_cookie";

export interface ColumnDef {
  key: string;
  label: string;
  width: number;
}

export interface FileTypeDef {
  key: FileType;
  label: string;
  badge: string;
  icon: string;
  desc: string;
  columns: ColumnDef[];
}

export interface SheetFile {
  id: string;
  name: string;
  type: FileType;
  rowCount?: number;
  dataCount?: number;
  createdAt?: number;
  updatedAt?: number;
  deletedAt?: number;
}

/** A grid row — cookie cells are plain string keys. */
export type Row = Record<string, string | null | undefined>;

export const FILE_TYPE_DEFS: Record<FileType, FileTypeDef> = {
  fb_cookie: {
    key: "fb_cookie",
    label: "Facebook",
    badge: "Facebook",
    icon: "FB",
    desc: "cookies, 2fa key & uid",
    columns: [
      { key: "cookies", label: "cookies", width: 340 },
      { key: "twofakey", label: "2fa key", width: 200 },
      { key: "uid", label: "uid", width: 120 },
    ],
  },
};

/** Safe FILE_TYPE_DEFS lookup — falls back to fb_cookie for missing/unknown
 * types (e.g. files created by older builds or direct API calls). */
export function fileTypeDef(type?: string): FileTypeDef {
  const t = type as FileType;
  return (type && t in FILE_TYPE_DEFS ? FILE_TYPE_DEFS[t] : FILE_TYPE_DEFS.fb_cookie);
}

/** Authenticated Telegram user. */
export interface User {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  photoUrl?: string | null;
  isAdmin?: boolean;
  fileId?: string | null;
  lastLogin?: number;
  fileCount?: number;
  archivedCount?: number;
  files?: SheetFile[];
}

export interface CrossDupEntry {
  fileId: string;
  fileName: string;
  rowIdx: number;
}

export interface CrossDupResult {
  counts: Record<string, number>;
  dups?: Record<string, CrossDupEntry[]>;
}

export type ArchiveFile = SheetFile & { deletedAt?: number };

export interface VersionMeta {
  v: number;
  ts: number;
  action: string;
  name?: string | null;
  rowCount?: number;
  parentV?: number | null;
  type?: string;
  hash?: string;
}

export interface WaCacheEntry {
  status: string | null;
  banReason: string | null;
  error: string | null;
  pageName?: string | null;
  linkedNumber?: string | null;
  ts: number | null;
}

export interface HistoryResult {
  undo: unknown[];
  redo: unknown[];
}

export type AdminUser = User & {
  fileCount: number;
  archivedCount: number;
  banned?: boolean;
};
