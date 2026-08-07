import { createTopupTierDeps } from "@/lib/topup-tier/deps";
import { syncAllTierDiscountsToGo } from "@/lib/topup-tier/go-amount-discount";
import { withAdminUser } from "@/lib/auth/product-route-auth";

/**
 * PUT /api/admin/topup-tiers/sync — 全量补同步档位折扣到 Go（IK75PR）
 *
 * 用途：把当前全部 active 档位的折扣统一写进 Go `payment_setting.amount_discount`，
 * 补齐存量/手工/批量导入档位漏同步的 key（如 original_price=4 的 0.02 折扣）。
 *
 * 语义：对每个 active 档位（原价 N、折扣 d）写 AmountDiscount[round(N)] = d，
 * 复用 syncAllTierDiscountsToGo（读整表 → 覆盖 key → 写回，串行队列防 RMW 竞争）。
 * 保留 Go 表里非 web 档位的 key；无 active 档位 → 返回 0。
 *
 * 鉴权：管理端 withAdminUser（fresh 实时校验），非管理身份 403。
 */
async function handleSyncTiersToGo() {
  const { db } = createTopupTierDeps();
  const tiers = await db.listActive();
  const synced = await syncAllTierDiscountsToGo(
    tiers.map((t) => ({ originalPrice: t.originalPrice, discount: t.discount })),
  );
  return Response.json({
    success: true,
    data: { synced, total: tiers.length },
  });
}

export async function PUT(request: Request) {
  return withAdminUser(request, () => handleSyncTiersToGo());
}
