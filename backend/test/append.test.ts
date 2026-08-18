// Tests for the delta-append + seq versioning routes in backend/src/routes/files.ts.
// The real redis + auth modules are replaced: redis by the in-memory fake
// (WATCH/MULTI optimistic locking), auth by middleware that sets req.userId and
// loads req.file from the seeded files list. Routes are exercised over a real
// HTTP server so handler wiring (status codes, response shape) is verified.
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import path from "node:path";
import type { StoredFile } from "../src/lib/shared";
import { fakeSet, installRedisMock, key, resetStore, store } from "./redis-mock";

installRedisMock();

const authMock = {
  requireAuth: async (req: Request, _res: Response, next: NextFunction) => {
    req.userId = String(req.headers["x-user-id"] || "user1");
    next();
  },
  requireFileAccess: async (req: Request, res: Response, next: NextFunction) => {
    const raw = store[key("files:" + req.userId)];
    let files: StoredFile[] = [];
    if (typeof raw === "string") {
      try {
        files = JSON.parse(raw) as StoredFile[];
      } catch {
        files = [];
      }
    }
    const file = files.find((f) => f.id === req.params.id);
    if (!file) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    req.file = file;
    next();
  },
  migrateLogKey: async () => {},
};

mock.module(path.join(import.meta.dir, "..", "src", "middleware", "auth"), () => authMock);
mock.module("../src/middleware/auth", () => authMock);

const { filesRouter } = await import("../src/routes/files");

const app = express();
app.use(express.json());
app.use("/api/files", filesRouter);

let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = "http://127.0.0.1:" + (server.address() as { port: number }).port;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  resetStore();
});

function seedFile(id: string): StoredFile {
  const file: StoredFile = {
    id,
    name: "File " + id,
    type: "fb_cookie",
    userId: "user1",
    createdAt: 1,
    updatedAt: 1,
    rowCount: 0,
    columns: null,
    dataCount: 0,
  };
  fakeSet(key("files:user1"), JSON.stringify([file]));
  return file;
}

async function api(route: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(baseUrl + "/api/files" + route, {
    method: body === undefined ? "GET" : "PUT",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const parsed = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const storedRows = (id: string) => parsed(store[key("rows:" + id)]) as Record<string, string>[];

describe("PUT /api/files/:id/append", () => {
  test("applies ops to existing rows and returns seq = base+1", async () => {
    seedFile("f1");
    fakeSet(key("rows:f1"), JSON.stringify([{ a: "1" }]));
    fakeSet(key("seq:f1"), "0");

    const r = await api("/f1/append", { base: 0, ops: [{ rowIdx: 0, cols: { b: "2" } }] });

    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.seq).toBe(1);
    expect(storedRows("f1")).toEqual([{ a: "1", b: "2" }]);
    expect(store[key("seq:f1")]).toBe("1");
  });

  test("pads with empty rows when rowIdx is beyond the array length", async () => {
    seedFile("f2");
    fakeSet(key("rows:f2"), JSON.stringify([{ a: "1" }]));

    const r = await api("/f2/append", { base: 0, ops: [{ rowIdx: 3, cols: { x: "y" } }] });

    expect(r.status).toBe(200);
    expect(r.json.seq).toBe(1);
    expect(storedRows("f2")).toEqual([{ a: "1" }, {}, {}, { x: "y" }]);
    expect(store[key("seq:f2")]).toBe("1");
  });

  test("conflict: base mismatch returns 409 and changes nothing", async () => {
    seedFile("f3");
    fakeSet(key("rows:f3"), JSON.stringify([{ a: "1" }]));
    fakeSet(key("seq:f3"), "2");

    const r = await api("/f3/append", { base: 1, ops: [{ rowIdx: 0, cols: { b: "2" } }] });

    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: "version conflict", serverSeq: 2 });
    expect(storedRows("f3")).toEqual([{ a: "1" }]);
    expect(store[key("seq:f3")]).toBe("2");
  });

  test("action snapshots history and still applies ops", async () => {
    seedFile("f4");
    fakeSet(key("rows:f4"), JSON.stringify([{ a: "1" }]));

    const r = await api("/f4/append", {
      base: 0,
      action: "append",
      ops: [{ rowIdx: 0, cols: { c: "3" } }],
    });

    expect(r.status).toBe(200);
    expect(r.json.seq).toBe(1);
    expect(storedRows("f4")).toEqual([{ a: "1", c: "3" }]);
    const meta = parsed(store[key("hist:f4")]) as { v: number; action: string }[];
    expect(Array.isArray(meta)).toBe(true);
    expect(meta.length).toBe(1);
    expect(meta[0].action).toBe("append");
  });

  test("logs replaced when client list length >= server length", async () => {
    seedFile("f5");
    fakeSet(key("rows:f5"), JSON.stringify([]));
    fakeSet(key("logs:f5"), [JSON.stringify({ m: 1 }), JSON.stringify({ m: 2 })]);
    const clientLogs = [{ m: 3 }, { m: 4 }, { m: 5 }];

    const r = await api("/f5/append", { base: 0, ops: [{ rowIdx: 0, cols: { a: "1" } }], logs: clientLogs });

    expect(r.status).toBe(200);
    const stored = (store[key("logs:f5")] as string[]).map((l) => parsed(l));
    expect(stored).toEqual(clientLogs);
  });

  test("logs NOT replaced when client list is shorter than server length", async () => {
    seedFile("f6");
    fakeSet(key("rows:f6"), JSON.stringify([]));
    const serverLogs = [JSON.stringify({ m: 1 }), JSON.stringify({ m: 2 }), JSON.stringify({ m: 3 })];
    fakeSet(key("logs:f6"), serverLogs);

    const r = await api("/f6/append", { base: 0, ops: [{ rowIdx: 0, cols: { a: "1" } }], logs: [{ m: 4 }, { m: 5 }] });

    expect(r.status).toBe(200);
    expect(store[key("logs:f6")]).toEqual(serverLogs);
  });

  test("invalid payload returns 400", async () => {
    seedFile("f7");
    const bad = [
      { base: 0, ops: "nope" },
      { base: 0, ops: [{ rowIdx: -1, cols: {} }] },
      { base: 0, ops: [{ rowIdx: 0, cols: [] }] },
      { base: "0", ops: [] },
    ];
    for (const body of bad) {
      const r = await api("/f7/append", body as any);
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ error: "invalid append payload" });
    }
  });
});

describe("seq versioning on full read + persist", () => {
  test("GET /full includes seq from the stored counter", async () => {
    seedFile("g1");
    fakeSet(key("rows:g1"), JSON.stringify([{ a: "1" }]));
    fakeSet(key("seq:g1"), "5");

    const r = await api("/g1/full");

    expect(r.status).toBe(200);
    expect(r.json.seq).toBe(5);
    expect(r.json.file.id).toBe("g1");
    expect(r.json.rows).toEqual([{ a: "1" }]);
  });

  test("full persist advances seq and returns it", async () => {
    seedFile("g2");
    fakeSet(key("seq:g2"), "1");

    const r = await api("/g2/persist", { rows: [{ a: "9" }] });

    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.seq).toBe(2);
    expect(r.json.file.id).toBe("g2");
    expect(store[key("seq:g2")]).toBe("2");
    expect(storedRows("g2")).toEqual([{ a: "9" }]);
  });
});