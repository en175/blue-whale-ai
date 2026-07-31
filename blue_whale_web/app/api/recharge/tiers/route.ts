import { createTopupTierDeps } from "@/lib/topup-tier/deps";

/**
 * GET /api/recharge/tiers — 用户端充值档位列表
 *
 * 数据源：blue_whale DB topup_tiers（仅 active + 时间窗口内）。
 * 响应沿用 { code, msg, data: { tiers } } 信封，与前端 apiRequest 对齐。
 */
export async function GET() {
  try {
    const { db } = createTopupTierDeps();
    const rows = await db.listActive();
    const tiers = rows.map((t) => ({
      id: t.id,
      name: t.name,
      amount: t.amount,
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
