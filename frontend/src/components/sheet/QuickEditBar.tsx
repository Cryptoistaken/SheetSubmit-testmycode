import { useRef, useState } from "react";
import { parseStyles, useSheetStore } from "@/stores/sheetStore";
import CellEditor from "./CellEditor";

const PALETTE = ["#000000","#434343","#666666","#999999","#B7B7B7","#CCCCCC","#D9D9D9","#FFFFFF","#ee0000","#ff6d00","#fbbc04","#16a34a","#00acc1","#0070f3","#6366f1","#795548"];

function trigger(el: HTMLElement | null, cls: string) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
}

export default function QuickEditBar() {
  const qebOpen = useSheetStore((s) => s.qebOpen);
  const selectedCell = useSheetStore((s) => s.selectedCell);
  const rows = useSheetStore((s) => s.rows);
  const [picker, setPicker] = useState<"text"|"cell"|null>(null);
  const [tabText, setTabText] = useState<"basic"|"custom">("basic");
  const [tabCell, setTabCell] = useState<"basic"|"custom">("basic");
  const [hexText, setHexText] = useState("#000000");
  const [hexCell, setHexCell] = useState("#ffffff");
  const copyRef = useRef<HTMLButtonElement>(null);
  const pasteRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);

  if (!qebOpen || !selectedCell) return null;

  const { rowIdx, colIdx } = selectedCell;
  const styles = parseStyles(rows[rowIdx] ?? ({} as never))[colIdx] ?? {};
  const bold = !!styles.bold;
  const textColor = styles.color ?? "#000000";
  const cellBg = styles.bg ?? "transparent";

  const setStyle = (patch: { bg?: string | null; color?: string | null; bold?: boolean | null }) =>
    (useSheetStore.getState().setCellStyle as (r:number,c:string,p: typeof patch)=>void)(rowIdx, colIdx, patch);

  return (
    <div className="qeb-bar open" onClick={(e) => { if (e.target === e.currentTarget) setPicker(null); }}>
      <div className="qeb-formula-bar"><CellEditor /></div>

      <div className="qeb-toolbar">
        <button className={`qeb-icon-btn${bold ? " active" : ""}`} title="Bold" onClick={() => setStyle({ bold: !bold })}><span style={{ fontWeight: 800, fontSize: 16, lineHeight: 1 }}>B</span></button>
        <div className="qeb-divider" />
        <button className="qeb-icon-btn" title="Text color" onClick={() => { setPicker(p => p === "text" ? null : "text"); setTabText("basic"); }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 16l4-12h4l4 12" /><path d="M8 12h8" /></svg>
          <span className="qeb-color-bar" style={{ background: textColor }} />
        </button>
        <button className="qeb-icon-btn" title="Cell fill" onClick={() => { setPicker(p => p === "cell" ? null : "cell"); setTabCell("basic"); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3l7 7-8 8-7-7 8-8Z" /><path d="M5 19l3-3" /><path d="M14 14l3 3 -1 1 -3 -3" /></svg>
          <span className="qeb-color-bar" style={{ background: cellBg === "transparent" ? "transparent" : cellBg }} />
        </button>
        <div className="qeb-divider" />
        <button ref={copyRef} className="qeb-icon-btn" title="Copy" onClick={() => { trigger(copyRef.current, "anim-copy"); void useSheetStore.getState().quickEditCopy().then(() => { copyRef.current?.classList.add("copied"); setTimeout(() => copyRef.current?.classList.remove("copied"), 900); }); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V7a2 2 0 0 1 2-2h8" /></svg>
        </button>
        <button ref={pasteRef} className="qeb-icon-btn" title="Paste" onClick={() => { trigger(pasteRef.current, "anim-paste"); void useSheetStore.getState().quickEditPaste(); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M9 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" /><rect x="9" y="3" width="8" height="6" rx="1.5" /></svg>
        </button>
        <button ref={clearRef} className="qeb-icon-btn" title="Clear" onClick={() => { trigger(clearRef.current, "anim-clear"); useSheetStore.getState().quickEditClear(); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
        </button>
      </div>

      <div className="qeb-handle" />

      {picker === "text" && (
        <div className="qeb-picker open" onClick={e => e.stopPropagation()}>
          <div className="qeb-picker-title">Text color</div>
          <div className="qeb-picker-tabs"><button className={`qeb-picker-tab${tabText === "basic" ? " active" : ""}`} onClick={() => setTabText("basic")}>Basic</button><button className={`qeb-picker-tab${tabText === "custom" ? " active" : ""}`} onClick={() => setTabText("custom")}>Custom</button></div>
          {tabText === "basic" ? (
            <div className="qeb-swatch-grid">{PALETTE.map(c => <button key={c} className={`qeb-swatch${textColor === c ? " selected" : ""}`} style={{ background: c }} onClick={() => { setStyle({ color: c }); setHexText(c); }} aria-label={c} />)}</div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(hexText) ? hexText : "#000000"} onChange={e => { setHexText(e.target.value); setStyle({ color: e.target.value }); }} style={{ width: 44, height: 32, border: "1px solid var(--border)", borderRadius: 8, padding: 2, background: "var(--bg)", cursor: "pointer", flexShrink: 0 }} />
              <input className="qeb-hex-input open" value={hexText} maxLength={7} onChange={e => setHexText(e.target.value)} onBlur={() => { let v = hexText.trim(); if (!v.startsWith("#")) v = "#" + v; if (/^#[0-9A-Fa-f]{6}$/.test(v)) setStyle({ color: v }); }} spellCheck={false} placeholder="#000000" style={{ display: "block", flex: 1 }} />
              <div style={{ width: 22, height: 22, borderRadius: 6, background: /^#[0-9A-Fa-f]{6}$/.test(hexText) ? hexText : textColor, border: "1px solid var(--border)", flexShrink: 0 }} />
            </div>
          )}
        </div>
      )}
      {picker === "cell" && (
        <div className="qeb-picker open" onClick={e => e.stopPropagation()} style={{ transformOrigin: "38% 32%" }}>
          <div className="qeb-picker-title">Cell fill</div>
          <div className="qeb-picker-tabs"><button className={`qeb-picker-tab${tabCell === "basic" ? " active" : ""}`} onClick={() => setTabCell("basic")}>Basic</button><button className={`qeb-picker-tab${tabCell === "custom" ? " active" : ""}`} onClick={() => setTabCell("custom")}>Custom</button></div>
          {tabCell === "basic" ? (
            <div className="qeb-swatch-grid"><button className={`qeb-swatch none${cellBg === "transparent" ? " selected" : ""}`} onClick={() => { setStyle({ bg: null }); setHexCell("#ffffff"); }} title="No fill" aria-label="No fill" /><>{PALETTE.map(c => <button key={c} className={`qeb-swatch${cellBg === c ? " selected" : ""}`} style={{ background: c }} onClick={() => { setStyle({ bg: c }); setHexCell(c); }} aria-label={c} />)}</></div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(hexCell) ? hexCell : "#ffffff"} onChange={e => { setHexCell(e.target.value); setStyle({ bg: e.target.value }); }} style={{ width: 44, height: 32, border: "1px solid var(--border)", borderRadius: 8, padding: 2, background: "var(--bg)", cursor: "pointer", flexShrink: 0 }} />
              <input className="qeb-hex-input open" value={hexCell} maxLength={7} onChange={e => setHexCell(e.target.value)} onBlur={() => { let v = hexCell.trim(); if (!v.startsWith("#")) v = "#" + v; if (/^#[0-9A-Fa-f]{6}$/.test(v)) setStyle({ bg: v }); }} spellCheck={false} placeholder="#RRGGBB" style={{ display: "block", flex: 1 }} />
              <div style={{ width: 22, height: 22, borderRadius: 6, background: /^#[0-9A-Fa-f]{6}$/.test(hexCell) ? hexCell : "#ffffff", border: "1px solid var(--border)", flexShrink: 0 }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
