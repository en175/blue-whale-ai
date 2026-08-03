/**
 * recharge — 充值 API 函数（真实后端）
 *
 * 统一调用 Next.js relay 路由 /api/recharge/*，路由内部转发 Go new-api 原生 topup。
 * 响应为 { code, msg, data } 信封，由 apiRequest 统一剥壳：code === 200 返回 data，
 * 否则抛 ApiError。充值档位数据源为 blue_whale DB topup_tiers（active + 时间窗口内）。
 */
import { apiRequest } from "@/lib/api-client";
import type {
  CreateOrderRequest,
  CreateOrderResponse,
  OrderStatusResponse,
  RechargeAgreementResponse,
  RechargeTiersResponse,
} from "./recharge.dto";

/** 获取充值档位列表 */
export async function getRechargeTiers(): Promise<RechargeTiersResponse> {
  return apiRequest<RechargeTiersResponse>("/api/recharge/tiers");
}

/** 创建充值订单，返回 QR 二维码 */
export async function createRechargeOrder(
  req: CreateOrderRequest,
): Promise<CreateOrderResponse> {
  return apiRequest<CreateOrderResponse>("/api/recharge/order", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/** 查询订单支付状态 */
export async function getOrderStatus(
  tradeNo: string,
): Promise<OrderStatusResponse> {
  return apiRequest<OrderStatusResponse>(
    `/api/recharge/order/${encodeURIComponent(tradeNo)}/status`,
  );
}

/** 取消未支付订单 */
export async function cancelRechargeOrder(tradeNo: string): Promise<void> {
  await apiRequest<void>(
    `/api/recharge/order/${encodeURIComponent(tradeNo)}/cancel`,
    { method: "POST" },
  );
}

/** 获取充值协议 */
export async function getRechargeAgreement(): Promise<RechargeAgreementResponse> {
  return apiRequest<RechargeAgreementResponse>("/api/recharge/agreement");
}
