/* ============================================
 * 定价目录草稿：解析 / 读取 / 修改 / 序列化 / 单位换算。
 *
 * 这些是纯函数，界面只负责把它们接到控件上 —— 目录与单价是**钱**，所以「怎么改」这件事
 * 必须能单测，而不是埋在 JSX 的事件处理里。（原先服务「模型计费」页；那一页已删除，单条规则的编辑收进模型列表的「定价」tab —— 规则的形态仍是本文件的 {@link CatalogRuleView}，
 * 只是存处从 `document.models.<模型>.<任务类型>` 搬到了能力行的 `pricing`。）
 *
 * ── 三条贯穿全文件的口径 ──────────────────────────────────────────────────────
 *
 * 1. **一条规则上的未知字段原样保留**。改一条规则一律是「读原对象 → 展开 → 只换要改的那几个键」
 *    （`ruleFromForm` 的入参 `original`），绝不用一个自己拼的新对象覆盖原对象 ——
 *    后者会在一次「只改单价」的保存里把别人的字段（`usageSemantic` / `by` 等）悄悄删掉。
 *
 *    ⚠️ **文档级反过来**：目录现在只有站点级那几个键（模型计价规则已搬进能力行
 *    `generation_model_capability.pricing`），发布用的文档由 {@link siteCatalogDocument}
 *    **白名单重建**，不再展开原对象。为什么以前不能、现在可以，见那个函数。
 *
 * 2. **编辑单位是「元」，存储单位是 mc**（1 元 = creditsPerYuan 积分 = creditsPerYuan × 1000 mc）。
 *    运营手上的是官方价目表上的元（「70 元 / 百万 token」「0.12 元 / 张」），
 *    让他对着 1050000 这种内部数字填，既认不出自己配的是哪一档、也没法照着文档抄 ——
 *    所以**换算只发生在界面这一层**，写回目录的仍然是 mc（引擎单位不动）。
 *
 *    ⚠️ 换算必然经过一次舍入，而**没被改动的字段也会被写回**：若老老实实「渲染成元 → 解析 → 换回 mc」，
 *    一次改 A 的保存就会顺手把 B 的价挪动几个 mc（改的是钱，且没人看得见）。
 *    所以每个价格栏都带着**打开表单时读到的原 mc**（`MoneyField` / `PriceRow.originalMc`）：
 *    文本与「原值渲染出来的文本」逐字相同 ⇒ **原值写回**，换算只落在真正被改过的那一栏。
 *
 *    ⚠️ 反转过来看：以前那条「必须按 mc 编辑，否则精度丢失」的理由**只对按次成立**
 *    （creditsPerYuan=15 时 100000 mc = ¥6.666666666666667，除不尽）。
 *    「元 / 百万 token」是整数报价（70 / 42 / 77 / 46），换回 mc 是精确的 —— 那条理由在这里不成立。
 *
 * 3. **序列化只发生一次**（`serializeCatalog`），发出去的就是它。
 * ============================================ */

/** 解析后的目录对象。**刻意是宽松类型**：不认识的字段也要活着回去（见文件头第 1 条）。 */
export type CatalogDocumentJson = Record<string, unknown>;

/**
 * 一条计价规则的只读视图 —— 也就是能力行 `generation_model_capability.pricing` 的形态。
 * 字段都可能缺（老数据、手工写的 JSON）。
 */
export interface CatalogRuleView {
  usageSemantic?: unknown;
  baseUnit?: unknown;
  basePrice?: {
    kind?: unknown;
    value?: unknown;
    by?: unknown;
    table?: Record<string, unknown>;
  };
  dims?: Record<string, unknown>;
  multipliers?: Record<string, unknown>;
  /**
   * 维度 → **绝对**加价 `{ unitMc, firstFree? }`。
   *
   * <p>与 `dims` 的区别是它**不乘 basePrice**：`dims` 给的是万分比（相对量），而这里
   * 每个单位固定多少钱 —— 单价分档的规则（Seedream 5.0 Pro 的输出图 0.3 / 0.6 两档）
   * 表达不了「参考图每张 0.02 元在两档下是同一个数」。键与 `dims` 同一份白名单。
   *
   * <p>⚠️ 与 `maxCredits` **互斥**（上限计价跳过用量计算、算不到这份加价）。
   */
  dimPrices?: Record<string, unknown>;
  unitDenominator?: unknown;
  minCredits?: unknown;
  maxCredits?: unknown;
  rounding?: unknown;
  /** 视频按 token 计价的**预扣估算参数**（服务端 `TokenEstimate` 的 JSON 形态）。 */
  tokenEstimate?: {
    divisor?: unknown;
    fps?: unknown;
    /** 「档位 + 比例」→ 「宽x高」，与价格表同一套键语法 */
      /** 输入视频时长的规格键；不写 = 公式不含输入时长那一项 */
    inputSecondsKey?: unknown;
    /**
     * 最低 token 用量表：「分辨率 + 宽高比 + 输出时长」→ 最低用量（正整数）。
     * 火山明文规则：**含视频输入时**估算 < 下限就按下限计。不写 = 本规则不做下限。
     */
    minimumTokens?: Record<string, unknown>;
  };
}

