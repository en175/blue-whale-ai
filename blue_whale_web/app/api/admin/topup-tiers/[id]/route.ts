import { createTopupTierDeps } from "@/lib/topup-tier/deps";

type Params = { params: Promise<{ id: string }> };

// PUT /api/admin/topup-tiers/:id → 更新档位
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      amount,
      originalPrice,
      discount,
      name,
      isRecommended,
      status,
      startTime,
      endTime,
    } = body;

    if (discount !== undefined && (discount <= 0 || discount > 1)) {
      return Response.json(
        { success: false, error: "折扣比例须在 (0, 1] 之间" },
        { status: 400 },
      );
    }

    const { db } = createTopupTierDeps();
    const tier = await db.update(id, {
      ...(amount !== undefined && { amount: Number(amount) }),
      ...(originalPrice !== undefined && {
        originalPrice: Number(originalPrice),
      }),
      ...(discount !== undefined && { discount: Number(discount) }),
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
    return Response.json({ success: true, data: tier });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

// DELETE /api/admin/topup-tiers/:id → 删除档位（逻辑删）
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { db } = createTopupTierDeps();
    const ok = await db.remove(id);
    if (!ok) {
      return Response.json(
        { success: false, error: "档位不存在" },
        { status: 404 },
      );
    }
    return Response.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
