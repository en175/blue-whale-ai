import { describe, expect, it, vi } from "vitest";

import { NewApiError } from "@lib/core";
import { AdminRechargeCustomConfigController } from "./recharge-custom-config.controller.js";

// 自定义充值配置的管理端接口（模块 B，PRD §10.3）。
// 入参解析必须**当场 400**，不能静默落默认值：
// 运营把「指定用户群」写成错的值、系统却存成 `all`，现场表现是
// 「名单配了，但所有人都能买」—— 一句查不出来的假话。

const VIEW = {
  minCredits: 600,
  maxCredits: 499_995,
  defaultCredits: 600,
  creditsPerYuan: 15,
  stepCredits: 15,
  enabled: true,
  permission: "all" as const,
  permissionAllowlist: [] as string[],
  permissionDeniedHint: "",
  creditsValidMonths: 24,
  version: 5,
  updatedAt: "2026-09-27T00:00:00.000Z",
};

function makeController(overrides: {
  requireConfig?: ReturnType<typeof vi.fn>;
  saveConfig?: ReturnType<typeof vi.fn>;
} = {}) {
  const requireConfig = overrides.requireConfig ?? vi.fn().mockResolvedValue(VIEW);
  const saveConfig = overrides.saveConfig ?? vi.fn().mockResolvedValue({ ...VIEW, version: 6 });
  const operationLog = { create: vi.fn().mockResolvedValue(undefined) };
  const controller = new AdminRechargeCustomConfigController(
    { requireConfig, saveConfig } as never,
    operationLog as never,
  );
  return { controller, requireConfig, saveConfig, operationLog };
}

describe("AdminRechargeCustomConfigController.get", () => {
  it("回配置全量 + 权限的中文名（免得每个页面各写一份映射）", async () => {
    const { controller } = makeController();

    const res = await controller.get();

    expect(res).toEqual({
      success: true,
      data: { ...VIEW, permissionLabel: "全部登录用户" },
    });
  });
});

describe("AdminRechargeCustomConfigController.update — 部分更新", () => {
  it("只传一个字段 → 只写这一个（不传的键不能被重置成默认值）", async () => {
    const { controller, saveConfig } = makeController();

    await controller.update({ minCredits: 750 });

    expect(saveConfig).toHaveBeenCalledWith({ minCredits: 750 });
  });

  it("一个字段都没传 → 400（「保存成功但什么都没改」会让人以为改上了）", async () => {
    const { controller, saveConfig } = makeController();

    await expect(controller.update({})).rejects.toThrow(/没有可保存的字段/);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("★ 数值字段非法 → 400，不落任何值", async () => {
    const { controller, saveConfig } = makeController();

    for (const body of [
      { minCredits: 0 },
      { maxCredits: -1 },
      { defaultCredits: 1.5 },
      { creditsPerYuan: 0 },
      { stepCredits: "abc" },
      { creditsValidMonths: 0 },
      { creditsValidMonths: 9_999 },
    ]) {
      await expect(
        controller.update(body),
        JSON.stringify(body),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("★ 权限枚举不认得 → 400（**不静默落 `all`**）", async () => {
    const { controller, saveConfig } = makeController();

    await expect(controller.update({ permission: "vip_only" })).rejects.toMatchObject({
      status: 400,
    });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("权限枚举认得 → 原样保存（含本阶段只是占位的 member_tier）", async () => {
    const { controller, saveConfig } = makeController();

    await controller.update({ permission: "member_tier", permissionAllowlist: null });

    expect(saveConfig).toHaveBeenCalledWith({
      permission: "member_tier",
      permissionAllowlist: null,
    });
  });

  it("白名单：null = 显式清空；数组 = 覆盖；元素非法 → 400", async () => {
    const { controller, saveConfig } = makeController();

    await controller.update({ permissionAllowlist: ["9001", 42] });
    expect(saveConfig).toHaveBeenCalledWith({ permissionAllowlist: ["9001", "42"] });

    saveConfig.mockClear();
    await expect(
      controller.update({ permissionAllowlist: [{ id: 1 }] }),
    ).rejects.toMatchObject({ status: 400 });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("是否启用必须是布尔值（`\"false\"` 这种字符串会被 JSON 解析成真值，不能收）", async () => {
    const { controller, saveConfig } = makeController();

    await expect(controller.update({ enabled: "false" })).rejects.toMatchObject({
      status: 400,
    });

    await controller.update({ enabled: false });
    expect(saveConfig).toHaveBeenCalledWith({ enabled: false });
  });

  it("无权限提示：去空白；超长 / 非文本 → 400", async () => {
    const { controller, saveConfig } = makeController();

    await controller.update({ permissionDeniedHint: "  该活动仅限内测用户  " });
    expect(saveConfig).toHaveBeenCalledWith({
      permissionDeniedHint: "该活动仅限内测用户",
    });

    saveConfig.mockClear();
    await expect(
      controller.update({ permissionDeniedHint: "x".repeat(256) }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      controller.update({ permissionDeniedHint: 123 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("★ 保存成功后写审计，且审计里看得出**改了什么**（换算率那一条特别标注）", async () => {
    const { controller, operationLog } = makeController({
      saveConfig: vi.fn().mockResolvedValue({ ...VIEW, creditsPerYuan: 5, version: 6 }),
    });

    await controller.update({ creditsPerYuan: 5 });

    const entry = operationLog.create.mock.calls[0]?.[0] as { detail: string; category: string };
    expect(entry.category).toBe("recharge_custom");
    expect(entry.detail).toContain("每元积分数：15→5");
    // 换算是**价格算法**的输入：改它等于改所有新订单的价格，审计里必须单独看得见
    expect(entry.detail).toContain("影响新订单价格");
  });

  it("审计写失败不阻断保存（配置已经落库了，回滚才是更大的错）", async () => {
    const operationLog = { create: vi.fn().mockRejectedValue(new Error("log down")) };
    const saveConfig = vi.fn().mockResolvedValue(VIEW);
    const controller = new AdminRechargeCustomConfigController(
      { requireConfig: vi.fn().mockResolvedValue(VIEW), saveConfig } as never,
      operationLog as never,
    );

    await expect(controller.update({ stepCredits: 75 })).resolves.toMatchObject({
      success: true,
    });
  });

  it("配置行缺失 → 503（管理端也要看得见「这个环境没初始化」，不是 500）", async () => {
    const { controller, saveConfig } = makeController({
      requireConfig: vi.fn().mockRejectedValue(
        new NewApiError("自定义充值配置缺失", 503, "recharge_custom_unconfigured"),
      ),
    });

    await expect(controller.update({ minCredits: 750 })).rejects.toMatchObject({
      status: 503,
    });
    expect(saveConfig).not.toHaveBeenCalled();
  });
});
