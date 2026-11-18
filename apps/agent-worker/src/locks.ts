import Redis from "ioredis";
import { ScoutLock } from "@repo/agent-core";
import { env } from "@repo/config-env";

export interface ActiveLock {
  scoutId: string;
  source: "manual" | "scheduled";
  acquiredAt: string;
  workerId?: string;
  ttlMs?: number;
}

export class RedisScoutLockManager implements ScoutLock {
  private redis: Redis | null = null;
  private memoryLocks = new Map<string, ActiveLock>();
  private readonly keyPrefix = "forager:lock:scout:";
  private readonly defaultTtlMs = 15 * 60 * 1000;
  private readonly workerId = `worker_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

  private hasWarnedConnection = false;

  constructor(redisUrl?: string) {
    let targetUrl = redisUrl || env.REDIS_URL;
    if (targetUrl) {
      if (targetUrl.startsWith("http://")) {
        targetUrl = targetUrl.replace(/^http:\/\//, "redis://");
      } else if (targetUrl.startsWith("https://")) {
        targetUrl = targetUrl.replace(/^https:\/\//, "rediss://");
      }

      try {
        this.redis = new Redis(targetUrl, {
          maxRetriesPerRequest: 1,
          lazyConnect: true,
          enableReadyCheck: false,
          retryStrategy: (times) => {
            if (times > 2) {
              return null;
            }
            return 1000;
          },
        });

        this.redis.on("error", (err) => {
          if (!this.hasWarnedConnection) {
            this.hasWarnedConnection = true;
            console.warn("[RedisLock] Redis connection warning, fallback active:", err.message);
          }
        });

        this.redis.connect().catch((err) => {
          if (!this.hasWarnedConnection) {
            this.hasWarnedConnection = true;
            console.warn("[RedisLock] Initial Redis connect failed, memory fallback active:", err.message);
          }
          try {
            this.redis?.disconnect();
          } catch {}
          this.redis = null;
        });
      } catch (err) {
        console.warn("[RedisLock] Failed to initialize Redis client, memory fallback active:", (err as Error).message);
        this.redis = null;
      }
    }
  }

  acquire(scoutId: string, source: "manual" | "scheduled", ttlMs = this.defaultTtlMs): boolean | Promise<boolean> {
    const now = new Date().toISOString();
    const payload: ActiveLock = {
      scoutId,
      source,
      acquiredAt: now,
      workerId: this.workerId,
      ttlMs,
    };

    if (this.redis && this.redis.status === "ready") {
      return (async () => {
        try {
          const key = `${this.keyPrefix}${scoutId}`;
          const result = await this.redis!.set(key, JSON.stringify(payload), "PX", ttlMs, "NX");
          return result === "OK";
        } catch (err) {
          console.warn(`[RedisLock] Redis acquire error for ${scoutId}, falling back to memory:`, (err as Error).message);
        }
        if (this.memoryLocks.has(scoutId)) {
          return false;
        }
        this.memoryLocks.set(scoutId, payload);
        return true;
      })();
    }

    if (this.memoryLocks.has(scoutId)) {
      return false;
    }
    this.memoryLocks.set(scoutId, payload);
    return true;
  }

  release(scoutId: string): void | Promise<void> {
    if (this.redis && this.redis.status === "ready") {
      return (async () => {
        try {
          const key = `${this.keyPrefix}${scoutId}`;
          await this.redis!.del(key);
        } catch (err) {
          console.warn(`[RedisLock] Redis release error for ${scoutId}:`, (err as Error).message);
        }
        this.memoryLocks.delete(scoutId);
      })();
    }

    this.memoryLocks.delete(scoutId);
  }

  isLocked(scoutId: string): boolean | Promise<boolean> {
    if (this.redis && this.redis.status === "ready") {
      return (async () => {
        try {
          const key = `${this.keyPrefix}${scoutId}`;
          const exists = await this.redis!.exists(key);
          return exists === 1;
        } catch (err) {
          console.warn(`[RedisLock] Redis isLocked check error for ${scoutId}:`, (err as Error).message);
        }
        return this.memoryLocks.has(scoutId);
      })();
    }

    return this.memoryLocks.has(scoutId);
  }

  getActiveLocks(): ActiveLock[] | Promise<ActiveLock[]> {
    if (this.redis && this.redis.status === "ready") {
      return (async () => {
        try {
          const keys = await this.redis!.keys(`${this.keyPrefix}*`);
          if (keys.length === 0) return [];

          const values = await this.redis!.mget(keys);
          const active: ActiveLock[] = [];
          for (const val of values) {
            if (val) {
              try {
                active.push(JSON.parse(val));
              } catch {}
            }
          }
          return active;
        } catch (err) {
          console.warn("[RedisLock] Redis getActiveLocks error:", (err as Error).message);
        }
        return Array.from(this.memoryLocks.values());
      })();
    }

    return Array.from(this.memoryLocks.values());
  }

  clear(): void | Promise<void> {
    if (this.redis && this.redis.status === "ready") {
      return (async () => {
        try {
          const keys = await this.redis!.keys(`${this.keyPrefix}*`);
          if (keys.length > 0) {
            await this.redis!.del(...keys);
          }
        } catch (err) {
          console.warn("[RedisLock] Redis clear error:", (err as Error).message);
        }
        this.memoryLocks.clear();
      })();
    }

    this.memoryLocks.clear();
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        this.redis.disconnect();
      }
    }
  }
}

export const lockManager = new RedisScoutLockManager();
export const ScoutLockManager = RedisScoutLockManager;
