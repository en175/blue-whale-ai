import { createTopupTierDeps } from "@/lib/topup-tier/deps";
import { quotaToCredits } from "@/lib/credits";

/**
 * GET /api/recharge/tiers — 用户端充值档位列表
 *
 * 数据源：blue_whale DB topup_tiers（仅 active + 时间窗口内）。
 * 响应沿用 { code, msg, data: { tiers } } 信封，与前端 apiRequest 对齐。
 *
 * 积分口径（IK756O）：DB amount 存裸 quota，展示层统一换算成积分
 * （quota × QUOTA_TO_CREDITS_COEFFICIENT），与余额/账户记录口径一致。
 */
export async function GET() {
  try {
    const { db } = createTopupTierDeps();
    const rows = await db.listActive();
    const tiers = rows.map((t) => ({
      id: t.id,
      name: t.name,
      amount: Math.round(quotaToCredits(t.amount)),
      price: t.price,
      original_price: t.originalPrice,
      discount: t.discount,
      is_recommended: t.isRecommended,
      sort_order: t.sortOrder,
    }));
    return Response.json({ code: 200, msg: null, data: { tiers } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "档位服务不可用";
    return Response.json({ code: 500, msg, data: null }, { status: 500 });
  }
}
