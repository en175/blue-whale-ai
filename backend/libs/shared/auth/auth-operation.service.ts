import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { redisConnectionOptions } from "@lib/shared/rate-limit/redis-connection.js";

export const AUTH_OPERATION_TYPES = [
  "login",
  "bind",
  "rebind",
  "nickname",
  "sms",
  "migration",
] as const;

export type AuthOperationType = (typeof AUTH_OPERATION_TYPES)[number];
export type AuthOperationStatus = "pending" | "succeeded" | "failed";

export interface AuthOperationView {
  id: string;
  type: AuthOperationType;
  userId: number | null;
  status: AuthOperationStatus;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  phone: string | null;
  createdAt: number;
  updatedAt: number;
}

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const TERMINAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const QUERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function newOperationId(): string {
  return `op_${randomBytes(12).toString("base64url")}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class AuthOperationService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(redisConnectionOptions());
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  private key(id: string): string {
    return `auth_op:${id}`;
  }

  private requestKey(type: AuthOperationType, requestId: string): string {
    return `auth_op_req:${type}:${hash(requestId)}`;
  }

  private queryKey(token: string): string {
    return `auth_query:${hash(token)}`;
  }

  async begin(input: {
    type: AuthOperationType;
    userId?: number | null;
    requestId?: string | undefined;
    phone?: string | undefined;
  }): Promise<{ operation: AuthOperationView; duplicate: boolean }> {
    if (input.requestId) {
      const acquired = await this.redis.set(
        this.requestKey(input.type, input.requestId),
        "pending",
        "PX",
        TERMINAL_TTL_MS,
        "NX",
      );
      if (acquired === null) {
        const existingId = await this.redis.get(
          this.requestKey(input.type, input.requestId),
        );
        if (existingId && existingId !== "pending") {
          const existing = await this.get(existingId);
          if (existing) return { operation: existing, duplicate: true };
        }
        const pending = this.pendingRecord(input);
        return { operation: pending, duplicate: true };
      }
    }

    const now = Date.now();
    const operation: AuthOperationView = {
      id: newOperationId(),
      type: input.type,
      userId: input.userId ?? null,
      status: "pending",
      result: null,
      errorCode: null,
      phone: input.phone ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.redis.set(
      this.key(operation.id),
      JSON.stringify(operation),
      "PX",
      PENDING_TTL_MS,
    );
    if (input.requestId) {
      await this.redis.set(
        this.requestKey(input.type, input.requestId),
        operation.id,
        "PX",
        TERMINAL_TTL_MS,
      );
    }
    return { operation, duplicate: false };
  }

  private pendingRecord(input: {
    type: AuthOperationType;
    userId?: number | null;
    phone?: string | undefined;
  }): AuthOperationView {
    const now = Date.now();
    return {
      id: "",
      type: input.type,
      userId: input.userId ?? null,
      status: "pending",
      result: null,
      errorCode: null,
      phone: input.phone ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async succeed(id: string, result: Record<string, unknown>): Promise<void> {
    await this.finish(id, "succeeded", result, null);
  }

  async fail(id: string, errorCode: string): Promise<void> {
    await this.finish(id, "failed", null, errorCode);
  }

  private async finish(
    id: string,
    status: AuthOperationStatus,
    result: Record<string, unknown> | null,
    errorCode: string | null,
  ): Promise<void> {
    if (!id) return;
    const current = await this.get(id);
    if (!current) return;
    const updated: AuthOperationView = {
      ...current,
      status,
      result,
      errorCode,
      updatedAt: Date.now(),
    };
    await this.redis.set(
      this.key(id),
      JSON.stringify(updated),
      "PX",
      TERMINAL_TTL_MS,
    );
  }

  async get(id: string): Promise<AuthOperationView | null> {
    const raw = await this.redis.get(this.key(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthOperationView;
    } catch {
      return null;
    }
  }

  async issueQueryToken(id: string, userId: number): Promise<string> {
    const token = `qry_${randomBytes(24).toString("base64url")}`;
    await this.redis.set(
      this.queryKey(token),
      JSON.stringify({ id, userId, issuedAt: Date.now() }),
      "PX",
      QUERY_TTL_MS,
    );
    return token;
  }

  async verifyQueryToken(token: string, id: string): Promise<boolean> {
    const raw = await this.redis.get(this.queryKey(token));
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as { id?: unknown };
      return parsed.id === id;
    } catch {
      return false;
    }
  }
}

export function maskPhone(phone: string | null): string {
  if (!phone || phone.length < 7) return "";
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}