/* ---------- 解析 / 序列化 ---------- */

/**
 * 目录文本 → 对象。
 *
 * @throws Error 文本不是合法 JSON（消息是中文，直接给用户看）
 */
export function parseCatalog(text: string): CatalogDocumentJson {
  if (!text.trim()) return siteCatalogDocument(DEFAULT_CREDITS_PER_YUAN, DEFAULT_DISCOUNT_POLICY);
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('目录文档必须是 JSON 对象');
    }
    return parsed as CatalogDocumentJson;
  } catch (e) {
    throw new Error(e instanceof Error ? `目录文档不是合法 JSON：${e.message}` : '目录文档不是合法 JSON');
  }
}

/** 1 元默认换多少积分。**只是新起草时的初值**，生效值一律以目录里写的为准。 */
export const DEFAULT_CREDITS_PER_YUAN = 15;

/** 折扣策略的默认值 —— 与 billing 相同（缺字段时计价侧用的就是它）。 */
const DEFAULT_DISCOUNT_POLICY: DiscountPolicyView = { stackMode: 'multiply', floorFactorBp: 3000 };

/** 草稿 → 发布用的文本。**全流程唯一一次序列化**（见文件头第 3 条）。 */
export function serializeCatalog(doc: CatalogDocumentJson): string {
  return JSON.stringify(doc);
}

/**
 * 有没有实质改动。
 *
 * ⚠️ 比的是**序列化后的对象**，不是读回来的那段文本：读回来的是 MySQL JSON 列的规范化形态
 *    （键序、空白由 MySQL 决定），拿它当基线比文本，会把一次没改过的保存判成「改了」——
 *    于是每点一次保存就多出一个内容相同的新版本，历史里再也看不出「这版是谁改的」。
 */
export function isCatalogDirty(
  draft: CatalogDocumentJson,
  baseline: CatalogDocumentJson,
): boolean {
  return serializeCatalog(draft) !== serializeCatalog(baseline);
}

/* ---------- 文档级字段 ---------- */

/** 1 元 = 多少积分；读不出来返回 null（**不猜默认值**）。 */
export function readCreditsPerYuan(doc: CatalogDocumentJson): number | null {
  const raw = doc.creditsPerYuan;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * 写入换算率。
 *
 * @param creditsPerYuan `null` = 这个字段空着（用户清空了输入框）。**不替人补默认值**：
 *        悄悄填一个数会让「我明明清空了」变成一个要过一会儿才发现的谜；空着就让它空着，
 *        发布时 billing 的编译期会明确拒绝（creditsPerYuan=0 不在 1 ~ 100000），
 *        报错指着这一项，比这里猜一个数强。
 */
export function withCreditsPerYuan(
  doc: CatalogDocumentJson,
  creditsPerYuan: number | null,
): CatalogDocumentJson {
  return { ...clone(doc), creditsPerYuan };
}

export interface DiscountPolicyView {
  stackMode: string;
  floorFactorBp: number;
}

/** 折扣策略；缺字段时给出与 billing 相同的默认（multiply / 3000）。 */
export function readDiscountPolicy(doc: CatalogDocumentJson): DiscountPolicyView {
  const raw = doc.discountPolicy;
  const policy = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    stackMode: typeof policy.stackMode === 'string' && policy.stackMode ? policy.stackMode : 'multiply',
    floorFactorBp:
      typeof policy.floorFactorBp === 'number' && Number.isFinite(policy.floorFactorBp)
        ? policy.floorFactorBp
        : 3000,
  };
}

export function withDiscountPolicy(
  doc: CatalogDocumentJson,
  patch: Partial<DiscountPolicyView>,
): CatalogDocumentJson {
  const next = clone(doc);
  const current = next.discountPolicy;
  const merged = current !== null && typeof current === 'object' ? (current as Record<string, unknown>) : {};
  next.discountPolicy = { ...merged, ...patch };
  return next;
}

/**
 * 目录文档的骨架：目录现在**只有**这 4 个键，一个不多、一个不少。
 *
 * <p>`creditsPerYuan` 先摆 `null`、折扣策略先摆 billing 的默认 —— 两者都会被
 * {@link siteCatalogDocument} 立刻覆盖掉。这里的价值不在值，而在「有哪些键」这件事只有一处定义。
 */
const SITE_CATALOG_SKELETON: CatalogDocumentJson = {
  schemaVersion: 1,
  currency: 'CNY',
  creditsPerYuan: null,
  discountPolicy: DEFAULT_DISCOUNT_POLICY,
};

