import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { redisConnectionOptions } from "@lib/shared/rate-limit/redis-connection.js";

export type PhoneActionKind = "rebind" | "migration";

export interface PhoneActionPayload {
  kind: PhoneActionKind;
  userId: number;
  phone?: string | undefined;
}

const ACTION_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class PhoneActionService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(redisConnectionOptions());
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  private key(token: string): string {
    return `phone_action:${createHash("sha256").update(token).digest("hex")}`;
  }

  async issue(payload: PhoneActionPayload): Promise<string> {
    const token = `pa_${randomBytes(24).toString("base64url")}`;
    await this.redis.set(
      this.key(token),
      JSON.stringify(payload),
      "PX",
      ACTION_TTL_MS,
    );
    return token;
  }

  async resolve(kind: PhoneActionKind, token: string): Promise<PhoneActionPayload | null> {
    const raw = await this.redis.get(this.key(token));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PhoneActionPayload;
      if (parsed.kind !== kind || typeof parsed.userId !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async revoke(token: string): Promise<void> {
    await this.redis.del(this.key(token));
  }
}
