import { describe, expect, it, vi } from "vitest";

import { createAuthRepo } from "./auth-repo.js";


function uniqueViolation(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

type CreateImpl = (args: unknown) => Promise<{ id: bigint; username: string }>;

function fakePrisma(create?: CreateImpl) {
  const findFirst = vi.fn().mockResolvedValue(null);
  const createMock = vi.fn(create ?? (async () => ({ id: 1n, username: "用户0001" })));
  const codeCreate = vi.fn().mockResolvedValue({ id: 1n });
  const codeUpdate = vi.fn().mockResolvedValue({ id: 1n });

  return {
    prisma: {
      bw_users: { findFirst, create: createMock },
      bw_verification_codes: { create: codeCreate, update: codeUpdate },
    } as never,
    findFirst,
    createMock,
    codeCreate,
    codeUpdate,
  };
}

describe("auth-repo 表名（bw_ 前缀）", () => {
  it("验证码读写走 bw_verification_codes", async () => {
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

  it("用户查询走 bw_users", async () => {
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
    const { prisma, createMock } = fakePrisma(async () => {
      throw Object.assign(new Error("connection lost"), { code: "P1001" });
    });

    await expect(createAuthRepo(prisma).upsertUser("13800000003")).rejects.toThrow(
      "connection lost",
    );
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("手机号已存在时直接返回，不建号，且 created=false", async () => {
    const { prisma, findFirst, createMock } = fakePrisma();
    findFirst.mockResolvedValue({ id: 7n, username: "老用户" });

    const user = await createAuthRepo(prisma).upsertUser("13800000004");

    expect(user).toMatchObject({ id: "7", username: "老用户", created: false });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("新建号时 created=true —— 它就是响应里的 is_new_user", async () => {
    const { prisma, findFirst, createMock } = fakePrisma();
    findFirst.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: 8n, username: "用户0001" });

    const user = await createAuthRepo(prisma).upsertUser("13800000005");

    expect(user).toMatchObject({ id: "8", phone: "13800000005", created: true });
  });
});
