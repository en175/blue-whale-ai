import { describe, expect, it, vi } from "vitest";

import { createIdentityUserRepo, USER_STATUS_NORMAL } from "./identity-user-repo.js";

function fakePrisma(row: Record<string, unknown> | null) {
  const findFirst = vi.fn().mockResolvedValue(row);
  const update = vi.fn().mockResolvedValue({});
  return {
    prisma: { bw_users: { findFirst, update } } as never,
    findFirst,
    update,
  };
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 42n,
    username: "alice",
    email: null,
    phone: null,
    status: USER_STATUS_NORMAL,
    password: "$2a$10$hash",
    must_change_password: false,
    ...over,
  };
}

describe("identity-user-repo 的 must_change_password", () => {
  it("★ 查询带出该列：重置过的账号 mustChangePassword 为真", async () => {
    const { prisma } = fakePrisma(row({ must_change_password: true }));
    const repo = createIdentityUserRepo(prisma);

    const found = await repo.findById("42");

    expect(found?.mustChangePassword).toBe(true);
  });

  it("未被重置的账号为假（默认值不被读成真）", async () => {
    const { prisma } = fakePrisma(row({ must_change_password: false }));

    expect((await createIdentityUserRepo(prisma).findById("42"))?.mustChangePassword).toBe(
      false,
    );
  });

  it("★ 写口令时同写该标记：重置置真、自助改密置假", async () => {
    const { prisma, update } = fakePrisma(row());
    const repo = createIdentityUserRepo(prisma);

    await repo.updatePassword("42", "$2a$10$new", true);
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          password: "$2a$10$new",
          must_change_password: true,
        }),
      }),
    );

    await repo.updatePassword("42", "$2a$10$newer", false);
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ must_change_password: false }),
      }),
    );
  });
});

function uniqueViolation(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

function fakePhonePrisma(
  createImpl?: (args: { data: Record<string, unknown> }) => Promise<unknown>,
) {
  const findFirst = vi.fn().mockResolvedValue(null);
  const createMock = vi.fn(
    createImpl ??
      (async (args: { data: Record<string, unknown> }) =>
        row({
          id: 8n,
          username: args.data.username,
          nickname: args.data.nickname,
          phone: args.data.phone,
        })),
  );
  return {
    prisma: { bw_users: { findFirst, create: createMock, update: vi.fn() } } as never,
    findFirst,
    createMock,
  };
}

describe("identity-user-repo 手机号建号（统一建号路径）", () => {
  it("手机号已存在时直接返回，不建号，created=false", async () => {
    const { prisma, findFirst, createMock } = fakePhonePrisma();
    findFirst.mockResolvedValue(row({ id: 7n, username: "老用户", phone: "13800000004" }));

    const out = await createIdentityUserRepo(prisma).upsertPhone("13800000004");

    expect(out).toMatchObject({
      user: { id: "7", username: "老用户" },
      created: false,
      deleted: false,
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("软删账号按 deleted 返回，交由调用方拒绝", async () => {
    const { prisma, findFirst } = fakePhonePrisma();
    findFirst.mockResolvedValue(row({ id: 9n, is_delete: true }));

    const out = await createIdentityUserRepo(prisma).upsertPhone("13800000009");

    expect(out).toMatchObject({ deleted: true, created: false });
  });

  it("新号写默认昵称（蓝鲸用户_ 前缀 + 6 位），created=true", async () => {
    const { prisma, createMock } = fakePhonePrisma();

    const out = await createIdentityUserRepo(prisma).upsertPhone("13800000005");

    expect(out).toMatchObject({
      user: { phone: "13800000005" },
      created: true,
    });
    const data = (createMock.mock.calls[0]![0] as { data: { nickname: string } }).data;
    expect(data.nickname).toMatch(/^蓝鲸用户_[A-Za-z0-9]{6}$/);
  });

  it("并发撞手机号唯一键时回查已有用户，不重试", async () => {
    const { prisma, findFirst, createMock } = fakePhonePrisma(async () => {
      throw uniqueViolation();
    });
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row({ id: 11n, username: "抢到的用户" }));

    const out = await createIdentityUserRepo(prisma).upsertPhone("13800000006");

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({
      user: { id: "11", username: "抢到的用户" },
      created: false,
    });
  });

  it("确属用户名撞车时换名字重试", async () => {
    let calls = 0;
    const { prisma, createMock } = fakePhonePrisma(async () => {
      calls++;
      if (calls === 1) throw uniqueViolation();
      return row({ id: 2n, username: "用户0002" });
    });

    const out = await createIdentityUserRepo(prisma).upsertPhone("13800000001");

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ user: { id: "2", username: "用户0002" } });
  });

  it("连续撞满上限时抛出可诊断错误", async () => {
    const { prisma, createMock } = fakePhonePrisma(async () => {
      throw uniqueViolation();
    });

    await expect(
      createIdentityUserRepo(prisma).upsertPhone("13800000002"),
    ).rejects.toThrow(/连续 5 次撞车/);
    expect(createMock).toHaveBeenCalledTimes(5);
  });

  it("非唯一约束错误直接抛出，不重试", async () => {
    const { prisma, createMock } = fakePhonePrisma(async () => {
      throw Object.assign(new Error("connection lost"), { code: "P1001" });
    });

    await expect(
      createIdentityUserRepo(prisma).upsertPhone("13800000003"),
    ).rejects.toThrow("connection lost");
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
