import type { PrismaClient } from "@prisma/client";

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
  return {
    async record(entry) {
      await prisma.bw_login_logs.create({
        data: {
          user_id: entry.userId == null ? null : BigInt(entry.userId),
          username: entry.username,
          ip: entry.ip,
          user_agent: entry.userAgent.slice(0, 255),
          success: entry.success,
          reason: (entry.reason ?? "").slice(0, 64),
        },
      });
    },
  };
}