/**
 * 站点级参数 → **发布用的**目录文档（白名单重建）。
 *
 * <h2>为什么以前不能重建、现在可以</h2>
 *
 * 目录以前还装着每个模型的计价规则（`models.<模型>.<任务类型>`）。那时候发布**只能**是
 * 「展开读回来那份原对象、只换这两个键」：按本页认识的字段拼一份新文档，会在一次「改换算率」的
 * 保存里把目录里那十几个模型的规则整个抹掉，而界面上看不出任何异常 —— 所以那时的纪律是
 * **绝不重建**。
 *
 * 那批规则已经搬进能力行（`generation_model_capability.pricing`），目录现在只剩站点级字段，
 * 「重建会吃掉不认识的字段」这件事没有了受害者；反过来，重建才是**唯一说得清「发出去的文档里
 * 有什么」的做法** —— 不再取决于库里那份历史上长什么样。这也是发布后目录里不该再有 `models`
 * 段的原因（旧的 `models` / 顶层未知字段都会在这一次重建里退场，那是迁移的收尾，不是丢数据）。
 *
 * ⚠️ 重建只发生在**发布**这一处。读回来做编辑走的是解析后的原对象 + 上面两个 setter，
 *    对未知字段的宽容口径不变。
 */
export function siteCatalogDocument(
  creditsPerYuan: number | null,
  policy: DiscountPolicyView,
): CatalogDocumentJson {
  // 骨架 → 覆盖两个值：改的是值，**不再是在原对象上展开**
  return withDiscountPolicy(withCreditsPerYuan(SITE_CATALOG_SKELETON, creditsPerYuan), policy);
}

/* ---------- 单位换算 ---------- */

/** mc → 整数积分。与 billing 的 `RoundingPolicy.HalfUp` 同口径（四舍五入）。 */
export function mcToCredits(mc: number): number {
  return Math.round(mc / 1000);
}

/** mc → 元（浮点，仅供展示与「渲染成编辑文本」；不要拿它当存储值反推）。 */
export function mcToYuan(mc: number, creditsPerYuan: number | null): number | null {
  if (!creditsPerYuan || creditsPerYuan <= 0) return null;
  return mc / 1000 / creditsPerYuan;
}

/**
 * 元 → mc。**单价与「元」是同一口径**（都按 `unitDenominator` 那一份量报），
 * 所以这里不出现 `unitDenominator` —— 它只决定这一栏该叫「每百万 token」还是「每张 / 每次」。
 *
 * <p>对账关系（billing 侧 `AbstractPricingCalculator`）：
 * <pre>
 *   积分 = 用量 × basePrice ÷ unitDenominator ÷ 1000
 *   ⇒  售价（元） = basePrice ÷ unitDenominator ÷ creditsPerYuan
 *   ⇒  basePrice = 元 × creditsPerYuan × 1000          （本函数）
 * </pre>
 * 即「70 元 / 百万 token」配上 `unitDenominator=1000000` 就是 1050000 mc；
 * 「0.12 元 / 张」配上 `unitDenominator=1` 就是 1800 mc。
 *
 * @returns 整数 mc；换算率读不出来（没有生效目录）时返回 **null，不猜默认值**
 */
export function yuanToMc(yuan: number, creditsPerYuan: number | null): number | null {
  if (creditsPerYuan === null || !Number.isFinite(creditsPerYuan) || creditsPerYuan <= 0) return null;
  if (!Number.isFinite(yuan)) return null;
  return Math.round(yuan * creditsPerYuan * 1000);
}

/**
 * mc → 元的**编辑文本**（价格栏里显示与编辑用的就是它）。
 *
 * <p>它必须满足一条硬不变式：`yuanToMc(Number(mcToYuanText(mc, cpy)), cpy) === mc`。
 * 小数位数由 {@link yuanDecimals} 按换算率推出来 —— 位数不够时「显示 → 解析 → 回写」
 * 会让没改过的价自己挪动（见文件头第 2 条）。尾随 0 去掉，让整数元显示成 `70` 而不是 `70.000000`。
 *
 * @returns 换算率读不出来时返回空串（**不拿 mc 冒充元**）
 */
export function mcToYuanText(mc: number, creditsPerYuan: number | null): string {
  const yuan = mcToYuan(mc, creditsPerYuan);
  if (yuan === null) return '';
  return trimTrailingZeros(yuan.toFixed(yuanDecimals(creditsPerYuan)));
}

/**
 * 展示元时需要的小数位数。
 *
 * <p>推导：`toFixed(d)` 的截断误差 ≤ 0.5 × 10⁻ᵈ 元，换算回 mc 会被放大
 * `creditsPerYuan × 1000` 倍，要让它不足半个 mc（否则 `Math.round` 就会挪走一个 mc）：
 * `0.5 × 10⁻ᵈ × creditsPerYuan × 1000 < 0.5` ⇒ `d > log₁₀(creditsPerYuan) + 3`。
 * 上界 12 位只是防病态配置把界面撑爆。
 */
export function yuanDecimals(creditsPerYuan: number | null): number {
  if (creditsPerYuan === null || !Number.isFinite(creditsPerYuan) || creditsPerYuan <= 0) return 6;
  return Math.min(12, Math.ceil(Math.log10(creditsPerYuan)) + 4);
}

function trimTrailingZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

export type PriceKind = 'const' | 'table' | 'unset';

/** 一对可增删的键值行（dims / multipliers / token 尺寸表共用）。 */
export interface KeyValueRow {
  key: string;
  value: string;
}

