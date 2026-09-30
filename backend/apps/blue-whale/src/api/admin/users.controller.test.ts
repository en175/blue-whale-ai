import { beforeEach, describe, expect, it, vi } from "vitest";

// 只替换网络函数，两个错误类用真实现——「billing 没配 / billing 挂了各回什么状态码」
// 是这条端点对外契约的一部分，换成假的等于把这条断言删掉（与 consumption-records.controller.test 同款）。
const { grantCredits } = vi.hoisted(() => ({ grantCredits: vi.fn() }));

vi.mock("@lib/shared/billing/billing-admin-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@lib/shared/billing/billing-admin-client.js")>();
  return { ...actual, grantCredits };
});

import {
  BillingAdminConfigError,
  BillingAdminError,
} from "@lib/shared/billing/billing-admin-client.js";
import { PasswordPolicyError } from "@lib/shared/identity/index.js";
import { AdminUsersController } from "./users.controller.js";

// 冻结强制登出：freeze 在本地把 bw_users.status 置为 DISABLED 后 best-effort
// 踢该用户全部会话，审计 detail 记 revokedSessions；unfreeze 不碰会话。
// 发放积分（adjustBalance）：调 billing 的发放接口，**不写我们自己的库**；只加不减，
// 幂等键必填，审计 action 落 `user.adjust_balance`（前端「调整记录」tab 过滤的就是它）
// 且 detail 带 value。

function createController(overrides: {
  setUserStatus?: ReturnType<typeof vi.fn>;
  revokeAllForUser?: ReturnType<typeof vi.fn>;
  operationLogCreate?: ReturnType<typeof vi.fn>;
  userExists?: ReturnType<typeof vi.fn>;
  listAdminUsers?: ReturnType<typeof vi.fn>;
  listRoleCodes?: ReturnType<typeof vi.fn>;
  resetPassword?: ReturnType<typeof vi.fn>;
} = {}) {
  const operationLog = { create: overrides.operationLogCreate ?? vi.fn().mockResolvedValue(undefined) };
  const sessions = { revokeAllForUser: overrides.revokeAllForUser ?? vi.fn().mockResolvedValue(0) };
  const identity = {
    listAdminUsers: overrides.listAdminUsers ?? vi.fn().mockResolvedValue({ items: [], total: 0 }),
    setUserStatus: overrides.setUserStatus ?? vi.fn().mockResolvedValue(true),
    userExists: overrides.userExists ?? vi.fn().mockResolvedValue(true),
    listRoleCodes: overrides.listRoleCodes ?? vi.fn().mockResolvedValue([]),
    resetPassword: overrides.resetPassword ?? vi.fn().mockResolvedValue(undefined),
  };
  const controller = new AdminUsersController(
    identity as never,
    operationLog as never,
    sessions as never,
  );
  return { controller, identity, operationLog, sessions };
}

const USER = { userId: "1", username: "admin" } as never;
const BEARER = "Bearer sk-admin-token";
const ADMIN_CTX = {
  user: USER,
  rawUserId: "42",
  body: { action: "freeze", reason: "违规" },
  authorization: BEARER,
};

