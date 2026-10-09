import { describe, expect, it } from "vitest";

import {
  DiscountInputError,
  parseId,
  parseMemberDiscountInput,
  parsePromotionInput,
  toDiscountAdminError,
} from "./discount-input.js";
import { BillingAdminError, DiscountNotFoundError, DiscountRejectedError } from "./billing-admin-client.js";
import { AdminException } from "@lib/shared/errors/admin-error.js";

const MEMBER = {
  tier: "pro",
  modelPattern: "*",
  taskPattern: "*",
  discountBp: 9000,
  priority: 0,
  status: "enabled",
};

const PROMOTION = {
  code: "night-70",
  name: "夜间 7 折",
  discountBp: 7000,
  modelIds: ["seedance-*"],
  taskTypes: null,
  tierScope: null,
  startAt: "2026-10-01T00:00",
  endAt: "2026-11-01T00:00",
  dailyTimeStart: "22:00",
  dailyTimeEnd: "06:00",
  daysOfWeek: [1, 5],
  status: "draft",
  priority: 0,
};

describe("parseMemberDiscountInput", () => {
  it("去掉可选文本的空白，数字原样", () => {
    expect(parseMemberDiscountInput({ ...MEMBER, tier: " pro " })).toEqual(MEMBER);
  });

  it("请求体不是对象 → 400", () => {
    for (const body of [null, [], "x", 42]) {
      expect(() => parseMemberDiscountInput(body)).toThrow(DiscountInputError);
    }
  });

  it("缺字段 / 类型不对 → 400（不是把它当 undefined 转发给 billing）", () => {
    expect(() => parseMemberDiscountInput({ ...MEMBER, discountBp: "9000" })).toThrow(/必须是整数/);
    expect(() => parseMemberDiscountInput({ ...MEMBER, discountBp: 9.5 })).toThrow(/必须是整数/);
    expect(() => parseMemberDiscountInput({ ...MEMBER, modelPattern: "  " })).toThrow(/必填/);
  });
});

describe("parsePromotionInput", () => {
  it("完整请求体原样通过", () => {
    expect(parsePromotionInput(PROMOTION)).toEqual(PROMOTION);
  });

  it("空数组归一成 null：不限／全天在库里只有一种表示", () => {
    const parsed = parsePromotionInput({
      ...PROMOTION,
      taskTypes: [],
      tierScope: [],
      daysOfWeek: [],
    });

    expect(parsed.taskTypes).toBeNull();
    expect(parsed.tierScope).toBeNull();
    expect(parsed.daysOfWeek).toBeNull();
  });

  it("模型范围不能为空（空数组在计价侧 = 全站打折，几乎不会是本意）", () => {
    expect(() => parsePromotionInput({ ...PROMOTION, modelIds: [] })).toThrow(/至少填一个/);
    expect(() => parsePromotionInput({ ...PROMOTION, modelIds: undefined })).toThrow(/至少填一个/);
  });

  it("数组元素类型不对 → 400", () => {
    expect(() => parsePromotionInput({ ...PROMOTION, modelIds: [1] })).toThrow(/必须是文本数组/);
    expect(() => parsePromotionInput({ ...PROMOTION, daysOfWeek: ["1"] })).toThrow(/必须是整数数组/);
  });

  it("时间字段必须是文本：缺字段就是缺字段，不替它兜一个默认值", () => {
    expect(() => parsePromotionInput({ ...PROMOTION, startAt: "" })).toThrow(/起始时间必填/);
  });

  it("每日时段给 null 是「全天」这个状态，不是「没填」", () => {
    const parsed = parsePromotionInput({ ...PROMOTION, dailyTimeStart: null, dailyTimeEnd: null });

    expect(parsed.dailyTimeStart).toBeNull();
    expect(parsed.dailyTimeEnd).toBeNull();
  });
});

describe("parseId", () => {
  it("只接受正整数", () => {
    expect(parseId("12")).toBe(12);
    for (const raw of ["abc", "0", "-3", "1.5", ""]) {
      expect(() => parseId(raw)).toThrow(AdminException);
      expect(() => parseId(raw)).toThrow(/必须是正整数/);
    }
  });
});

describe("toDiscountAdminError", () => {
  it("四类失败各归各位：400 改表单 / 404 刷新 / 503 等服务", () => {
    expect(toDiscountAdminError(new DiscountInputError("折扣必填"))).toMatchObject({ status: 400 });
    expect(toDiscountAdminError(new DiscountRejectedError("折扣被拒"))).toMatchObject({ status: 400 });
    expect(toDiscountAdminError(new DiscountNotFoundError("不存在"))).toMatchObject({ status: 404 });
    expect(toDiscountAdminError(new BillingAdminError("HTTP 502"))).toMatchObject({ status: 503 });
    expect(toDiscountAdminError(new Error("boom"))).toMatchObject({ status: 500 });
  });

  it("已经是 AdminException 的原样返回（幂等：控制器可能连抛两次）", () => {
    const original = new AdminException(409, "冲突");

    expect(toDiscountAdminError(original)).toBe(original);
  });
});
