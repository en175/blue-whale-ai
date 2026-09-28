import { describe, expect, it, vi } from "vitest";

import { createAuthRepo } from "./auth-repo.js";

/**
 * 自动注册的用户名重试。
 *
 * <p>背景：`identity_users.username` 变成唯一索引之后，随机用户名（`randomInt(0, 10000)`）
 * 的撞车从「静默产生两个同名用户」变成了「注册直接失败」。这个文件钉住修复。
 */

/** 唯一约束冲突的错误形状（Prisma P2002）。 */
function uniqueViolation(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

type CreateImpl = (args: unknown) => Promise<{ id: bigint; username: string }>;

/**
 * 只暴露**新表名**的假 Prisma。
 *
 * ⚠️ 这不是省事，是一条断言：repo 里若还残留 `prisma.users` / `prisma.verification_codes`，
 * 这里会直接是 undefined 而炸掉——表改名这件事靠它才测得到。
 */
function fakePrisma(create?: CreateImpl) {
  const findFirst = vi.fn().mockResolvedValue(null);
  const createMock = vi.fn(create ?? (async () => ({ id: 1n, username: "用户0001" })));
  const codeCreate = vi.fn().mockResolvedValue({ id: 1n });
  const codeUpdate = vi.fn().mockResolvedValue({ id: 1n });

  return {
    prisma: {
      identity_users: { findFirst, create: createMock },
      identity_verification_codes: { create: codeCreate, update: codeUpdate },
    } as never,
    findFirst,
    createMock,
    codeCreate,
    codeUpdate,
  };
}

describe("auth-repo 表名（identity_ 前缀）", () => {
  it("验证码读写走 identity_verification_codes", async () => {
    const { prisma, codeCreate, codeUpdate } = fakePrisma();
    const repo = createAuthRepo(prisma);

    await repo.createVerificationCode({
      phone: "13800000000",
      code: "123456",
      ip: "127.0.0.1",
      expiresAt: new Date("2026-09-24T12:05:00+08:00"),
    });
    await repo.markCodeUsed("1");

    expect(codeCreate).toHaveBeenCalled();
    expect(codeUpdate).toHaveBeenCalled();
  });

  it("用户查询走 identity_users", async () => {
    const { prisma, findFirst } = fakePrisma();
    await createAuthRepo(prisma).upsertUser("13800000000");
    expect(findFirst).toHaveBeenCalledWith({ where: { phone: "13800000000" } });
  });
});

describe("auth-repo 自动注册的用户名撞车重试", () => {
  it("首次就成功时不重试", async () => {
    const { prisma, createMock } = fakePrisma();

    const user = await createAuthRepo(prisma).upsertUser("13800000000");

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(user).toMatchObject({ id: "1", username: "用户0001", phone: "13800000000" });
  });

  it("撞车后换一个名字重试，最终成功", async () => {
    // ★ 这条是本次修复的核心：username 唯一之后，1 万个取值的随机空间
    //   约 120 个用户就有一半概率撞上。不重试的话，用户看到的是「注册失败」。
    let calls = 0;
    const { prisma } = fakePrisma(async () => {
      calls++;
      if (calls === 1) throw uniqueViolation();
      return { id: 2n, username: "用户0002" };
    });

    const user = await createAuthRepo(prisma).upsertUser("13800000001");

    expect(calls).toBe(2);
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
    // 重试解不了的问题（比如并发建号撞 phone）重试只是把错误变成超时。
    const { prisma, createMock } = fakePrisma(async () => {
      throw Object.assign(new Error("connection lost"), { code: "P1001" });
    });

    await expect(createAuthRepo(prisma).upsertUser("13800000003")).rejects.toThrow(
      "connection lost",
    );
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("手机号已存在时直接返回，不建号", async () => {
    const { prisma, findFirst, createMock } = fakePrisma();
    findFirst.mockResolvedValue({ id: 7n, username: "老用户" });

    const user = await createAuthRepo(prisma).upsertUser("13800000004");

    expect(user).toMatchObject({ id: "7", username: "老用户" });
    expect(createMock).not.toHaveBeenCalled();
  });
});
