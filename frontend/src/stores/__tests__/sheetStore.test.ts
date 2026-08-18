import { beforeEach, describe, expect, it, mock } from "bun:test";

// Bun has no `localStorage`. sheetStore reads it in openFile (inside try/catch)
// and in maybeAutoCheck (unprotected). Provide a minimal shim so the real store
// module can run unmodified under bun.
(globalThis as Record<string, unknown>).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface PersistPayloadLike {
  rows: Array<Record<string, unknown>>;
  action?: string;
}

interface PersistCall {
  id: string;
  payload: PersistPayloadLike;
  admin?: boolean;
}

interface Harness {
  getRowsCalls: number;
  persistCalls: PersistCall[];
  nextPersist: Deferred<{ ok: boolean }> | null;
}

const harness: Harness = {
  getRowsCalls: 0,
  persistCalls: [],
  nextPersist: null,
};

// Fake the entire `@/lib/api` module BEFORE importing the store. sheetStore only
// calls these methods during the flows under test; the extra stubs exist so the
// module graph (fbcookie behavior etc.) imports cleanly.
mock.module("@/lib/api", () => ({
  api: {
    getFileFull: async (id: string) => ({
      file: { id, name: "Test", type: "fb_cookie" },
      rows: [{ cookies: "", uid: "", twofakey: "" }],
      logs: [],
      undo: [],
      redo: [],
    }),
    getCrossDups: async () => ({ counts: {}, dups: {} }),
    getRows: async () => {
      harness.getRowsCalls++;
      return [{ cookies: "c_user=202;", uid: "202", twofakey: "" }];
    },
    persist: async (id: string, payload: unknown) => {
      harness.persistCalls.push({ id, payload: payload as PersistPayloadLike });
      if (harness.nextPersist) return harness.nextPersist.promise;
      return { ok: true };
    },
    adminPersist: async (id: string, payload: unknown) => {
      harness.persistCalls.push({
        id,
        payload: payload as PersistPayloadLike,
        admin: true,
      });
      if (harness.nextPersist) return harness.nextPersist.promise;
      return { ok: true };
    },
    fbCheck: async () => ({ valid: [], dead: [], uncertain: [] }),
    getWaCache: async () => ({ cache: {} }),
    pageCheck: async () => null,
    restoreVersion: async () => ({ ok: false }),
    adminRestoreVersion: async () => ({ ok: false }),
    adminFile: async (id: string) => ({ id, name: "Test", type: "fb_cookie" }),
    adminFileRows: async () => [],
    adminFileLogs: async () => [],
    adminUndo: async () => ({ undo: [], redo: [] }),
    getVersion: async () => ({ v: 0, rows: [], action: null, ts: null }),
    adminGetVersion: async () => ({ v: 0, rows: [], action: null, ts: null }),
  },
}));

const { useSheetStore } = await import("../sheetStore");

function resetStore(): void {
  useSheetStore.setState({
    status: "idle",
    fileId: null,
    file: null,
    rows: [],
    columns: [],
    visibleCols: new Set(),
    undoStack: [],
    redoStack: [],
    apiLogs: [],
    isDirty: false,
    selectedCell: null,
    draft: "",
    qebOpen: false,
    inlineEdit: false,
    selectionMode: false,
    selectedItems: new Set(),
    selRows: new Set(),
    selCols: new Set(),
    dupCells: new Set(),
    dupRows: new Set(),
    invalidCells: new Set(),
    crossDupRows: new Set(),
    hasDuplicates: false,
    crossDups: {},
    checkRunning: false,
    pendingAutoCheck: false,
    adminMode: false,
    adminOwnerId: null,
  });
  harness.getRowsCalls = 0;
  harness.persistCalls = [];
  harness.nextPersist = null;
}

beforeEach(resetStore);

async function openTestFile(): Promise<void> {
  await useSheetStore.getState().openFile("f1");
  const s = useSheetStore.getState();
  expect(s.fileId).toBe("f1");
  expect(s.status).toBe("ready");
  expect(s.isDirty).toBe(false);
}

