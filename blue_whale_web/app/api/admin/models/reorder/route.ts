import type { AuthenticatedUser } from "@/lib/auth/authenticated-user";
import { withAdminUser } from "@/lib/auth/product-route-auth";
import { createModelCapabilityAdminDeps } from "@/lib/model-capability/deps";
import { logModelReorder } from "@/lib/model-capability/operation-log";

// PUT /api/admin/models/reorder → 批量排序（调整 sort_order）。
// body: { items: [{ id, sortOrder }] }；审计 target=首个变更行 model_id，
// detail 列出全部 sort_order 变更。列表按 sort_order 序展示。
async function handleReorderModels(request: Request, user: AuthenticatedUser) {
  let body: { items?: { id: string; sortOrder: number }[] };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: "请求体须为合法 JSON" },
      { status: 400 },
    );
  }
  const { items } = body ?? {};

  if (!Array.isArray(items) || items.length === 0) {
    return Response.json(
      { success: false, error: "缺少排序数据" },
      { status: 400 },
    );
  }
  const invalid = items.find(
    (i) =>
      typeof i.id !== "string" ||
      !/^\d{1,19}$/.test(i.id) ||
      !Number.isInteger(i.sortOrder) ||
      i.sortOrder < 0 ||
      i.sortOrder > 2147483647, // sort_order 为 MySQL Int，越界会 500
  );
  if (invalid) {
    return Response.json(
      {
        success: false,
        error: "排序项 id 须为正整数、sortOrder 须为非负整数（≤2147483647）",
      },
      { status: 400 },
    );
  }

  const { db } = createModelCapabilityAdminDeps();
  // 审计 detail 需要 id → model_id 映射；listAll 一次取回即可。
  const all = await db.listAll();
  const modelIdByRowId = new Map(all.map((m) => [m.id, m.model_id]));
  const result = await db.updateSortOrder(items);
  if (!result.ok) {
    return Response.json(
      { success: false, error: `模型不存在或已删除: ${result.missingId}` },
      { status: 404 },
    );
  }

  try {
    // best-effort 审计（服务端写入，失败不阻断）。
    try {
      await logModelReorder(
        items.map((i) => ({
          id: i.id,
          model_id: modelIdByRowId.get(i.id) ?? i.id,
          sortOrder: i.sortOrder,
        })),
        user.username,
      );
    } catch (auditErr) {
      console.error("[model-capability] 审计写入失败（排序已更新）", auditErr);
    }
    return Response.json({ success: true, data: await db.listAll() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  return withAdminUser(request, (user) => handleReorderModels(request, user));
}
