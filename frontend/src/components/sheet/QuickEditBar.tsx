import { useSheetStore } from "@/stores/sheetStore";

import CellEditor from "./CellEditor";

function isBubbleMode(): boolean {
  return typeof document !== "undefined" && document.body.classList.contains("bubble-mode");
}

export default function QuickEditBar() {
  const qebOpen = useSheetStore((s) => s.qebOpen);
  const selectedCell = useSheetStore((s) => s.selectedCell);
  const columns = useSheetStore((s) => s.columns);

  if (!qebOpen) return null;

  const bubble = isBubbleMode();
  const colIdx = selectedCell?.colIdx;
  const label = columns.find((c) => c.key === colIdx)?.label ?? colIdx ?? "";

  if (bubble) {
    return (
      <div className="qeb-bar open">
        <CellEditor />
        <button
          className="qeb-paste-btn"
          onClick={() => useSheetStore.getState().quickEditClear()}
        >
          Clear
        </button>
        <button
          className="qeb-paste-btn"
          onClick={() => void useSheetStore.getState().quickEditPaste()}
        >
          Paste
        </button>
        <button
          className="qeb-paste-btn"
          onClick={() => void useSheetStore.getState().quickEditCopy()}
        >
          Copy
        </button>
      </div>
    );
  }

  return (
    <div className="qeb-bar open">
      <span className="qeb-chip">{label}</span>
      <CellEditor />
      <div className="qeb-right">
        <button
          className="qeb-paste-btn"
          onClick={() => void useSheetStore.getState().quickEditPaste()}
        >
          Paste
        </button>
        <button
          className="qeb-paste-btn"
          onClick={() => useSheetStore.getState().quickEditClear()}
        >
          Clear
        </button>
        <button
          className="qeb-icon-btn save"
          onClick={() => useSheetStore.getState().commitQuickEdit()}
        >
          OK
        </button>
      </div>
    </div>
  );
}