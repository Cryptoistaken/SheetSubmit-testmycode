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
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
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

interface AppendOpLike {
  rowIdx: number;
  cols: Record<string, string>;
}

interface AppendPayloadLike {
  base: number;
  ops: AppendOpLike[];
  newLogs?: unknown[];
  undoNew?: unknown[];
  redoNew?: unknown[];
  dataCount?: number;
  action?: string;
}

interface AppendCall {
  id: string;
  payload: AppendPayloadLike;
}

interface Harness {
  getRowsCalls: number;
  getFileFullCalls: number;
  persistCalls: PersistCall[];
  nextPersist: Deferred<{ ok: boolean }> | null;
  appendCalls: AppendCall[];
  nextAppend: Deferred<{ ok: boolean; seq: number }> | null;
  fullRows: Array<Record<string, string>>;
  fullSeq: number;
}

const harness: Harness = {
  getRowsCalls: 0,
  getFileFullCalls: 0,
  persistCalls: [],
  nextPersist: null,
  appendCalls: [],
  nextAppend: null,
  fullRows: [{ cookies: "", uid: "", twofakey: "" }],
  fullSeq: 0,
};

// Fake the entire `@/lib/api` module BEFORE importing the store. sheetStore only
// calls these methods during the flows under test; the extra stubs exist so the
// module graph (fbcookie behavior etc.) imports cleanly.
mock.module("@/lib/api", () => ({
  api: {
    getFileFull: async (id: string) => {
      harness.getFileFullCalls++;
      return {
        file: { id, name: "Test", type: "fb_cookie" },
        rows: harness.fullRows,
        logs: [],
        undo: [],
        redo: [],
        seq: harness.fullSeq,
      };
    },
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
    append: async (id: string, payload: unknown) => {
      harness.appendCalls.push({ id, payload: payload as AppendPayloadLike });
      if (harness.nextAppend) return harness.nextAppend.promise;
      return { ok: true, seq: harness.fullSeq };
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
    logBase: 0,
    undoBase: 0,
    redoBase: 0,
    isDirty: false,
    changeJournal: [],
    lastSeq: 0,
    dirtyStructural: false,
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
    bubbleActiveRow: -1,
    adminMode: false,
    adminOwnerId: null,
  });
  harness.getRowsCalls = 0;
  harness.getFileFullCalls = 0;
  harness.persistCalls = [];
  harness.nextPersist = null;
  harness.appendCalls = [];
  harness.nextAppend = null;
  harness.fullRows = [{ cookies: "", uid: "", twofakey: "" }];
  harness.fullSeq = 0;
}

beforeEach(resetStore);

async function openTestFile(): Promise<void> {
  await useSheetStore.getState().openFile("f1");
  const s = useSheetStore.getState();
  expect(s.fileId).toBe("f1");
  expect(s.status).toBe("ready");
  expect(s.isDirty).toBe(false);
  expect(s.lastSeq).toBe(0);
}

describe("sheetStore data-integrity", () => {
  it("flushPersist serializes concurrent appends", async () => {
    await openTestFile();
    useSheetStore.getState().commitCell(0, "uid", "111");
    expect(useSheetStore.getState().isDirty).toBe(true);
    expect(useSheetStore.getState().changeJournal).toEqual([
      { rowIdx: 0, cols: { uid: "111" } },
    ]);

    harness.nextAppend = deferred<{ ok: boolean; seq: number }>();
    const p1 = useSheetStore.getState().flushPersist();
    const p2 = useSheetStore.getState().flushPersist();
    await Promise.resolve(); // let the first chained run start

    // Only one append may be in-flight; the second flush waits on the chain.
    expect(harness.appendCalls.length).toBe(1);
    expect(harness.appendCalls[0].payload.base).toBe(0);
    expect(harness.appendCalls[0].payload.ops).toEqual([
      { rowIdx: 0, cols: { uid: "111" } },
    ]);

    harness.nextAppend.resolve({ ok: true, seq: 5 });
    await Promise.all([p1, p2]);

    // The second concurrent flush ran AFTER the first cleared isDirty, so it was
    // a serialized no-op — exactly one payload is sent (real store behavior).
    expect(harness.appendCalls.length).toBe(1);
    expect(useSheetStore.getState().isDirty).toBe(false);
    expect(useSheetStore.getState().lastSeq).toBe(5);
    expect(useSheetStore.getState().changeJournal).toEqual([]);

    // A subsequent edit still flushes through the same chain, in order.
    useSheetStore.getState().commitCell(0, "uid", "444");
    harness.nextAppend = deferred<{ ok: boolean; seq: number }>();
    const p3 = useSheetStore.getState().flushPersist();
    await Promise.resolve();
    expect(harness.appendCalls.length).toBe(2);
    expect(harness.appendCalls[1].payload.base).toBe(5);
    expect(harness.appendCalls[1].payload.ops).toEqual([
      { rowIdx: 0, cols: { uid: "444" } },
    ]);
    harness.nextAppend.resolve({ ok: true, seq: 6 });
    await p3;
    expect(useSheetStore.getState().isDirty).toBe(false);
    expect(useSheetStore.getState().lastSeq).toBe(6);
  });

  it("dirty-clear guard preserves newer edits made while a save is pending", async () => {
    await openTestFile();
    useSheetStore.getState().commitCell(0, "uid", "111");

    harness.nextAppend = deferred<{ ok: boolean; seq: number }>();
    const p = useSheetStore.getState().flushPersist();
    await Promise.resolve();
    expect(harness.appendCalls.length).toBe(1);

    // Newer edit while the save is still pending → rows reference changes.
    useSheetStore.getState().commitCell(0, "uid", "222");
    expect(useSheetStore.getState().rows[0].uid).toBe("222");

    harness.nextAppend.resolve({ ok: true, seq: 5 });
    await p;

    // The resolved append must NOT clear the newer dirty state, journal or seq.
    expect(useSheetStore.getState().isDirty).toBe(true);
    expect(useSheetStore.getState().rows[0].uid).toBe("222");
    // Journal is coalesced per-row: the later commit on the same row replaces
    // the earlier one, so only the latest value survives.
    expect(useSheetStore.getState().changeJournal).toEqual([
      { rowIdx: 0, cols: { uid: "222" } },
    ]);
    expect(useSheetStore.getState().lastSeq).toBe(0);
  });

  it("closeFile commits the open draft, awaits the final flush, then resets", async () => {
    await openTestFile();
    useSheetStore.getState().openInlineEdit(0, "uid");
    useSheetStore.getState().setDraft("777");
    expect(useSheetStore.getState().inlineEdit).toBe(true);

    harness.nextPersist = deferred<{ ok: boolean }>();
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
    expect(s.changeJournal).toEqual([]);
    expect(s.lastSeq).toBe(0);
    expect(s.dirtyStructural).toBe(false);
  });

  it("closeFile with a clean file does not persist", async () => {
    await openTestFile();
    await useSheetStore.getState().closeFile();

    expect(harness.persistCalls.length).toBe(0);
    expect(harness.appendCalls.length).toBe(0);
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

  it("409 conflict refetches and re-applies the local journal onto server rows", async () => {
    await openTestFile();
    useSheetStore.getState().commitCell(0, "uid", "111");
    expect(useSheetStore.getState().changeJournal).toEqual([
      { rowIdx: 0, cols: { uid: "111" } },
    ]);

    harness.nextAppend = deferred<{ ok: boolean; seq: number }>();
    const p = useSheetStore.getState().flushPersist();
    await Promise.resolve();
    expect(harness.appendCalls.length).toBe(1);

    // Server meanwhile moved on (someone else edited in parallel).
    harness.fullRows = [{ cookies: "c_user=999;", uid: "999", twofakey: "" }];
    harness.fullSeq = 7;
    harness.nextAppend.reject(new Error("409 Conflict — version conflict"));
    await p;

    const s = useSheetStore.getState();
    expect(s.rows[0].uid).toBe("111"); // local edit survived the re-apply
    expect(s.rows[0].cookies).toBe("c_user=999;"); // server row content kept
    expect(s.lastSeq).toBe(7); // advanced to the server seq
    expect(s.changeJournal).toEqual([{ rowIdx: 0, cols: { uid: "111" } }]); // still unsent
    expect(s.isDirty).toBe(true);

    // Next flush re-appends with base = the fresh server seq.
    harness.nextAppend = deferred<{ ok: boolean; seq: number }>();
    const p2 = useSheetStore.getState().flushPersist();
    await Promise.resolve();
    expect(harness.appendCalls.length).toBe(2);
    expect(harness.appendCalls[1].payload.base).toBe(7);
    expect(harness.appendCalls[1].payload.ops).toEqual([
      { rowIdx: 0, cols: { uid: "111" } },
    ]);
    harness.nextAppend.resolve({ ok: true, seq: 8 });
    await p2;
    expect(useSheetStore.getState().lastSeq).toBe(8);
    expect(useSheetStore.getState().changeJournal).toEqual([]);
    expect(useSheetStore.getState().isDirty).toBe(false);
  });

  it("structural changes fall back to a full persist and clear the journal", async () => {
    await openTestFile();
    useSheetStore.getState().commitCell(0, "uid", "111");
    await useSheetStore.getState().flushPersist();
    expect(harness.appendCalls.length).toBe(1);
    expect(useSheetStore.getState().isDirty).toBe(false);

    // Structural mutation (deleteSelected) → full persist, not append.
    useSheetStore.getState().enterSelectionMode("cell", 0, "uid");
    useSheetStore.getState().deleteSelected();
    const s = useSheetStore.getState();
    expect(s.dirtyStructural).toBe(true);
    expect(s.isDirty).toBe(true);
    expect(s.rows[0].uid).toBe("");

    await useSheetStore.getState().flushPersist();

    expect(harness.appendCalls.length).toBe(1); // append not used for structural
    expect(harness.persistCalls.length).toBe(1); // full persist used instead
    expect(useSheetStore.getState().isDirty).toBe(false);
    expect(useSheetStore.getState().changeJournal).toEqual([]);
    expect(useSheetStore.getState().dirtyStructural).toBe(false);
  });

  it("appends sync logs/undo/redo incrementally (only new entries)", async () => {
    await openTestFile();
    const logA = { username: "A", status: "done" };
    const logB = { username: "B", status: "done" };
    useSheetStore.setState({ apiLogs: [logA] });
    useSheetStore.getState().commitCell(0, "uid", "111");

    await useSheetStore.getState().flushPersist();
    expect(harness.appendCalls.length).toBe(1);
    expect(harness.appendCalls[0].payload.newLogs).toEqual([logA]);
    expect(harness.appendCalls[0].payload.ops).toEqual([
      { rowIdx: 0, cols: { uid: "111" } },
    ]);
    expect(useSheetStore.getState().logBase).toBe(1);

    // More log entries appear locally; the next append sends ONLY the new ones.
    useSheetStore.setState({ apiLogs: [logA, logB] });
    useSheetStore.getState().commitCell(0, "uid", "222");
    await useSheetStore.getState().flushPersist();
    expect(harness.appendCalls.length).toBe(2);
    expect(harness.appendCalls[1].payload.newLogs).toEqual([logB]);
    expect(harness.appendCalls[1].payload.undoNew).toEqual([
      { rowIdx: 0, colKey: "uid", prevVal: "111" },
    ]);
    expect(useSheetStore.getState().logBase).toBe(2);
  });

  it("undoNew delta only sends the unsynced tail of the undo stack", async () => {
    await openTestFile();
    const undoA = { rowIdx: 0, colKey: "uid", prevVal: "old1" };
    const undoB = { rowIdx: 1, colKey: "uid", prevVal: "old2" };
    useSheetStore.setState({
      undoStack: [undoA, undoB],
      undoBase: 1,
      changeJournal: [{ rowIdx: 0, cols: { uid: "999" } }],
      isDirty: true,
    });

    await useSheetStore.getState().flushPersist();
    expect(harness.appendCalls.length).toBe(1);
    expect(harness.appendCalls[0].payload.undoNew).toEqual([undoB]);
    expect(harness.appendCalls[0].payload.newLogs).toEqual([]);
    expect(harness.appendCalls[0].payload.redoNew).toEqual([]);
    expect(useSheetStore.getState().undoBase).toBe(2);
  });

  it("full persist resets sync bases; next append sends no stale entries", async () => {
    await openTestFile();
    const logA = { username: "A", status: "done" };
    const logB = { username: "B", status: "done" };
    useSheetStore.setState({ apiLogs: [logA, logB] });

    useSheetStore.getState().addRow(); // structural → full persist
    await useSheetStore.getState().flushPersist();
    expect(harness.persistCalls.length).toBe(1);
    expect(useSheetStore.getState().logBase).toBe(2);
    expect(useSheetStore.getState().undoBase).toBe(0);
    expect(useSheetStore.getState().redoBase).toBe(0);

    // A later append has no new log/undo/redo entries to send.
    useSheetStore.setState({
      changeJournal: [{ rowIdx: 0, cols: { uid: "999" } }],
      isDirty: true,
    });
    await useSheetStore.getState().flushPersist();
    expect(harness.appendCalls.length).toBe(1);
    expect(harness.appendCalls[0].payload.newLogs).toEqual([]);
    expect(harness.appendCalls[0].payload.undoNew).toEqual([]);
    expect(harness.appendCalls[0].payload.redoNew).toEqual([]);
  });

  it("changeJournal coalesces consecutive commits on the same row (latest value)", async () => {
    await openTestFile();
    useSheetStore.getState().commitCell(0, "uid", "111");
    useSheetStore.getState().commitCell(0, "uid", "222");
    expect(useSheetStore.getState().changeJournal).toEqual([
      { rowIdx: 0, cols: { uid: "222" } },
    ]);

    useSheetStore.getState().commitCell(1, "uid", "333");
    expect(useSheetStore.getState().changeJournal).toEqual([
      { rowIdx: 0, cols: { uid: "222" } },
      { rowIdx: 1, cols: { uid: "333" } },
    ]);

    useSheetStore.getState().commitCell(0, "uid", "444");
    expect(useSheetStore.getState().changeJournal).toEqual([
      { rowIdx: 1, cols: { uid: "333" } },
      { rowIdx: 0, cols: { uid: "444" } },
    ]);
  });

  it("changeJournal caps at 200 ops (keeps the tail)", async () => {
    await openTestFile();
    const rows = Array.from({ length: 220 }, (_, i) => ({
      cookies: "",
      uid: "",
      twofakey: "",
      index: String(i),
    }));
    useSheetStore.setState({ rows });
    for (let i = 0; i < 220; i++) {
      useSheetStore.getState().commitCell(i, "uid", String(i));
    }
    const journal = useSheetStore.getState().changeJournal;
    expect(journal.length).toBe(200);
    expect(journal[0].rowIdx).toBe(20);
    expect(journal[journal.length - 1].rowIdx).toBe(219);
  });

  it("bubbleActiveRow resets on closeFile and openFile", async () => {
    await openTestFile();
    useSheetStore.setState({ bubbleActiveRow: 5 });
    await useSheetStore.getState().closeFile();
    expect(useSheetStore.getState().bubbleActiveRow).toBe(-1);

    await openTestFile();
    expect(useSheetStore.getState().bubbleActiveRow).toBe(-1);
  });

  it("incremental recomputeMarks keeps dup marks correct after editing a dup cell", async () => {
    await openTestFile();
    useSheetStore.setState({
      rows: [
        { cookies: "", uid: "111", twofakey: "" },
        { cookies: "", uid: "111", twofakey: "" },
        { cookies: "", uid: "222", twofakey: "" },
      ],
      dupCells: new Set(["0:uid", "1:uid"]),
      dupRows: new Set([0, 1]),
      hasDuplicates: true,
    });

    // Break the duplicate from row 0's side: row 1 becomes unique too.
    useSheetStore.getState().commitCell(0, "uid", "333");
    let s = useSheetStore.getState();
    expect(s.rows[0].uid).toBe("333");
    expect(s.dupCells).toEqual(new Set());
    expect(s.dupRows).toEqual(new Set());
    expect(s.hasDuplicates).toBe(false);

    // Recreate the duplicate.
    useSheetStore.getState().commitCell(0, "uid", "111");
    s = useSheetStore.getState();
    expect(s.dupCells).toEqual(new Set(["0:uid", "1:uid"]));
    expect(s.dupRows).toEqual(new Set([0, 1]));
    expect(s.hasDuplicates).toBe(true);

    // Break it from row 1's side: the stale partner mark must be cleared.
    useSheetStore.getState().commitCell(1, "uid", "444");
    s = useSheetStore.getState();
    expect(s.dupCells).toEqual(new Set());
    expect(s.dupRows).toEqual(new Set());
    expect(s.hasDuplicates).toBe(false);
  });
});