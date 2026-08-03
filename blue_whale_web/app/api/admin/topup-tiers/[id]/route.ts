import {
  deriveTierAmount,
  parseTierDiscount,
  parseTierOriginalPrice,
} from "@/lib/topup-tier/constants";
import { createTopupTierDeps } from "@/lib/topup-tier/deps";
import {
  removeTierDiscountFromGo,
  syncTierDiscountToGo,
} from "@/lib/topup-tier/go-amount-discount";
import { logTierDelete, logTierUpdate } from "@/lib/topup-tier/operation-log";
import { withAdminUser } from "@/lib/auth/product-route-auth";

type Params = { params: Promise<{ id: string }> };

// PUT /api/admin/topup-tiers/:id → 更新档位（部分更新）
// 原价为主输入且须为正整数；改价时到账积分随之服务端重派生（N × QuotaPerUnit），
// 客户端提交的 amount 一律不接受（积分是派生量，落库以原价为准）。
async function handleUpdateTopupTier(request: Request, { params }: Params) {
  try {
    const { id } = await params;
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

    let price: number | null = null;
    if (originalPrice !== undefined) {
      price = parseTierOriginalPrice(originalPrice);
      if (price === null) {
        return Response.json(
          { success: false, error: "原价须为正整数（元）" },
          { status: 400 },
        );
      }
    }
    let discountNum: number | undefined;
    if (discount !== undefined) {
      discountNum = parseTierDiscount(discount) ?? undefined;
      if (discountNum === undefined) {
        return Response.json(
          { success: false, error: "折扣比例须在 (0, 1] 之间" },
          { status: 400 },
        );
      }
    }

    const { db } = createTopupTierDeps();
    const before = await db.getById(id); // 取旧原价，供折扣 key 迁移
    if (!before) {
      return Response.json(
        { success: false, error: "档位不存在" },
        { status: 404 },
      );
    }
    // 原价唯一：改价不得撞上其他档位（amount_discount 按整数原价做 key）。
    // 未提交原价（只改折扣等）不校验，存量碰撞不阻断。
    if (price !== null) {
      const all = await db.listAll();
      const clash = all.find(
        (t) => t.id !== id && Math.round(t.originalPrice) === price,
      );
      if (clash) {
        return Response.json(
          {
            success: false,
            error: `每个原价只能有一个档位：已存在原价 ¥${price} 的档位`,
          },
          { status: 409 },
        );
      }
    }
    const tier = await db.update(id, {
      // 改价时积分随之重派生（派生量不接受客户端直改）
      ...(price !== null && {
        originalPrice: price,
        amount: deriveTierAmount(price),
      }),
      ...(discountNum !== undefined && { discount: discountNum }),
      ...(name !== undefined && { name }),
      ...(isRecommended !== undefined && { isRecommended: !!isRecommended }),
      ...(status !== undefined && {
        status: status === "inactive" ? "inactive" : "active",
      }),
      ...(startTime !== undefined && { startTime: startTime || null }),
      ...(endTime !== undefined && { endTime: endTime || null }),
    });

    if (!tier) {
      return Response.json(
        { success: false, error: "档位不存在" },
        { status: 404 },
      );
    }
    // best-effort 折扣同步：原价变更先删旧 N 的 key，再 set 新档位的折扣。
    // 失败只记录、不阻断更新（档位已落 web 库；凭证未配置时内部 no-op），
    // 但会在响应里带 warning 提示管理员核对（web 库与 Go 折扣表可能已漂移）。
    let warning: string | undefined;
    try {
      if (Math.round(before.originalPrice) !== Math.round(tier.originalPrice)) {
        await removeTierDiscountFromGo(before.originalPrice);
      }
      await syncTierDiscountToGo(tier.originalPrice, tier.discount);
    } catch (syncErr) {
      console.error("[topup-tiers] 折扣同步到 Go 失败（档位已更新）", syncErr);
      warning =
        "折扣同步到 Go 失败（档位已保存），请到 Go 后台核对金额折扣，或重新保存本档位重试";
    }
    // best-effort 审计（服务端写入，失败不阻断）。
    try {
      await logTierUpdate(before, tier);
    } catch (auditErr) {
      console.error("[topup-tiers] 审计写入失败（档位已更新）", auditErr);
    }
    return Response.json({
      success: true,
      data: tier,
      ...(warning && { warning }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

// DELETE /api/admin/topup-tiers/:id → 删除档位（逻辑删）
async function handleDeleteTopupTier(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db } = createTopupTierDeps();
    const before = await db.getById(id); // 删除前取原价，供移除折扣 key
    const ok = await db.remove(id);
    if (!ok) {
      return Response.json(
        { success: false, error: "档位不存在" },
        { status: 404 },
      );
    }
    // best-effort：删档后移除对应 N 的折扣 key（失败只记录、不阻断删除）。
    let warning: string | undefined;
    if (before) {
      try {
        await removeTierDiscountFromGo(before.originalPrice);
      } catch (syncErr) {
        console.error(
          "[topup-tiers] 折扣同步到 Go 失败（档位已删除）",
          syncErr,
        );
        warning = "折扣同步到 Go 失败（档位已删除），请到 Go 后台核对金额折扣";
      }
      // best-effort 审计（服务端写入，失败不阻断）。
      try {
        await logTierDelete(before);
      } catch (auditErr) {
        console.error("[topup-tiers] 审计写入失败（档位已删除）", auditErr);
      }
    }
    return Response.json({ success: true, ...(warning && { warning }) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function PUT(request: Request, context: Params) {
  return withAdminUser(request, () => handleUpdateTopupTier(request, context));
}

export async function DELETE(request: Request, context: Params) {
  return withAdminUser(request, () => handleDeleteTopupTier(request, context));
}
