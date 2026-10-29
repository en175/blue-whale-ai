import { describe, expect, it, vi } from "vitest";

import { createTopupTierRepo } from "./topup-tier-repo.js";


const ROW = {
  id: 7n,
  name: "1000积分",
  amount: 1500n,
  base_credits: 1500n,
  original_price: 100,
  discount: 1,
  price: 100,
  is_recommended: false,
  status: "active",
  start_time: null,
  end_time: null,
  sort_order: 1,
  version: 4,
  gmt_create: new Date("2026-09-01T00:00:00Z"),
  gmt_modified: new Date("2026-09-26T00:00:00Z"),
};

describe("createTopupTierRepo.update — 保存即 +1 版", () => {
  it("保存一次 version 自增 1（只改名字也算——名字是用户看得到的东西）", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...ROW, version: 3 });
    const update = vi.fn().mockResolvedValue(ROW);
    const repo = createTopupTierRepo({ billing_products: { findFirst, update } } as never);

    const view = await repo.update("7", { name: "春季特惠" });

    expect(update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: expect.objectContaining({ name: "春季特惠", version: { increment: 1 } }),
    });
    expect(view?.version).toBe(4);
  });
});

describe("createTopupTierRepo.updateSortOrder — 排序不是配置变更", () => {
  it("只写 sort_order，不碰 version（拖一下顺序不代表商品口径变了）", async () => {
    const update = vi.fn().mockResolvedValue(ROW);
    const repo = createTopupTierRepo({
      billing_products: { update },
      $transaction: async (ops: unknown[]) => ops,
    } as never);

    await repo.updateSortOrder([{ id: "7", sortOrder: 2 }]);

    expect(update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: { sort_order: 2, gmt_modified: expect.any(Date) },
    });
  });
});


const FULL_ROW = {
  ...ROW,
  description: "适合轻量体验",
  bonus_credits: 3750n,
  activity_tag: "首购加赠 50%",
  button_text: "立享加赠",
  first_purchase_eligible: 1,
  credits_valid_months: 24,
  permission: "user_group",
  permission_allowlist: ["9001", 42, "007", "9001", {}, "abc"],
  permission_denied_hint: "该档位暂不对外开放",
};

describe("createTopupTierRepo.create — 新建默认草稿", () => {
  it("★ 不传 status 时落 draft，不是 active（PRD §10.5）", async () => {
    const create = vi.fn().mockResolvedValue(ROW);
    const aggregate = vi.fn().mockResolvedValue({ _max: { sort_order: 3 } });
    const repo = createTopupTierRepo({
      billing_products: { create, aggregate },
    } as never);

    await repo.create({ baseCredits: 1500, originalPrice: 100, discount: 1 });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "draft",
        sort_order: 4,
      }),
    });
  });

  it("显式给状态时以传入为准（上架 / 下架都要能设）", async () => {
    const create = vi.fn().mockResolvedValue(ROW);
    const aggregate = vi.fn().mockResolvedValue({ _max: { sort_order: 0 } });
    const repo = createTopupTierRepo({
      billing_products: { create, aggregate },
    } as never);

    await repo.create({
      baseCredits: 1500,
      originalPrice: 100,
      discount: 1,
      status: "active",
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "active" }),
    });
  });

  it("PRD §10.2 的新列有默认值：赠 0、按钮「立享加赠」、有效期 24 个月、权限 all", async () => {
    const create = vi.fn().mockResolvedValue(ROW);
    const aggregate = vi.fn().mockResolvedValue({ _max: { sort_order: 0 } });
    const repo = createTopupTierRepo({
      billing_products: { create, aggregate },
    } as never);

    await repo.create({ baseCredits: 1500, originalPrice: 100, discount: 1 });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: "",
        bonus_credits: 0n,
        activity_tag: "",
        button_text: "立享加赠",
        first_purchase_eligible: 0,
        credits_valid_months: 24,
        permission: "all",
        permission_denied_hint: "",
      }),
    });
    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.permission_allowlist).not.toBeInstanceOf(Array);
  });

  it("★ 基础积分是**配置值**：原样落 `base_credits`，遗留列 `amount` 只做同值镜像", async () => {
    const create = vi.fn().mockResolvedValue(ROW);
    const aggregate = vi.fn().mockResolvedValue({ _max: { sort_order: 0 } });
    const repo = createTopupTierRepo({
      billing_products: { create, aggregate },
    } as never);

    await repo.create({ baseCredits: 7_500, originalPrice: 100, discount: 1 });

    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.base_credits).toBe(7500n);
    expect(data.amount).toBe(7500n);
  });
});

describe("createTopupTierRepo — 卡片字段读写", () => {
  it("★ 白名单宽读：数字转串、掐前导零、去重、丢掉看不懂的元素", async () => {
    const findMany = vi.fn().mockResolvedValue([FULL_ROW]);
    const repo = createTopupTierRepo({ billing_products: { findMany } } as never);

    const [view] = await repo.listAll();

    expect(view.permissionAllowlist).toEqual(["9001", "42", "7"]);
  });

  it("存量行的白名单是 NULL → 归一成空数组（读路径恒为数组，调用方不用判空）", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ ...FULL_ROW, permission_allowlist: null }]);
    const repo = createTopupTierRepo({ billing_products: { findMany } } as never);

    const [view] = await repo.listAll();

    expect(view.permissionAllowlist).toEqual([]);
  });

  it("TINYINT 与 BIGINT 出库时转成布尔与 number", async () => {
    const findMany = vi.fn().mockResolvedValue([FULL_ROW]);
    const repo = createTopupTierRepo({ billing_products: { findMany } } as never);

    const [view] = await repo.listAll();

    expect(view.firstPurchaseEligible).toBe(true);
    expect(view.bonusCredits).toBe(3750);
    expect(view.baseCredits).toBe(1500);
    expect(view.permission).toBe("user_group");
    expect(view.creditsValidMonths).toBe(24);
    expect(view.buttonText).toBe("立享加赠");
    expect(view.activityTag).toBe("首购加赠 50%");
  });

  it("编辑只写传了的列：没传的新字段一个都不许出现在 UPDATE 里", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...ROW, version: 3 });
    const update = vi.fn().mockResolvedValue(ROW);
    const repo = createTopupTierRepo({ billing_products: { findFirst, update } } as never);

    await repo.update("7", { activityTag: "首购超级翻倍" });

    const data = update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.activity_tag).toBe("首购超级翻倍");
    for (const untouched of [
      "description",
      "bonus_credits",
      "button_text",
      "first_purchase_eligible",
      "credits_valid_months",
      "permission",
      "permission_allowlist",
      "permission_denied_hint",
      "base_credits",
      "amount",
    ]) {
      expect(data).not.toHaveProperty(untouched);
    }
  });

  it("★ 传了基础积分才写：`base_credits` 与遗留列 `amount` 一起落同一个数", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...ROW, version: 3 });
    const update = vi.fn().mockResolvedValue(ROW);
    const repo = createTopupTierRepo({ billing_products: { findFirst, update } } as never);

    await repo.update("7", { baseCredits: 7_500 });

    const data = update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.base_credits).toBe(7500n);
    expect(data.amount).toBe(7500n);
  });

  it("白名单传数组时按原样写回（上游已归一）", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...ROW, version: 3 });
    const update = vi.fn().mockResolvedValue(ROW);
    const repo = createTopupTierRepo({ billing_products: { findFirst, update } } as never);

    await repo.update("7", { permissionAllowlist: ["9001", "42"] });

    const data = update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.permission_allowlist).toEqual(["9001", "42"]);
  });
});
