import type { AuthenticatedUser } from "@/lib/auth/authenticated-user";
import { withAdminUser } from "@/lib/auth/product-route-auth";
import { createModelCapabilityAdminDeps } from "@/lib/model-capability/deps";
import { logModelToggle } from "@/lib/model-capability/operation-log";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/admin/models/:id/toggle → 启停切换（翻转 enabled）。
// 停用后 dock 与展示列表不再出现该模型（消费端 /api/generation/models 过滤 enabled）。404 不存在/已软删。
async function handleToggleModel({ params }: Params, user: AuthenticatedUser) {
  try {
    const { id } = await params;
    const { db } = createModelCapabilityAdminDeps();
    const after = await db.toggleEnabled(id);
    if (!after) {
      return Response.json(
        { success: false, error: "模型不存在" },
        { status: 404 },
      );
    }
    // best-effort 审计（服务端写入，失败不阻断）。
    try {
      await logModelToggle(after, user.username);
    } catch (auditErr) {
      console.error("[model-capability] 审计写入失败（模型已切换）", auditErr);
    }
    return Response.json({ success: true, data: after });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: Params) {
  return withAdminUser(request, (user) => handleToggleModel(context, user));
}
