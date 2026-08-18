import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import DiffView from "@/components/sheet/DiffView";
import { api } from "@/lib/api";
import { useSheetStore } from "@/stores/sheetStore";
import type { VersionMeta } from "@/lib/types";

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const ACTION_LABELS: Record<string, string> = {
  edit: "Edit",
  replace: "Replace",
  append: "Append",
  merge: "Merge",
  restore: "Restore",
  check: "Check",
  sync: "Sync",
  import: "Import",
};

function fmtVersionTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    WEEK[d.getDay()] +
    " " +
    d.getDate() +
    " " +
    MONTHS[d.getMonth()] +
    " " +
    d.getFullYear() +
    ", " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
}

export default function VersionDiffPage() {
  const params = useParams();
  const navigate = useNavigate();
  const fileId = params.fileId ?? params.id;
  const versionNum = Number(params.v);
  const ownerId = params.userId;

  const file = useSheetStore((s) => s.file);
  const fileStatus = useSheetStore((s) => s.status);

  const [meta, setMeta] = useState<VersionMeta[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const isAdmin = !!ownerId;

  useEffect(() => {
    if (!fileId) return;
    if (ownerId) void useSheetStore.getState().openFileAdmin(fileId, ownerId);
    else void useSheetStore.getState().openFile(fileId);
    return () => {
      void useSheetStore.getState().closeFile();
    };
  }, [fileId, ownerId]);

  useEffect(() => {
    if (!fileId) return;
    setMeta(null);
    setLoadError(false);
    const list = ownerId ? api.adminGetHistory(fileId) : api.getHistory(fileId);
    list
      .then((m) => setMeta(m ?? []))
      .catch(() => {
        setLoadError(true);
        setMeta([]);
      });
  }, [fileId, ownerId]);

  const rec = useMemo(() => {
    if (!meta) return null;
    return meta.find((m) => m.v === versionNum) ?? null;
  }, [meta, versionNum]);

  const prev = useMemo(() => {
    if (!meta || !rec) return null;
    const idx = meta.indexOf(rec);
    return idx >= 0 && idx + 1 < meta.length ? meta[idx + 1] : null;
  }, [meta, rec]);

  const back = () =>
    navigate(
      isAdmin && ownerId ? `/admin/user/${ownerId}/file/${fileId}` : "/file/" + fileId,
    );

  if (!fileId) {
    return (
      <div className="home-pane">
        <div className="empty-state">
          <div className="empty-state-title">Could not open diff</div>
          <button className="btn btn-ghost" onClick={() => navigate("/")}>
            Back
          </button>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="home-pane">
        <div className="empty-state">
          <div className="empty-state-title">Could not load version history</div>
          <button className="btn btn-ghost" onClick={back}>
            Back
          </button>
        </div>
      </div>
    );
  }

  if (fileStatus === "error") {
    return (
      <div className="home-pane">
        <div className="empty-state">
          <div className="empty-state-title">Could not open file</div>
          <button className="btn btn-ghost" onClick={back}>
            Back
          </button>
        </div>
      </div>
    );
  }

  if (meta === null || fileStatus === "loading" || fileStatus === "idle" || !file) {
    return (
      <div className="home-pane">
        <div className="empty-state">
          <div className="empty-state-title">Loading…</div>
        </div>
      </div>
    );
  }

  if (!rec) {
    return (
      <div className="home-pane">
        <div className="empty-state">
          <div className="empty-state-title">Version not found</div>
          <button className="btn btn-ghost" onClick={back}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="vdiff-page">
      <div className="vdiff-page-head">
        <button className="btn btn-ghost btn-sm" onClick={back}>
          ← Back
        </button>
        <div className="vdiff-page-title">
          Version {rec.v}
          {rec.name ? " · " + rec.name : ""}
        </div>
        <div className="vdiff-page-sub">
          {fmtVersionTime(rec.ts)}
          <span className="vdiff-page-badge">
            {ACTION_LABELS[rec.action] ?? rec.action}
          </span>
        </div>
      </div>
      <DiffView
        fileId={fileId}
        rec={rec}
        prev={prev}
        fileName={file.name}
        typeName={file.type}
      />
    </div>
  );
}
