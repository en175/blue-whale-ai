/* ============================================
 * 自定义充值（模块 B，PRD §7）：价格换算 / 配置校验 / 购买权限。
 *
 * 这里全是**纯函数**：价格与校验的规则必须能被单测直接钉住，不需要起服务或连库。
 * 下单链路（`RechargeService`）与管理端配置接口共用同一份规则 —— 规则只能有一处，
 * 否则「后台保存时放行、用户下单时拒绝」这种事会以「配置配错了但保存成功了」的形式出现。
 * ============================================ */
import type { RechargeCustomConfigView } from "@lib/shared/persistence/index.js";
import {
  parseNonNegativeInt,
  parseTierAllowlist,
  parseTierPermission,
} from "@lib/shared/topup-tier/constants.js";

/**
 * 购买权限的枚举与白名单解析直接复用档位那套（PRD §10.3：「购买权限…与固定积分卡一致」）。
 *
 * <p>这不是顺手抄近路：两处**必须是同一份**枚举与同一份白名单归一规则，
 * 否则「同一批白名单用户在档位能买、在自定义充值买不了」这种差异没有任何人会预期到。
 * 别名（`parseCustomPermission`）是为了让调用点的语义读起来是「自定义充值的权限」，
 * 而不是「档位的权限」—— 它们本来就是同一个东西。
 */
export {
  parseTierAllowlist as parseCustomPermissionAllowlist,
  parseTierPermission as parseCustomPermission,
};

/** 无权限时的兜底文案（后台没配 `permission_denied_hint` 时用它）。 */
export const DEFAULT_PERMISSION_DENIED_HINT = "当前账号暂不可购买自定义充值";

/**
 * 价格（单位**分**）= 积分数 × 100 ÷ 每元积分数，四舍五入到分。
 *
 * <p>取整口径（产品 2026-09-27 定）：**以积分为准** —— 用户选 N 积分就发 N 积分，
 * 价格由 N 反算，落到分位时四舍五入。所以价格会带 ≤ 半分钱的零头，**平台承担**：
 * 账本只有整数积分，不可能为了把钱凑整去改用户要到账的积分数。
 *
 * <p>⚠️ 先乘后除。写成 `credits / creditsPerYuan * 100` 会先把价格算成一个无限小数
 * （1 ÷ 15 = 0.0666…）再放大，四舍五入之前就已经带上浮点误差。
 * 前端的同名函数（`web/src/lib/customRecharge.ts`）必须用同一个式子，否则
 * 「界面显示 ¥40.00、下单回来 ¥40.01」。
 */
export function customPriceFen(credits: number, creditsPerYuan: number): number {
  if (
    !Number.isFinite(credits) ||
    !Number.isFinite(creditsPerYuan) ||
    creditsPerYuan <= 0
  ) {
    throw new Error("自定义充值定价参数非法");
  }
  return Math.round((credits * 100) / creditsPerYuan);
}

/**
 * 解析用户输入的积分数：只接受 >= 1 的整数（数字串也放行，表单从 DOM 出来就是字符串）。
 *
 * <p>`0` 与负数一律 null：0 积分的订单是「用户付了 0 元、拿到 0 积分」，
 * 没有任何存在理由，放行只会让它出现在对账里。
 */
export function parseCustomCredits(raw: unknown): number | null {
  const n = parseNonNegativeInt(raw);
  if (n === null || n < 1) return null;
  return n;
}

/** PRD §7.1 / §10.3 里参与校验的那组数字（从配置视图里摘出来，便于纯函数直接吃）。 */
export interface CustomConfigNumbers {
  minCredits: number;
  maxCredits: number;
  defaultCredits: number;
  creditsPerYuan: number;
  stepCredits: number;
}

/**
 * 配置一致性校验（**对「合并后的整份配置」校验**，不是对这次传的字段）。
 *
 * <p>⚠️ 必须按整份校验，不能只校验改动字段：PRD §7.1 自己注明
 * 「最高…需能被换算比例整除」，而**换算比例是可配的** —— 运营只改比例、
 * 不动上下限，原来那组数也会立刻不再整分。只看着 `creditsPerYuan` 一个字段校验
 * 是发现不了这件事的。
 *
 * <p>返回中文错误消息（调用方直接 400 回给运营），合法返回 null。
 */