describe("AdminUsersController.manage（冻结强制登出）", () => {
  beforeEach(() => {
    grantCredits.mockReset();
  });

  it("freeze：先本地置 DISABLED，再踢该用户全部会话，返回吊销数", async () => {
    const { controller, identity, sessions } = createController({
      revokeAllForUser: vi.fn().mockResolvedValue(3),
    });
    const order: string[] = [];
    identity.setUserStatus.mockImplementation(async () => {
      order.push("disable");
      return true;
    });
    sessions.revokeAllForUser.mockImplementation(async () => {
      order.push("revoke");
      return 3;
    });

    const result = await controller.manage(
      ADMIN_CTX.user,
      ADMIN_CTX.rawUserId,
      ADMIN_CTX.body,
      ADMIN_CTX.authorization,
    );

    expect(result).toEqual({ success: true, data: { revokedSessions: 3 } });
    expect(order).toEqual(["disable", "revoke"]);
    expect(identity.setUserStatus).toHaveBeenCalledWith(42, "DISABLED");
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42);
  });

  it("freeze：审计 detail 记录 revokedSessions", async () => {
    const { controller, operationLog } = createController({
      revokeAllForUser: vi.fn().mockResolvedValue(2),
    });
    await controller.manage(
      ADMIN_CTX.user,
      ADMIN_CTX.rawUserId,
      ADMIN_CTX.body,
      ADMIN_CTX.authorization,
    );
    expect(operationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "user",
        action: "user.freeze",
        target: "user:42",
        targetUserId: "42",
        detail: expect.stringContaining('"revokedSessions":2'),
      }),
    );
  });

  it("freeze：会话踢出失败为 best-effort，仍返回 success，审计记 revokeError", async () => {
    const { controller, operationLog } = createController({
      revokeAllForUser: vi
        .fn()
        .mockRejectedValue(new Error("redis timeout")),
    });
    const result = await controller.manage(
      ADMIN_CTX.user,
      ADMIN_CTX.rawUserId,
      ADMIN_CTX.body,
      ADMIN_CTX.authorization,
    );
    expect(result).toEqual({ success: true, data: { revokedSessions: 0 } });
    expect(operationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining('"revokeError":"redis timeout"'),
      }),
    );
  });

  it("freeze：写状态失败则不踢会话、整体失败", async () => {
    const { controller, sessions } = createController({
      setUserStatus: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        ADMIN_CTX.body,
        ADMIN_CTX.authorization,
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("freeze：用户不存在 → 404，不静默成功", async () => {
    const { controller, sessions } = createController({
      setUserStatus: vi.fn().mockResolvedValue(false),
    });
    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        ADMIN_CTX.body,
        ADMIN_CTX.authorization,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("unfreeze：把状态置回 NORMAL，不调 revokeAllForUser，响应 data 为 null", async () => {
    const { controller, identity, sessions } = createController();
    const result = await controller.manage(
      ADMIN_CTX.user,
      ADMIN_CTX.rawUserId,
      { action: "unfreeze", reason: "已改正" },
      ADMIN_CTX.authorization,
    );
    expect(result).toEqual({ success: true, data: null });
    expect(identity.setUserStatus).toHaveBeenCalledWith(42, "NORMAL");
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("adjustBalance：调 billing 发放（source=gift / bizType=grant），幂等键取 Idempotency-Key 头", async () => {
    grantCredits.mockResolvedValue({ lotId: "9", duplicated: false, existingBizId: null });
    const { controller, sessions } = createController();

    const result = await controller.manage(
      ADMIN_CTX.user,
      ADMIN_CTX.rawUserId,
      { action: "adjustBalance", reason: "补偿", value: 10 },
      ADMIN_CTX.authorization,
      undefined,
      "key-1",
    );

    expect(grantCredits).toHaveBeenCalledWith({
      userId: 42,
      credits: 10,
      // ⚠️ 这三个值各有一条理由，别当装饰：source 决定有效期与财报口径（赠送=成本）；
      //    bizType 是 idx_ledger__biz 的查询键（写 recharge 会让这笔混进充值那堆）；
      //    bizId 就是幂等键本身。
      source: "gift",
      bizType: "grant",
      bizId: "key-1",
    });
    expect(result).toEqual({ success: true, data: { credits: 10, duplicated: false } });
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("adjustBalance：幂等命中（409）时 credits 为 null、审计不写 value —— 不谎报一次发放", async () => {
    grantCredits.mockResolvedValue({ lotId: "", duplicated: true, existingBizId: "key-1" });
    const { controller, operationLog } = createController();

    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        { action: "adjustBalance", reason: "补偿", value: 10 },
        ADMIN_CTX.authorization,
        undefined,
        "key-1",
      ),
    ).resolves.toEqual({ success: true, data: { credits: null, duplicated: true } });

    // 那一笔是**上一次**发的，而且管理员可能改了数字再重试 —— 把本次请求值写进审计，
    // 就等于让「调整记录」断言一笔账本里查不到的发放。
    const detail = JSON.parse(
      (operationLog.create.mock.calls[0]?.[0] as { detail: string }).detail,
    ) as Record<string, unknown>;
    expect(detail).toMatchObject({ duplicated: true });
    expect(detail).not.toHaveProperty("value");
  });

  it("adjustBalance：用户不存在 → 404，一笔都不发（billing 没有用户表，没人兜底）", async () => {
    const { controller } = createController({
      userExists: vi.fn().mockResolvedValue(false),
    });

    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        { action: "adjustBalance", reason: "补偿", value: 10 },
        ADMIN_CTX.authorization,
        undefined,
        "key-1",
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("adjustBalance：value 超过安全整数范围 → 400（JS 已经四舍五入过，放过去就是发错数）", async () => {
    const { controller } = createController();

    for (const value of [1e21, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        controller.manage(
          ADMIN_CTX.user,
          ADMIN_CTX.rawUserId,
          { action: "adjustBalance", reason: "补偿", value },
          ADMIN_CTX.authorization,
          undefined,
          "key-1",
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("adjustBalance：审计 action 落 user.adjust_balance 且 detail 带 value", async () => {
    grantCredits.mockResolvedValue({ lotId: "9", duplicated: false, existingBizId: null });
    const { controller, operationLog } = createController();

    await controller.manage(
      ADMIN_CTX.user,
      ADMIN_CTX.rawUserId,
      { action: "adjustBalance", reason: "补偿", value: 10 },
      ADMIN_CTX.authorization,
      undefined,
      "key-1",
    );

    // 键名与前端 UserManage 的 ACTION_LABELS / adjusts 过滤是一对：落错名字不会报错，
    // 只会让「调整记录」tab 永远空着。
    expect(operationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.adjust_balance",
        target: "user:42",
        detail: expect.stringContaining('"value":10'),
      }),
    );
  });

  it("adjustBalance：缺 Idempotency-Key → 400，一笔都不发", async () => {
    const { controller } = createController();

    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        { action: "adjustBalance", reason: "补偿", value: 10 },
        ADMIN_CTX.authorization,
        undefined,
        "   ",
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("adjustBalance：value 须为正整数（0/负数/小数/非数字/缺失全拒），一笔都不发", async () => {
    const { controller } = createController();

    for (const value of [0, -5, 1.5, "10", undefined, null, Number.NaN]) {
      await expect(
        controller.manage(
          ADMIN_CTX.user,
          ADMIN_CTX.rawUserId,
          { action: "adjustBalance", reason: "补偿", value },
          ADMIN_CTX.authorization,
          undefined,
          "key-1",
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("adjustBalance：billing 管理端没配 → 503（重试不会好，要人去改配置）", async () => {
    grantCredits.mockRejectedValue(new BillingAdminConfigError("缺 BILLING_ADMIN_URL"));
    const { controller, operationLog } = createController();

    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        { action: "adjustBalance", reason: "补偿", value: 10 },
        ADMIN_CTX.authorization,
        undefined,
        "key-1",
      ),
    ).rejects.toMatchObject({ status: 503 });
    // 没发出去就不能记一笔「发过了」的审计
    expect(operationLog.create).not.toHaveBeenCalled();
  });

  it("adjustBalance：billing 调用失败 → 502 且带原因，绝不静默成功", async () => {
    grantCredits.mockRejectedValue(new BillingAdminError("billing 管理端返回 HTTP 500"));
    const { controller } = createController();

    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        { action: "adjustBalance", reason: "补偿", value: 10 },
        ADMIN_CTX.authorization,
        undefined,
        "key-1",
      ),
    ).rejects.toMatchObject({ status: 502, message: expect.stringContaining("发放积分失败") });
  });

  it("adjustBalance：网络层失败（连接被拒/超时）也是 502，不是 500", async () => {
    // 共享客户端的 `send()` 直接 return fetch(...)，网络异常不包装成 BillingAdminError。
    // 而那恰恰是「billing 挂了」最常见的一种 —— 落成 500 会让值班的人以为是代码问题。
    grantCredits.mockRejectedValue(new TypeError("fetch failed"));
    const { controller } = createController();

    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        { action: "adjustBalance", reason: "补偿", value: 10 },
        ADMIN_CTX.authorization,
        undefined,
        "key-1",
      ),
    ).rejects.toMatchObject({ status: 502, message: expect.stringContaining("不可达") });
  });

  it("userId 非正整数或 reason 缺失 → 400，不调任何写操作", async () => {
    const { controller, identity, sessions } = createController();
    for (const bad of [
      { rawUserId: "abc", body: { action: "freeze", reason: "x" } },
      { rawUserId: "-1", body: { action: "freeze", reason: "x" } },
      { rawUserId: "42", body: { action: "freeze" } },
      { rawUserId: "42", body: { action: "kick", reason: "x" } },
    ]) {
      await expect(
        controller.manage(ADMIN_CTX.user, bad.rawUserId, bad.body, BEARER),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(identity.setUserStatus).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });
});

/**
 * IKJABH：管理员重置密码。
 *
 * <p>它与冻结的性质不同 —— 冻结是「让这个账号暂时不能用」，重置是**交出这个账号**：
 * 管理员填的那个口令就是他登进这个账号的钥匙。所以除了「写库 + 踢会话 + 记审计」，
 * 这里还有两条**权限边界**，一条少了就是一次越权：
 * 不能重置自己（没意义且自锁），不能重置超管（否则任何 admin 一步接管超管）。
 */
describe("AdminUsersController.manage（IKJABH 重置密码）", () => {
  beforeEach(() => {
    grantCredits.mockReset();
  });

  const RESET = { action: "reset_password", reason: "用户报障", password: "TempPass123" };

  function call(controller: AdminUsersController, body: unknown, rawUserId = "42") {
    return controller.manage(USER, rawUserId, body as Record<string, unknown>, BEARER);
  }

  it("重置：写新口令（置强制改密）→ 踢该用户全部会话 → 审计 user.reset_password", async () => {
    const { controller, identity, sessions, operationLog } = createController({
      revokeAllForUser: vi.fn().mockResolvedValue(2),
    });

    const result = await call(controller, RESET);

    // 哨兵：口令与「必须改密」是 repos 那一对的入参，这里只钉住「转交给了 identity」
    expect(identity.resetPassword).toHaveBeenCalledWith(42, "TempPass123");
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42);
    expect(result).toEqual({ success: true, data: { revokedSessions: 2 } });
    expect(operationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "user",
        action: "user.reset_password",
        target: "user:42",
        targetUserId: "42",
        detail: expect.stringContaining('"revokedSessions":2'),
      }),
    );
  });

  it("★ 不能重置自己 → 400，一个字都不写", async () => {
    // 管理员是唯一能重置别人的人，误点一下自己就把自己锁在外面了；
    // 而且「自己重置自己」本来就没有要解决的问题 —— 走自助改密即可。
    const { controller, identity, sessions } = createController();

    await expect(call(controller, RESET, "1")).rejects.toMatchObject({ status: 400 });

    expect(identity.resetPassword).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("★ 不能重置持有 super_admin 的账号 → 403，一个字都不写", async () => {
    // 少了这一条，任何一个 admin 只要重置一次超管、拿自己填的口令登进去，
    // 就等于一步接管了超管 —— 而「谁能进管理端」正是靠 super_admin 分的。
    const { controller, identity, sessions } = createController({
      listRoleCodes: vi.fn().mockResolvedValue(["user", "super_admin"]),
    });

    await expect(call(controller, RESET)).rejects.toMatchObject({ status: 403 });

    expect(identity.resetPassword).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("重置目标不存在 → 404（billing 那边没有用户表，没人兜底）", async () => {
    const { controller, identity } = createController({
      userExists: vi.fn().mockResolvedValue(false),
    });

    await expect(call(controller, RESET)).rejects.toMatchObject({ status: 404 });
    expect(identity.resetPassword).not.toHaveBeenCalled();
  });

  it("口令不合规（PasswordPolicyError）→ 400 而不是 500", async () => {
    // 它是**输入问题**，不是服务故障。不特判的话会走到 toAdminError 的兜底 500，
    // 管理员只能靠自己猜「是不是密码太短了」。
    const { controller, sessions } = createController({
      resetPassword: vi
        .fn()
        .mockRejectedValue(new PasswordPolicyError("密码至少 8 位")),
    });

    await expect(call(controller, RESET)).rejects.toMatchObject({
      status: 400,
      message: "密码至少 8 位",
    });
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("password 缺失 / 非字符串 → 400，不写库", async () => {
    const { controller, identity } = createController();

    for (const password of [undefined, "", 12345678, null]) {
      await expect(
        call(controller, { ...RESET, password }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(identity.resetPassword).not.toHaveBeenCalled();
  });

  it("会话踢出失败为 best-effort：仍成功，审计记 revokeError", async () => {
    // 口令已经落库了，踢会话失败不该把这次重置整个回滚 —— 那会让管理员以为没重置成功、
    // 再点一次。但失败必须落在审计里可见，否则「重置了但人还在线」永远查不出来。
    const { controller, operationLog } = createController({
      revokeAllForUser: vi.fn().mockRejectedValue(new Error("redis timeout")),
    });

    const result = await call(controller, RESET);

    expect(result).toEqual({ success: true, data: { revokedSessions: 0 } });
    expect(operationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining('"revokeError":"redis timeout"'),
      }),
    );
  });
});

/**
 * 列表的余额三列来自 billing（IKJ5M7），于是这条**只读**接口多了一条失败路径 ——
 * 它此前读的是我们自己的库，不可能失败。
 *
 * 两条断言各钉一件事：状态码要能判出「该找谁」（配置错 vs 等服务恢复），
 * 以及**不能**把它兜成空列表 —— 空列表让人得出「一个用户都没有」，
 * 兜成三列全 0 则与「这用户真没积分」长得一模一样，那正是这次要消灭的症状。
 */
describe("AdminUsersController.list（余额三列来自 billing）", () => {
  it("billing 管理端没配 → 503（重试不会好，要人去改配置）", async () => {
    const { controller } = createController({
      listAdminUsers: vi
        .fn()
        .mockRejectedValue(new BillingAdminConfigError("缺 BILLING_ADMIN_URL")),
    });

    await expect(controller.list(USER, BEARER, {})).rejects.toMatchObject({ status: 503 });
  });

  it("billing 调用失败 → 502 且带原因，不回落成空列表", async () => {
    const { controller } = createController({
      listAdminUsers: vi.fn().mockRejectedValue(new BillingAdminError("服务不可用")),
    });

    await expect(controller.list(USER, BEARER, {})).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("用户列表查询失败"),
    });
  });

  /**
   * ★ **不是 billing 的失败就不许冒充 billing 故障**。
   *
   * <p>这条路径上除了 billing 还有「读我们自己的库」那一步（Prisma 校验、库连不上…）。
   * 把它们一并翻成 502「计费调用失败」，值班的人会去查一个**没坏的服务** —— 而
   * 502/503 在本仓的全部含义就是「billing 那边的问题」。所以其余错误原样抛出，
   * 交给全局异常过滤器（与本次改动之前的行为一致）。
   */
  it("库自己出错时原样抛出，不冒充 billing 故障", async () => {
    const { controller } = createController({
      listAdminUsers: vi.fn().mockRejectedValue(new Error("prisma 炸了")),
    });

    const error = await controller.list(USER, BEARER, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("prisma 炸了");
    // 没有被包装成 AdminException（那会带上一个指向 billing 的状态码）
    expect((error as { status?: number }).status).toBeUndefined();
  });
});
