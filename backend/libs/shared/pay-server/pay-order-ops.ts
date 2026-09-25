/* ============================================
 * 支付网关的**商户接口调用**：下单（统一下单）与查单。
 *
 * 出口只负责传输（`pay-egress`）、签名是协议（`pay-sign`），本文件负责**业务语义**：
 * 发什么字段、应答里哪些是「受理成功」、哪些是「真的失败」。
 *
 * ── 渠道：只有杭州银行聚合主扫（wayCode = HCCB_QR） ─────────────────────────────
 *
 * 用户扫的是一个**银行统一收银台**链接，在银行的页面上自选微信 / 支付宝 / 云闪付。
 * 渠道选择对商户完全透明，所以商户侧**不区分支付方式**——
 * 这不是「只接了其中一个」，而是这个渠道本来就不暴露。
 *
 * ⚠️ 下单应答只代表**受理**（`orderState=1 支付中`）。真正确认支付的是异步通知或查单，
 *    所以这里永远不返回「已支付」，调用方必须自己去查/等。
 * ============================================ */
import { payServerFetch } from "./pay-egress.js";
import { paySign } from "./pay-sign.js";

/** 渠道标识（网关侧 `t_pay_interface_define.if_code`）。 */
export const PAY_IF_CODE_HCCB = "hccb";

/** 支付方式（网关侧 `t_pay_way.way_code`）：杭州银行聚合主扫。 */
export const PAY_WAY_CODE_HCCB_QR = "HCCB_QR";

/** 网关订单状态（`PayOrder.state`）。 */
export const PAY_ORDER_STATE = {
  /** 订单生成，尚未与渠道交互 */
  init: 0,
  /** 支付中：**已受理，未确认** */
  paying: 1,
  /** 支付成功 —— 到账的唯一依据 */
  success: 2,
  /** 支付失败 */
  failed: 3,
  /** 已撤销 */
  revoked: 4,
  /** 已退款 */
  refunded: 5,
  /** 订单关闭 */
  closed: 6,
} as const;

/** 商户凭证（网关侧 `t_mch_info` / `t_mch_app` 的标识与密钥）。 */
export interface PayMerchantCredentials {
  /** 商户号（网关侧 `mchNo`） */
  mchNo: string;
  /** 商户应用 ID（网关侧 `appId`） */
  appId: string;
  /** 商户密钥（网关侧 `t_mch_app.app_secret`），用于报文签名 */
  appSecret: string;
}

/** 网关**业务失败**（应答信封 `code !== 0`，如「不支持的支付方式」「商户应用不支持该支付方式」）。 */
export class PayGatewayError extends Error {
  constructor(
    message: string,
    /** 网关的业务响应码（0 为成功） */
    readonly code: number,
  ) {
    super(message);
    this.name = "PayGatewayError";
  }
}

/** 网关应答信封（`ApiRes`）。 */
interface PayApiEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
}

const VERSION = "1.0";
const SIGN_TYPE = "MD5";

/** 网关业务码：成功。 */
const SUCCESS_CODE = 0;

/**
 * 下单结果。
 *
 * <p>⚠️ 只到「受理」为止。`payData` 是**收银台链接**，前端自己渲染二维码；
 * 我们刻意不请求网关的 `codeImgUrl`（那要求网关的取图接口对用户浏览器可达，
 * 多一个必须公网可达的地址，而我们并不需要它）。
 */
export interface UnifiedOrderResult {
  /** 网关订单号 */
  payOrderId: string;
  /** 收银台链接（用户扫码打开银行页面选渠道付款） */
  cashierUrl: string;
  /** 网关订单状态，正常为 1（支付中） */
  orderState: number;
}

export interface UnifiedOrderInput {
  credentials: PayMerchantCredentials;
  /** 我们的商户订单号（本地 `recharge_orders.trade_no`） */
  mchOrderNo: string;
  /** 金额，单位**分** */
  amountFen: number;
  /** 商品标题 */
  subject: string;
  /** 商品描述 */
  body: string;
  /** 异步通知地址（网关支付成功后 POST 到这里，须公网可达） */
  notifyUrl: string;
}

/**
 * 统一下单（`POST /api/pay/unifiedOrder`）。
 *
 * <p>签名的字段集必须**与我们真实发出的那份报文一致**（见 `pay-sign` 的说明），
 * 所以先在同一个对象上算签名，再把签名一起发出去。
 */