/**
 * 一个**价格**栏：界面显示与编辑的是**元**文本，写回目录的是**mc**。
 *
 * <p>为什么还要带着 `originalMc`：`元 → mc` 必然经过一次舍入，而表单里没被改动的栏也会被写回。
 * 只按文本换算的话，「打开看一眼、点保存」就会把价格挪动几个 mc（改的是钱，且没人看得见）。
 * 所以把**打开表单时读到的原值**一路带下来：文本与「原值渲染出来的文本」逐字相同 ⇒ 用原值。
 * 判据是**文本**而不是「换算结果相等」——后者在换个换算率后可能碰巧相等，语义上却是「改过」。
 */
export interface MoneyField {
  /** 界面文本（元），如 `70` / `0.12` */
  value: string;
  /** 目录里的原值（mc）；null = 新建的栏，没有原值可依 */
  originalMc: number | null;
}

/** 价格表的一行 = 规格键 + 一个价格栏。 */
export interface PriceRow extends KeyValueRow, MoneyField {}

/**
 * 维度**绝对加价**的一行 = 维度键 + 一个价格栏（元）+ 「首张免费」。
 *
 * <p>价格栏与 {@link MoneyField} 同一口径（unitMc 也是钱：未改动 ⇒ 原值写回）。
 * `originalSpec` 是打开表单时读到的那条 spec —— `unitMc` / `firstFree` 之外的键
 * 原样带回去（见文件头第 1 条：一次「只改单价」的保存不该顺手删掉别的键）。
 */
export interface DimPriceRow extends KeyValueRow, MoneyField {
  /** 「首张免费」：计费单位 = `max(0, n-1)`（火山「首张参考图免费」就是它）。缺省 = 不免费 */
  firstFree: boolean;
  /** 原 spec；新建的行没有原值可依 */
  originalSpec: Record<string, unknown> | null;
}

/** 编辑弹窗的表单状态。数值一律用字符串存：输入过程中「-」「1.」都是合法中间态。 */
export interface RuleForm {
  modelId: string;
  taskType: string;
  baseUnit: string;
  priceKind: PriceKind;
  /** 常数单价：界面是**元**（见 {@link MoneyField}） */
  priceValue: MoneyField;
  /** 价格表：规格键 → 单价（界面是**元**） */
  priceTable: PriceRow[];
  /** 维度 → 万分比 */
  dims: KeyValueRow[];
  /** 维度 → 万分比 */
  multipliers: KeyValueRow[];
  /** 维度 → **绝对**加价（元 / 每单位；见 {@link DimPriceRow}） */
  dimPrices: DimPriceRow[];
  unitDenominator: string;
  minCredits: string;
  /** 空 = 不封顶 */
  maxCredits: string;
  rounding: string;
  /** 本规则要不要配 token 预扣估算参数（不配 = 该规则不做估算） */
  tokenEstimateEnabled: boolean;
  /** token 公式的除数字（mc 无关，官方 1024） */
  tokenDivisor: string;
  /** token 公式的帧率（官方对照表 24） */
  tokenFps: string;
  /** 规格键（档位 + 比例）→ 「宽x高」 */
  /** 输入视频时长的规格键；空 = 公式不含输入时长那一项 */
  tokenInputSecondsKey: string;
  /**
   * 最低 token 用量表（规格键 → 最低 token 数）。
   *
   * <p>火山明文规则：**含视频输入时**估算 < 下限 ⇒ 按下限计。**留空 = 不做下限**
   * （官方原页只给了两张表格的飞书链接，没有公开可抄的形态，所以这里是个可选的配置位）。
   */
  tokenMinimumTokens: KeyValueRow[];
}

/** 与 billing 的 `UsageDim` 注册表逐字一致（新增维度要两处一起改）。 */
export const BASE_UNIT_OPTIONS = [
  { value: 'constant:1', label: 'constant:1（按次）' },
  { value: 'usage.succeededSlots', label: 'usage.succeededSlots（成功槽数）' },
  { value: 'usage.seconds', label: 'usage.seconds（秒）' },
  { value: 'usage.characters', label: 'usage.characters（字符）' },
  { value: 'usage.referenceCount', label: 'usage.referenceCount（参考素材数）' },
  { value: 'usage.c', label: 'usage.c（输出 token，视频按 token 计费用）' },
];

const WHOLE_NUMBER = /^\d+$/;
/** 价格栏的文本：十进制数（**整数报价与小数报价都要收**：70 元/百万 token 与 0.12 元/张） */
const MONEY = /^\d+(\.\d+)?$/;

/** 整数 mc / 万分比 / 积分：允许前后空格，其余一律整数。 */
function parseWhole(raw: string): number | null {
  const trimmed = raw.trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : null;
}

/** 价格栏文本（元）→ 数；非数返回 null。 */
function parseMoney(raw: string): number | null {
  const trimmed = raw.trim();
  return MONEY.test(trimmed) ? Number(trimmed) : null;
}

/** 一组键值行的第一处问题（`field` 只出现在文案里，好让人知道改哪一栏）。 */
function rowsError(rows: KeyValueRow[], field: string): string | null {
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) return `${field}的键不能为空`;
    if (parseWhole(row.value) === null) return `${field}「${key}」的值必须是整数`;
  }
  return null;
}

