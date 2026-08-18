// Redis backup loop — faithful port of the old server's backup.js.
import Redis, { type RedisOptions } from "ioredis";
import { BACKUP_INTERVAL_MS, REDIS_BACKUP_URL } from "../config/env";

let _backupRedis: Redis | null = null;
let _lastKeyCount: number | null = null;

function getBackupRedis(): Redis | null {
  if (!_backupRedis && REDIS_BACKUP_URL) {
    const opts: RedisOptions = {
      maxRetriesPerRequest: 2,
      retryStrategy: (times: number) => Math.min(times * 300, 3000),
      lazyConnect: true,
    };
    if (REDIS_BACKUP_URL.startsWith("rediss://") || REDIS_BACKUP_URL.includes("upstash.io")) {
      opts.tls = {};
    }
    _backupRedis = new Redis(REDIS_BACKUP_URL, opts);
    _backupRedis.on("error", (err) => {
      console.error("[Backup] Backup Redis error: " + err.message);
    });
  }
  return _backupRedis;
}

async function copyKeys(source: Redis, dest: Redis): Promise<{ count: number; errors: number }> {
  let count = 0;
  let errors = 0;
  let cursor = "0";
  do {
    const result = await source.scan(cursor, "MATCH", "ss:*", "COUNT", "500");
    cursor = result[0];
    for (const key of result[1]) {
      try {
        const type = await source.type(key);
        const ttl = await source.ttl(key);
        if (type === "string") {
          const val = await source.get(key);
          if (val !== null) {
            if (ttl > 0) await dest.set(key, val, "PX", ttl * 1000);
            else await dest.set(key, val);
            count++;
          }
        } else if (type === "list") {
          const items = await source.lrange(key, 0, -1);
          if (items.length > 0) {
            await dest.del(key);
            await dest.rpush(key, ...items);
            if (ttl > 0) await dest.pexpire(key, ttl * 1000);
            count++;
          }
        } else if (type === "set") {
          const members = await source.smembers(key);
          if (members.length > 0) {
            await dest.del(key);
            await dest.sadd(key, ...members);
            if (ttl > 0) await dest.pexpire(key, ttl * 1000);
            count++;
          }
        } else if (type === "hash") {
          const obj = await source.hgetall(key);
          const keys = Object.keys(obj);
          if (keys.length > 0) {
            await dest.del(key);
            const bulk: string[] = [];
            for (const hk of keys) bulk.push(hk, obj[hk]);
            await dest.hset(key, bulk);
            if (ttl > 0) await dest.pexpire(key, ttl * 1000);
            count++;
          }
        } else {
          const data = await source.dump(key);
          if (data) {
            await dest.restore(key, ttl > 0 ? ttl * 1000 : 0, data, "REPLACE");
            count++;
          }
        }
      } catch (e) {
        errors++;
        if (errors <= 3) console.error("[Backup] copy failed for " + key + ": " + (e as Error).message);
      }
    }
  } while (cursor !== "0");
  if (errors > 0) console.error("[Backup] " + errors + " key(s) failed to copy");
  return { count, errors };
}

export async function createBackup(source: Redis): Promise<number> {
  try {
    const dest = getBackupRedis();
    if (!dest) return -1;
    if (dest.status !== "ready") {
      try {
        await dest.connect();
      } catch (e) {
        console.error("[Backup] connect failed: " + (e as Error).message);
        return -1;
      }
    }

    const dirty = await source.get("ss:meta:dirty");
    if (!dirty && _lastKeyCount !== null) return 0;

    const keyCount = await source.dbsize();
    const result = await copyKeys(source, dest);
    if (result.errors > 0) {
      console.error("[Backup] Copy had " + result.errors + " error(s), keeping dirty marker for retry");
      return result.count;
    }
    const dirtyAfter = await source.get("ss:meta:dirty");
    if (dirtyAfter && dirtyAfter !== dirty) {
      console.log("[Backup] New write during copy, keeping dirty marker");
      return result.count;
    }
    // Atomically delete the marker ONLY if it still holds the value we just
    // observed. If a writer updated ss:meta:dirty between the read above and
    // this delete, the compare-and-delete skips it and the next pass re-syncs.
    await source.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      "ss:meta:dirty",
      dirtyAfter || "",
    );
    console.log(
      "[Backup] Synced " + result.count + " ss:* keys" +
      (keyCount === _lastKeyCount ? "" : " (" + _lastKeyCount + "→" + keyCount + " total)"),
    );
    _lastKeyCount = keyCount;
    return result.count;
  } catch (e) {
    console.error("[Backup] createBackup error: " + (e as Error).message);
    return -1;
  }
}

export async function restoreFromBackup(dest: Redis): Promise<boolean> {
  try {
    const dbsize = await dest.dbsize();
    if (dbsize > 3) {
      console.log("[Backup] Main Redis has " + dbsize + " keys, skipping restore");
      return false;
    }

    const source = getBackupRedis();
    if (!source) return false;
    if (source.status !== "ready") {
      try {
        await source.connect();
      } catch (e) {
        console.error("[Backup] restore connect failed: " + (e as Error).message);
        return false;
      }
    }

    const backupCount = await source.dbsize();
    if (backupCount === 0) return false;

    const result = await copyKeys(source, dest);
    console.log("[Backup] Restored " + result.count + " keys from backup Redis");
    return result.count > 0;
  } catch (e) {
    console.error("[Backup] restoreFromBackup error: " + (e as Error).message);
    return false;
  }
}

export function startBackupLoop(source: Redis): void {
  if (!REDIS_BACKUP_URL) return;
  setTimeout(async () => {
    await createBackup(source);
    setInterval(() => {
      void createBackup(source);
    }, BACKUP_INTERVAL_MS);
    console.log("[Backup] Scheduled every " + BACKUP_INTERVAL_MS / 60000 + " min");
  }, 10000);
}
