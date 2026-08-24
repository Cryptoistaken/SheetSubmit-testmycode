import { useMemo, useState } from "react";
import { useSheetStore } from "@/stores/sheetStore";
import { buildDownloadOpts } from "@/lib/downloadOpts";
import { downloadCustomRows } from "@/lib/xlsx";
import { useToast } from "@/lib/toast";

const PW_KEY = "ss_customDlPw";

export default function CustomDownloadOverlay({
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

  const [pw, setPw] = useState(() => localStorage.getItem(PW_KEY) ?? "");
  const [step, setStep] = useState<1 | 2>(1);

  const opts = useMemo(() => buildDownloadOpts(rows, columns), [rows, columns]);

  if (!open) return null;

  const submit = () => {
    localStorage.setItem(PW_KEY, pw);
    setStep(2);
  };

  return (
    <div
      className="download-opt-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="download-opt-box">
        {step === 1 ? (
          <>
            <div className="download-opt-title">Custom download</div>
            <input
              className="modal-input download-opt-pw"
              type="password"
              placeholder="Password"
              value={pw}
              autoFocus
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button className="download-opt-btn primary" onClick={submit}>
              Continue
            </button>
            <button className="download-opt-cancel" onClick={onClose}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <div className="download-opt-title">Download custom format</div>
            {opts.map((o) => (
              <button
                key={o.key}
                className={"download-opt-btn " + o.className}
                onClick={async () => {
                  try {
                    const ok = await downloadCustomRows(
                      rows,
                      fileName,
                      pw,
                      o.filter,
                      o.suffix,
                    );
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
            <button className="download-opt-cancel" onClick={() => setStep(1)}>
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}