/** 价格表的完整性（键 + 以**元**报的价）。 */
function priceRowsError(rows: PriceRow[], field: string): string | null {
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) return `${field}的键不能为空`;
    if (parseMoney(row.value) === null) {
      return `${field}「${key}」的单价必须是一个数（单位：元 / 每 unitDenominator 个单位，如 70 或 0.12）`;
    }
  }
  return null;
}

/**
 * 维度绝对加价表的完整性（维度 + 以**元**报的单价）。
 *
 * <p>⚠️ 这里**不校维度的白名单**：那是 billing 的 `UsageDim` 注册表说了算（后端写闸门同判据），
 * 在界面里再抄一份只会多一处会漂的地方 —— 与 `dims` / `multipliers` 同一口径。
 */
function dimPriceRowsError(rows: DimPriceRow[], creditsPerYuan: number | null): string | null {
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) return '维度绝对加价的维度不能为空';
    if (parseMoney(row.value) === null) {
      return `维度绝对加价「${key}」的单价必须是一个数（单位：元 / 每个单位，如 0.02）`;
    }
    // 换算回来必须 **> 0**：billing 明确拒 0（0 等于「这个维度免费」，而免费该由整行删掉表达），
    // 也拒折算不出来的价 —— 换算率不够细时 0.000001 元会被舍入成 0 mc，那是一份算不出钱的配置。
    if (moneyToMc(row, creditsPerYuan) <= 0) {
      return `维度绝对加价「${key}」的单价必须大于 0（要让这个维度免费就整行删掉，别写 0）`;
    }
  }
  return null;
}

/**
 * 表单完整性检查。
 *
 * <p>⚠️ **这不是第二份编译器**：目录能不能用由 billing 编译时说了算（那是唯一的校验时机，
 * 且它的报错指得出哪条规则配错了）。这里只拦「表单根本表达不出来」的东西 ——
 * 模型 / 任务类型空着、该填的数字没填或填的不是数。多写一条规则校验，就会多一处
 * 「两边不一致」的地方。
 *
 * <p>价格栏的文本是**元**：填的不合法、或读不到换算率（没有生效目录）时，这里就拦下 ——
 * 换算不出来的话，写回目录的 mc 只能是错的或编的。
 *
 * @returns 一句中文错误；合法时返回 null
 */
export function ruleFormError(form: RuleForm, creditsPerYuan: number | null): string | null {
  if (!form.modelId.trim()) return '模型 ID 必填';
  if (!form.taskType.trim()) return '任务类型必填';
  if (!form.baseUnit.trim()) return '基准维度必填';

  /** 有没有实质的绝对加价行（整行空着 = 加到一半又不要了，不该拿它去要换算率） */
  const hasDimPrices = form.dimPrices.some((row) => row.key.trim() !== '');

  // dimPrices 的单价也按**元**填（写回是 mc），所以它同样需要换算率
  const needsMoney = form.priceKind === 'const' || form.priceKind === 'table' || hasDimPrices;
  if (needsMoney && (creditsPerYuan === null || !Number.isFinite(creditsPerYuan) || creditsPerYuan <= 0)) {
    return '读不到换算率（1 元 = 多少积分）—— 单价按元填、写回目录要换成 mc，先在上面把换算率配好';
  }

  if (form.priceKind === 'const') {
    if (parseMoney(form.priceValue.value) === null) {
      return '基准单价必填，且是一个数（单位：元 / 每 unitDenominator 个单位，如 70）';
    }
  } else if (form.priceKind === 'table') {
    // 查表才看价格表 —— 常数方式与「待配」下那一栏是收起来的，里面的空行不该拦住保存
    if (form.priceTable.length === 0) return '价格表至少要有一行（规格键 → 单价）';
    const priceError = priceRowsError(form.priceTable, '价格表');
    if (priceError !== null) return priceError;
  }
  // unset（单价待配）不需要填任何价 —— 那正是这个形态存在的意义：**留空发布**，
  // 提交时被 billing 拒绝（不是按 0 免费）。所以这里不校验价格栏。

  const weightsError = rowsError([...form.dims, ...form.multipliers], '维度表');
  if (weightsError !== null) return weightsError;

  const dimPricesError = dimPriceRowsError(form.dimPrices, creditsPerYuan);
  if (dimPricesError !== null) return dimPricesError;

  // ⚠️ **与积分上限互斥**（后端 `pricingFieldErr` 是同一条闸门）：上限计价跳过用量计算，
  //    算不到这份绝对加价 ⇒ 预扣冻的是一份**不含加价**的额度，而结算会把它算进去 ⇒
  //    超出部分记应收（少收，且账面上只有一条 WARN，看不出原因）。
  if (hasDimPrices && form.maxCredits.trim()) {
    return '维度绝对加价与积分上限不能同时配：上限计价算不到这份加价，预扣会冻少、'
      + '结算超出后只记应收（少收且静默）。二选一';
  }

  if (form.tokenEstimateEnabled) {
    const divisor = parseWhole(form.tokenDivisor);
    if (divisor === null || divisor <= 0) return 'token 估算的除数必须是正整数（官方 1024）';
    const fps = parseWhole(form.tokenFps);
    if (fps === null || fps <= 0) return 'token 估算的帧率必须是正整数（官方对照表 24）';
    for (const row of form.tokenMinimumTokens) {
      if (!row.key.trim()) return '最低 token 用量表的规格键不能为空';
      // 值必须是**正整数**：0 不是下限（等于「看起来配了、实际没有」），
      // 负数会让 max() 恒取估算值 —— 两者都让这条官方规则静默失效。
      const floor = parseWhole(row.value);
      if (floor === null || floor <= 0) {
        return `最低 token 用量表「${row.key.trim()}」的值必须是正整数（token 数，如 200000）`;
      }
    }
  }

  if (form.unitDenominator.trim() && parseWhole(form.unitDenominator) === null) {
    return '单位分母必须是整数（1 = 每秒/每张，1000000 = 每百万 token）';
  }
  if (form.minCredits.trim() && parseWhole(form.minCredits) === null) return '积分下限必须是整数';
  if (form.maxCredits.trim() && parseWhole(form.maxCredits) === null) return '积分上限必须是整数';
  return null;
}

