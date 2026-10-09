import { describe, expect, it, vi } from "vitest";

import { AdminBillingDiscountsController } from "./billing-discounts.controller.js";
import {
  BillingAdminConfigError,
  DiscountNotFoundError,
  DiscountRejectedError,
} from "@lib/shared/billing/billing-admin-client.js";

const billing = vi.hoisted(() => ({
  listMemberDiscounts: vi.fn(),
  createMemberDiscount: vi.fn(),
  updateMemberDiscount: vi.fn(),
  deleteMemberDiscount: vi.fn(),
}));

vi.mock("@lib/shared/billing/billing-admin-client.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, ...billing };
});

const VALID_BODY = {
  tier: "pro",
  modelPattern: "*",
  taskPattern: "*",
  discountBp: 9000,
  priority: 0,
  status: "enabled",
};

function createController() {
  return new AdminBillingDiscountsController();
}

describe("AdminBillingDiscountsController.list", () => {
  it("不带过滤条件时不传查询串（不过滤 ≠ 过滤一个空值）", async () => {
    billing.listMemberDiscounts.mockResolvedValue([]);

    await expect(createController().list(undefined, undefined)).resolves.toEqual({
      success: true,
      data: [],
    });
    expect(billing.listMemberDiscounts).toHaveBeenCalledWith({});
  });

  it("带过滤条件时原样转发", async () => {
    billing.listMemberDiscounts.mockResolvedValue([{ id: 1, tier: "pro" }]);

    await createController().list("pro", "enabled");

    expect(billing.listMemberDiscounts).toHaveBeenCalledWith({ tier: "pro", status: "enabled" });
  });

  it("billing 管理端地址没配 → 503，不伪装成 500", async () => {
    billing.listMemberDiscounts.mockRejectedValue(
      new BillingAdminConfigError("计费管理端地址未配置（缺环境变量 BILLING_ADMIN_URL）"),
    );

    await expect(createController().list(undefined, undefined)).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe("AdminBillingDiscountsController.create", () => {
  it("请求体解析成有类型的输入后外发", async () => {
    billing.createMemberDiscount.mockResolvedValue({ id: 7, ...VALID_BODY });

    await createController().create({ ...VALID_BODY, tier: " pro " });

    expect(billing.createMemberDiscount).toHaveBeenCalledWith(VALID_BODY);
  });

  it("形状不对 → 400，且不打扰 billing", async () => {
    billing.createMemberDiscount.mockClear();

    for (const body of [{}, { ...VALID_BODY, discountBp: "9000" }, { ...VALID_BODY, tier: "  " }]) {
      await expect(createController().create(body)).rejects.toMatchObject({ status: 400 });
    }
    expect(billing.createMemberDiscount).not.toHaveBeenCalled();
  });

  it("billing 说「你配得不对」（400）→ 原样透传 400 与人话", async () => {
    billing.createMemberDiscount.mockRejectedValue(
      new DiscountRejectedError("折扣配置被拒：折扣必须大于 0：万分比 0 表示免费"),
    );

    await expect(createController().create(VALID_BODY)).rejects.toMatchObject({
      status: 400,
      message: "折扣配置被拒：折扣必须大于 0：万分比 0 表示免费",
    });
  });
});

describe("AdminBillingDiscountsController.update / remove", () => {
  it("改：整条覆盖，id 走路径", async () => {
    billing.updateMemberDiscount.mockResolvedValue({ id: 7, ...VALID_BODY });

    await createController().update("7", VALID_BODY);

    expect(billing.updateMemberDiscount).toHaveBeenCalledWith(7, VALID_BODY);
  });

  it("id 不是正整数 → 400（拼错地址，不是服务故障）", async () => {
    await expect(createController().update("abc", VALID_BODY)).rejects.toMatchObject({
      status: 400,
    });
    await expect(createController().remove("0")).rejects.toMatchObject({ status: 400 });
  });

  it("删一条已经不在的 → 404（刷新一下，而不是改表单）", async () => {
    billing.deleteMemberDiscount.mockRejectedValue(
      new DiscountNotFoundError("目标不存在：会员折扣不存在（可能已被删除）：id=7"),
    );

    await expect(createController().remove("7")).rejects.toMatchObject({ status: 404 });
  });

  it("删成功 → 回 deleted:true", async () => {
    billing.deleteMemberDiscount.mockResolvedValue(undefined);

    await expect(createController().remove("7")).resolves.toEqual({
      success: true,
      data: { deleted: true },
    });
  });
});
