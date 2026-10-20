import { describe, expect, it, vi } from "vitest";

import {
  RECHARGE_CUSTOM_SETTING_KEY,
  createRechargeCustomConfigRepo,
} from "./recharge-custom-config-repo.js";


const CONFIG = {
  minCredits: 600,
  maxCredits: 499_995,
  defaultCredits: 600,
  creditsPerYuan: 15,
  stepCredits: 15,
  enabled: true,
  permission: "all",
  permissionAllowlist: null as string[] | null,
  permissionDeniedHint: "",
  creditsValidMonths: 24,
};

const ROW = {
  setting_key: RECHARGE_CUSTOM_SETTING_KEY,
  setting_value: JSON.stringify(CONFIG),
  is_secret: false,
  version: 6,
  gmt_create: new Date("2026-09-27T00:00:00Z"),
  gmt_modified: new Date("2026-09-27T00:00:00Z"),
};

function repoWith(row: unknown) {
  return createRechargeCustomConfigRepo({
    system_settings: { findUnique: vi.fn().mockResolvedValue(row) },
  } as never);
}

function repoWithUpdate(row: unknown, returned: unknown = { ...ROW, version: 7 }) {
  const update = vi.fn().mockResolvedValue(returned);
  const repo = createRechargeCustomConfigRepo({
    system_settings: {
      findUnique: vi.fn().mockResolvedValue(row),
      update,
    },
  } as never);
  return { repo, update };
}

function storedConfig(update: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const data = (update.mock.calls[call]?.[0] as { data: { setting_value: string } }).data;
  return JSON.parse(data.setting_value) as Record<string, unknown>;
}

describe("createRechargeCustomConfigRepo.get — 读 system_settings.rechargeCustom", () => {
  it("固定读 rechargeCustom 这一行，并把 JSON 映射成 View", async () => {
    const findUnique = vi.fn().mockResolvedValue(ROW);
    const repo = createRechargeCustomConfigRepo({
      system_settings: { findUnique },
    } as never);

    const view = await repo.get();

    expect(findUnique).toHaveBeenCalledWith({
      where: { setting_key: RECHARGE_CUSTOM_SETTING_KEY },
    });
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
    await expect(repoWith(null).get()).resolves.toBeNull();
  });

  it("JSON 损坏 → null，不静默回落默认价", async () => {
    await expect(repoWith({ ...ROW, setting_value: "{not json" }).get()).resolves.toBeNull();
  });

  it("缺必需数值字段 → null", async () => {
    const broken = JSON.stringify({ ...CONFIG, creditsPerYuan: undefined });
    await expect(repoWith({ ...ROW, setting_value: broken }).get()).resolves.toBeNull();
  });

  it("白名单的 NULL 归一成空数组，不安全整数被丢弃", async () => {
    const withList = JSON.stringify({
      ...CONFIG,
      permission: "user_group",
      permissionAllowlist: [9007199254740993, 42, "007"],
    });
    const repo = repoWith({ ...ROW, setting_value: withList });

    await expect(repo.get()).resolves.toMatchObject({
      permissionAllowlist: ["42", "7"],
    });
  });
});

describe("createRechargeCustomConfigRepo.save — 读改写 + 版本自增", () => {
  it("保存时合并当前 JSON，只覆盖显式传的键", async () => {
    const { repo, update } = repoWithUpdate(ROW);

    const view = await repo.save({ minCredits: 750, stepCredits: 75 });

    expect(storedConfig(update)).toMatchObject({
      minCredits: 750,
      maxCredits: 499_995,
      defaultCredits: 600,
      creditsPerYuan: 15,
      stepCredits: 75,
      enabled: true,
    });
    expect(view.version).toBe(7);
  });

  it("写回 version 自增、is_secret=0、gmt_modified，且只按 setting_key 定位", async () => {
    const { repo, update } = repoWithUpdate(ROW);

    await repo.save({ defaultCredits: 900 });

    expect(update).toHaveBeenCalledWith({
      where: { setting_key: RECHARGE_CUSTOM_SETTING_KEY },
      data: expect.objectContaining({
        is_secret: false,
        version: { increment: 1 },
        gmt_modified: expect.any(Date),
      }),
    });
  });

  it("换算率（价格算法的输入）写进 JSON：改它等于改所有新订单的价格", async () => {
    const { repo, update } = repoWithUpdate(ROW);

    await repo.save({ creditsPerYuan: 5 });

    expect(storedConfig(update)).toHaveProperty("creditsPerYuan", 5);
  });

  it("权限白名单：显式 null = 清空，数组 = 覆盖成这份名单", async () => {
    const { repo, update } = repoWithUpdate(ROW);

    await repo.save({ permissionAllowlist: null });
    expect(storedConfig(update)).toHaveProperty("permissionAllowlist", null);

    await repo.save({ permissionAllowlist: ["9001"] });
    expect(storedConfig(update, 1)).toHaveProperty("permissionAllowlist", ["9001"]);
  });

  it("enabled 保持 JSON 布尔，不降级成 0/1", async () => {
    const { repo, update } = repoWithUpdate(ROW);

    await repo.save({ enabled: false });

    expect(storedConfig(update)).toHaveProperty("enabled", false);
  });

  it("行缺失或损坏时保存直接报错（服务层在此之前已用 requireConfig 拦成 503）", async () => {
    await expect(repoWithUpdate(null).repo.save({ defaultCredits: 900 })).rejects.toThrow(
      /rechargeCustom/,
    );
  });
});
