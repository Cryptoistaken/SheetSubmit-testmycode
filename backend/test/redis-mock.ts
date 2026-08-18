// In-memory fake of backend/src/services/redis.ts.
// Mirrors its exports (redis, key, getJSON, setJSON, setJSONex, delKey) plus a
// WATCH/MULTI/pipeline implementation with genuine optimistic-lock semantics so
// updateUserFilesAtomic's conflict-retry loop can be tested without a Redis.
//
// Version counters: every mutation bumps a per-key version. watch() records the
// version at call time; exec() aborts (returns null) if any watched key changed,
// exactly like Redis. setBeforeExec(hook) lets tests simulate a concurrent writer.
import { mock } from "bun:test";
import path from "node:path";

type StoreVal = string | string[] | Set<string>;

export const store: Record<string, StoreVal> = {};
const versions: Record<string, number> = {};
let watched: Record<string, number> = {};
let beforeExecHook: (() => void) | null = null;

function bump(k: string): void {
  versions[k] = (versions[k] || 0) + 1;
}

// Low-level store writers used by the hook to simulate a concurrent writer
// (they bump the key version so an in-flight WATCH conflict is detected).
export function fakeSet(k: string, val: StoreVal): void {
  store[k] = val;
  bump(k);
}

export function fakeDel(k: string): void {
  if (k in store) {
    delete store[k];
    bump(k);
  }
}

export function resetStore(): void {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(versions)) delete versions[k];
  watched = {};
  beforeExecHook = null;
}

export function setBeforeExec(hook: (() => void) | null): void {
  beforeExecHook = hook;
}

type ValType = "string" | "list" | "set" | "none";

function valType(k: string): ValType {
  const v = store[k];
  if (v === undefined) return "none";
  if (typeof v === "string") return "string";
  if (Array.isArray(v)) return "list";
  return "set";
}

function norm(start: number, stop: number, len: number): [number, number] {
  const s = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
  let e = stop < 0 ? len + stop : Math.min(stop, len - 1);
  if (e < s) e = s - 1;
  return [s, e];
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
}

// ---- synchronous, version-bumping command implementations ----
function cmdGet(k: string): string | null {
  const v = store[k];
  return typeof v === "string" ? v : null;
}

function cmdSet(k: string, value: string): "OK" {
  store[k] = value;
  bump(k);
  return "OK";
}

function cmdDel(...keys: string[]): number {
  let n = 0;
  for (const k of keys) {
    if (k in store) {
      delete store[k];
      bump(k);
      n++;
    }
  }
  return n;
}

function cmdExists(k: string): number {
  return k in store ? 1 : 0;
}

function cmdType(k: string): ValType {
  return valType(k);
}

function cmdRpush(k: string, ...vals: string[]): number {
  const arr = Array.isArray(store[k]) ? (store[k] as string[]).slice() : [];
  arr.push(...vals);
  store[k] = arr;
  bump(k);
  return arr.length;
}

function cmdLrange(k: string, start: number, stop: number): string[] {
  if (!Array.isArray(store[k])) return [];
  const arr = store[k] as string[];
  const [s, e] = norm(start, stop, arr.length);
  return e < s ? [] : arr.slice(s, e + 1);
}

function cmdLlen(k: string): number {
  return Array.isArray(store[k]) ? (store[k] as string[]).length : 0;
}

function cmdLtrim(k: string, start: number, stop: number): "OK" {
  if (Array.isArray(store[k])) {
    const arr = store[k] as string[];
    const [s, e] = norm(start, stop, arr.length);
    store[k] = e < s ? [] : arr.slice(s, e + 1);
    bump(k);
  }
  return "OK";
}

function cmdSadd(k: string, ...members: string[]): number {
  const set = store[k] instanceof Set ? (store[k] as Set<string>) : new Set<string>();
  let added = 0;
  for (const m of members) {
    if (!set.has(m)) {
      set.add(m);
      added++;
    }
  }
  store[k] = set;
  bump(k);
  return added;
}

function cmdSrem(k: string, ...members: string[]): number {
  const set = store[k] instanceof Set ? (store[k] as Set<string>) : new Set<string>();
  let removed = 0;
  for (const m of members) {
    if (set.delete(m)) removed++;
  }
  if (removed > 0 || set.size > 0) store[k] = set;
  bump(k);
  return removed;
}

function cmdSmembers(k: string): string[] {
  return store[k] instanceof Set ? [...(store[k] as Set<string>)] : [];
}

function cmdScard(k: string): number {
  return store[k] instanceof Set ? (store[k] as Set<string>).size : 0;
}

function cmdScan(cursor: string, ...args: unknown[]): [string, string[]] {
  let pattern = "*";
  for (let i = 0; i + 1 < args.length; i += 2) {
    if (String(args[i]).toUpperCase() === "MATCH") pattern = String(args[i + 1]);
  }
  const re = globToRegex(pattern);
  const keys = Object.keys(store).filter((k) => re.test(k));
  return ["0", keys];
}

