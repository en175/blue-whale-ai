import type { AdminTemplateCardView } from "@blue-whale/persistence";
import { TemplateAdminInputError } from "@blue-whale/persistence";

import { withAdminUser } from "@/lib/auth/product-route-auth";
import { listTemplateTags } from "@/lib/templates/template-tags";
import { createTemplateAdminDeps } from "@/lib/template-admin/deps";
import {
  logTemplateDelete,
  logTemplateUpdate,
} from "@/lib/template-admin/operation-log";
import {
  parseBigId,
  parseTemplateCardForm,
} from "@/lib/template-admin/validation";

/**
 * /api/admin/templates/:id —— 单卡片编辑与软删除（IK764F）
 *
 * PUT    更新全部字段（图片按入参整体同步：保留/软删/新增）
 * DELETE 软删除（is_delete=1，首页立即不可见，数据可恢复）
 */

type RouteParams = { params: Promise<{ id: string }> };

/** 对比改前后视图，列出具体变更字段（用于审计 detail）。 */
function diffFields(
  before: AdminTemplateCardView,
  after: {
    title: string;
    tag_code: string;
    layout: string;
    sort_order: number;
    video_url: string | null;
    content: string | null;
    images: Array<{ id?: string; image_url: string }>;
  },
): string[] {
  const changed: string[] = [];
  if (before.title !== after.title) changed.push("标题");
  if (before.tag_code !== after.tag_code) changed.push("标签");
  if (before.layout !== after.layout) changed.push("layout");
  if (before.sort_order !== after.sort_order) changed.push("排序");
  if ((before.video_url ?? "") !== (after.video_url ?? "")) {
    changed.push("视频");
  }
  if ((before.content ?? "") !== (after.content ?? "")) {
    changed.push("提示词");
  }
  const beforeImgs = before.images.map((i) => i.image_url).join("|");
  const afterImgs = after.images.map((i) => i.image_url).join("|");
  if (beforeImgs !== afterImgs) changed.push("图片");
  return changed;
}

async function handleUpdate(request: Request, idRaw: string) {
  const id = parseBigId(idRaw);
  if (!id) {
    return Response.json({ success: false, error: "id 无效" }, { status: 400 });
  }

  let form: unknown;
  try {
    form = await request.json();
  } catch {
    return Response.json(
      { success: false, error: "请求体须为 JSON" },
      { status: 400 },
    );
  }

  try {
    const { admin, templates } = createTemplateAdminDeps();
    const before = await admin.getCard(id);
    if (!before) {
      return Response.json(
        { success: false, error: "卡片不存在" },
        { status: 404 },
      );
    }

    const tags = await templates.listTags();
    // tag 表意外为空（seed 被清）时兜底硬编码枚举，与首页读取侧兜底语义对齐。
    const validTagCodes = new Set(
      (tags.length > 0 ? tags : listTemplateTags()).map((t) => t.tag_code),
    );
    const parsed = parseTemplateCardForm(
      (form ?? {}) as Record<string, unknown>,
      validTagCodes,
    );
    if (!parsed.ok) {
      return Response.json(
        { success: false, error: parsed.error },
        { status: 400 },
      );
    }

    const updated = await admin.updateCard(id, parsed.input);
    if (!updated) {
      return Response.json(
        { success: false, error: "卡片不存在" },
        { status: 404 },
      );
    }
    await logTemplateUpdate(
      parsed.input.title,
      diffFields(before, parsed.input),
    );
    return Response.json({ success: true, data: { id: idRaw } });
  } catch (e) {
    if (e instanceof TemplateAdminInputError) {
      return Response.json(
        { success: false, error: e.message },
        { status: 400 },
      );
    }
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

async function handleDelete(idRaw: string) {
  const id = parseBigId(idRaw);
  if (!id) {
    return Response.json({ success: false, error: "id 无效" }, { status: 400 });
  }
  try {
    const { admin } = createTemplateAdminDeps();
    const before = await admin.getCard(id);
    if (!before) {
      return Response.json(
        { success: false, error: "卡片不存在" },
        { status: 404 },
      );
    }
    const deleted = await admin.softDeleteCard(id);
    if (!deleted) {
      return Response.json(
        { success: false, error: "卡片不存在" },
        { status: 404 },
      );
    }
    await logTemplateDelete(before.title);
    return Response.json({ success: true, data: { id: idRaw } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  return withAdminUser(request, async () => {
    const { id } = await params;
    return handleUpdate(request, id);
  });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return withAdminUser(request, async () => {
    const { id } = await params;
    return handleDelete(id);
  });
}
