import { describe, expect, it, vi } from "vitest";

import { AdminBillingPromotionsController } from "./billing-promotions.controller.js";
import { BillingAdminError } from "@lib/shared/billing/billing-admin-client.js";

const billing = vi.hoisted(() => ({
  listPromotions: vi.fn(),
  createPromotion: vi.fn(),
  updatePromotion: vi.fn(),
  deletePromotion: vi.fn(),
}));

vi.mock("@lib/shared/billing/billing-admin-client.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, ...billing };
});

const OPERATOR = { userId: "42" } as never;

const VALID_BODY = {
  code: "night-70",
  name: "夜间 7 折",
  discountBp: 7000,
  modelIds: ["seedance-*"],
  taskTypes: [],
  tierScope: ["pro", "max"],
  startAt: "2026-10-01T00:00",
  endAt: "2026-11-01T00:00",
  dailyTimeStart: "22:00",
  dailyTimeEnd: "06:00",
  daysOfWeek: [1, 5],
  tz: "Asia/Shanghai",
  status: "draft",
  priority: 0,
};

function createController() {
  return new AdminBillingPromotionsController();
}

describe("AdminBillingPromotionsController.create", () => {
  it("带上操作人 —— billing 那边没有鉴权，这是「谁建的」唯一来源", async () => {
    billing.createPromotion.mockResolvedValue({ id: 3 });

    await createController().create(OPERATOR, VALID_BODY);

    expect(billing.createPromotion).toHaveBeenCalledWith(
      expect.objectContaining({ code: "night-70", daysOfWeek: [1, 5] }),
      "42",
    );
  });

  it("空数组的任务 / 等级范围归一成 null（不限只有一个表示）", async () => {
    billing.createPromotion.mockResolvedValue({ id: 3 });

    await createController().create(OPERATOR, { ...VALID_BODY, taskTypes: [], tierScope: [] });

    // ⚠️ 不归一会让「界面上清空了」这件事，要靠读 billing 的代码才知道它等于不限
    expect(billing.createPromotion).toHaveBeenCalledWith(
      expect.objectContaining({ taskTypes: null, tierScope: null }),
      "42",
    );
  });

  it("模型范围不能为空 —— 空数组在计价侧等于全站打折", async () => {
    billing.createPromotion.mockClear();

    await expect(
      createController().create(OPERATOR, { ...VALID_BODY, modelIds: [] }),
    ).rejects.toMatchObject({ status: 400 });
    expect(billing.createPromotion).not.toHaveBeenCalled();
  });

  it("时间字段不是文本 / 缺字段 → 400，不让它变成一个 undefined 转发过去", async () => {
    await expect(
      createController().create(OPERATOR, { ...VALID_BODY, startAt: undefined }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createController().create(OPERATOR, { ...VALID_BODY, daysOfWeek: ["1"] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("billing 不可用 → 503（等服务恢复，而不是改表单）", async () => {
    billing.createPromotion.mockRejectedValue(new BillingAdminError("HTTP 502"));

    await expect(createController().create(OPERATOR, VALID_BODY)).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe("AdminBillingPromotionsController 读 / 改 / 删", () => {
  it("列：不带状态时不过滤", async () => {
    billing.listPromotions.mockResolvedValue([]);

    await createController().list(undefined);

    expect(billing.listPromotions).toHaveBeenCalledWith({});
  });

  it("改：id 走路径，body 整条覆盖", async () => {
    billing.updatePromotion.mockResolvedValue({ id: 3 });

    await createController().update("3", VALID_BODY);

    expect(billing.updatePromotion).toHaveBeenCalledWith(3, expect.objectContaining({ code: "night-70" }));
  });

  it("删：回 deleted:true；id 非数字是 400", async () => {
    billing.deletePromotion.mockResolvedValue(undefined);

    await expect(createController().remove("3")).resolves.toEqual({
      success: true,
      data: { deleted: true },
    });
    await expect(createController().remove("x")).rejects.toMatchObject({ status: 400 });
  });
});