/** 键值行 → 对象；键重复时**报错而不是悄悄覆盖**（覆盖会丢掉一条本来生效的配置）。 */
function rowsToRecord(rows: KeyValueRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (key in out) throw new Error(`键重复：${key}`);
    out[key] = parseWhole(row.value) ?? 0;
  }
  return out;
}

/**
 * 一个价格栏 → 写回目录的 **mc**。
 *
 * <p>判据见 {@link MoneyField}：文本与「原值渲染出来的文本」**逐字相同** ⇒ 原值写回。
 * 这条分支让「打开看一眼、点保存」对没改过的价是**恒等**的，与换算率、小数位数都无关。
 */
function moneyToMc(field: MoneyField, creditsPerYuan: number | null): number {
  if (
    field.originalMc !== null &&
    field.value.trim() === mcToYuanText(field.originalMc, creditsPerYuan)
  ) {
    return field.originalMc;
  }
  const yuan = parseMoney(field.value);
  if (yuan === null) return field.originalMc ?? 0;
  return yuanToMc(yuan, creditsPerYuan) ?? field.originalMc ?? 0;
}

/**
 * 表单 → 目录里的 rule 对象。
 *
 * <p>入参 `original` 是**改动前的那条规则**：本页不编辑的字段（`usageSemantic`、`by` 等）
 * 从它原样带过去，不会被这次编辑抹掉（见文件头第 1 条）。
 *
 * @throws Error 键重复
 */
export function ruleFromForm(
  form: RuleForm,
  original: CatalogRuleView,
  creditsPerYuan: number | null,
): CatalogRuleView {
  let basePrice: CatalogRuleView['basePrice'];
  if (form.priceKind === 'const') {
    basePrice = {
      ...(original.basePrice ?? {}),
      kind: 'const',
      value: moneyToMc(form.priceValue, creditsPerYuan),
    };
  } else if (form.priceKind === 'table') {
    basePrice = {
      ...(original.basePrice ?? {}),
      kind: 'table',
      value: null,
      table: priceRowsToRecord(form.priceTable, creditsPerYuan),
    };
  } else {
    // 单价待配的空位：**只保留定价轴声明**（`by` 是文档），把 value / table 清掉 ——
    // 留着上一版的价会让人以为「价还在，只是待配」，而 billing 那边是必拒的。
    basePrice = {
      ...(Array.isArray(original.basePrice?.by) ? { by: original.basePrice.by } : {}),
      kind: 'unset',
    };
  }

  const rule: CatalogRuleView = {
    ...original,
    baseUnit: form.baseUnit.trim(),
    basePrice,
    unitDenominator: form.unitDenominator.trim() ? parseWhole(form.unitDenominator) : 1,
    minCredits: form.minCredits.trim() ? parseWhole(form.minCredits) : 1,
    rounding: form.rounding,
  };

  const dims = rowsToRecord(form.dims);
  const multipliers = rowsToRecord(form.multipliers);
  // 空对象不写进文档：`"dims": {}` 与不写是同一个意思，但会在 diff 里多出一行噪音
  if (Object.keys(dims).length > 0) rule.dims = dims;
  else delete rule.dims;
  if (Object.keys(multipliers).length > 0) rule.multipliers = multipliers;
  else delete rule.multipliers;

  // 维度绝对加价：同样「空对象不写」—— `"dimPrices": {}` 与不写同义，只会给 diff 添噪音
  const dimPrices = dimPriceRowsToRecord(form.dimPrices, creditsPerYuan);
  if (Object.keys(dimPrices).length > 0) rule.dimPrices = dimPrices;
  else delete rule.dimPrices;

  // token 估算参数：整块写或整块删。**不整块删就一定会留下半配的残骸**
  // （用户取消勾选后 divisor 还在），而半配的估算服务端编译期会拒——那是发布失败，
  // 不是「这条规则不估算」。
  if (form.tokenEstimateEnabled) {
    // ⚠️ **不从原文档带任何键过来**（原先这里 spread 了 `original.tokenEstimate`）。表单已经
    //    覆盖了全部合法键（divisor / fps / inputSecondsKey / minimumTokens），spread 只可能
    //    带回**已退役的残骸**：实测库里 5 条视频规则的 `tokenEstimate` 里都还挂着 `dimensions`
    //    （像素搬进能力行的 `features.video_dimensions` 之后没人读它），而它会被原样写回来、
    //    再随规则快照冻进每一条预留行。写侧闸门现在也只收那四个键。
    const token: NonNullable<CatalogRuleView['tokenEstimate']> = {
      divisor: parseWhole(form.tokenDivisor) ?? 0,
      fps: parseWhole(form.tokenFps) ?? 0,
    };
    // 清空输入框 = **明确不要那一项**，不能因为原文档里有就留着（那会让「我删了」变成没删）
    if (form.tokenInputSecondsKey.trim()) token.inputSecondsKey = form.tokenInputSecondsKey.trim();
    else delete token.inputSecondsKey;
    // ⚠️ 这里**不再有 dimensions**：输出像素已经搬进能力行的 `features.video_dimensions`
    //   （见「尺寸与素材」tab）。规则里只留**公式参数**——除数字、帧率、输入时长的规格键、最低用量表。
    //   分界：像素是「这个模型长什么样」，帧率与除数是「我们怎么把它折算成钱」。
    // 最低 token 用量表：**整块写或整块删**。
    // 删掉全部行 = 本规则不做下限 —— 那是合法状态（官方表没有公开可抄的形态），
    // 不能因为原文档里有就留着，否则「我删了」变成没删。
    const minimumTokens = rowsToRecord(form.tokenMinimumTokens);
    if (Object.keys(minimumTokens).length > 0) token.minimumTokens = minimumTokens;
    else delete token.minimumTokens;
    rule.tokenEstimate = token;
  } else {
    delete rule.tokenEstimate;
  }

  // 不封顶就写 null（显式表达「没有上限」），而不是省略 —— 省略与 null 同义，
  // 但显式 null 在文档里一眼能看出「这条规则想过这件事」
  rule.maxCredits = form.maxCredits.trim() ? parseWhole(form.maxCredits) : null;

  return rule;
}

