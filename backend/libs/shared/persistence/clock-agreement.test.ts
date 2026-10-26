import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { assertClockAgreement } from "./clock-agreement.js";

function clientReturning(skew: number): PrismaClient {
  return { $queryRaw: vi.fn(async () => [{ skew }]) } as unknown as PrismaClient;
}

const PROCESS_SKEW = -new Date().getTimezoneOffset() * 60;

describe("assertClockAgreement", () => {
  it("进程与库同一个钟 → 放行", async () => {
    await expect(assertClockAgreement(clientReturning(PROCESS_SKEW))).resolves.toBeUndefined();
  });

  it("差 8 小时 → 拒绝，并指出是哪一侧", async () => {
    await expect(
      assertClockAgreement(clientReturning(PROCESS_SKEW - 28_800)),
    ).rejects.toThrow(/进程时区与数据库会话时区不一致/);
  });

  it("一分钟容差内仍放行", async () => {
    await expect(assertClockAgreement(clientReturning(PROCESS_SKEW + 59))).resolves.toBeUndefined();
  });

  it("★ 库不可达 → 报「不可达」，不冒充时钟不一致", async () => {
    const unreachable = {
      $queryRaw: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.1:3306");
      }),
    } as unknown as PrismaClient;

    await expect(assertClockAgreement(unreachable)).rejects.toThrow(/数据库不可达/);
    await expect(assertClockAgreement(unreachable)).rejects.not.toThrow(/不一致/);
  });
});
