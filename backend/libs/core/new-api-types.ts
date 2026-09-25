// IK74V8：new-api 出入参契约类型与行解析（从 new-api-client.ts 拆出）。
export interface NewApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /**
   * 出站 X-Trace-Id 提供者（IK73EV）：返回非空时优先于链路上下文与缺省生成，
   * 用于 BFF 等场景把入站 trace id 带入出站请求。缺省不传行为不变。
   */
  traceIdProvider?: () => string | null | Promise<string | null>;
}

export interface NewApiUsage {
  userQuota: number;
  raw: unknown;
}

export interface NewApiLog {
  quota?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  model_name?: string;
  created_at?: number | string;
  [key: string]: unknown;
}

export interface NewApiImageInput {
  model: string;
  prompt: string;
  size?: string | null;
  quality?: string;
  n: number;
  webSearch?: boolean;
  sequential?: boolean;
  /** 图生图参考图：单张字符串，多张数组。走 generations Extra `image`。 */
  image?: string | readonly string[];
}

export interface NewApiImage {
  url: string;
  [key: string]: unknown;
}

export interface NewApiImageEditInput {
  model: string;
  prompt: string;
  /** Legacy single-image shape. Prefer images for new callers. */
  image?: Blob;
  fileName?: string;
  images?: Array<{ blob: Blob; fileName: string }>;
  size?: string | null;
  quality?: string;
  n: number;
  webSearch?: boolean;
  sequential?: boolean;
}

export type NewApiVideoReference = {
  /** IKDJNZ：参考音频（type:"audio"）作为普通 reference；首尾帧仍只允许图片。 */
  type: "image" | "video" | "audio";
  url: string;
  /** IKDJNZ：单数组 references 语义下，帧条目带 role（first_frame/last_frame）；普通参考无。 */
  role?: "first_frame" | "last_frame";
};

export interface NewApiVideoInput {
  model: string;
  prompt: string;
  /** @deprecated Use references. Kept for the legacy worker adapter. */
  image?: string;
  firstFrameImage?: string;
  lastFrameImage?: string;
  /** @deprecated Use references. Kept for the legacy worker adapter. */
  referenceImages?: string[];
  references?: NewApiVideoReference[];
  duration: number;
  width: number;
  height: number;
  resolution: string;
  ratio: string;
  responseFormat?: "url";
}

export interface NewApiVideoSubmission {
  taskId: string;
  status: string;
}

export interface NewApiVideoTask {
  taskId: string;
  status: string;
  url: string | null;
  /** IK7G9X：TaskDto.quota —— 任务当前 quota（预扣额，轮询成功时=结算后实际扣费额）。 */
  quota?: number;
  error: { code: string | number | null; message: string } | null;
}

export interface NewApiRechargeTierItem {
  id: string;
  name: string;
  amount: number;
  price: number;
  original_price?: number | null;
  bonus: number;
  is_recommended: boolean;
  sort_order: number;
}

export interface NewApiRechargeTiersResult {
  tiers: NewApiRechargeTierItem[];
}

export interface NewApiRechargeOrderResult {
  trade_no: string;
  qr_code_data: string;
  expire_time: number;
  amount: number;
  points: number;
}

export interface NewApiRechargeOrderStatus {
  trade_no: string;
  status: string;
  credits_after?: number | null;
}

export interface NewApiRechargeAgreement {
  title: string;
  content: string;
}

// ---- 原生充值（Model B：catalog→web，settlement→Go 原生 new-api topup）----

/** 原生 BlueWhalePay 下单结果。pay_data 与旧自定义 recharge 的 qr_code_data 同源
 *  （都来自 BlueWhalePay 统一下单），前端直接当二维码渲染。 */
export interface NewApiTopUpOrderResult {
  /** Go TopUp.trade_no（BWP... 前缀） */
  tradeNo: string;
  /** 支付拉起数据 / 二维码 */
  payData: string;
}

/** 产品充值代收下单入参（IKBXLN / IKBWY4）。 */
export interface NewApiCollectTopUpInput {
  collectToken: string;
  userId: number;
  /** 档位实付（元） */
  money: number;
  /** 美元额度 N */
  amount: number;
  wayCode: string;
}

/** 原生充值订单记录（GET /api/user/topup/self 的 items 元素）。 */
export interface NewApiTopUpRecord {
  trade_no: string;
  /** pending | success | failed | expired（Go common.TopUpStatus*） */
  status: string;
  /** 美元额度 N（加 quota = N × QuotaPerUnit） */
  amount: number;
  /** 实付金额（元，getPayMoney 算） */
  money: number;
  create_time: number;
  complete_time: number;
  /** Go TopUp.payment_method：新单渠道族值 alipay/wxpay；存量可能是 bluewhalepay/wechat。 */
  payment_method: string;
}

/** GET /api/user/topup/self 分页结果（Go PageInfo：按 id desc 即时间倒序）。 */
export interface NewApiTopUpListResult {
  items: NewApiTopUpRecord[];
  total: number;
}

