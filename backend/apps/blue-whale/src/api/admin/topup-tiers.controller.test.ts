import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminTopupTiersController } from "./topup-tiers.controller.js";

/**
 * 管理端固定积分卡接口（`/api/admin/topup-tiers`）在字段扩展后的两处硬约束：
 *
 * <ul>
 *   <li>**新建默认草稿**（PRD §10.5）：落成 active 就是「新建即开卖」，
 *       而卡片上的价格、赠送、标签在那一刻还没配；</li>
 *   <li>**支付价格与基础积分不是输入**：body 里塞 `amount` 必须被忽略，
 *       真正入库的是「原价 × 换算率」派生出来的那个数——否则
 *       「原价 100、积分 999999」这种自相矛盾的档位就能存进库。</li>
 * </ul>
 *
 * 其余是枚举与边界的取值纪律：非法值一律 400，**不静默回退到默认值**
 * （静默回退会让运营以为自己改成功了）。
 */

const billing = vi.hoisted(() => ({ fetchCreditsPerYuan: vi.fn() }));

vi.mock("@lib/shared/billing/billing-admin-client.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, ...billing };
});

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
  billing.fetchCreditsPerYuan.mockResolvedValue(15);
});

describe("AdminTopupTiersController.create — 新建默认草稿", () => {
  it("★ 不传 status → 落 draft（不是 active）", async () => {
    const { controller, topupTier } = createController();

    await controller.create({ originalPrice: 100, discount: 1 });

    expect(createInput(topupTier).status).toBe("draft");
  });

  it("显式传三态之一 → 以传入为准", async () => {
    const { controller, topupTier } = createController();

    await controller.create({ originalPrice: 100, discount: 1, status: "active" });

    expect(createInput(topupTier).status).toBe("active");
  });

  it("非法状态 → 400，且不落库", async () => {
    const { controller, topupTier } = createController();

    await expect(
      controller.create({ originalPrice: 100, discount: 1, status: "enabled" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(topupTier.create).not.toHaveBeenCalled();
  });
});

describe("AdminTopupTiersController.create — 派生量不是输入", () => {
  it("★ body 里的 amount 被忽略，入库的是「原价 × 换算率」", async () => {
    const { controller, topupTier } = createController();

    await controller.create({ originalPrice: 100, discount: 1, amount: 999_999 });

    // 100 元 × 15 = 1500。若把 body.amount 当输入收下，用户会看到 999999 而实际到账 1500。
    expect(createInput(topupTier).amount).toBe(1500);
  });

  it("body 里的 price 被忽略（实付 = 原价 × 折扣，由 repo 派生）", async () => {
    const { controller, topupTier } = createController();

    await controller.create({ originalPrice: 100, discount: 0.5, price: 1 });

    expect(createInput(topupTier)).not.toHaveProperty("price");
  });
});

describe("AdminTopupTiersController — 卡片字段解析（PRD §10.2）", () => {
  it("赠送积分：非负整数放行，负数 / 小数 / 布尔 400", async () => {
    const { controller, topupTier } = createController();

    await controller.create({
      originalPrice: 100,
      discount: 1,
      bonusCredits: 3750,
    });
    expect(createInput(topupTier).bonusCredits).toBe(3750);

    // 数字串 "3750" 放行：与原价 / 折扣同口径（表单从 DOM 出来本来就是字符串），
    // 见 parseTierOriginalPrice / parseTierDiscount 的既有约定
    for (const bad of [-1, 1.5, true, "abc"]) {
      await expect(
        controller.create({ originalPrice: 100, discount: 1, bonusCredits: bad }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it("积分有效期：1–1200 的整数（单位月），0 与 1201 都 400", async () => {
    const { controller, topupTier } = createController();

    await controller.create({
      originalPrice: 100,
      discount: 1,
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
      permission: "member_tier",
    });

    expect(createInput(topupTier).permission).toBe("member_tier");
  });

  it("枚举外的值 400", async () => {
    const { controller, topupTier } = createController();

    await expect(
      controller.create({ originalPrice: 100, discount: 1, permission: "vip" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(topupTier.create).not.toHaveBeenCalled();
  });

  it("★ 白名单归一成十进制串：数字、前导零、重复项", async () => {
    const { controller, topupTier } = createController();

    await controller.create({
      originalPrice: 100,
      discount: 1,
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
    ]) {
      expect(input).not.toHaveProperty(untouched);
    }
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
