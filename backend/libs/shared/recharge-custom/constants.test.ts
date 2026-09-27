import { describe, expect, it } from "vitest";

import {
  DEFAULT_PERMISSION_DENIED_HINT,
  canPurchaseCustom,
  customCreditsExpireAt,
  customDeniedHint,
  customPriceFen,
  parseCustomCredits,
  validateCustomConfig,
} from "./constants.js";

// 纯函数层（模块 B，PRD §7.1 / §7.3 / §7.6）。
// 这些规则同时被「下单链路」与「管理端保存接口」用 —— 只留一份，
// 否则会出现「后台保存时放行、用户下单时拒绝」这种以「配置保存成功了」形式出现的缺陷。

/** PRD §7.1 的默认配置（校验的基准）。 */
const DEFAULT = {
  minCredits: 600,
  maxCredits: 499_995,
  defaultCredits: 600,
  creditsPerYuan: 15,
  stepCredits: 15,
};

describe("customPriceFen — 价格 = 积分数 ÷ 每元积分数，四舍五入到分", () => {
  it("PRD §7.6「价格计算」：按 1 元 = 15 积分正确刷新", () => {
    // 600 ÷ 15 = ¥40（4000 分）
    expect(customPriceFen(600, 15)).toBe(4_000);
    expect(customPriceFen(900, 15)).toBe(6_000);
    expect(customPriceFen(1_200, 15)).toBe(8_000);
    // 上限：499,995 ÷ 15 = ¥33,333 整
    expect(customPriceFen(499_995, 15)).toBe(3_333_300);
  });

  it("★ 取整以积分为准：价格四舍五入到分，绝不为凑整回头去改积分数", () => {
    // 601 ÷ 15 = 40.0666… → ¥40.07。那 0.0033 元的零头平台承担 ——
    // 账本只有整数积分，用户要 601 就发 601
    expect(customPriceFen(601, 15)).toBe(4_007);
    // 1 ÷ 15 = 0.0666… → ¥0.07
    expect(customPriceFen(1, 15)).toBe(7);
    // 半分钱恰好落在中点：Math.round 向上（用户多付半分，不会付不出这个价）
    expect(customPriceFen(7, 8)).toBe(88); // 0.875 元 → 88 分
  });

  it("先乘后除：不允许出现浮点误差把整元价算歪", () => {
    // 若写成 `credits / rate * 100`，300 ÷ 15 得 20.000000000000004 之类再放大取整，
    // 上限那几个大数上会漂。这里把「整元」的价逐一对一遍
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
    // PRD §7.1 自己注明「最高…需能被换算比例整除」，而换算比例是**可配的**。
    // 三个值分别取一个「只有它不整除」的比例，确保三条判断都在（不是只查了第一个）
    expect(validateCustomConfig({ ...DEFAULT, minCredits: 601 })).toMatch(/最低积分/);
    expect(validateCustomConfig({ ...DEFAULT, defaultCredits: 601 })).toMatch(/默认积分/);
    // 比例 4：600 % 4 === 0 通过，而 499995 % 4 === 3 —— 只有上限这一条会响
    expect(validateCustomConfig({ ...DEFAULT, creditsPerYuan: 4 })).toMatch(/最高积分/);
  });

  it("★ 校验的是**整份**配置：只改换算率也会让上下限不再整分", () => {
    // 这正是必须合并后校验的理由 —— 只看着 creditsPerYuan 一个字段是发现不了的
    const err = validateCustomConfig({ ...DEFAULT, creditsPerYuan: 4 });
    expect(err).not.toBeNull();
    expect(err).toContain("499995");
    // 换一个比例，卡住的换成下限：无论卡在哪一个，报的都是**整份配置**里的矛盾
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
    // max-min = 499395；步长 16 除不尽 → 用户拖到底拿不到上限
    expect(validateCustomConfig({ ...DEFAULT, stepCredits: 16 })).toMatch(
      /滑杆推不到最高值/,
    );
    // default-min = 0 恒成立，所以这里只可能卡在上一条
    expect(validateCustomConfig({ ...DEFAULT, stepCredits: 7 })).toMatch(
      /滑杆推不到最高值/,
    );
  });

  it("★ 默认值必须是滑杆上的一个格点（否则「默认选中」那个数拖不出来）", () => {
    // min=600, step=15, max 取一个能被 15 整除、且 (max-min) 也能被 15 整除的值
    const cfg = {
      minCredits: 600,
      maxCredits: 900,
      defaultCredits: 615,
      creditsPerYuan: 15,
      stepCredits: 30,
    };
    // (900-600) % 30 === 0 通过；但 (615-600) % 30 = 15 ≠ 0
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
    // PRD §10.4 明说它「为后续会员模块预留（阶段 2 生效，本阶段仅保留配置项）」
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

describe("customCreditsExpireAt — 订单快照里的有效期", () => {
  it("按支付成功时间起算，加配置的月数（PRD §9.5）", () => {
    const paidAt = new Date("2026-09-27T10:00:00.000Z");
    const expire = customCreditsExpireAt(paidAt, 24);
    expect(expire.getUTCFullYear()).toBe(2028);
    expect(expire.getUTCMonth()).toBe(8); // 9 月（0 基）
    // 不修改传入的 Date（快照是只读的输入）
    expect(paidAt.toISOString()).toBe("2026-09-27T10:00:00.000Z");
  });
});
