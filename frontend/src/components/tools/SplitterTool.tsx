import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fileTypeDef } from "@/lib/types";
import type { ColumnDef, Row, SheetFile } from "@/lib/types";
import { downloadXlsx, importXlsx, splitRows } from "@/lib/xlsx";

function SplitIcon({ n }: { n: number }) {
  const c = "currentColor";
  if (n === 2) return <svg width="22" height="14" viewBox="0 0 22 14" fill="none"><rect x="0.5" y="0.5" width="9" height="13" rx="1.5" stroke={c} strokeWidth="1.2" /><rect x="12.5" y="0.5" width="9" height="13" rx="1.5" stroke={c} strokeWidth="1.2" /></svg>;
  if (n === 3) return <svg width="24" height="14" viewBox="0 0 24 14" fill="none"><rect x="0.5" y="0.5" width="6.4" height="13" rx="1.5" stroke={c} strokeWidth="1.2" /><rect x="8.8" y="0.5" width="6.4" height="13" rx="1.5" stroke={c} strokeWidth="1.2" /><rect x="17.1" y="0.5" width="6.4" height="13" rx="1.5" stroke={c} strokeWidth="1.2" /></svg>;
  return <svg width="22" height="14" viewBox="0 0 22 14" fill="none"><rect x="0.5" y="0.5" width="9" height="5.8" rx="1.2" stroke={c} strokeWidth="1.1" /><rect x="12.5" y="0.5" width="9" height="5.8" rx="1.2" stroke={c} strokeWidth="1.1" /><rect x="0.5" y="7.7" width="9" height="5.8" rx="1.2" stroke={c} strokeWidth="1.1" /><rect x="12.5" y="7.7" width="9" height="5.8" rx="1.2" stroke={c} strokeWidth="1.1" /></svg>;
}

export default function SplitterTool() {
  const showToast = useToast();
  const navigate = useNavigate();
  const [source, setSource] = useState<"upload" | "existing">("upload");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cols, setCols] = useState<ColumnDef[] | null>(null);
  const [name, setName] = useState("");
  const [files, setFiles] = useState<SheetFile[] | null>(null);
  const [selId, setSelId] = useState("");
  const [loading, setLoading] = useState(false);
  const [n, setN] = useState(2);
  const [custom, setCustom] = useState("");
  const effectiveN = custom.trim() ? parseInt(custom, 10) : n;

  const loadFiles = useCallback(async () => {
    try { setFiles(await api.getFiles()); } catch { setFiles([]); }
  }, []);

  useEffect(() => { if (source === "existing" && files === null) loadFiles(); }, [source, files, loadFiles]);

  const handleUpload = async (f: File) => {
    setLoading(true);
    try {
      const buf = await f.arrayBuffer();
      const res = await importXlsx(buf, f.name, []);
      setRows(res.rows);
      setCols(fileTypeDef(res.type).columns);
      setName(res.name);
      showToast(`Loaded ${res.rows.length} rows`);
    } catch (e) {
      showToast((e as Error).message || "Parse failed");
      setRows(null); setCols(null); setName("");
    } finally { setLoading(false); }
  };

  const handleExisting = async (id: string) => {
    setSelId(id);
    const file = files?.find((x) => x.id === id);
    if (!file) return;
    setLoading(true);
    try {
      const r = await api.getRows(id);
      if (!r || !r.length) throw new Error("No data");
      setRows(r);
      setCols(fileTypeDef(file.type).columns);
      setName(file.name);
    } catch (e) {
      showToast((e as Error).message || "Failed to load");
      setRows(null); setCols(null);
    } finally { setLoading(false); }
  };

  const doSplit = async () => {
    if (!rows || !cols || !name) { showToast("Load a file first"); return; }
    const parts = effectiveN;
    if (!Number.isFinite(parts) || parts < 1 || parts > 100) { showToast("Pick 1-100 parts"); return; }
    if (parts === 1) { showToast("Pick at least 2"); return; }
    if (!rows.length) { showToast("Empty file"); return; }
    const clamped = Math.min(parts, rows.length);
    if (clamped !== parts) showToast(`Only ${rows.length} rows — splitting into ${clamped}`);
    const chunks = splitRows(rows, clamped);
    const base = name.replace(/\.xlsx?$/i, "");
    try {
      for (let i = 0; i < chunks.length; i++) {
        const ch = chunks[i];
        // downloadXlsx adds .xlsx, name includes part + count
        await downloadXlsx(ch, cols, `${base} - Part ${i + 1} [${ch.length}]`);
      }
      showToast(`Downloaded ${chunks.length} files`);
    } catch {
      showToast("Download failed");
    }
  };

  return (
    <div>
      <button className="btn btn-ghost" style={{ marginBottom: 16 }} onClick={() => navigate("/tools")}>← Tools</button>
      <h2 style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>Splitter</h2>
      <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 2, marginBottom: 16 }}>Split an xlsx into N equal parts</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={`btn ${source === "upload" ? "btn-primary" : ""}`} onClick={() => setSource("upload")}>Upload xlsx</button>
        <button className={`btn ${source === "existing" ? "btn-primary" : ""}`} onClick={() => setSource("existing")}>Existing file</button>
      </div>

      {source === "upload" ? (
        <label className="btn" style={{ marginBottom: 12, cursor: "pointer" }}>
          Choose file
          <input type="file" accept=".xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.currentTarget.value = ""; }} />
        </label>
      ) : (
        <select className="modal-input" style={{ maxWidth: 360, marginBottom: 12 }} value={selId} onChange={(e) => handleExisting(e.target.value)}>
          <option value="">Select file…</option>
          {(files ?? []).map((f) => <option key={f.id} value={f.id}>{f.name} ({f.dataCount ?? f.rowCount ?? "?"})</option>)}
        </select>
      )}

      {loading ? <div style={{ fontSize: 13, color: "var(--text3)" }}>Loading…</div> : null}
      {rows ? <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 12 }}>{name} — {rows.length} rows</div> : null}

      {rows && cols ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--rl)", padding: 16, background: "var(--bg)" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Split into</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            {[2, 3, 4].map((v) => (
              <button
                key={v}
                className="btn"
                aria-label={`Split into ${v}`}
                onClick={() => { setN(v); setCustom(""); }}
                style={{
                  borderColor: !custom && n === v ? "var(--blue)" : undefined,
                  background: !custom && n === v ? "var(--blue-light)" : undefined,
                  color: !custom && n === v ? "var(--blue)" : undefined,
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                <SplitIcon n={v} /> {v}
              </button>
            ))}
            <span style={{ fontSize: 12, color: "var(--text3)" }}>or</span>
            <input
              className="modal-input"
              type="number"
              min={1}
              max={100}
              placeholder="custom"
              aria-label="Custom parts"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              style={{ width: 90 }}
            />
          </div>
          <button className="btn btn-primary" onClick={doSplit}>Split &amp; download</button>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 8 }}>Files: “{name.replace(/\.xlsx?$/i, "")} - Part 1 [{rows.length ? Math.ceil(rows.length / (effectiveN || 2)) : 0}].xlsx” …</div>
        </div>
      ) : null}
    </div>
  );
}