export async function unifiedOrder(input: UnifiedOrderInput): Promise<UnifiedOrderResult> {
  const { credentials } = input;
  const payload: Record<string, unknown> = {
    mchNo: credentials.mchNo,
    appId: credentials.appId,
    mchOrderNo: input.mchOrderNo,
    wayCode: PAY_WAY_CODE_HCCB_QR,
    amount: input.amountFen,
    currency: "cny",
    subject: input.subject,
    body: input.body,
    notifyUrl: input.notifyUrl,
    reqTime: String(Date.now()),
    version: VERSION,
    signType: SIGN_TYPE,
  };
  payload.sign = paySign(payload, credentials.appSecret);

  const data = await callGateway<{
    payOrderId?: string;
    orderState?: number;
    payDataType?: string;
    payData?: string;
    errMsg?: string;
  }>("/api/pay/unifiedOrder", payload);

  const payOrderId = (data.payOrderId ?? "").trim();
  const cashierUrl = (data.payData ?? "").trim();
  if (!payOrderId) {
    // 没有网关订单号 = 这笔订单在网关侧没有身份，后面既查不到也回调不了。
    // 当成失败处理，不做「先记下来回头再说」的猜测。
    throw new PayGatewayError(`网关未返回订单号（orderState=${data.orderState}）`, SUCCESS_CODE);
  }
  if (!cashierUrl) {
    throw new PayGatewayError(`网关未返回收银台链接（orderState=${data.orderState}）`, SUCCESS_CODE);
  }
  return { payOrderId, cashierUrl, orderState: data.orderState ?? PAY_ORDER_STATE.init };
}

export interface QueryOrderInput {
  credentials: PayMerchantCredentials;
  /** 二选一：网关订单号（优先）或我们的商户订单号 */
  payOrderId?: string;
  mchOrderNo?: string;
}

export interface QueryOrderResult {
  payOrderId: string;
  mchOrderNo: string;
  /** 网关订单状态，见 {@link PAY_ORDER_STATE} */
  state: number;
  /** 网关侧金额，单位分（用于与本地订单对账） */
  amountFen: number | null;
}

/**
 * 商户查单（`POST /api/pay/query`）。
 *
 * <p>**这是回调丢失时的补偿手段**：网关只在终态通知一次，通知重投 6 次（约 15 分钟）后
 * 就不再重试。过了那个窗口还没对上的订单，只能靠查单把结果捞回来。
 * 网关不会因为查单而改变订单状态（它自己的补单任务在银行侧跑），查单只是读。
 */
export async function queryOrder(input: QueryOrderInput): Promise<QueryOrderResult> {
  const { credentials } = input;
  if (!input.payOrderId && !input.mchOrderNo) {
    throw new PayGatewayError("查单必须给出 payOrderId 或 mchOrderNo", SUCCESS_CODE);
  }
  const payload: Record<string, unknown> = {
    mchNo: credentials.mchNo,
    appId: credentials.appId,
    reqTime: String(Date.now()),
    version: VERSION,
    signType: SIGN_TYPE,
  };
  if (input.payOrderId) payload.payOrderId = input.payOrderId;
  if (input.mchOrderNo) payload.mchOrderNo = input.mchOrderNo;
  payload.sign = paySign(payload, credentials.appSecret);

  const data = await callGateway<{
    payOrderId?: string;
    mchOrderNo?: string;
    state?: number;
    amount?: number;
  }>("/api/pay/query", payload);

  return {
    payOrderId: (data.payOrderId ?? "").trim(),
    mchOrderNo: (data.mchOrderNo ?? "").trim(),
    state: data.state ?? PAY_ORDER_STATE.init,
    amountFen: typeof data.amount === "number" ? data.amount : null,
  };
}

/**
 * 发一个商户接口请求并拆开应答信封。
 *
 * <p>**不做应答验签**：应答只可能来自我们自己的网关（TLS 直连，不走浏览器），
 * 而签名用的密钥与我们发请求时用的**是同一个**——密钥错了请求先被拒成「验签失败」，
 * 验应答签不会多拦住任何一种情况。真正需要验签的是**公网可达的回调接口**，
 * 那一步在 `recharge.controller` 里做。
 */
async function callGateway<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await payServerFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify(payload),
    // 下单要等银行受理（实测秒级），给足余量但不无限等
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new PayGatewayError(`支付网关返回 HTTP ${response.status}`, response.status);
  }

  let envelope: PayApiEnvelope<T>;
  try {
    envelope = (await response.json()) as PayApiEnvelope<T>;
  } catch {
    throw new PayGatewayError("支付网关返回的不是合法 JSON", response.status);
  }

  if (envelope.code !== SUCCESS_CODE) {
    throw new PayGatewayError(
      envelope.msg || `支付网关业务失败（code=${envelope.code}）`,
      envelope.code ?? -1,
    );
  }
  if (!envelope.data) {
    throw new PayGatewayError("支付网关应答缺少 data", SUCCESS_CODE);
  }
  return envelope.data;
}
