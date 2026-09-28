/* ============================================
 * blue-whale-pay（支付网关）的**唯一出口**
 *
 * ── 为什么不复用 new-api 那个出口 ──────────────────────────────────────────────
 *
 * `libs/shared/upstream/new-api-egress.ts` 管的是 AI 网关。支付网关是**另一个供应商**：
 * 地址不同、鉴权模型不同（`new-api` 是 Bearer 上游 key，这里是商户号 + MD5 报文签名）、
 * 语义也不同（那边是「算力」，这边是「钱」）。合成一个出口就得让它去分辨「这次是哪家」，
 * 那只是把分支换了个地方（与 new-api 出口当初合并六处时的判断同源）。
 *
 * ── 这个出口管什么、不管什么 ──────────────────────────────────────────────────
 *
 * **管**：base URL 解析（含缺失即拒绝）、路径拼接、`X-Trace-Id` 透传、发起请求。
 * 这几件事是纯重复，漂移了没人会发现。
 *
 * **不管**：商户凭证与报文签名。凭证来自管理端配置（`system-settings`），
 * 签名是 jeepay 商户协议的一部分（见 `pay-sign.ts`）——它们是这个上游的**业务契约**，
 * 不是传输细节。
 *
 * ⚠️ **超时策略不在这里**：出口只把调用方的 `signal` 透传下去（`init` 原样展开）。
 *    下单要等银行受理，查单要快——两个「卡住」的定义本来就不同，由调用方按语义定。
 * ============================================ */
import { TRACE_ID_HEADER, getCurrentTraceId } from "@lib/core/logging";

export const PAY_SERVER_BASE_URL_ENV = "PAY_SERVER_BASE_URL";

/**
 * 支付网关地址未配置。
 *
 * <p>返回空串然后让调用方自己去处理，是本仓历史上多处踩过的坑：表现为
 * `fetch("undefined/api/pay/unifiedOrder")` 或一个来路不明的 404，报错点离原因很远。
 * 支付这条链路上还有更坏的一层：**配错地址会把订单下到别处去**，所以宁可起手就抛。
 */
export class PayServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayServerConfigError";
  }
}

/** 支付网关 base URL（去掉尾部斜杠，避免拼出 `//api`）。未配置即抛。 */
export function payServerBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env[PAY_SERVER_BASE_URL_ENV] ?? "").trim();
  if (!raw) {
    throw new PayServerConfigError(`支付网关地址未配置（缺环境变量 ${PAY_SERVER_BASE_URL_ENV}）`);
  }
  return raw.replace(/\/+$/, "");
}

/**
 * 拼一个网关 URL。
 *
 * @param path 以 `/` 开头的网关路径，例如 `/api/pay/unifiedOrder`
 */
export function payServerUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${payServerBaseUrl(env)}${path}`;
}

/**
 * 向支付网关发一个请求。
 *
 * <p>`X-Trace-Id` 由这里统一补：支付链路上「用户说付了钱没到账」是必然会来的一类工单，
 * 从我们的下单请求到网关、再到银行，靠的就是同一个 trace id 串起来。
 *
 * @param init 调用方的原始 init（`signal` / 超时由调用方决定，这里原样透传）。
 *             报文签名由调用方放进 body。
 */
export async function payServerFetch(
  path: string,
  init: RequestInit = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has(TRACE_ID_HEADER)) {
    const traceId = getCurrentTraceId();
    if (traceId) headers.set(TRACE_ID_HEADER, traceId);
  }
  return fetch(payServerUrl(path, env), { ...init, headers });
}
