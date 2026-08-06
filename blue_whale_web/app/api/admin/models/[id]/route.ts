import type { AuthenticatedUser } from "@/lib/auth/authenticated-user";
import { withAdminUser } from "@/lib/auth/product-route-auth";
import { parseModelUpdateBody } from "@/lib/model-capability/constants";
import { createModelCapabilityAdminDeps } from "@/lib/model-capability/deps";
import {
  logModelDelete,
  logModelUpdate,
} from "@/lib/model-capability/operation-log";

type Params = { params: Promise<{ id: string }> };

// PUT /api/admin/models/:id → 更新模型（部分更新）。
// 身份字段（provider_id/model_id/capability_type）创建后不可改，payload 只含可编辑字段；
// 能力 JSON 列整份替换（编辑弹窗原始 JSON 回写）。id 不存在或已软删 → 404。
async function handleUpdateModel(
  request: Request,
  { params }: Params,
  user: AuthenticatedUser,
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = parseModelUpdateBody(body);
    if (!parsed.ok) {
      return Response.json(
        { success: false, error: parsed.error },
        { status: 400 },
      );
    }

    const { db } = createModelCapabilityAdminDeps();
    const before = await db.getById(id); // 审计 diff 需要改前快照
    if (!before) {
      return Response.json(
        { success: false, error: "模型不存在" },
        { status: 404 },
      );
    }
    const after = await db.update(id, parsed.value);
    if (!after) {
      return Response.json(
        { success: false, error: "模型不存在" },
        { status: 404 },
      );
    }
    // best-effort 审计（服务端写入，失败不阻断）。
    try {
      await logModelUpdate(before, after, user.username);
    } catch (auditErr) {
      console.error("[model-capability] 审计写入失败（模型已更新）", auditErr);
    }
    return Response.json({ success: true, data: after });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function PUT(request: Request, context: Params) {
  return withAdminUser(request, (user) =>
    handleUpdateModel(request, context, user),
  );
}

// DELETE /api/admin/models/:id → 软删除（is_delete=true，行数据保留）。
// 软删后 admin 列表与 dock 展示列表均不再出现（读取查询已过滤 is_delete=false）。
// 不存在或已软删 → 404。
async function handleDeleteModel({ params }: Params, user: AuthenticatedUser) {
  try {
    const { id } = await params;
    const { db } = createModelCapabilityAdminDeps();
    const before = await db.getById(id); // 审计需要删除前快照
    const ok = await db.remove(id);
    if (!ok) {
      return Response.json(
        { success: false, error: "模型不存在" },
        { status: 404 },
      );
    }
    // best-effort 审计（服务端写入，失败不阻断）。
    if (before) {
      try {
        await logModelDelete(before, user.username);
      } catch (auditErr) {
        console.error(
          "[model-capability] 审计写入失败（模型已删除）",
          auditErr,
        );
      }
    }
    return Response.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: Params) {
  return withAdminUser(request, (user) => handleDeleteModel(context, user));
}
