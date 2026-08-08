/**
 * 模板管理入参校验（IK764F）。纯函数，路由与单测共用。
 *
 * layout 限定四种渲染形态（与前端 TemplateCardItem 渲染分支一一对应）；
 * URL 本期不校验格式（grilling 共识 Q9：后续 TOS 上传工单再收紧）。
 */
import type { TemplateCardInput } from "@blue-whale/persistence";

export const TEMPLATE_LAYOUTS = [
  "wide",
  "portrait",
  "social",
  "image",
] as const;
export type TemplateLayoutValue = (typeof TEMPLATE_LAYOUTS)[number];

const TITLE_MAX = 255;
const URL_MAX = 512;
const CONTENT_MAX = 20_000;
const IMAGES_MAX = 20;
/** sort_order 为 DB INTEGER（32 位），上界防穿透落库报 range 错 */
const SORT_ORDER_MAX = 2_147_483_647;

const POSITIVE_INT_RE = /^[1-9]\d*$/;

export interface TemplateCardForm {
  title?: unknown;
  tag_code?: unknown;
  layout?: unknown;
  sort_order?: unknown;
  video_url?: unknown;
  content?: unknown;
  images?: unknown;
}

export type ParseResult =
  { ok: true; input: TemplateCardInput } | { ok: false; error: string };

function parseOptionalUrl(
  value: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: `${field} 须为字符串` };
  }
  if (value.length > URL_MAX) {
    return { ok: false, error: `${field} 长度不得超过 ${URL_MAX}` };
  }
  return { ok: true, value };
}

/** 解析并校验新建/编辑卡片入参；validTagCodes 为当前有效 tag 集合。 */
export function parseTemplateCardForm(
  form: TemplateCardForm,
  validTagCodes: ReadonlySet<string>,
): ParseResult {
  const title = form.title;
  if (typeof title !== "string" || title.trim() === "") {
    return { ok: false, error: "标题必填" };
  }
  if (title.length > TITLE_MAX) {
    return { ok: false, error: `标题长度不得超过 ${TITLE_MAX}` };
  }

  const tagCode = form.tag_code;
  if (typeof tagCode !== "string" || !validTagCodes.has(tagCode)) {
    return { ok: false, error: "标签无效" };
  }

  const layout = form.layout;
  if (
    typeof layout !== "string" ||
    !TEMPLATE_LAYOUTS.includes(layout as TemplateLayoutValue)
  ) {
    return { ok: false, error: "layout 仅支持 wide/portrait/social/image" };
  }

  const sortOrder = form.sort_order;
  const sortOrderNum =
    typeof sortOrder === "number" ? sortOrder : Number(sortOrder ?? "");
  if (
    !Number.isInteger(sortOrderNum) ||
    sortOrderNum < 0 ||
    sortOrderNum > SORT_ORDER_MAX
  ) {
    return { ok: false, error: "sort_order 须为非负整数" };
  }

  const video = parseOptionalUrl(form.video_url, "video_url");
  if (!video.ok) return video;

  const content = form.content;
  if (
    content !== undefined &&
    content !== null &&
    typeof content !== "string"
  ) {
    return { ok: false, error: "content 须为字符串" };
  }
  if (typeof content === "string" && content.length > CONTENT_MAX) {
    return { ok: false, error: `content 长度不得超过 ${CONTENT_MAX}` };
  }

  const rawImages = form.images ?? [];
  if (!Array.isArray(rawImages)) {
    return { ok: false, error: "images 须为数组" };
  }
  if (rawImages.length > IMAGES_MAX) {
    return { ok: false, error: `图片数量不得超过 ${IMAGES_MAX}` };
  }
  const images: TemplateCardInput["images"] = [];
  const seenIds = new Set<string>();
  for (const [i, img] of rawImages.entries()) {
    if (typeof img !== "object" || img === null) {
      return { ok: false, error: `第 ${i + 1} 张图片格式错误` };
    }
    const { id, image_url } = img as { id?: unknown; image_url?: unknown };
    if (typeof image_url !== "string" || image_url.trim() === "") {
      return { ok: false, error: `第 ${i + 1} 张图片 URL 必填` };
    }
    if (image_url.length > URL_MAX) {
      return { ok: false, error: `第 ${i + 1} 张图片 URL 过长` };
    }
    if (id !== undefined) {
      if (typeof id !== "string" || !POSITIVE_INT_RE.test(id)) {
        return { ok: false, error: `第 ${i + 1} 张图片 id 无效` };
      }
      if (seenIds.has(id)) {
        return { ok: false, error: `图片 id ${id} 重复` };
      }
      seenIds.add(id);
      images.push({ id, image_url });
    } else {
      images.push({ image_url });
    }
  }

  return {
    ok: true,
    input: {
      tag_code: tagCode,
      title: title.trim(),
      content: typeof content === "string" ? content : null,
      video_url: video.value,
      layout,
      sort_order: sortOrderNum,
      images,
    },
  };
}

/** 解析大整数路径/入参 id；非法 → null。 */
export function parseBigId(value: unknown): bigint | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (!POSITIVE_INT_RE.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

/** 解析调序方向；非法 → null。 */
export function parseMoveDirection(value: unknown): "up" | "down" | null {
  return value === "up" || value === "down" ? value : null;
}