/** 目录里的 rule → 表单（编辑已有规则时用）。价格栏一律渲染成**元**文本（见文件头第 2 条）。 */
export function formFromRule(
  modelId: string,
  taskType: string,
  rule: CatalogRuleView,
  creditsPerYuan: number | null,
): RuleForm {
  const price = rule.basePrice ?? {};
  const kind: PriceKind =
    price.kind === 'table' ? 'table' : price.kind === 'unset' ? 'unset' : 'const';
  const table = price.table !== undefined && price.table !== null ? price.table : {};
  const asText = (v: unknown): string =>
    typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  /** 一个价格栏：显示成元，同时把原 mc 带上（未改动时原样写回，见 MoneyField）。 */
  const asMoney = (v: unknown): MoneyField => {
    const mc = typeof v === 'number' && Number.isFinite(v) ? v : null;
    return { value: mc === null ? '' : mcToYuanText(mc, creditsPerYuan), originalMc: mc };
  };
  const token = rule.tokenEstimate;

  return {
    modelId,
    taskType,
    baseUnit: typeof rule.baseUnit === 'string' ? rule.baseUnit : '',
    priceKind: kind,
    priceValue: asMoney(price.value),
    priceTable: Object.entries(table).map(([key, value]) => ({
      key,
      ...asMoney(value),
    })),
    dims: recordToRows(rule.dims),
    multipliers: recordToRows(rule.multipliers),
    dimPrices: recordToDimPriceRows(rule.dimPrices, creditsPerYuan),
    unitDenominator: asText(rule.unitDenominator ?? 1),
    minCredits: asText(rule.minCredits ?? 1),
    maxCredits: asText(rule.maxCredits),
    rounding: typeof rule.rounding === 'string' && rule.rounding ? rule.rounding : 'halfUp',
    // 「有没有 tokenEstimate」本身就是那个开关：文档里没有它 = 这条规则不做估算
    tokenEstimateEnabled: token !== undefined && token !== null,
    tokenDivisor: asText(token?.divisor ?? DEFAULT_TOKEN_DIVISOR),
    tokenFps: asText(token?.fps ?? DEFAULT_TOKEN_FPS),
    tokenInputSecondsKey:
      typeof token?.inputSecondsKey === 'string' ? token.inputSecondsKey : '',
    tokenMinimumTokens: recordToRows(token?.minimumTokens),
  };
}

/** 新建规则时的一张干净表单。 */
export function emptyRuleForm(): RuleForm {
  return {
    modelId: '',
    taskType: '',
    baseUnit: 'constant:1',
    priceKind: 'const',
    priceValue: { value: '', originalMc: null },
    priceTable: [{ key: '', value: '', originalMc: null }],
    dims: [],
    multipliers: [],
    dimPrices: [],
    unitDenominator: '1',
    minCredits: '1',
    maxCredits: '',
    rounding: 'halfUp',
    tokenEstimateEnabled: false,
    tokenDivisor: String(DEFAULT_TOKEN_DIVISOR),
    tokenFps: String(DEFAULT_TOKEN_FPS),
    tokenInputSecondsKey: '',
    tokenMinimumTokens: [],
  };
}

