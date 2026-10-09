import { beforeEach, describe, expect, it, vi } from "vitest";

import { RechargeCustomService } from "./recharge-custom.service.js";


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
  version: 5,
  gmt_create: new Date("2026-09-27T00:00:00Z"),
  gmt_modified: new Date("2026-09-27T00:00:00Z"),
};

function makeService(row: typeof ROW | null = ROW) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const upsert = vi.fn().mockImplementation(
    async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
      ...ROW,
      ...create,
      ...Object.fromEntries(
        Object.entries(update).filter(([, v]) => typeof v !== "object"),
      ),
      version: 6,
    }),
  );
  const service = new RechargeCustomService({
    client: { recharge_custom_config: { findUnique, upsert } },
  } as never);
  return { service, findUnique, upsert };
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
});

describe("RechargeCustomService.saveConfig", () => {
  it("只改一个字段：合并后仍合法就放行，并且**只写这一个字段**", async () => {
    const { service, upsert } = makeService();

    await service.saveConfig({ defaultCredits: 900 });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ default_credits: 900n }),
      }),
    );
  });

  it("★ 只改换算率，也要按**整份配置**校验（PRD §7.1 整除要求）", async () => {
    const { service, upsert } = makeService();

    await expect(service.saveConfig({ creditsPerYuan: 4 })).rejects.toMatchObject({
      status: 400,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("★ 上下限配歪（不整除 / 步长对不齐）→ 400，且**不落库**", async () => {
    const { service, upsert } = makeService();

    await expect(service.saveConfig({ minCredits: 601 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.saveConfig({ stepCredits: 16 })).rejects.toMatchObject({
      status: 400,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("默认值超出上下限 → 400", async () => {
    const { service } = makeService();

    await expect(
      service.saveConfig({ minCredits: 900, maxCredits: 1_200, defaultCredits: 600 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("★ 配置行缺失时保存**会把它建出来**（不是静默什么都不做）", async () => {
    const { service, upsert } = makeService(null);

    await expect(service.saveConfig({ defaultCredits: 900 })).rejects.toMatchObject({
      status: 503,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("权限与提示文案这类不参与数值校验的字段照常保存", async () => {
    const { service, upsert } = makeService();

    await service.saveConfig({
      enabled: false,
      permission: "user_group",
      permissionAllowlist: ["9001"],
      permissionDeniedHint: "该活动仅限内测用户",
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          enabled: 0,
          permission: "user_group",
          permission_denied_hint: "该活动仅限内测用户",
        }),
      }),
    );
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
      permission: "user_group",
      permission_allowlist: ["9001"],
      permission_denied_hint: "该活动仅限内测用户",
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
