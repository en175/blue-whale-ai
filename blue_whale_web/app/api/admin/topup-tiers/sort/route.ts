import { createTopupTierDeps } from "@/lib/topup-tier/deps";

// PUT /api/admin/topup-tiers/sort → 批量排序
// body: { items: [{ id: "1", sortOrder: 1 }, ...] }
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { items } = body as { items?: { id: string; sortOrder: number }[] };

    if (!Array.isArray(items) || items.length === 0) {
      return Response.json(
        { success: false, error: "缺少排序数据" },
        { status: 400 },
      );
    }

    const { db } = createTopupTierDeps();
    await db.updateSortOrder(
      items.map((i) => ({ id: i.id, sortOrder: i.sortOrder })),
    );
    const tiers = await db.listAll();
    return Response.json({ success: true, data: tiers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
