import { describe, expect, it } from "vitest";

import {
  DEFAULT_PERMISSION_DENIED_HINT,
  canPurchaseCustom,
  customDeniedHint,
  customPriceFen,
  parseCustomCredits,
  validateCustomConfig,
} from "./constants.js";


const DEFAULT = {
  minCredits: 600,
  maxCredits: 499_995,
  defaultCredits: 600,
  creditsPerYuan: 15,
  stepCredits: 15,
};

describe("customPriceFen — 价格 = 积分数 ÷ 每元积分数，四舍五入到分", () => {
  it("PRD §7.6「价格计算」：按 1 元 = 15 积分正确刷新", () => {
    expect(customPriceFen(600, 15)).toBe(4_000);
    expect(customPriceFen(900, 15)).toBe(6_000);
    expect(customPriceFen(1_200, 15)).toBe(8_000);
    expect(customPriceFen(499_995, 15)).toBe(3_333_300);
  });

  it("★ 取整以积分为准：价格四舍五入到分，绝不为凑整回头去改积分数", () => {
    expect(customPriceFen(601, 15)).toBe(4_007);
    expect(customPriceFen(1, 15)).toBe(7);
    expect(customPriceFen(7, 8)).toBe(88);
  });

  it("先乘后除：不允许出现浮点误差把整元价算歪", () => {
    for (let credits = 600; credits <= 9_000; credits += 15) {
      expect(customPriceFen(credits, 15)).toBe((credits / 15) * 100);
    }
  });

  it("换算率非法（0 / 负数 / 非有限）→ 抛错，不返回一个编的价格", () => {
    expect(() => customPriceFen(600, 0)).toThrow(/定价参数非法/);
    expect(() => customPriceFen(600, -15)).toThrow(/定价参数非法/);
    expect(() => customPriceFen(600, Number.NaN)).toThrow(/定价参数非法/);
  });
});

describe("parseCustomCredits — 用户输入的积分数", () => {
  it("正整数与数字串放行（表单从 DOM 出来就是字符串）", () => {
    expect(parseCustomCredits(600)).toBe(600);
    expect(parseCustomCredits("600")).toBe(600);
    expect(parseCustomCredits(" 900 ")).toBe(900);
  });

  it("0 / 负数 / 小数 / 非数字 → null（0 积分的订单是「付 0 元拿 0 积分」，没有存在理由）", () => {
    for (const raw of [0, -1, 600.5, "abc", null, undefined, true, {}, []]) {
      expect(parseCustomCredits(raw), `raw=${String(raw)}`).toBeNull();
    }
  });
});

describe("validateCustomConfig — 保存配置时的整份口径校验（PRD §7.1 / §10.3）", () => {
  it("PRD §7.1 的默认那组数是合法的（种子配歪了这里就会红）", () => {
    expect(validateCustomConfig(DEFAULT)).toBeNull();
  });

  it("★ 下限 / 上限 / 默认值必须能被每元积分数整除", () => {
    expect(validateCustomConfig({ ...DEFAULT, minCredits: 601 })).toMatch(/最低积分/);
    expect(validateCustomConfig({ ...DEFAULT, defaultCredits: 601 })).toMatch(/默认积分/);
    expect(validateCustomConfig({ ...DEFAULT, creditsPerYuan: 4 })).toMatch(/最高积分/);
  });

  it("★ 校验的是**整份**配置：只改换算率也会让上下限不再整分", () => {
    const err = validateCustomConfig({ ...DEFAULT, creditsPerYuan: 4 });
    expect(err).not.toBeNull();
    expect(err).toContain("499995");
    expect(validateCustomConfig({ ...DEFAULT, creditsPerYuan: 7 })).toContain("600");
  });

  it("范围关系：最高不得低于最低；默认值必须落在两者之间", () => {
    expect(validateCustomConfig({ ...DEFAULT, maxCredits: 300 })).toMatch(
      /最高积分不得低于最低积分/,
    );
    expect(validateCustomConfig({ ...DEFAULT, defaultCredits: 499_995 + 15 })).toMatch(
      /默认积分须落在/,
    );
  });

  it("每个数字都必须是 >= 1 的整数（0 元 / 0 积分的配置没有意义）", () => {
    for (const patch of [
      { minCredits: 0 },
      { maxCredits: 0 },
      { defaultCredits: 0 },
      { creditsPerYuan: 0 },
      { stepCredits: 0 },
      { stepCredits: 1.5 },
    ]) {
      expect(validateCustomConfig({ ...DEFAULT, ...patch }), JSON.stringify(patch)).toMatch(
        /1 以上的整数/,
      );
    }
  });

  it("★ 步长必须让滑杆推得到两端（否则「最高可选 499,995」是句假话）", () => {
    expect(validateCustomConfig({ ...DEFAULT, stepCredits: 16 })).toMatch(
      /滑杆推不到最高值/,
    );
    expect(validateCustomConfig({ ...DEFAULT, stepCredits: 7 })).toMatch(
      /滑杆推不到最高值/,
    );
  });

  it("★ 默认值必须是滑杆上的一个格点（否则「默认选中」那个数拖不出来）", () => {
    const cfg = {
      minCredits: 600,
      maxCredits: 900,
      defaultCredits: 615,
      creditsPerYuan: 15,
      stepCredits: 30,
    };
    expect(validateCustomConfig(cfg)).toMatch(/默认值不在滑杆的格点上/);
  });
});

describe("canPurchaseCustom — 购买权限（PRD §10.4）", () => {
  it("all：全部登录用户可买", () => {
    expect(
      canPurchaseCustom({ permission: "all", permissionAllowlist: [] }, 9001),
    ).toBe(true);
  });

  it("user_group：按白名单（字符串比对，BigInt 不会静默错位）", () => {
    const config = { permission: "user_group" as const, permissionAllowlist: ["9001"] };
    expect(canPurchaseCustom(config, 9001)).toBe(true);
    expect(canPurchaseCustom(config, 9002)).toBe(false);
  });

  it("user_group + 空名单 = 谁都不能买（那是运营的显式配置，不做兜底放行）", () => {
    expect(
      canPurchaseCustom({ permission: "user_group", permissionAllowlist: [] }, 9001),
    ).toBe(false);
  });

  it("★ member_tier 本阶段**放行**：会员体系还没有，按它拒绝等于把所有人挡在门外", () => {
    expect(
      canPurchaseCustom({ permission: "member_tier", permissionAllowlist: [] }, 9001),
    ).toBe(true);
  });
});

describe("customDeniedHint — 无权限提示", () => {
  it("后台配了就用后台的", () => {
    expect(customDeniedHint({ permissionDeniedHint: "该活动仅限内测用户" })).toBe(
      "该活动仅限内测用户",
    );
  });

  it("没配（空串/空白）用默认文案：不能把空串当提示展示出来", () => {
    expect(customDeniedHint({ permissionDeniedHint: "" })).toBe(
      DEFAULT_PERMISSION_DENIED_HINT,
    );
    expect(customDeniedHint({ permissionDeniedHint: "   " })).toBe(
      DEFAULT_PERMISSION_DENIED_HINT,
    );
  });
});
