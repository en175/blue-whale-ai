import { createTopupTierDeps } from "@/lib/topup-tier/deps";

// GET /api/admin/topup-tiers → 管理端列出全部档位（含停用）
export async function GET() {
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
export async function POST(request: Request) {
  try {
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

    if (!amount || amount <= 0) {
      return Response.json(
        { success: false, error: "积分数必须大于 0" },
        { status: 400 },
      );
    }
    if (!originalPrice || originalPrice <= 0) {
      return Response.json(
        { success: false, error: "原价必须大于 0" },
        { status: 400 },
      );
    }
    if (discount === undefined || discount <= 0 || discount > 1) {
      return Response.json(
        { success: false, error: "折扣比例须在 (0, 1] 之间" },
        { status: 400 },
      );
    }

    const { db } = createTopupTierDeps();
    const tier = await db.create({
      amount: Number(amount),
      originalPrice: Number(originalPrice),
      discount: Number(discount),
      name: name || undefined,
      isRecommended: !!isRecommended,
      status: status === "inactive" ? "inactive" : "active",
      startTime: startTime || null,
      endTime: endTime || null,
    });
    return Response.json({ success: true, data: tier }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
