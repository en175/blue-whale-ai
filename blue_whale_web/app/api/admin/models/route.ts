import { createModelCapabilityAdminDeps } from "@/lib/model-capability/deps";
import { withAdminUser } from "@/lib/auth/product-route-auth";

// GET /api/admin/models → 管理端列出全部未软删模型（含停用），供三类型 tab 列表展示。
async function handleListModels() {
  try {
    const { db } = createModelCapabilityAdminDeps();
    const models = await db.listAll();
    return Response.json({ success: true, data: models });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return withAdminUser(request, () => handleListModels());
}