describe("sheetStore data-integrity", () => {
  it("flushPersist serializes concurrent saves", async () => {
    await openTestFile();
    useSheetStore.getState().commitCell(0, "uid", "111");
    expect(useSheetStore.getState().isDirty).toBe(true);

    harness.nextPersist = deferred();
    const p1 = useSheetStore.getState().flushPersist();
    const p2 = useSheetStore.getState().flushPersist();
    await Promise.resolve(); // let the first chained run start

    // Only one persist may be in-flight; the second flush waits on the chain.
    expect(harness.persistCalls.length).toBe(1);

    harness.nextPersist.resolve({ ok: true });
    await Promise.all([p1, p2]);

    // The second concurrent flush ran AFTER the first cleared isDirty, so it was
    // a serialized no-op — exactly one payload is sent (real store behavior).
    expect(harness.persistCalls.length).toBe(1);
    expect(useSheetStore.getState().isDirty).toBe(false);

    // A subsequent edit still flushes through the same chain, in order.
    useSheetStore.getState().commitCell(0, "uid", "444");
    harness.nextPersist = deferred();
    const p3 = useSheetStore.getState().flushPersist();
    await Promise.resolve();
    expect(harness.persistCalls.length).toBe(2);
    expect(harness.persistCalls[1].payload.rows[0].uid).toBe("444");
    harness.nextPersist.resolve({ ok: true });
    await p3;
    expect(useSheetStore.getState().isDirty).toBe(false);
  });

  it("dirty-clear guard preserves newer edits made while a save is pending", async () => {
    await openTestFile();
    useSheetStore.getState().commitCell(0, "uid", "111");

    harness.nextPersist = deferred();
    const p = useSheetStore.getState().flushPersist();
    await Promise.resolve();
    expect(harness.persistCalls.length).toBe(1);

    // Newer edit while the save is still pending → rows reference changes.
    useSheetStore.getState().commitCell(0, "uid", "222");
    expect(useSheetStore.getState().rows[0].uid).toBe("222");

    harness.nextPersist.resolve({ ok: true });
    await p;

    // The resolved save must NOT clear the newer dirty state.
    expect(useSheetStore.getState().isDirty).toBe(true);
    expect(useSheetStore.getState().rows[0].uid).toBe("222");
  });

  it("closeFile commits the open draft, awaits the final flush, then resets", async () => {
    await openTestFile();
    useSheetStore.getState().openInlineEdit(0, "uid");
    useSheetStore.getState().setDraft("777");
    expect(useSheetStore.getState().inlineEdit).toBe(true);

    harness.nextPersist = deferred();
    const p = useSheetStore.getState().closeFile();
    await Promise.resolve();

    // Draft was folded into rows before the flush started.
    expect(useSheetStore.getState().rows[0].uid).toBe("777");
    expect(useSheetStore.getState().isDirty).toBe(true);
    expect(harness.persistCalls.length).toBe(1);

    harness.nextPersist.resolve({ ok: true });
    await p;

    const s = useSheetStore.getState();
    expect(s.fileId).toBeNull();
    expect(s.status).toBe("idle");
    expect(s.isDirty).toBe(false);
    expect(s.selectedCell).toBeNull();
    expect(s.rows).toEqual([]);
  });

  it("closeFile with a clean file does not persist", async () => {
    await openTestFile();
    await useSheetStore.getState().closeFile();

    expect(harness.persistCalls.length).toBe(0);
    const s = useSheetStore.getState();
    expect(s.fileId).toBeNull();
    expect(s.status).toBe("idle");
    expect(s.isDirty).toBe(false);
    expect(s.selectedCell).toBeNull();
  });

  it("refreshSheet skips while dirty and fetches once clean", async () => {
    await openTestFile();
    useSheetStore.getState().commitCell(0, "uid", "333");
    expect(useSheetStore.getState().isDirty).toBe(true);

    await useSheetStore.getState().refreshSheet();
    expect(harness.getRowsCalls).toBe(0); // skipped while dirty

    await useSheetStore.getState().flushPersist(); // simulate a completed save
    expect(useSheetStore.getState().isDirty).toBe(false);

    await useSheetStore.getState().refreshSheet();
    expect(harness.getRowsCalls).toBe(1);
    expect(useSheetStore.getState().rows[0].uid).toBe("202");
  });
});