import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";

import { redisConnectionOptions } from "../rate-limit/redis-connection.js";

const LOCK_TTL_MS = 30_000;

const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface ProjectCreateLease {
  release(): Promise<void>;
}

@Injectable()
export class ProjectCreateLock implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(redisConnectionOptions());
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  async acquire(userId: string): Promise<ProjectCreateLease | null> {
    const key = `project:create:user:${userId}`;
    const token = randomUUID();
    let acquired: string | null;
    try {
      acquired = await this.redis.set(key, token, "PX", LOCK_TTL_MS, "NX");
    } catch {
      return { release: async () => undefined };
    }
    if (acquired !== "OK") return null;
    return {
      release: async () => {
        await this.redis.eval(RELEASE, 1, key, token).catch(() => undefined);
      },
    };
  }
}
