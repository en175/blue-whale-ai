import { describe, expect, it, vi } from "vitest";

import { createAuthRepo } from "./auth-repo.js";

function fakePrisma() {
  const codeCreate = vi.fn().mockResolvedValue({ id: 9n });
  const codeUpdate = vi.fn().mockResolvedValue({ attempts: 1 });
  const codeUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
  const codeFindFirst = vi.fn().mockResolvedValue(null);

  return {
    prisma: {
      bw_verification_codes: {
        create: codeCreate,
        update: codeUpdate,
        updateMany: codeUpdateMany,
        findFirst: codeFindFirst,
      },
    } as never,
    codeCreate,
    codeUpdate,
    codeUpdateMany,
    codeFindFirst,
  };
}

describe("auth-repo 验证码（用途隔离与次数）", () => {
  it("写码时落 purpose/code/expire，attempts 从 0 开始", async () => {
    const { prisma, codeCreate } = fakePrisma();
    const repo = createAuthRepo(prisma);

    const created = await repo.createVerificationCode({
      phone: "13800000000",
      purpose: "login",
      code: "123456",
      ip: "127.0.0.1",
      expiresAt: new Date("2026-10-21T12:05:00+08:00"),
    });

    expect(created).toEqual({ id: "9" });
    expect(codeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone: "13800000000",
        purpose: "login",
        code: "123456",
        attempts: 0,
        is_used: false,
      }),
    });
  });

  it("新码受理后把同号同用途的旧未用码全部作废，保留新码", async () => {
    const { prisma, codeUpdateMany } = fakePrisma();
    const repo = createAuthRepo(prisma);

    await repo.invalidateOtherCodes("13800000000", "login", "9");

    expect(codeUpdateMany).toHaveBeenCalledWith({
      where: {
        phone: "13800000000",
        purpose: "login",
        is_used: false,
        id: { not: 9n },
      },
      data: { is_used: true },
    });
  });

  it("查有效码按 phone + 用途集合过滤，并带出已错次数", async () => {
    const { prisma } = fakePrisma();
    const findFirst = vi.fn().mockResolvedValue({
      id: 9n,
      code: "123456",
      attempts: 2,
      purpose: "login",
    });
    (prisma as unknown as { bw_verification_codes: { findFirst: unknown } })
      .bw_verification_codes.findFirst = findFirst;

    const record = await createAuthRepo(prisma).findActiveCode("13800000000", [
      "login",
      "legacy",
    ]);

    expect(record).toEqual({ id: "9", code: "123456", attempts: 2, purpose: "login" });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          phone: "13800000000",
          purpose: { in: ["login", "legacy"] },
          is_used: false,
        }),
      }),
    );
  });

  it("一次性消费：只有把未用码改成已用的那一次返回 true", async () => {
    const { prisma, codeUpdateMany } = fakePrisma();
    const repo = createAuthRepo(prisma);

    codeUpdateMany.mockResolvedValueOnce({ count: 1 });
    await expect(repo.consumeCode("9")).resolves.toBe(true);

    codeUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repo.consumeCode("9")).resolves.toBe(false);
  });

  it("错码累加次数并返回新值", async () => {
    const { prisma, codeUpdate } = fakePrisma();
    const repo = createAuthRepo(prisma);

    await expect(repo.incrementAttempts("9")).resolves.toBe(1);
    expect(codeUpdate).toHaveBeenCalledWith({
      where: { id: 9n },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
  });
});
