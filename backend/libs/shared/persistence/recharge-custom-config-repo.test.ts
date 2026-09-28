import { describe, expect, it, vi } from "vitest";

import {
  CUSTOM_CONFIG_ROW_ID,
  createRechargeCustomConfigRepo,
} from "./recharge-custom-config-repo.js";

// 自定义充值配置是**单行表**（模块 B，迁移 050）。
// 这里钉住两件事：
//   1. 读写都落在**同一行**（id 恒为 1）—— 多一行就是两份互相矛盾的配置；
//   2. 保存让 `version` **走数据库自增**，不是「读出来 +1 再写回」——
//      后者在并发保存下会丢版本，而 config_version 是订单快照里回答
//      「这单是哪一版配置」的唯一依据。

const ROW = {
  id: 1,
  min_credits: 600n,
  max_credits: 499_995n,
  default_credits: 600n,
  credits_per_yuan: 15,
  step_credits: 15n,
  enabled: 1,
  permission: "all",
  permission_allowlist: null,
  permission_denied_hint: "",
  credits_valid_months: 24,
  // 保存后的行：版本已经从 5 涨到 6（Prisma 的 increment 会把新值带在返回行里）
  version: 6,
  gmt_create: new Date("2026-09-27T00:00:00Z"),
  gmt_modified: new Date("2026-09-27T00:00:00Z"),
};

describe("createRechargeCustomConfigRepo.get — 单行读", () => {
  it("读的永远是 id=1 那一行", async () => {
    const findUnique = vi.fn().mockResolvedValue(ROW);
    const repo = createRechargeCustomConfigRepo({
      recharge_custom_config: { findUnique },
    } as never);

    const view = await repo.get();

    expect(findUnique).toHaveBeenCalledWith({ where: { id: CUSTOM_CONFIG_ROW_ID } });
    expect(view).toMatchObject({
      minCredits: 600,
      maxCredits: 499_995,
      defaultCredits: 600,
      creditsPerYuan: 15,
      stepCredits: 15,
      enabled: true,
      permission: "all",
      permissionAllowlist: [],
      creditsValidMonths: 24,
      version: 6,
    });
  });

  it("行不存在 → null（由调用方决定是「环境坏了」还是「用默认值」，repo 不替它决定）", async () => {
    const repo = createRechargeCustomConfigRepo({
      recharge_custom_config: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never);

    await expect(repo.get()).resolves.toBeNull();
  });

  it("白名单的 NULL 归一成空数组（读路径不该为存量行的 NULL 抛错）", async () => {
    const repo = createRechargeCustomConfigRepo({
      recharge_custom_config: { findUnique: vi.fn().mockResolvedValue(ROW) },
    } as never);

    await expect(repo.get()).resolves.toMatchObject({ permissionAllowlist: [] });
  });

  it("白名单读出来是**字符串**；手改库留下的不安全整数被丢弃，而不是静默改值", async () => {
    const repo = createRechargeCustomConfigRepo({
      recharge_custom_config: {
        findUnique: vi.fn().mockResolvedValue({
          ...ROW,
          permission: "user_group",
          // 手改过库的人留下的是**数字**。`9007199254740993` 超出 JS 安全整数范围，
          // 读成 number 会静默变成 …992 —— 白名单错一位就是「放进来一个陌生人」，
          // 所以宁可不认识它（丢弃）也不猜
          permission_allowlist: [9007199254740993, 42, "007"],
        }),
      },
    } as never);

    const view = await repo.get();
    // 安全整数照常收下；字符串掐前导零（`007` 与 `7` 是同一个用户，不去重就会存两条）
    expect(view?.permissionAllowlist).toEqual(["42", "7"]);
  });
});

describe("createRechargeCustomConfigRepo.save — 单行写 + 版本自增", () => {
  it("保存写 id=1，并让 version 走**数据库自增**（不是读出来 +1）", async () => {
    const upsert = vi.fn().mockResolvedValue(ROW);
    const repo = createRechargeCustomConfigRepo({
      recharge_custom_config: { upsert },
    } as never);

    const view = await repo.save({ minCredits: 750, stepCredits: 75 });

    expect(upsert).toHaveBeenCalledWith({
      where: { id: CUSTOM_CONFIG_ROW_ID },
      create: { id: CUSTOM_CONFIG_ROW_ID, version: 0, min_credits: 750n, step_credits: 75n },
      update: expect.objectContaining({
        min_credits: 750n,
        step_credits: 75n,
        version: { increment: 1 },
        gmt_modified: expect.any(Date),
      }),
    });
    expect(view.version).toBe(6);
  });

  it("只写显式传了的键：不传的键整体不出现在写入里（否则「只改下限」会重置上限）", async () => {
    const upsert = vi.fn().mockResolvedValue(ROW);
    const repo = createRechargeCustomConfigRepo({
      recharge_custom_config: { upsert },
    } as never);

    await repo.save({ defaultCredits: 900 });

    const call = upsert.mock.calls[0]?.[0] as { update: Record<string, unknown> };
    expect(call.update).not.toHaveProperty("min_credits");
    expect(call.update).not.toHaveProperty("max_credits");
    expect(call.update).toHaveProperty("default_credits", 900n);
  });

  it("换算率（价格算法的输入）单独写列：改它等于改所有新订单的价格", async () => {
    const upsert = vi.fn().mockResolvedValue(ROW);
    const repo = createRechargeCustomConfigRepo({
      recharge_custom_config: { upsert },
    } as never);

    await repo.save({ creditsPerYuan: 5 });

    const call = upsert.mock.calls[0]?.[0] as { update: Record<string, unknown> };
    expect(call.update).toHaveProperty("credits_per_yuan", 5);
  });

  it("权限白名单：显式 null = 清空（SQL NULL），数组 = 覆盖成这份名单", async () => {
    const upsert = vi.fn().mockResolvedValue(ROW);
    const repo = createRechargeCustomConfigRepo({
      recharge_custom_config: { upsert },
    } as never);

    await repo.save({ permissionAllowlist: null });
    expect(
      (upsert.mock.calls[0]?.[0] as { update: Record<string, unknown> }).update,
    ).toHaveProperty("permission_allowlist");

    await repo.save({ permissionAllowlist: ["9001"] });
    const second = (upsert.mock.calls[1]?.[0] as { update: Record<string, unknown> })
      .update;
    expect(second.permission_allowlist).toEqual(["9001"]);
  });

  it("enabled 布尔 → tinyint（0/1），不是 true/false 直接塞进去", async () => {
    const upsert = vi.fn().mockResolvedValue(ROW);
    const repo = createRechargeCustomConfigRepo({
      recharge_custom_config: { upsert },
    } as never);

    await repo.save({ enabled: false });

    expect(
      (upsert.mock.calls[0]?.[0] as { update: Record<string, unknown> }).update,
    ).toHaveProperty("enabled", 0);
  });
});