/**
 * token 估算参数的默认值 —— **只是新建表单的初值**，生效值一律以目录里写的为准。
 *
 * <p>它们是火山官方对照表的除数字与帧率（此前一单从官方表逐格反推出来的），
 * 放在这里只为让新建时不必手敲；写不写进目录由「有没有勾选启用」决定。
 */
export const DEFAULT_TOKEN_DIVISOR = 1024;
export const DEFAULT_TOKEN_FPS = 24;

/** 价格表行 → `规格键 → 单价 mc`；键重复时**报错而不是悄悄覆盖**。 */
function priceRowsToRecord(rows: PriceRow[], creditsPerYuan: number | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (key in out) throw new Error(`键重复：${key}`);
    out[key] = moneyToMc(row, creditsPerYuan);
  }
  return out;
}

function recordToRows(record: Record<string, unknown> | undefined): KeyValueRow[] {
  if (!record || typeof record !== 'object') return [];
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: typeof value === 'number' && Number.isFinite(value) ? String(value) : String(value ?? ''),
  }));
}

/* ---------- 维度绝对加价（`dimPrices`）---------- */

/**
 * 目录里的 `dimPrices` → 表单行。
 *
 * <p>单价与其余价格栏同一口径：渲染成**元**文本，同时把原 mc 与**整条 spec** 带上 ——
 * 前者保住「未改动 ⇒ 一位不差地写回」，后者保住 `unitMc` / `firstFree` 之外的键。
 */
function recordToDimPriceRows(
  record: Record<string, unknown> | undefined,
  creditsPerYuan: number | null,
): DimPriceRow[] {
  if (!record || typeof record !== 'object') return [];
  return Object.entries(record).map(([key, raw]) => {
    const spec = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const mc = typeof spec.unitMc === 'number' && Number.isFinite(spec.unitMc) ? spec.unitMc : null;
    return {
      key,
      value: mc === null ? '' : mcToYuanText(mc, creditsPerYuan),
      originalMc: mc,
      // 只认**真布尔** true：写着 `"yes"` 这类脏值时按「不免费」渲染，保存时由写闸门拒掉，
      // 而不是在这里把它悄悄读成一个真值
      firstFree: spec.firstFree === true,
      originalSpec: spec,
    };
  });
}

/**
 * 维度绝对加价行 → `{ 维度: { unitMc, firstFree? } }`。
 *
 * <p>`unitMc` 与其余价格栏同一条「未改动 ⇒ 原值写回」的规矩（见 {@link moneyToMc}）。
 * `firstFree` **只在为真时写**：缺省就是不免费（billing 的缺省同义），每行都写一个 `false`
 * 只是给文档添噪音。键重复时**报错而不是悄悄覆盖**。
 *
 * @throws Error 维度键重复
 */
function dimPriceRowsToRecord(
  rows: DimPriceRow[],
  creditsPerYuan: number | null,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (key in out) throw new Error(`键重复：${key}`);
    // ⚠️ 展开原 spec：本页不编辑的键（如果有）原样带回去（见文件头第 1 条）
    const spec: Record<string, unknown> = {
      ...(row.originalSpec ?? {}),
      unitMc: moneyToMc(row, creditsPerYuan),
    };
    if (row.firstFree) spec.firstFree = true;
    else delete spec.firstFree;
    out[key] = spec;
  }
  return out;
}

/* ---------- 表格里的一行怎么显示 ---------- */

export function priceUnitLabel(rule: CatalogRuleView): string {
  const denom = typeof rule.unitDenominator === 'number' && rule.unitDenominator > 0
    ? rule.unitDenominator
    : 1;
  const unit = typeof rule.baseUnit === 'string' ? rule.baseUnit : '';
  if (unit === 'usage.c') return denom === 1_000_000 ? '百万 token' : `${denom} token`;
  if (unit === 'constant:1') return '次';
  if (unit === 'usage.seconds') return '秒';
  if (unit === 'usage.succeededSlots') return '张';
  if (unit === 'usage.characters') return '字符';
  if (unit === 'usage.referenceCount') return '参考素材';
  return `${denom} 个单位`;
}

export function describePriceInHuman(
  mc: number,
  creditsPerYuan: number | null,
  unitLabel = '',
): string {
  const yuan = mcToYuanText(mc, creditsPerYuan);
  if (!yuan) return `${mcToCredits(mc)} 积分`;
  return `${yuan} 元${unitLabel ? ` / ${unitLabel}` : ''}（${mcToCredits(mc)} 积分）`;
}

/** 深拷贝。入参一定来自 `JSON.parse`，所以 JSON 往返是**无损**的（见文件头第 1 条）。 */
function clone(doc: CatalogDocumentJson): CatalogDocumentJson {
  return JSON.parse(JSON.stringify(doc)) as CatalogDocumentJson;
}