export function validateCustomConfig(next: CustomConfigNumbers): string | null {
  const { minCredits, maxCredits, defaultCredits, creditsPerYuan, stepCredits } = next;

  for (const [label, value] of [
    ["最低积分", minCredits],
    ["最高积分", maxCredits],
    ["默认积分", defaultCredits],
    ["每元积分数", creditsPerYuan],
    ["积分步长", stepCredits],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      return `${label}须为 1 以上的整数`;
    }
  }
  if (maxCredits < minCredits) return "最高积分不得低于最低积分";
  if (defaultCredits < minCredits || defaultCredits > maxCredits) {
    return "默认积分须落在最低积分与最高积分之间";
  }

  // ── 整除校验（PRD §7.1「需能被换算比例整除」）──────────────────────────────
  // 为什么要求整分：价格 = 积分数 ÷ 每元积分数，/15 的默认口径下三个默认值都是整元。
  // 运营把比例改成 7 这类数时，原来的 600/499995 就不再整分 —— 与其让用户下单时
  // 看到一个奇怪的价（¥85.72 而不是 ¥85.71），不如在保存这一步就拒绝。
  // 这是产品决定（任务 #42 决定 3），不是推导出来的数学必然。
  for (const [label, value] of [
    ["最低积分", minCredits],
    ["最高积分", maxCredits],
    ["默认积分", defaultCredits],
  ] as const) {
    if (value % creditsPerYuan !== 0) {
      return `${label} ${value} 不能被每元积分数 ${creditsPerYuan} 整除（PRD §7.1：上下限与默认值需能被换算比例整除）`;
    }
  }

  // ── 步长对齐：滑杆必须真能推到两端 ─────────────────────────────────────────
  // PRD §7.2 要在界面上写「最高可选 499,995 积分」，而用户滚动条能到达的最大值是
  // `min + k × step`。对不齐时那句话就是假的 —— 界面写着最高 499,995，
  // 拖到底只能拿到 499,995 之前的某个数。默认值同理（它必须是滑杆上的一个格点）。
  if ((maxCredits - minCredits) % stepCredits !== 0) {
    return `最高积分与最低积分之差（${maxCredits - minCredits}）必须是积分步长 ${stepCredits} 的整数倍，否则滑杆推不到最高值`;
  }
  if ((defaultCredits - minCredits) % stepCredits !== 0) {
    return `默认积分与最低积分之差（${defaultCredits - minCredits}）必须是积分步长 ${stepCredits} 的整数倍，否则默认值不在滑杆的格点上`;
  }

  return null;
}

/**
 * 这个用户能不能买自定义充值（PRD §7.4「登录后校验权限」/ §7.5「无购买权限 → 不创建订单」）。
 *
 * <p>⚠️ `member_tier`（指定会员等级）**本阶段放行**，不放行是错的：PRD §10.4 明说它是
 * 「为后续会员模块预留（阶段 2 生效，本阶段仅保留配置项）」，而会员体系现在还没有 ——
 * 按它拒绝等于把所有用户挡在门外，且现场表现是「配置看着没问题、人人都买不了」。
 * 阶段 2 接会员时，这里才该变成真实判断。
 *
 * <p>`user_group` 是**本阶段真生效**的那一条：名单为空 = 谁都不能买，
 * 这是运营的显式配置，不做兜底放行。
 */
export function canPurchaseCustom(
  config: Pick<RechargeCustomConfigView, "permission" | "permissionAllowlist">,
  userId: number,
): boolean {
  if (config.permission === "user_group") {
    return config.permissionAllowlist.includes(String(userId));
  }
  return true;
}

/** 无权限时给用户看的提示：后台配了就用后台的，没配才用默认文案。 */
export function customDeniedHint(
  config: Pick<RechargeCustomConfigView, "permissionDeniedHint">,
): string {
  const hint = config.permissionDeniedHint.trim();
  return hint || DEFAULT_PERMISSION_DENIED_HINT;
}

/**
 * 下单时刻的积分到期时间（PRD §7.4 快照「有效期」/ §9.5「自订单支付成功时间起算」）。
 *
 * <p>按**月**加：`Date.setMonth` 在 8/31 + 6 个月时会溢出到 3/3，
 * 那是 `new Date` 的既有语义，这里不做「钳到月末」的特殊处理 ——
 * 有效期是一个承诺的量级（2 年后），不是精确到日的对账口径。
 *
 * <p>⚠️ 落地范围：本函数只负责**把承诺写进订单快照**。
 * 「到期批次一次性过期并写过期流水」（§9.5）是 #43 的事，尚未实现 ——
 * 也就是说这一列现在**只被记录、不被执行**。
 */
export function customCreditsExpireAt(paidAt: Date, creditsValidMonths: number): Date {
  const expire = new Date(paidAt.getTime());
  expire.setMonth(expire.getMonth() + creditsValidMonths);
  return expire;
}
