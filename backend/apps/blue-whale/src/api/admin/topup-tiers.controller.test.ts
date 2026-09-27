import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminTopupTiersController } from "./topup-tiers.controller.js";

/**
 * 管理端固定积分卡接口（`/api/admin/topup-tiers`）的几处硬约束：
 *
 * <ul>
 *   <li>**新建默认草稿**（PRD §10.5）：落成 active 就是「新建即开卖」，
 *       而卡片上的价格、赠送、标签在那一刻还没配；</li>
 *   <li>**基础积分是运营的输入**（2026-09-27 改）：它是配置值，用户到账的就是运营填的那个数。
 *       body 里塞 `amount`（遗留列）仍必须被忽略 —— 真正入库的是 `baseCredits`；</li>
 *   <li>**实付价格仍不是输入**：`price = 原价 × 折扣`，由 repo 派生。</li>
 * </ul>
 *
 * 其余是枚举与边界的取值纪律：非法值一律 400，**不静默回退到默认值**
 * （静默回退会让运营以为自己改成功了）。
 */

function createController() {
  const topupTier = {
    listAll: vi.fn().mockResolvedValue([]),
    listActive: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue({ id: "7" }),
    create: vi.fn().mockImplementation(async (input: unknown) => input),
    update: vi.fn().mockImplementation(async (_id: string, input: unknown) => input),
    remove: vi.fn().mockResolvedValue(true),
    updateSortOrder: vi.fn().mockResolvedValue(undefined),
  };
  const tierAudit = {
    logCreate: vi.fn().mockResolvedValue(undefined),
    logUpdate: vi.fn().mockResolvedValue(undefined),
    logDelete: vi.fn().mockResolvedValue(undefined),
  };
  return {
    controller: new AdminTopupTiersController(
      topupTier as never,
      tierAudit as never,
    ),
    topupTier,
    tierAudit,
  };
}

/** create 的调用入参（controller 把它原样交给 service）。 */
function createInput(topupTier: { create: { mock: { calls: unknown[][] } } }) {
  return topupTier.create.mock.calls[0][0] as Record<string, unknown>;
}

