import { describe, expect, it } from "vitest";

import {
  mapAdminOrder,
  mapAdminUser,
  mapConsumeRecord,
} from "./admin-mapper.js";

// IK9VZ0：管理端展示口径统一——quota 原值换算为积分（quota / 50,000），
// 与用户侧一致；TopUp.Amount / Log.quota / User.quota 均为 quota 量纲（Go 原值）。

describe("admin-mapper 展示口径（IK9VZ0 quota → 积分）", () => {
  it("mapAdminUser：balance / totalRecharge / totalSpend 换算为积分", () => {
    const user = mapAdminUser({
      id: 1,
      display_name: "u1",
      username: "u1",
      email: "u1@x.com",
      quota: 500_000, // 余额 10 积分
      used_quota: 50_000_000, // 累计消费 1000 积分
      role: 1,
      status: 1,
      created_at: 1700000000,
    } as never);
    expect(user.balance).toBe(10);
    expect(user.totalSpend).toBe(1000);
    expect(user.totalRecharge).toBe(1010);
  });

  it("mapAdminOrder：tierName / points 换算为积分（amount 为 quota 量纲）", () => {
    const order = mapAdminOrder({
      trade_no: "T1",
      user_id: 1,
      amount: 50_000_000, // 档位 quota
      money: 100,
      status: "success",
      payment_method: "wxpay",
      payment_provider: "bluewhalepay",
      create_time: 1700000000,
      complete_time: 1700000100,
    } as never);
    expect(order.tierName).toBe("1000 积分");
    expect(order.points).toBe(1000);
    expect(order.price).toBe(100);
  });

  it("mapConsumeRecord：points 换算为积分（quota 量纲）", () => {
    const record = mapConsumeRecord({
      user_id: 1,
      model_name: "doubao-seedance-2-0",
      quota: 880000, // 消费 17.6 积分
      created_at: 1700000000,
    } as never);
    expect(record.points).toBe(17.6);
    expect(record.model).toBe("doubao-seedance-2-0");
  });

  it("非法/缺失 quota → 0 积分（不抛错）", () => {
    const user = mapAdminUser({ id: 1, username: "u" } as never);
    expect(user.balance).toBe(0);
    const order = mapAdminOrder({ trade_no: "T2", user_id: 2 } as never);
    expect(order.points).toBe(0);
  });
});