function applyCmd(cmd: string, args: unknown[]): unknown {
  switch (cmd) {
    case "get":
      return cmdGet(String(args[0]));
    case "set":
      return cmdSet(String(args[0]), String(args[1]));
    case "del":
      return cmdDel(...args.map(String));
    case "exists":
      return cmdExists(String(args[0]));
    case "type":
      return cmdType(String(args[0]));
    case "rpush":
      return cmdRpush(String(args[0]), ...args.slice(1).map(String));
    case "lrange":
      return cmdLrange(String(args[0]), Number(args[1]), Number(args[2]));
    case "llen":
      return cmdLlen(String(args[0]));
    case "ltrim":
      return cmdLtrim(String(args[0]), Number(args[1]), Number(args[2]));
    case "sadd":
      return cmdSadd(String(args[0]), ...args.slice(1).map(String));
    case "srem":
      return cmdSrem(String(args[0]), ...args.slice(1).map(String));
    case "smembers":
      return cmdSmembers(String(args[0]));
    case "scard":
      return cmdScard(String(args[0]));
    case "scan":
      return cmdScan(String(args[0]), ...args);
    default:
      return null;
  }
}

const CHAINABLE_CMDS = [
  "get",
  "set",
  "del",
  "exists",
  "type",
  "rpush",
  "lrange",
  "llen",
  "ltrim",
  "sadd",
  "srem",
  "smembers",
  "scard",
  "scan",
];

type Op = { cmd: string; args: unknown[] };

// MULTI/pipeline: commands buffer until exec(). exec() first runs the
// concurrent-writer hook, then aborts (returns null) if any watched key changed,
// otherwise applies all queued commands and returns [null, result] pairs.
function makeChain() {
  const ops: Op[] = [];
  const chain: Record<string, unknown> = {
    exec: async () => {
      beforeExecHook?.();
      for (const k of Object.keys(watched)) {
        if ((versions[k] || 0) !== watched[k]) {
          watched = {};
          return null;
        }
      }
      const results: [null, unknown][] = [];
      for (const op of ops) {
        results.push([null, applyCmd(op.cmd, op.args)]);
      }
      watched = {};
      return results;
    },
  };
  for (const cmd of CHAINABLE_CMDS) {
    chain[cmd] = (...args: unknown[]) => {
      ops.push({ cmd, args });
      return chain;
    };
  }
  return chain;
}

export const redis = {
  get: async (k: string) => cmdGet(k),
  set: async (...args: unknown[]) => cmdSet(String(args[0]), String(args[1])),
  del: async (...keys: string[]) => cmdDel(...keys),
  exists: async (k: string) => cmdExists(k),
  type: async (k: string) => cmdType(k),
  rpush: async (k: string, ...vals: string[]) => cmdRpush(k, ...vals),
  lrange: async (k: string, s: number, e: number) => cmdLrange(k, s, e),
  llen: async (k: string) => cmdLlen(k),
  ltrim: async (k: string, s: number, e: number) => cmdLtrim(k, s, e),
  sadd: async (k: string, ...members: string[]) => cmdSadd(k, ...members),
  srem: async (k: string, ...members: string[]) => cmdSrem(k, ...members),
  smembers: async (k: string) => cmdSmembers(k),
  scard: async (k: string) => cmdScard(k),
  scan: async (cursor: string, ...args: unknown[]) => cmdScan(cursor, ...args),
  watch: async (...keys: string[]) => {
    for (const k of keys) {
      watched[k] = versions[k] || 0;
    }
    return "OK";
  },
  unwatch: async () => {
    watched = {};
    return "OK";
  },
  multi: () => makeChain(),
  pipeline: () => makeChain(),
};

export function key(k: string): string {
  return "ss:" + k;
}

export async function getJSON<T>(k: string): Promise<T | null> {
  try {
    const raw = await redis.get(key(k));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setJSON(k: string, val: unknown): Promise<boolean> {
  try {
    await redis.set(key(k), JSON.stringify(val));
    return true;
  } catch {
    return false;
  }
}

export async function setJSONex(k: string, val: unknown, ms: number): Promise<boolean> {
  try {
    await redis.set(key(k), JSON.stringify(val), "PX", String(ms));
    return true;
  } catch {
    return false;
  }
}

export async function delKey(k: string): Promise<boolean> {
  try {
    await redis.del(key(k));
    return true;
  } catch {
    return false;
  }
}

const fakeExports = { redis, key, getJSON, setJSON, setJSONex, delKey };

// Must be called BEFORE any dynamic import of ../services/history or
// ../services/files so the real module (which connects to Redis at import time)
// is never loaded.
export function installRedisMock(): void {
  mock.module(path.join(import.meta.dir, "..", "src", "services", "redis"), () => fakeExports);
  mock.module("../src/services/redis", () => fakeExports);
}