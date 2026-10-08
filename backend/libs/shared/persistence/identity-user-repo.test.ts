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
