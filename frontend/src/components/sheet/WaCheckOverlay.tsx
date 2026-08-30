import { useMemo, useState } from "react";
import { useSheetStore } from "@/stores/sheetStore";
import { useToast } from "@/lib/toast";

export default function WaCheckOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows = useSheetStore((s) => s.rows);
  const showToast = useToast();
  const [custom, setCustom] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);

  const pageCount = useMemo(() => rows.filter((r) => r.wa_status === "eligible").length, [rows]);
  const noPageCount = useMemo(() => rows.filter((r) => r.status === "good" && r.wa_status !== "eligible" && !!r.cookies && /c_user=\d+/.test(r.cookies)).length, [rows]);

  const handleClose = () => { setCustom(false); setSel(new Set()); onClose(); };

  if (!open) return null;

  const run = async (filter: (row: Record<string, unknown>, idx: number) => boolean, emptyMsg: string) => {
    if (running) return;
    setRunning(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await useSheetStore.getState().runWaChecksFiltered(filter as any);
      showToast(emptyMsg);
    } catch {
      showToast("WA Check failed");
    } finally {
      setRunning(false);
      handleClose();
    }
  };

  const toggle = (idx: number) => setSel((p) => { const s = new Set(p); s.has(idx) ? s.delete(idx) : s.add(idx); return s; });

  return (
    <div className="download-opt-overlay" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="download-opt-box" style={{ width: custom ? 300 : 220 }}>
        <div className="download-opt-title">WA Check</div>
        {!custom ? (
          <>
            <button className="download-opt-btn btn-blue" disabled={running} onClick={() => void run((r) => (r as Record<string,string>).wa_status === "eligible", pageCount ? "Checking Page..." : "No Page rows")}>Page <span className="opt-count">{pageCount}</span></button>
            <button className="download-opt-btn btn-amber" disabled={running} onClick={() => void run((r) => (r as Record<string,string>).status === "good" && (r as Record<string,string>).wa_status !== "eligible" && !!(r as Record<string,string>).cookies, noPageCount ? "Checking No Page..." : "No rows")}>No Page <span className="opt-count">{noPageCount}</span></button>
            <button className="download-opt-btn primary" onClick={() => setCustom(true)}>Custom <span className="opt-count">{rows.filter((r) => !!r.cookies && /c_user=\d+/.test(r.cookies)).length}</span></button>
            <button className="download-opt-cancel" onClick={handleClose}>Cancel</button>
          </>
        ) : (
          <>
            <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 6 }}>
              {rows.slice(0, 200).map((r, idx) => {
                if (!r.cookies || !/c_user=\d+/.test(r.cookies)) return null;
                const checked = sel.has(idx);
                const uid = (r.uid as string) || (r.cookies.match(/c_user=(\d+)/)?.[1] ?? "") || "";
                const dot = r.wa_status === "eligible" ? "var(--green)" : r.wa_status === "ineligible" ? "var(--text3)" : r.status === "good" ? "var(--cyan)" : "var(--border2)";
                return (
                  <div key={idx} onClick={() => toggle(idx)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: "var(--r)", cursor: "pointer", background: checked ? "var(--blue-light)" : "transparent", border: checked ? "1px solid var(--blue)" : "1px solid transparent" }}>
                    <span style={{ width: 14, height: 14, borderRadius: 3, border: "1.5px solid " + (checked ? "var(--blue)" : "var(--border2)"), background: checked ? "var(--blue)" : "var(--bg)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10 }}>{checked ? "✓" : ""}</span>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontFamily: "var(--mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{uid ? uid.slice(-8) : r.cookies.slice(-12)} #{idx + 1}</span>
                  </div>
                );
              })}
            </div>
            <button className="download-opt-btn primary" disabled={running || sel.size === 0} onClick={() => void run((_, idx) => sel.has(idx), sel.size ? `Checking ${sel.size}...` : "No selection")}>Check Selected ({sel.size})</button>
            <button className="download-opt-cancel" onClick={() => { setCustom(false); setSel(new Set()); }}>Back</button>
          </>
        )}
      </div>
    </div>
  );
}
