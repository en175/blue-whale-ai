import { withAdminUser } from "@/lib/auth/product-route-auth";
import { listTemplateTags } from "@/lib/templates/template-tags";
import { createTemplateAdminDeps } from "@/lib/template-admin/deps";
import { logTemplateCreate } from "@/lib/template-admin/operation-log";
import { parseTemplateCardForm } from "@/lib/template-admin/validation";

/**
 * /api/admin/templates —— 首页模板卡片管理（IK764F）
 *
 * GET  ?tagCode= 列出卡片（含图片，按 tag + sort_order 排序；tagCode 可选过滤）
 * POST           新建卡片（title/tag/layout/sort_order/video_url/content/images）
 */

async function handleList(request: Request) {
  try {
    const tagCode = new URL(request.url).searchParams.get("tagCode") ?? "";
    const { admin } = createTemplateAdminDeps();
    const cards = await admin.listCards(tagCode || undefined);
    return Response.json({ success: true, data: cards });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

async function handleCreate(request: Request) {
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

    const id = await admin.createCard(parsed.input);
    await logTemplateCreate(parsed.input.title, parsed.input.tag_code);
    return Response.json({ success: true, data: { id } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return withAdminUser(request, () => handleList(request));
}

export async function POST(request: Request) {
  return withAdminUser(request, () => handleCreate(request));
}
