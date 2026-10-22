import { describe, expect, it, vi } from "vitest";

import { createAuthRepo } from "./auth-repo.js";

function uniqueViolation(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

type UserRow = {
  id: bigint;
  username: string;
  nickname: string | null;
  phone: string | null;
  status: string;
  is_delete: boolean;
};

type CreateImpl = (args: unknown) => Promise<UserRow>;

function userRow(over: Partial<UserRow> = {}): UserRow {
  return {
    id: 1n,
    username: "用户0001",
    nickname: "蓝鲸用户_Ab12Cd",
    phone: "13800000000",
    status: "NORMAL",
    is_delete: false,
    ...over,
  };
}

function fakePrisma(create?: CreateImpl) {
  const findFirst = vi.fn().mockResolvedValue(null);
  const createMock = vi.fn(create ?? (async () => userRow()));
  const codeCreate = vi.fn().mockResolvedValue({ id: 9n });
  const codeUpdate = vi.fn().mockResolvedValue({ attempts: 1 });
  const codeUpdateMany = vi.fn().mockResolvedValue({ count: 2 });

  return {
    prisma: {
      bw_users: { findFirst, create: createMock },
      bw_verification_codes: {
        create: codeCreate,
        update: codeUpdate,
        updateMany: codeUpdateMany,
      },
    } as never,
    findFirst,
    createMock,
    codeCreate,
    codeUpdate,
    codeUpdateMany,
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

describe("auth-repo 手机号建号", () => {
  it("手机号已存在时直接返回，不建号，且 created=false", async () => {
    const { prisma, findFirst, createMock } = fakePrisma();
    findFirst.mockResolvedValue(userRow({ id: 7n, username: "老用户", nickname: null }));

    const user = await createAuthRepo(prisma).upsertUser("13800000004");

    expect(user).toMatchObject({ id: "7", username: "老用户", created: false });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("新建号写默认昵称（蓝鲸用户_ 前缀 + 6 位），created=true", async () => {
    const { prisma, createMock } = fakePrisma();
    createMock.mockResolvedValue(userRow({ id: 8n, phone: "13800000005" }));

    const user = await createAuthRepo(prisma).upsertUser("13800000005");

    expect(user).toMatchObject({ id: "8", phone: "13800000005", created: true });
    const data = (createMock.mock.calls[0]![0] as { data: { nickname: string } }).data;
    expect(data.nickname).toMatch(/^蓝鲸用户_[A-Za-z0-9]{6}$/);
  });

  it("并发建号撞手机号唯一键时回查已有用户，不再当用户名冲突重试", async () => {
    const { prisma, findFirst, createMock } = fakePrisma(async () => {
      throw uniqueViolation();
    });
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(userRow({ id: 11n, username: "抢到的用户" }));

    const user = await createAuthRepo(prisma).upsertUser("13800000006");

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(user).toMatchObject({ id: "11", username: "抢到的用户", created: false });
  });

  it("确属用户名撞车时换名字重试", async () => {
    let calls = 0;
    const { prisma, createMock } = fakePrisma(async () => {
      calls++;
      if (calls === 1) throw uniqueViolation();
      return userRow({ id: 2n, username: "用户0002" });
    });

    const user = await createAuthRepo(prisma).upsertUser("13800000001");

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(user).toMatchObject({ id: "2", username: "用户0002" });
  });

  it("连续撞满上限时抛出可诊断的错误，而不是无限重试", async () => {
    const { prisma, createMock } = fakePrisma(async () => {
      throw uniqueViolation();
    });

    await expect(createAuthRepo(prisma).upsertUser("13800000002")).rejects.toThrow(
      /连续 5 次撞车/,
    );
    expect(createMock).toHaveBeenCalledTimes(5);
  });

  it("非唯一约束的错误直接抛出，不重试", async () => {
    const { prisma, createMock } = fakePrisma(async () => {
      throw Object.assign(new Error("connection lost"), { code: "P1001" });
    });

    await expect(createAuthRepo(prisma).upsertUser("13800000003")).rejects.toThrow(
      "connection lost",
    );
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("软删/停用账号也原样返回，由上层决定拒绝（不在 repo 里静默重建）", async () => {
    const { prisma, findFirst } = fakePrisma();
    findFirst.mockResolvedValue(
      userRow({ id: 12n, is_delete: true, status: "DISABLED" }),
    );

    const user = await createAuthRepo(prisma).findByPhone("13800000007");

    expect(user).toMatchObject({ id: "12", isDelete: true, status: "DISABLED" });
  });
});