function updateInput(topupTier: { update: { mock: { calls: unknown[][] } } }) {
  return topupTier.update.mock.calls[0][1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminTopupTiersController.create — 新建默认草稿", () => {
  it("★ 不传 status → 落 draft（不是 active）", async () => {
    const { controller, topupTier } = createController();

    await controller.create({ originalPrice: 100, discount: 1, baseCredits: 1500 });

    expect(createInput(topupTier).status).toBe("draft");
  });

  it("显式传三态之一 → 以传入为准", async () => {
    const { controller, topupTier } = createController();

    await controller.create({ originalPrice: 100, discount: 1, baseCredits: 1500, status: "active" });

    expect(createInput(topupTier).status).toBe("active");
  });

  it("非法状态 → 400，且不落库", async () => {
    const { controller, topupTier } = createController();

    await expect(
      controller.create({ originalPrice: 100, discount: 1, baseCredits: 1500, status: "enabled" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(topupTier.create).not.toHaveBeenCalled();
  });
});

describe("AdminTopupTiersController.create — 基础积分是输入，实付仍是派生", () => {
  it("★ 运营填的基础积分原样入库（**不乘换算率、不按原价算**）", async () => {
    const { controller, topupTier } = createController();

    // 7,500 / 原价 100：**刻意不成整数倍**。任何「原价 × 换算率」的残留实现都会给出 1500，
    // 而充值常有折扣 —— ¥499 的档给 7,500 而不是 7,485，这个数就是运营填的那个。
    await controller.create({
      originalPrice: 100,
      discount: 1,
      baseCredits: 7_500,
    });

    expect(createInput(topupTier).baseCredits).toBe(7500);
  });

  it("★ 缺 baseCredits → 400，不替运营猜一个（猜出来的在折扣档上就是错的数）", async () => {
    const { controller, topupTier } = createController();

    await expect(
      controller.create({ originalPrice: 100, discount: 1 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(topupTier.create).not.toHaveBeenCalled();
  });

  it("baseCredits 为 0 / 负数 / 小数 / 非数字 → 400（0 积分档位用户付了钱拿不到东西）", async () => {
    const { controller, topupTier } = createController();

    for (const bad of [0, -1, 1.5, "abc", "", null]) {
      await expect(
        controller.create({ originalPrice: 100, discount: 1, baseCredits: bad }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(topupTier.create).not.toHaveBeenCalled();
  });

  it("★ body 里的 amount（遗留 quota 列）被忽略，入库的是 baseCredits", async () => {
    const { controller, topupTier } = createController();

    await controller.create({
      originalPrice: 100,
      discount: 1,
      baseCredits: 1500,
      amount: 999_999,
    });

    // `amount` 是 new-api 记账时代遗留的列（读路径已不看它）。若把它当输入收下，
    // 用户会看到 999999 而实际到账 1500。
    expect(createInput(topupTier).amount).toBeUndefined();
    expect(createInput(topupTier).baseCredits).toBe(1500);
  });

  it("body 里的 price 被忽略（实付 = 原价 × 折扣，由 repo 派生）", async () => {
    const { controller, topupTier } = createController();

    await controller.create({ originalPrice: 100, discount: 0.5, baseCredits: 1500, price: 1 });

    expect(createInput(topupTier)).not.toHaveProperty("price");
  });
});

describe("AdminTopupTiersController — 卡片字段解析（PRD §10.2）", () => {
  it("赠送积分：非负整数放行，负数 / 小数 / 布尔 400", async () => {
    const { controller, topupTier } = createController();

    await controller.create({
      originalPrice: 100,
      discount: 1,
      baseCredits: 1500,
      bonusCredits: 3750,
    });
    expect(createInput(topupTier).bonusCredits).toBe(3750);

    // 数字串 "3750" 放行：与原价 / 折扣同口径（表单从 DOM 出来本来就是字符串），
    // 见 parseTierOriginalPrice / parseTierDiscount 的既有约定
    for (const bad of [-1, 1.5, true, "abc"]) {
      await expect(
        controller.create({ originalPrice: 100, discount: 1, baseCredits: 1500, bonusCredits: bad }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it("积分有效期：1–1200 的整数（单位月），0 与 1201 都 400", async () => {
    const { controller, topupTier } = createController();

    await controller.create({
      originalPrice: 100,
      discount: 1,
      baseCredits: 1500,
      creditsValidMonths: 24,
    });
    expect(createInput(topupTier).creditsValidMonths).toBe(24);

    for (const bad of [0, -1, 1201, 2.5]) {
      await expect(
        controller.create({
          originalPrice: 100,
          discount: 1,
          creditsValidMonths: bad,
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it("是否参与首购只收布尔，字符串 'true' 400", async () => {
    const { controller, topupTier } = createController();

    await controller.create({
      originalPrice: 100,
      discount: 1,
      baseCredits: 1500,
      firstPurchaseEligible: true,
    });
    expect(createInput(topupTier).firstPurchaseEligible).toBe(true);

    await expect(
      controller.create({
        originalPrice: 100,
        discount: 1,
        firstPurchaseEligible: "true",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("文本超列宽 → 400（不要等 MySQL 严格模式在写库时炸成 500）", async () => {
    const { controller } = createController();

    await expect(
      controller.create({
        originalPrice: 100,
        discount: 1,
        description: "x".repeat(256),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      controller.create({
        originalPrice: 100,
        discount: 1,
        activityTag: "x".repeat(65),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      controller.create({
        originalPrice: 100,
        discount: 1,
        buttonText: "x".repeat(33),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("AdminTopupTiersController — 购买权限（PRD §10.4）", () => {
  it("member_tier 放行：阶段 2 的值现在就要能存下来（先占位，加逻辑不改表）", async () => {
    const { controller, topupTier } = createController();

    await controller.create({
      originalPrice: 100,
      discount: 1,
      baseCredits: 1500,
      permission: "member_tier",
    });

    expect(createInput(topupTier).permission).toBe("member_tier");
  });

  it("枚举外的值 400", async () => {
    const { controller, topupTier } = createController();

    await expect(
      controller.create({ originalPrice: 100, discount: 1, baseCredits: 1500, permission: "vip" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(topupTier.create).not.toHaveBeenCalled();
  });

  it("★ 白名单归一成十进制串：数字、前导零、重复项", async () => {
    const { controller, topupTier } = createController();

    await controller.create({
      originalPrice: 100,
      discount: 1,
      baseCredits: 1500,
      permission: "user_group",
      permissionAllowlist: [9001, "007", "9001"],
    });

    // userId 是 BigInt：存成 number 超过安全整数就会静默改值，
    // 而白名单错一位是「放进来一个陌生人」——所以统一存十进制串并掐前导零。
    expect(createInput(topupTier).permissionAllowlist).toEqual(["9001", "7"]);
  });

  it("白名单不是数组 / 元素不是 id → 400（而不是当成空名单存下去）", async () => {
    const { controller, topupTier } = createController();

    for (const bad of ["9001", { id: 9001 }, [9001, "abc"], [null]]) {
      await expect(
        controller.create({
          originalPrice: 100,
          discount: 1,
          permissionAllowlist: bad,
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(topupTier.create).not.toHaveBeenCalled();
  });

  it("显式 null = 清空白名单", async () => {
    const { controller, topupTier } = createController();

    await controller.create({
      originalPrice: 100,
      discount: 1,
      baseCredits: 1500,
      permissionAllowlist: null,
    });

    expect(createInput(topupTier).permissionAllowlist).toBeNull();
  });
});

describe("AdminTopupTiersController.update — 部分更新", () => {
  it("只传一个卡片字段：其余新旧字段都不出现在入参里", async () => {
    const { controller, topupTier } = createController();

    await controller.update("7", { activityTag: "首购超级翻倍" });

    const input = updateInput(topupTier);
    expect(input.activityTag).toBe("首购超级翻倍");
    for (const untouched of [
      "bonusCredits",
      "description",
      "buttonText",
      "firstPurchaseEligible",
      "creditsValidMonths",
      "permission",
      "permissionAllowlist",
      "permissionDeniedHint",
      "status",
      "name",
      "discount",
      "originalPrice",
      // 基础积分同为部分更新：只改标签不该顺手把积分写一遍
      "baseCredits",
    ]) {
      expect(input).not.toHaveProperty(untouched);
    }
  });

  it("★ 改原价**不再连带改积分**（两条独立配置项）", async () => {
    const { controller, topupTier } = createController();

    await controller.update("7", { originalPrice: 200 });

    const input = updateInput(topupTier);
    expect(input.originalPrice).toBe(200);
    // 曾经这里是 `amount: deriveCredits(原价, 换算率)`：改价顺手把积分重算一遍。
    // 现在积分是运营配的值，改原价（只为划线价）不该动它。
    expect(input).not.toHaveProperty("baseCredits");
  });

  it("编辑也认基础积分：合法放行、非法 400", async () => {
    const { controller, topupTier } = createController();

    await controller.update("7", { baseCredits: 7_500 });
    expect(updateInput(topupTier).baseCredits).toBe(7500);

    await expect(
      controller.update("7", { baseCredits: 0 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("编辑上的状态走同一把尺子：三态放行、别的 400", async () => {
    const { controller, topupTier } = createController();

    await controller.update("7", { status: "inactive" });
    expect(updateInput(topupTier).status).toBe("inactive");

    await expect(controller.update("7", { status: "off" })).rejects.toMatchObject({
      status: 400,
    });
  });
});
