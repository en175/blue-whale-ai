import type { PrismaClient } from "@prisma/client";
import { maskIdentifier } from "@lib/core";
import {
  createOperationLogRepo,
  OPERATION_STATUS_FAILED,
  OPERATION_STATUS_SUCCEEDED,
} from "./operation-log-repo.js";

export interface IdentityLoginLogRepo {
  record(entry: {
    userId?: string | null | undefined;
    username: string;
    ip: string;
    userAgent: string;
    success: boolean;
    reason?: string | undefined;
  }): Promise<void>;
}

export function createIdentityLoginLogRepo(prisma: PrismaClient): IdentityLoginLogRepo {
  const logs = createOperationLogRepo(prisma);
  return {
    async record(entry) {
      const identifier = maskIdentifier(entry.username);
      await logs.create({
        category: "auth",
        action: entry.success ? "login_success" : "login_failed",
        target: identifier,
        targetUserId: entry.userId ?? null,
        detail: JSON.stringify({
          success: entry.success,
          reason: (entry.reason ?? "").slice(0, 64),
          user_agent: entry.userAgent.slice(0, 255),
        }),
        operator: identifier,
        operatorId: entry.userId ?? null,
        ipAddress: entry.ip,
        status: entry.success
          ? OPERATION_STATUS_SUCCEEDED
          : OPERATION_STATUS_FAILED,
      });
    },
  };
}
