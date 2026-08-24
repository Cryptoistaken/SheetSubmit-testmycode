import { useMemo } from "react";
import { useSheetStore } from "@/stores/sheetStore";
import { downloadSheetRows } from "@/lib/xlsx";
import { buildDownloadOpts } from "@/lib/downloadOpts";
import { useToast } from "@/lib/toast";

export default function DownloadOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const rows = useSheetStore((s) => s.rows);
  const columns = useSheetStore((s) => s.columns);
  const fileName = useSheetStore((s) => s.file?.name ?? "export");
  const showToast = useToast();

  const opts = useMemo(() => buildDownloadOpts(rows, columns), [rows, columns]);

  if (!open) return null;

  return (
    <div
      className="download-opt-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="download-opt-box">
        <div className="download-opt-title">Download</div>
        {opts.map((o) => (
          <button
            key={o.key}
            className={"download-opt-btn " + o.className}
            onClick={async () => {
              try {
                const ok = await downloadSheetRows(rows, columns, fileName, o.filter, o.suffix);
                showToast(ok ? "Downloaded" : "No data to download");
              } catch {
                showToast("Download failed");
              }
              onClose();
            }}
          >
            {o.label} <span className="opt-count">{o.count}</span>
          </button>
        ))}
        <button className="download-opt-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
