import { beforeEach, describe, expect, it, vi } from "vitest";

import { RECHARGE_CUSTOM_SETTING_KEY } from "@lib/shared/persistence/index.js";
import { RechargeCustomService } from "./recharge-custom.service.js";


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
  version: 5,
  gmt_create: new Date("2026-09-27T00:00:00Z"),
  gmt_modified: new Date("2026-09-27T00:00:00Z"),
};

function makeService(row: typeof ROW | null = ROW, alwaysConflict = false) {
  let current = row;
  const findUnique = vi.fn(async () => current);
  const updateMany = vi.fn(
    async ({ where, data }: { where: { version: number }; data: Record<string, unknown> }) => {
      if (alwaysConflict || !current || current.version !== where.version) {
        return { count: 0 };
      }
      current = {
        ...current,
        setting_value: String(data.setting_value),
        version: current.version + 1,
        gmt_modified: data.gmt_modified as Date,
      };
      return { count: 1 };
    },
  );
  const service = new RechargeCustomService({
    client: { system_settings: { findUnique, updateMany } },
  } as never);
  return { service, findUnique, updateMany };
}

function savedConfig(
  updateMany: ReturnType<typeof vi.fn>,
  call = 0,
): Record<string, unknown> {
  const data = (updateMany.mock.calls[call]?.[0] as { data: { setting_value: string } }).data;
  return JSON.parse(data.setting_value) as Record<string, unknown>;
}

describe("RechargeCustomService.requireConfig", () => {
  it("读出 PRD §7.1 的默认配置", async () => {
    const { service } = makeService();

    await expect(service.requireConfig()).resolves.toMatchObject({
      minCredits: 600,
      maxCredits: 499_995,
      defaultCredits: 600,
      creditsPerYuan: 15,
      stepCredits: 15,
      enabled: true,
    });
  });

  it("★ 行缺失 → 503（不回退到代码默认值：那会造出第二个「配置是多少」的答案）", async () => {
    const { service } = makeService(null);

    await expect(service.requireConfig()).rejects.toMatchObject({
      status: 503,
      code: "recharge_custom_unconfigured",
    });
  });

  it("★ JSON 损坏 → 503，不静默回落默认价", async () => {
    const { service } = makeService({ ...ROW, setting_value: "{oops" });

    await expect(service.requireConfig()).rejects.toMatchObject({
      status: 503,
      code: "recharge_custom_unconfigured",
    });
  });
});

describe("RechargeCustomService.saveConfig", () => {
  it("只改一个字段：合并后仍合法就放行，其余字段保持原值", async () => {
    const { service, updateMany } = makeService();

    await service.saveConfig({ defaultCredits: 900 });

    expect(savedConfig(updateMany)).toMatchObject({
      minCredits: 600,
      maxCredits: 499_995,
      defaultCredits: 900,
      creditsPerYuan: 15,
      stepCredits: 15,
    });
  });

  it("★ 只改换算率，也要按**整份配置**校验（PRD §7.1 整除要求）", async () => {
    const { service, updateMany } = makeService();

    await expect(service.saveConfig({ creditsPerYuan: 4 })).rejects.toMatchObject({
      status: 400,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("★ 上下限配歪（不整除 / 步长对不齐）→ 400，且**不落库**", async () => {
    const { service, updateMany } = makeService();

    await expect(service.saveConfig({ minCredits: 601 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.saveConfig({ stepCredits: 16 })).rejects.toMatchObject({
      status: 400,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("默认值超出上下限 → 400", async () => {
    const { service } = makeService();

    await expect(
      service.saveConfig({ minCredits: 900, maxCredits: 1_200, defaultCredits: 600 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("★ 非安全整数 → 400，不把整份配置写成读不回来的样子", async () => {
    const { service, updateMany } = makeService();

    await expect(
      service.saveConfig({ maxCredits: 9_007_199_254_741_020 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("★ 配置行缺失时保存 → 503，且不写", async () => {
    const { service, updateMany } = makeService(null);

    await expect(service.saveConfig({ defaultCredits: 900 })).rejects.toMatchObject({
      status: 503,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("★ 连续版本冲突 → 重试用尽后 409，不让两个管理员互相覆盖", async () => {
    const { service } = makeService(ROW, true);

    await expect(service.saveConfig({ defaultCredits: 900 })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("权限与提示文案这类不参与数值校验的字段照常保存", async () => {
    const { service, updateMany } = makeService();

    await service.saveConfig({
      enabled: false,
      permission: "user_group",
      permissionAllowlist: ["9001"],
      permissionDeniedHint: "该活动仅限内测用户",
    });

    expect(savedConfig(updateMany)).toMatchObject({
      enabled: false,
      permission: "user_group",
      permissionAllowlist: ["9001"],
      permissionDeniedHint: "该活动仅限内测用户",
    });
  });
});

describe("RechargeCustomService.buildOffer — 用户侧报价（PRD §7.2 / §7.4）", () => {
  let service: RechargeCustomService;

  beforeEach(() => {
    service = makeService().service;
  });

  it("★ 游客（userId = null）：展示项全给，但 canPurchase 为 null（可见不可买）", async () => {
    await expect(service.buildOffer(null)).resolves.toMatchObject({
      enabled: true,
      minCredits: 600,
      maxCredits: 499_995,
      defaultCredits: 600,
      stepCredits: 15,
      creditsPerYuan: 15,
      creditsValidMonths: 24,
      canPurchase: null,
    });
  });

  it("★ 登录用户：带上权限判定（PRD §7.4「登录后校验权限」）", async () => {
    await expect(service.buildOffer(9001)).resolves.toMatchObject({
      canPurchase: true,
    });
  });

  it("无权限用户：canPurchase=false，并给出提示文案", async () => {
    const { service: restricted } = makeService({
      ...ROW,
      setting_value: JSON.stringify({
        ...CONFIG,
        permission: "user_group",
        permissionAllowlist: ["9001"],
        permissionDeniedHint: "该活动仅限内测用户",
      }),
    });

    const offer = await restricted.buildOffer(7007);
    expect(offer.canPurchase).toBe(false);
    expect(offer.deniedHint).toBe("该活动仅限内测用户");
  });

  it("报价**不含**内部字段（版本号、白名单不出去）", async () => {
    const offer = await service.buildOffer(9001);
    expect(offer).not.toHaveProperty("version");
    expect(offer).not.toHaveProperty("permissionAllowlist");
    expect(offer).not.toHaveProperty("permission");
  });
});
