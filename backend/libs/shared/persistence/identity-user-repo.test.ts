import { describe, expect, it, vi } from "vitest";

import { createIdentityUserRepo, USER_STATUS_NORMAL } from "./identity-user-repo.js";

/**
 * IKJABH：`must_change_password` 的读写。
 *
 * <p>三轨迁移（SQL + parity 测试）只保证**列存在**，保证不了代码真的在用它。
 * 而这里的两处漏法都不会报错：
 *
 * <ul>
 *   <li>`SELECT` 里漏了这一列 → `hydrate` 拿到 undefined → 恒为假 →
 *       **被重置过的账号永远不会被要求改密**，管理员交付的临时口令永久有效；</li>
 *   <li>`updatePassword` 里漏写它 → 用户自己改完密码标记还留着，
 *       之后每次登录都被拦去改密。</li>
 * </ul>
 *
 * <p>用假 Prisma 而不是 mock 掉整个 repo：repo 的职责就是「Prisma 行 ↔ 领域行」
 * 的翻译，把翻译本身 mock 掉等于什么都没测。
 */
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
    // 漏了 SELECT 里那一列时，这里得到的是 undefined —— 一个恒为「不需要改密」的账号，
    // 而且全程没有任何报错。
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
    // 两个字段是一次动作里成对变的两种取值，所以走同一个方法。
    // 漏写任何一个方向都会让状态卡在错误的那一边。
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
