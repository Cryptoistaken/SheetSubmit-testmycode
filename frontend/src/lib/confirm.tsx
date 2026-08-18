import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

interface ConfirmState {
  message: string;
  okText: string;
}

interface ConfirmContextValue {
  confirm: (message: string, okText?: string) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((message: string, okText?: string) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({ message, okText: okText || "Delete" });
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(null);
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <div
        className={`modal-overlay${state ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) close(false);
        }}
      >
        <div className="modal-box">
          <div className="modal-title">{state?.message ?? ""}</div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => close(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={() => close(true)}>
              {state?.okText ?? "Delete"}
            </button>
          </div>
        </div>
      </div>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (message: string, okText?: string) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx.confirm;
}
