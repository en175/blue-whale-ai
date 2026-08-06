import type { AuthenticatedUser } from "@/lib/auth/authenticated-user";
import { withAdminUser } from "@/lib/auth/product-route-auth";
import { parseModelCreateBody } from "@/lib/model-capability/constants";
import { createModelCapabilityAdminDeps } from "@/lib/model-capability/deps";
import { logModelCreate } from "@/lib/model-capability/operation-log";

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

// POST /api/admin/models → 新建模型。
// 复制式新建由前端预填（复制自某模型的整份能力 JSON），服务端不感知 copy_source，
// 只校验最终 payload 形状；同 (provider_id, model_id) 已存在（含软删）→ 409。
async function handleCreateModel(request: Request, user: AuthenticatedUser) {
  try {
    const body = await request.json();
    const parsed = parseModelCreateBody(body);
    if (!parsed.ok) {
      return Response.json(
        { success: false, error: parsed.error },
        { status: 400 },
      );
    }

    const { db } = createModelCapabilityAdminDeps();
    const result = await db.create(parsed.value);
    if (!result.ok) {
      const { provider_id, model_id } = parsed.value;
      return Response.json(
        {
          success: false,
          error: `同供应商模型已存在：${provider_id}/${model_id}（含已软删，不可复用）`,
        },
        { status: 409 },
      );
    }
    // best-effort 审计（服务端写入，失败不阻断）。
    try {
      await logModelCreate(result.row, user.username);
    } catch (auditErr) {
      console.error("[model-capability] 审计写入失败（模型已创建）", auditErr);
    }
    return Response.json({ success: true, data: result.row }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return withAdminUser(request, () => handleListModels());
}

export async function POST(request: Request) {
  return withAdminUser(request, (user) => handleCreateModel(request, user));
}
