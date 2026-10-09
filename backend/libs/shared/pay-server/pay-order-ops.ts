import { payServerFetch } from "./pay-egress.js";
import { paySign } from "./pay-sign.js";

export const PAY_IF_CODE_HCCB = "hccb";

export const PAY_WAY_CODE_HCCB_QR = "HCCB_QR";

export const PAY_ORDER_STATE = {
  init: 0,
  paying: 1,
  success: 2,
  failed: 3,
  revoked: 4,
  refunded: 5,
  closed: 6,
} as const;

export interface PayMerchantCredentials {
  mchNo: string;
  appId: string;
  appSecret: string;
}

export class PayGatewayError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = "PayGatewayError";
  }
}

interface PayApiEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
}

const VERSION = "1.0";
const SIGN_TYPE = "MD5";

const SUCCESS_CODE = 0;

export interface UnifiedOrderResult {
  payOrderId: string;
  cashierUrl: string;
  orderState: number;
}

export interface UnifiedOrderInput {
  credentials: PayMerchantCredentials;
  mchOrderNo: string;
  amountFen: number;
  subject: string;
  body: string;
  notifyUrl: string;
}

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
    throw new PayGatewayError(`网关未返回订单号（orderState=${data.orderState}）`, SUCCESS_CODE);
  }
  if (!cashierUrl) {
    throw new PayGatewayError(`网关未返回收银台链接（orderState=${data.orderState}）`, SUCCESS_CODE);
  }
  return { payOrderId, cashierUrl, orderState: data.orderState ?? PAY_ORDER_STATE.init };
}

export interface QueryOrderInput {
  credentials: PayMerchantCredentials;
  payOrderId?: string;
  mchOrderNo?: string;
}

export interface QueryOrderResult {
  payOrderId: string;
  mchOrderNo: string;
  state: number;
  amountFen: number | null;
}

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

async function callGateway<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await payServerFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify(payload),
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
