import { describe, expect, it, vi } from "vitest";

import {
  RECHARGE_CUSTOM_SETTING_KEY,
  RechargeCustomConfigConflictError,
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

function makeRepo(row: unknown) {
  let current = row as typeof ROW | null;
  const findUnique = vi.fn(async () => current);
  const updateMany = vi.fn(
    async ({ where, data }: { where: { version: number }; data: Record<string, unknown> }) => {
      if (!current || current.version !== where.version) return { count: 0 };
      current = {
        ...current,
        setting_value: String(data.setting_value),
        version: current.version + 1,
        gmt_modified: data.gmt_modified as Date,
      };
      return { count: 1 };
    },
  );
  const repo = createRechargeCustomConfigRepo({
    bw_platform_settings: { findUnique, updateMany },
  } as never);
  return { repo, updateMany, findUnique };
}

function storedConfig(
  updateMany: ReturnType<typeof vi.fn>,
  call = 0,
): Record<string, unknown> {
  const data = (updateMany.mock.calls[call]?.[0] as { data: { setting_value: string } }).data;
  return JSON.parse(data.setting_value) as Record<string, unknown>;
}

describe("createRechargeCustomConfigRepo.get — 读 system_settings.rechargeCustom", () => {
  it("固定读 rechargeCustom 这一行，并把 JSON 映射成 View", async () => {
    const { repo, findUnique } = makeRepo(ROW);

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
    await expect(makeRepo(null).repo.get()).resolves.toBeNull();
  });

  it("JSON 损坏 → null，不静默回落默认价", async () => {
    await expect(
      makeRepo({ ...ROW, setting_value: "{not json" }).repo.get(),
    ).resolves.toBeNull();
  });

  it("缺必需数值字段或数值非安全整数 → null", async () => {
    const broken = JSON.stringify({ ...CONFIG, creditsPerYuan: 9007199254740993 });
    await expect(
      makeRepo({ ...ROW, setting_value: broken }).repo.get(),
    ).resolves.toBeNull();
  });

  it("权限枚举不认识 → null，不把未知值当 all 放行", async () => {
    const broken = JSON.stringify({ ...CONFIG, permission: "bogus" });
    await expect(
      makeRepo({ ...ROW, setting_value: broken }).repo.get(),
    ).resolves.toBeNull();
  });

  it("白名单的 NULL 归一成空数组，不安全整数被丢弃", async () => {
    const withList = JSON.stringify({
      ...CONFIG,
      permission: "user_group",
      permissionAllowlist: [9007199254740993, 42, "007"],
    });

    await expect(makeRepo({ ...ROW, setting_value: withList }).repo.get()).resolves.toMatchObject({
      permissionAllowlist: ["42", "7"],
    });
  });
});

describe("createRechargeCustomConfigRepo.save — 读改写 + 乐观版本锁", () => {
  it("保存时合并当前 JSON，只覆盖显式传的键", async () => {
    const { repo, updateMany } = makeRepo(ROW);

    const view = await repo.save({ minCredits: 750, stepCredits: 75 }, 6);

    expect(storedConfig(updateMany)).toMatchObject({
      minCredits: 750,
      maxCredits: 499_995,
      defaultCredits: 600,
      creditsPerYuan: 15,
      stepCredits: 75,
      enabled: true,
    });
    expect(view.version).toBe(7);
  });

  it("写回按 version 做条件更新，并让 version 自增、is_secret=0", async () => {
    const { repo, updateMany } = makeRepo(ROW);

    await repo.save({ defaultCredits: 900 }, 6);

    expect(updateMany).toHaveBeenCalledWith({
      where: { setting_key: RECHARGE_CUSTOM_SETTING_KEY, version: 6 },
      data: expect.objectContaining({
        is_secret: false,
        version: { increment: 1 },
        gmt_modified: expect.any(Date),
      }),
    });
  });

  it("★ 版本不一致 → 冲突错误，不覆盖别人刚写的配置", async () => {
    const { repo, updateMany } = makeRepo(ROW);

    await expect(repo.save({ defaultCredits: 900 }, 5)).rejects.toBeInstanceOf(
      RechargeCustomConfigConflictError,
    );
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("换算率（价格算法的输入）写进 JSON：改它等于改所有新订单的价格", async () => {
    const { repo, updateMany } = makeRepo(ROW);

    await repo.save({ creditsPerYuan: 5 }, 6);

    expect(storedConfig(updateMany)).toHaveProperty("creditsPerYuan", 5);
  });

  it("权限白名单：显式 null = 清空，数组 = 覆盖成这份名单", async () => {
    const { repo, updateMany } = makeRepo(ROW);

    await repo.save({ permissionAllowlist: null }, 6);
    expect(storedConfig(updateMany)).toHaveProperty("permissionAllowlist", null);

    await repo.save({ permissionAllowlist: ["9001"] }, 7);
    expect(storedConfig(updateMany, 1)).toHaveProperty("permissionAllowlist", ["9001"]);
  });

  it("enabled 保持 JSON 布尔，不降级成 0/1", async () => {
    const { repo, updateMany } = makeRepo(ROW);

    await repo.save({ enabled: false }, 6);

    expect(storedConfig(updateMany)).toHaveProperty("enabled", false);
  });

  it("★ 写前校验：非安全整数在落库前被拒，不会把配置写成 503 也修不回来的样子", async () => {
    const { repo, updateMany } = makeRepo(ROW);

    await expect(
      repo.save({ maxCredits: 9_007_199_254_741_020 }, 6),
    ).rejects.toMatchObject({ status: 400 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("行缺失或损坏时保存直接报 503（服务层在此之前已用 requireConfig 拦一次）", async () => {
    await expect(makeRepo(null).repo.save({ defaultCredits: 900 }, 6)).rejects.toMatchObject({
      status: 503,
    });
  });
});
