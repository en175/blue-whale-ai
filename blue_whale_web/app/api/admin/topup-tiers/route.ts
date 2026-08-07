import {
  deriveTierAmount,
  parseTierDiscount,
  parseTierOriginalPrice,
} from "@/lib/topup-tier/constants";
import { createTopupTierDeps } from "@/lib/topup-tier/deps";
import {
  syncAllTierDiscountsToGo,
  syncTierDiscountToGo,
} from "@/lib/topup-tier/go-amount-discount";
import { logTierCreate } from "@/lib/topup-tier/operation-log";
import { withAdminUser } from "@/lib/auth/product-route-auth";

// GET /api/admin/topup-tiers → 管理端列出全部档位（含停用）
async function handleListTopupTiers() {
  try {
    const { db } = createTopupTierDeps();
    const tiers = await db.listAll();
    return Response.json({ success: true, data: tiers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST /api/admin/topup-tiers → 新建档位
// 原价为主输入且须为正整数（N = 美元额度，Go int64，amount_discount 按整数 N 做 key）；
// 到账积分是派生量（N × QuotaPerUnit），服务端派生落库，不接受客户端值。
async function handleCreateTopupTier(request: Request) {
  try {
    const body = await request.json();
    const {
      originalPrice,
      discount,
      name,
      isRecommended,
      status,
      startTime,
      endTime,
    } = body;

    const price = parseTierOriginalPrice(originalPrice);
    if (price === null) {
      return Response.json(
        { success: false, error: "原价须为正整数（元）" },
        { status: 400 },
      );
    }
    const discountNum = parseTierDiscount(discount);
    if (discountNum === null) {
      return Response.json(
        { success: false, error: "折扣比例须在 (0, 1] 之间" },
        { status: 400 },
      );
    }

    const { db } = createTopupTierDeps();
    // 原价唯一：amount_discount 按整数原价做 key，同原价档位的折扣必互相覆盖，
    // 故在源头拒绝（与上下架状态无关，比对全部未删除档位）。
    const existing = await db.listAll();
    const clash = existing.find((t) => Math.round(t.originalPrice) === price);
    if (clash) {
      return Response.json(
        {
          success: false,
          error: `每个原价只能有一个档位：已存在原价 ¥${price} 的档位`,
        },
        { status: 409 },
      );
    }
    const tier = await db.create({
      amount: deriveTierAmount(price), // 服务端派生，不信任客户端 amount
      originalPrice: price,
      discount: discountNum,
      name: name || undefined,
      isRecommended: !!isRecommended,
      status: status === "inactive" ? "inactive" : "active",
      startTime: startTime || null,
      endTime: endTime || null,
    });
    // best-effort：把逐档折扣同步到 Go payment_setting.amount_discount。
    // 失败只记录、不阻断建档（档位已落 web 库；凭证未配置时内部 no-op），
    // 但会在响应里带 warning 提示管理员核对（web 库与 Go 折扣表可能已漂移）。
    let warning: string | undefined;
    try {
      await syncTierDiscountToGo(price, discountNum);
    } catch (syncErr) {
      console.error("[topup-tiers] 折扣同步到 Go 失败（档位已创建）", syncErr);
      warning =
        "折扣同步到 Go 失败（档位已保存），请到 Go 后台核对金额折扣，或重新保存本档位重试";
    }
    // best-effort 审计（服务端写入，失败不阻断）。
    try {
      await logTierCreate(tier);
    } catch (auditErr) {
      console.error("[topup-tiers] 审计写入失败（档位已创建）", auditErr);
    }
    return Response.json(
      { success: true, data: tier, ...(warning && { warning }) },
      { status: 201 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return withAdminUser(request, () => handleListTopupTiers());
}

export async function POST(request: Request) {
  return withAdminUser(request, () => handleCreateTopupTier(request));
}
