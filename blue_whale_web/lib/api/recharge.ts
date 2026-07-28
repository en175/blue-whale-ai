/**
 * recharge — 充值 API 函数 + mock 切换
 *
 * NEXT_PUBLIC_MOCK_RECHARGE !== "false" 时走 mock，否则走真实后端。
 * 对接后端：设环境变量 NEXT_PUBLIC_MOCK_RECHARGE=false 或删 mock 分支。
 */
import { apiRequest } from "@/lib/api-client";
import type {
  CreateOrderRequest,
  CreateOrderResponse,
  OrderStatus,
  OrderStatusResponse,
  RechargeAgreementResponse,
  RechargeTierDto,
  RechargeTiersResponse,
} from "./recharge.dto";
import { MOCK_TIERS, MOCK_INITIAL_CREDITS } from "@/components/recharge/constants";

// ---------------------------------------------------------------------------
// Mock toggle
// ---------------------------------------------------------------------------

const USE_MOCK = process.env.NEXT_PUBLIC_MOCK_RECHARGE !== "false";

// ---------------------------------------------------------------------------
// Mock state (shared across calls in same session)
// ---------------------------------------------------------------------------

let mockCredits = MOCK_INITIAL_CREDITS;
let mockOrderCounter = 0;
const mockOrderPollCounts = new Map<string, number>();
const mockOrderMeta = new Map<string, { points: number; price: number }>();

function resetMockState() {
  mockCredits = MOCK_INITIAL_CREDITS;
  mockOrderCounter = 0;
  mockOrderPollCounts.clear();
  mockOrderMeta.clear();
}

// Expose for tests
export { resetMockState };

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/** 获取充值档位列表 */
export async function getRechargeTiers(): Promise<RechargeTiersResponse> {
  if (USE_MOCK) {
    await mockDelay(400);
    return { tiers: MOCK_TIERS.map(toTierDto) };
  }
  return apiRequest<RechargeTiersResponse>("/api/recharge/tiers");
}

/** 创建充值订单，返回 QR 二维码 */
export async function createRechargeOrder(
  req: CreateOrderRequest,
): Promise<CreateOrderResponse> {
  if (USE_MOCK) {
    await mockDelay(800);
    const tier = MOCK_TIERS.find((t) => t.id === req.tier_id);
    if (!tier) throw new Error(`Unknown tier: ${req.tier_id}`);
    mockOrderCounter++;
    const tradeNo = `MOCK_${Date.now()}_${mockOrderCounter}`;
    const points = tier.amount + tier.bonus;
    const expireTime = new Date(
      Date.now() + 15 * 60 * 1000,
    ).toISOString();
    mockOrderPollCounts.set(tradeNo, 0);
    mockOrderMeta.set(tradeNo, { points, price: tier.price });
    return {
      trade_no: tradeNo,
      qr_code_url: mockQrDataUri(),
      expire_time: expireTime,
      amount: tier.price,
      points,
    };
  }
  return apiRequest<CreateOrderResponse>("/api/recharge/order", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/** 查询订单支付状态 */
export async function getOrderStatus(
  tradeNo: string,
): Promise<OrderStatusResponse> {
  if (USE_MOCK) {
    await mockDelay(500);
    const count = (mockOrderPollCounts.get(tradeNo) ?? 0) + 1;
    mockOrderPollCounts.set(tradeNo, count);
    // 前 3 次 pending，第 4 次 paid
    const status: OrderStatus = count >= 4 ? "paid" : "pending";
    if (status === "paid") {
      const meta = mockOrderMeta.get(tradeNo);
      if (meta) {
        mockCredits += meta.points;
      }
    }
    return {
      trade_no: tradeNo,
      status,
      credits_after: status === "paid" ? mockCredits : null,
    };
  }
  return apiRequest<OrderStatusResponse>(
    `/api/recharge/order/${encodeURIComponent(tradeNo)}/status`,
  );
}

/** 取消未支付订单 */
export async function cancelRechargeOrder(
  tradeNo: string,
): Promise<void> {
  if (USE_MOCK) {
    mockOrderPollCounts.delete(tradeNo);
    mockOrderMeta.delete(tradeNo);
    return;
  }
  await apiRequest<void>(
    `/api/recharge/order/${encodeURIComponent(tradeNo)}/cancel`,
    { method: "POST" },
  );
}

/** 获取充值协议 */
export async function getRechargeAgreement(): Promise<RechargeAgreementResponse> {
  if (USE_MOCK) {
    await mockDelay(200);
    return {
      title: "充值协议",
      content:
        "## 充值协议\n\n充值协议内容待运营提供。\n\n- 充值即视为同意本协议\n- 不支持退款\n- 暂不支持开发票",
    };
  }
  return apiRequest<RechargeAgreementResponse>("/api/recharge/agreement");
}

/** 获取当前余额（mock 用，真实后端走 /api/me 的 credits 字段） */
export function getMockCredits(): number {
  return mockCredits;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockDelay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 将前端域类型 RechargeTier 转为 DTO 契约类型 */
function toTierDto(t: { id: string; amount: number; price: number; bonus: number; isRecommended: boolean; sortOrder: number }): RechargeTierDto {
  return {
    id: t.id,
    amount: t.amount,
    price: t.price,
    bonus: t.bonus,
    is_recommended: t.isRecommended,
    sort_order: t.sortOrder,
  };
}

/** 生成一个占位 QR 码 data URI（灰色方块） */
function mockQrDataUri(): string {
  // 200x200 灰色方块，标注 "MOCK QR"
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <rect width="200" height="200" fill="#f0f0f0" stroke="#ccc" stroke-width="2"/>
  <text x="100" y="90" text-anchor="middle" font-size="14" fill="#999">MOCK QR</text>
  <text x="100" y="115" text-anchor="middle" font-size="12" fill="#aaa">后端就绪后替换</text>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
