/* ============================================
 * 定价目录草稿：解析 / 读取 / 修改 / 序列化 / 单位换算。
 *
 * 这些是纯函数，页面只负责把它们接到界面上 —— 目录是**钱**，所以「怎么改」这件事
 * 必须能单测，而不是埋在 JSX 的事件处理里。
 *
 * ── 三条贯穿全文件的口径 ──────────────────────────────────────────────────────
 *
 * 1. **未知字段原样保留**。目录解析用的是宽容口径（服务端 `FAIL_ON_UNKNOWN_PROPERTIES=false`），
 *    所以文档里可能存在本页不认识的字段（新版本加的）。所有修改都是「读原对象 → 展开 → 只换
 *    要改的那几个键」（`withRule` / `withCreditsPerYuan` 等），绝不用一个自己拼的新对象覆盖原对象 ——
 *    后者会在一次「只改单价」的保存里把别人的字段悄悄删掉。
 *
 * 2. **编辑单位 = 存储单位（不换算）**。基准单价在目录里是 **mc**（1 积分 = 1000 mc），
 *    界面就按 mc 编辑，旁边实时给出「≈ N 积分 / ¥X.XX 一次」的换算提示。
 *    理由：换算着编辑意味着「显示 → 写回」要经过一次取整，而**没被改动的字段也会被写回** ——
 *    一次改 A 的保存会顺手把 B 的价格挪动几个 mc。那是最坏的失败模式：改的是钱，且没人看得见。
 *    实测一下就知道 mc 才是那个「齐整」的单位：creditsPerYuan=15 时 100000 mc = 100 积分
 *    = ¥6.666666666666667，反过来编辑元几乎永远是长小数。
 *
 * 3. **序列化只发生一次**（`serializeCatalog`），发出去的就是它。
 * ============================================ */

/** 解析后的目录对象。**刻意是宽松类型**：不认识的字段也要活着回去（见文件头第 1 条）。 */
export type CatalogDocumentJson = Record<string, unknown>;

/** 一条规则的只读视图。字段都可能缺（老文档、手工写的文档）。 */
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
  unitDenominator?: unknown;
  minCredits?: unknown;
  maxCredits?: unknown;
  rounding?: unknown;
  /** 视频按 token 计价的**预扣估算参数**（服务端 `TokenEstimate` 的 JSON 形态）。 */
  tokenEstimate?: {
    divisor?: unknown;
    fps?: unknown;
    /** 「档位 + 比例」→ 「宽x高」，与价格表同一套键语法 */
    dimensions?: Record<string, unknown>;
    /** 输入视频时长的规格键；不写 = 公式不含输入时长那一项 */
    inputSecondsKey?: unknown;
  };
}

/** 表格里的一行 = 一个 (模型, 任务类型) 的规则。 */
export interface CatalogRuleRow {
  modelId: string;
  taskType: string;
  rule: CatalogRuleView;
}

/* ---------- 解析 / 序列化 ---------- */

/**
 * 目录文本 → 对象。
 *
 * @throws Error 文本不是合法 JSON（消息是中文，直接给用户看）
 */
