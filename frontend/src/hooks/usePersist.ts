import { useEffect } from "react";
import { useSheetStore } from "@/stores/sheetStore";

export function usePersist(): void {
  useEffect(() => {
    const handler = () => {
      void useSheetStore.getState().flushPersist();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
}