/** 用户消费流水记录（GET /api/log/self 的 items 元素，Go model.Log 子集）。 */
export interface NewApiUserLogRecord {
  id: number;
  /** Go common.LogType*（2 = 消费） */
  type: number;
  content: string;
  model_name: string;
  /** 消耗 quota（正数） */
  quota: number;
  created_at: number;
}

/** GET /api/log/self 分页结果（Go PageInfo：按 id desc 即时间倒序）。 */
export interface NewApiUserLogListResult {
  items: NewApiUserLogRecord[];
  total: number;
}

/**
 * IKAFPC / IKCGE7：按 Agent Run 号汇总的消费。
 *
 * **归属只认 Run 号，不认时间窗。** new-api 只有「用户」这一个维度，没有会话与项目；同一个
 * 账号完全可能同时跑两个 Agent 会话，也完全可能一边对话一边在 dock 栏出图。按「用户 + 时间窗」
 * 求和会把这些账全算进来。而 new-api 把 `other.agent_run_id` 写进了每一笔经蓝鲸网关的账单，
 * 一个 Run 号对应一次运行，逐笔精确——出图出片不走 Agent 链路，账单上根本没有这个字段，
 * 天然被排除。
 *
 * 券退役前这一列叫 `other.run_capability_id`（IKCGE7 改名）。上线之前产生的账单只有旧列，
 * 按新口径一条都匹配不上，所以 `matched === 0` 时调用方必须报「不知道」而不是 0。
 */
export interface NewApiAgentRunQuotaResult {
  /** 汇总到的 quota 总额（未换算成积分；换算是展示层的事）。 */
  quota: number;
  /** 命中的账单条数，用于判断「真的是 0」还是「一条都没查到」。 */
  matched: number;
  /**
   * 是否因为翻页上限而提前收手。
   *
   * true 时 `quota` 是下界而非确切值——**调用方不得把它当成最终账**，否则会在用户面前把
   * 一个偏小的数字说成确切花费。
   */
  truncated: boolean;
}

/** IK7G9X：模型定价目录条目（GET /api/pricing 的 data 数组元素子集）。 */
export interface NewApiPricingItem {
  modelName: string;
  /** 固定价（per-call/task 计费用）；无则走 modelRatio。 */
  modelPrice?: number;
  /** 倍率价（token 计费用）；无固定价时用。 */
  modelRatio?: number;
  /** tiered_expr 时非空。 */
  billingMode?: string;
  billingExpr?: string;
}

/** IK7G9X：GET /api/pricing 响应解析结果。 */
export interface NewApiPricingResult {
  pricing: NewApiPricingItem[];
  /** 响应级 pricing_version（可追溯当次定价目录）。 */
  pricingVersion?: string;
}

/** 把 topup/self items 的裸 JSON 元素解析成 NewApiTopUpRecord（缺字段兜底）。 */
export function parseTopUpRecord(raw: Record<string, unknown>): NewApiTopUpRecord {
  return {
    trade_no: String(raw.trade_no ?? ""),
    status: typeof raw.status === "string" ? raw.status : "",
    amount: Number(raw.amount ?? 0),
    money: Number(raw.money ?? 0),
    create_time: Number(raw.create_time ?? 0),
    complete_time: Number(raw.complete_time ?? 0),
    payment_method:
      typeof raw.payment_method === "string" ? raw.payment_method : "",
  };
}

// ---- 管理端（middleware.AdminAuth：仅 role >= 10 的管理员 token 可调）----
// 接口：GET /api/user、/api/user/search、POST /api/user/manage、
//       GET /api/user/topup、POST /api/user/topup/complete、
//       GET /api/log/stat、GET /api/log。信封为标准 {success, data} 分页（PageInfo）。

/** new-api 通用分页信封（PageInfo：page / page_size / total / items）。 */
export interface NewApiPageInfo<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** GET /api/user、/api/user/search 的行元素（model.User 的 json 视图）。 */
export interface NewApiAdminUserRow {
  id: number;
  username: string;
  display_name?: string;
  email?: string;
  role: number;
  status: number;
  quota: number;
  used_quota: number;
  created_at: number;
  [key: string]: unknown;
}

/** GET /api/user/topup 的行元素（model.TopUp 的 json 视图）。 */
export interface NewApiAdminTopUpRow {
  id: number;
  user_id: number;
  amount: number;
  money: number;
  trade_no: string;
  payment_method: string;
  payment_provider: string;
  create_time: number;
  complete_time: number;
  /** pending | success | failed | expired */
  status: string;
  [key: string]: unknown;
}

/** GET /api/log 的行元素（model.Log 的 json 视图，管理员侧全部用户）。 */
export interface NewApiLogRow {
  id: number;
  user_id: number;
  created_at: number;
  type: number;
  username: string;
  model_name: string;
  quota: number;
  prompt_tokens: number;
  completion_tokens: number;
  [key: string]: unknown;
}

/** GET /api/log/stat 的聚合结果。 */
export interface NewApiLogStat {
  quota: number;
  rpm: number;
  tpm: number;
}

/** POST /api/user/manage 入参（Go ManageRequest）。 */
export interface NewApiAdminManageUserInput {
  id: number;
  action: "disable" | "enable" | "add_quota";
  value?: number;
  mode?: "add" | "subtract" | "override";
}

