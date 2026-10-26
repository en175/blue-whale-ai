import { describe, expect, it } from "vitest";
import { lotDetailText } from "./lot-detail.js";

const base = { amount: 1500, remaining: 1500, productName: "白送" };

describe("lotDetailText（获取详情）", () => {
  it("★ 每个批次只写自己的角色，数字取本批次 amount", () => {
    expect(lotDetailText({ ...base, source: "purchased" })).toBe("白送，充值积分：1500");
    expect(lotDetailText({ ...base, source: "bonus", amount: 1000 })).toBe("白送，赠送积分：1000");
  });

  it("★ 未用满时补「· 剩余」，用满或未用不补", () => {
    expect(lotDetailText({ ...base, source: "purchased", remaining: 1200 })).toBe(
      "白送，充值积分：1500 · 剩余 1200",
    );
    expect(lotDetailText({ ...base, source: "purchased", remaining: 1500 })).toBe(
      "白送，充值积分：1500",
    );
  });

  it("无商品名（非充值批次）回落来源文案 + 积分", () => {
    expect(
      lotDetailText({ source: "gift", amount: 10000, remaining: 10000, productName: null }),
    ).toBe("赠送 10000 积分");
    expect(
      lotDetailText({ source: "gift", amount: 10000, remaining: 9795, productName: null }),
    ).toBe("赠送 10000 积分 · 剩余 9795");
  });

  it("充值批次但商品名为空串时同样回落，不产出悬空标点", () => {
    expect(
      lotDetailText({ source: "purchased", amount: 600, remaining: 600, productName: "" }),
    ).toBe("充值到账 600 积分");
  });

  it("未知来源原样透出", () => {
    expect(
      lotDetailText({ source: "mystery", amount: 1, remaining: 1, productName: null }),
    ).toBe("mystery 1 积分");
  });
});