export function parseCatalog(text: string): CatalogDocumentJson {
  if (!text.trim()) return emptyCatalog(DEFAULT_CREDITS_PER_YUAN);
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

/**
 * 从空开始起草一份目录。
 *
 * 只在**还没有任何生效目录**时用得上：这时候没有任何「当前值」可读，得先给一个能编译过的骨架，
 * 否则运营打开页面看到的是一片空白加一个必然失败的保存按钮。
 */
export function emptyCatalog(creditsPerYuan = DEFAULT_CREDITS_PER_YUAN): CatalogDocumentJson {
  return {
    schemaVersion: 1,
    currency: 'CNY',
    creditsPerYuan,
    models: {},
    discountPolicy: { stackMode: 'multiply', floorFactorBp: 3000 },
  };
}

/** 1 元默认换多少积分。**只是新起草时的初值**，生效值一律以目录里写的为准。 */
export const DEFAULT_CREDITS_PER_YUAN = 15;

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

/* ---------- 规则（模型 × 任务类型） ---------- */

function modelsOf(doc: CatalogDocumentJson): Record<string, Record<string, CatalogRuleView>> {
  const raw = doc.models;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, Record<string, CatalogRuleView>>;
}

/** 全部规则，按 (模型, 任务类型) 排序 —— 展示顺序稳定，不随 JSON 键序漂。 */
export function listRules(doc: CatalogDocumentJson): CatalogRuleRow[] {
  const rows: CatalogRuleRow[] = [];
  for (const [modelId, tasks] of Object.entries(modelsOf(doc))) {
    if (tasks === null || typeof tasks !== 'object') continue;
    for (const [taskType, rule] of Object.entries(tasks)) {
      rows.push({ modelId, taskType, rule: rule ?? {} });
    }
  }
  return rows.sort(
    (a, b) => a.modelId.localeCompare(b.modelId) || a.taskType.localeCompare(b.taskType),
  );
}

/** 新增或覆盖一条规则（返回新文档，不动入参）。 */
export function withRule(
  doc: CatalogDocumentJson,
  modelId: string,
  taskType: string,
  rule: CatalogRuleView,
): CatalogDocumentJson {
  const next = clone(doc);
  const models = modelsOf(next);
  const existing = models[modelId];
  next.models = {
    ...models,
    [modelId]: { ...(existing ?? {}), [taskType]: rule },
  };
  return next;
}

/** 删掉一条规则；删空的模型键也一并清掉（不留 `"模型": {}` 这种垃圾）。 */
export function withoutRule(
  doc: CatalogDocumentJson,
  modelId: string,
  taskType: string,
): CatalogDocumentJson {
  const next = clone(doc);
  const models = modelsOf(next);
  const tasks = { ...(models[modelId] ?? {}) };
  delete tasks[taskType];
  const remaining = { ...models };
  if (Object.keys(tasks).length === 0) {
    delete remaining[modelId];
  } else {
    remaining[modelId] = tasks;
  }
  next.models = remaining;
  return next;
}

/* ---------- 单位换算（只用于展示，写回一律按 mc 原值） ---------- */

/** mc → 整数积分。与 billing 的 `RoundingPolicy.HalfUp` 同口径（四舍五入）。 */
export function mcToCredits(mc: number): number {
  return Math.round(mc / 1000);
}

/** mc → 元（浮点，仅供展示；不要拿它反推 mc）。 */
export function mcToYuan(mc: number, creditsPerYuan: number | null): number | null {
  if (!creditsPerYuan || creditsPerYuan <= 0) return null;
  return mc / 1000 / creditsPerYuan;
}

/** 万分比 → 倍数（4000 → 4）。 */
export function bpToMultiple(bp: number): number {
  return bp / 10000;
}

/* ---------- 表单 ↔ 规则 ---------- */

/** 基准单价的三种形态之一。 */
export type PriceKind = 'const' | 'table' | 'unset';

/** 一对可增删的键值行（dims / multipliers / 价格表共用）。 */
export interface KeyValueRow {
  key: string;
  value: string;
}

/** 编辑弹窗的表单状态。数值一律用字符串存：输入过程中「-」「1.」都是合法中间态。 */
export interface RuleForm {
  modelId: string;
  taskType: string;
  baseUnit: string;
  priceKind: PriceKind;
  /** 整数 mc */
  priceValue: string;
  /** 键 → 整数 mc */
  priceTable: KeyValueRow[];
  /** 维度 → 万分比 */
  dims: KeyValueRow[];
  /** 维度 → 万分比 */
  multipliers: KeyValueRow[];
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
  tokenDimensions: KeyValueRow[];
  /** 输入视频时长的规格键；空 = 公式不含输入时长那一项 */
  tokenInputSecondsKey: string;
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

/** 整数 mc / 万分比 / 积分：允许前后空格，其余一律整数。 */
function parseWhole(raw: string): number | null {
  const trimmed = raw.trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : null;
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

/**
 * 表单完整性检查。
 *
 * <p>⚠️ **这不是第二份编译器**：目录能不能用由 billing 编译时说了算（那是唯一的校验时机，
 * 且它的报错指得出哪条规则配错了）。这里只拦「表单根本表达不出来」的东西 ——
 * 模型 / 任务类型空着、该填的数字没填或填的不是整数。多写一条规则校验，就会多一处
 * 「两边不一致」的地方。
 *
 * @returns 一句中文错误；合法时返回 null
 */
export function ruleFormError(form: RuleForm): string | null {
  if (!form.modelId.trim()) return '模型 ID 必填';
  if (!form.taskType.trim()) return '任务类型必填';
  if (!form.baseUnit.trim()) return '基准维度必填';

  if (form.priceKind === 'const') {
    if (parseWhole(form.priceValue) === null) return '基准单价必填，且是整数 mc';
  } else if (form.priceKind === 'table') {
    // 查表才看价格表 —— 常数方式与「待配」下那一栏是收起来的，里面的空行不该拦住保存
    if (form.priceTable.length === 0) return '价格表至少要有一行（规格键 → 单价 mc）';
    const priceError = rowsError(form.priceTable, '价格表');
    if (priceError !== null) return priceError;
  }
  // unset（单价待配）不需要填任何价 —— 那正是这个形态存在的意义：**留空发布**，
  // 提交时被 billing 拒绝（不是按 0 免费）。所以这里不校验价格栏。

  const weightsError = rowsError([...form.dims, ...form.multipliers], '维度表');
  if (weightsError !== null) return weightsError;

  if (form.tokenEstimateEnabled) {
    const divisor = parseWhole(form.tokenDivisor);
    if (divisor === null || divisor <= 0) return 'token 估算的除数必须是正整数（官方 1024）';
    const fps = parseWhole(form.tokenFps);
    if (fps === null || fps <= 0) return 'token 估算的帧率必须是正整数（官方对照表 24）';
    if (form.tokenDimensions.length === 0) {
      return 'token 估算的尺寸表至少要有一行（规格键 → 宽x高）';
    }
    for (const row of form.tokenDimensions) {
      if (!row.key.trim()) return 'token 尺寸表的规格键不能为空';
      // 值只校验「非空」：`1248x704` 这种形态由 billing 编译期说了算（它是唯一的校验时机）
      if (!row.value.trim()) return `token 尺寸表「${row.key.trim()}」的宽高不能为空（写成 1248x704）`;
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

/** 键值行 → 对象，值保持**文本**（token 尺寸表的值是 `1248x704`，不是数）。 */
function rowsToTextRecord(rows: KeyValueRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (key in out) throw new Error(`键重复：${key}`);
    out[key] = row.value.trim();
  }
  return out;
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
  original: CatalogRuleView = {},
): CatalogRuleView {
  let basePrice: CatalogRuleView['basePrice'];
  if (form.priceKind === 'const') {
    basePrice = {
      ...(original.basePrice ?? {}),
      kind: 'const',
      value: parseWhole(form.priceValue) ?? 0,
    };
  } else if (form.priceKind === 'table') {
    basePrice = {
      ...(original.basePrice ?? {}),
      kind: 'table',
      value: null,
      table: rowsToRecord(form.priceTable),
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

  // token 估算参数：整块写或整块删。**不整块删就一定会留下半配的残骸**
  // （用户取消勾选后 divisor 还在），而半配的估算服务端编译期会拒——那是发布失败，
  // 不是「这条规则不估算」。
  if (form.tokenEstimateEnabled) {
    const token: NonNullable<CatalogRuleView['tokenEstimate']> = {
      ...(original.tokenEstimate ?? {}),
      divisor: parseWhole(form.tokenDivisor) ?? 0,
      fps: parseWhole(form.tokenFps) ?? 0,
      dimensions: rowsToTextRecord(form.tokenDimensions),
    };
    // 清空输入框 = **明确不要那一项**，不能因为原文档里有就留着（那会让「我删了」变成没删）
    if (form.tokenInputSecondsKey.trim()) token.inputSecondsKey = form.tokenInputSecondsKey.trim();
    else delete token.inputSecondsKey;
    rule.tokenEstimate = token;
  } else {
    delete rule.tokenEstimate;
  }

  // 不封顶就写 null（显式表达「没有上限」），而不是省略 —— 省略与 null 同义，
  // 但显式 null 在文档里一眼能看出「这条规则想过这件事」
  rule.maxCredits = form.maxCredits.trim() ? parseWhole(form.maxCredits) : null;

  return rule;
}

/** 目录里的 rule → 表单（编辑已有规则时用）。 */
export function formFromRule(
  modelId: string,
  taskType: string,
  rule: CatalogRuleView,
): RuleForm {
  const price = rule.basePrice ?? {};
  const kind: PriceKind =
    price.kind === 'table' ? 'table' : price.kind === 'unset' ? 'unset' : 'const';
  const table = price.table !== undefined && price.table !== null ? price.table : {};
  const asText = (v: unknown): string =>
    typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  const token = rule.tokenEstimate;

  return {
    modelId,
    taskType,
    baseUnit: typeof rule.baseUnit === 'string' ? rule.baseUnit : '',
    priceKind: kind,
    priceValue: asText(price.value),
    priceTable: Object.entries(table).map(([key, value]) => ({ key, value: asText(value) })),
    dims: recordToRows(rule.dims),
    multipliers: recordToRows(rule.multipliers),
    unitDenominator: asText(rule.unitDenominator ?? 1),
    minCredits: asText(rule.minCredits ?? 1),
    maxCredits: asText(rule.maxCredits),
    rounding: typeof rule.rounding === 'string' && rule.rounding ? rule.rounding : 'halfUp',
    // 「有没有 tokenEstimate」本身就是那个开关：文档里没有它 = 这条规则不做估算
    tokenEstimateEnabled: token !== undefined && token !== null,
    tokenDivisor: asText(token?.divisor ?? DEFAULT_TOKEN_DIVISOR),
    tokenFps: asText(token?.fps ?? DEFAULT_TOKEN_FPS),
    tokenDimensions: recordToRows(token?.dimensions),
    tokenInputSecondsKey:
      typeof token?.inputSecondsKey === 'string' ? token.inputSecondsKey : '',
  };
}

/** 新建规则时的一张干净表单。 */
export function emptyRuleForm(): RuleForm {
  return {
    modelId: '',
    taskType: '',
    baseUnit: 'constant:1',
    priceKind: 'const',
    priceValue: '',
    priceTable: [{ key: '', value: '' }],
    dims: [],
    multipliers: [],
    unitDenominator: '1',
    minCredits: '1',
    maxCredits: '',
    rounding: 'halfUp',
    tokenEstimateEnabled: false,
    tokenDivisor: String(DEFAULT_TOKEN_DIVISOR),
    tokenFps: String(DEFAULT_TOKEN_FPS),
    tokenDimensions: [{ key: '', value: '' }],
    tokenInputSecondsKey: '',
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

function recordToRows(record: Record<string, unknown> | undefined): KeyValueRow[] {
  if (!record || typeof record !== 'object') return [];
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: typeof value === 'number' && Number.isFinite(value) ? String(value) : String(value ?? ''),
  }));
}

/* ---------- 表格里的一行怎么显示 ---------- */

/** 基准单价的展示文本（mc 原文；人类可读的换算由 `describePriceInHuman` 补在旁边）。 */
export function describeBasePrice(rule: CatalogRuleView): string {
  const price = rule.basePrice ?? {};
  if (price.kind === 'unset') return '单价未配（提交会被拒绝）';
  if (price.kind === 'table') {
    const count = price.table ? Object.keys(price.table).length : 0;
    return `价格表（${count} 档）`;
  }
  if (typeof price.value === 'number') return `${price.value} mc`;
  return '—';
}

/**
 * 规格键的人话（**只用于展示**，存储与键名一律用火山那一套）。
 *
 * <p>火山的计费档按场景命名：一个模型的一个任务类型下，「输入不含视频 / 输入包含视频」
 * 两档写作 {@code video0} / {@code video1}。我们的规格键语法是「轴=值」，
 * 所以存的是 {@code video=0} / {@code video=1} —— 这里补一句中文，让人一眼看懂哪档是哪档。
 *
 * <p>⚠️ 只加解释、**不改写键名**：改写过一次，界面上看到的与目录里存的就不是一个东西了，
 * 而这两个值会出现在账、在价、在回滚历史里。
 */
const SPEC_KEY_LABELS: Record<string, string> = {
  'video=0': 'video=0（不含视频输入 video0）',
  'video=1': 'video=1（含视频输入 video1）',
};

export function describeSpecKey(key: string): string {
  return SPEC_KEY_LABELS[key] ?? key;
}

/** 单价的人话：`每 1 个单位 ≈ 100 积分 ≈ ¥6.67`；换算不出来（没生效目录）时返回空串。 */
export function describePriceInHuman(
  mc: number,
  creditsPerYuan: number | null,
): string {
  const yuan = mcToYuan(mc, creditsPerYuan);
  if (yuan === null) return `${mcToCredits(mc)} 积分`;
  return `${mcToCredits(mc)} 积分 ≈ ¥${yuan.toFixed(2)}`;
}

/** 深拷贝。入参一定来自 `JSON.parse`，所以 JSON 往返是**无损**的（见文件头第 1 条）。 */
function clone(doc: CatalogDocumentJson): CatalogDocumentJson {
  return JSON.parse(JSON.stringify(doc)) as CatalogDocumentJson;
}
