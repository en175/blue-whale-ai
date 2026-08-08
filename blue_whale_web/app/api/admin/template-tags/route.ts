import { withAdminUser } from "@/lib/auth/product-route-auth";
import { createTemplateAdminDeps } from "@/lib/template-admin/deps";
import { logTagRename } from "@/lib/template-admin/operation-log";

/**
 * /api/admin/template-tags —— 首页模板标签（IK764F）
 *
 * GET 列出全部标签（tag_code/label，按 sort_order 升序；前端筛选条直接用）。
 * PUT 改名：仅 label 可改；tag_code 与顺序固定（grilling 共识 Q7）。
 *     body: { tag_code: string, label: string }
 */

const LABEL_MAX = 128;

async function handleList() {
  try {
    const { templates } = createTemplateAdminDeps();
    const tags = await templates.listTags();
    return Response.json({ success: true, data: tags });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

async function handleRename(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: "请求体须为 JSON" },
      { status: 400 },
    );
  }
  const { tag_code, label } = (body ?? {}) as {
    tag_code?: unknown;
    label?: unknown;
  };
  const tagCode = typeof tag_code === "string" ? tag_code.trim() : "";
  if (tagCode === "") {
    return Response.json(
      { success: false, error: "tag_code 必填" },
      { status: 400 },
    );
  }
  if (typeof label !== "string" || label.trim() === "") {
    return Response.json(
      { success: false, error: "标签名称必填" },
      { status: 400 },
    );
  }
  if (label.length > LABEL_MAX) {
    return Response.json(
      { success: false, error: `标签名称长度不得超过 ${LABEL_MAX}` },
      { status: 400 },
    );
  }

  try {
    const { admin, templates } = createTemplateAdminDeps();
    const before = await templates.listTags();
    const old = before.find((t) => t.tag_code === tagCode);
    if (!old) {
      return Response.json(
        { success: false, error: "标签不存在" },
        { status: 404 },
      );
    }
    const renamed = await admin.renameTag(tagCode, label.trim());
    if (!renamed) {
      return Response.json(
        { success: false, error: "标签不存在" },
        { status: 404 },
      );
    }
    await logTagRename(tagCode, old.label, label.trim());
    return Response.json({ success: true, data: { tag_code: tagCode } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return withAdminUser(request, () => handleList());
}

export async function PUT(request: Request) {
  return withAdminUser(request, () => handleRename(request));
}
