import type { TemplateCardInput } from "@lib/shared/persistence/index.js";

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
  is_featured?: unknown;
}

export type TemplateParseResult =
  | { ok: true; input: TemplateCardInput }
  | { ok: false; error: string };

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

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
  if (!isHttpUrl(value)) {
    return { ok: false, error: `${field} 须为 http(s):// 开头的 URL` };
  }
  return { ok: true, value };
}

export function parseTemplateCardForm(
  form: TemplateCardForm,
  validTagCodes: ReadonlySet<string>,
): TemplateParseResult {
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
    if (!isHttpUrl(image_url)) {
      return {
        ok: false,
        error: `第 ${i + 1} 张图片 URL 须为 http(s):// 开头`,
      };
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

  const featuredRaw = form.is_featured;
  let isFeatured = 0;
  if (featuredRaw !== undefined && featuredRaw !== null) {
    if (featuredRaw === true || featuredRaw === 1 || featuredRaw === "1") {
      isFeatured = 1;
    } else if (featuredRaw === false || featuredRaw === 0 || featuredRaw === "0") {
      isFeatured = 0;
    } else {
      return { ok: false, error: "is_featured 仅支持 true/false 或 0/1" };
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
      is_featured: isFeatured,
      images,
    },
  };
}

export function parseBigId(value: unknown): bigint | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (!POSITIVE_INT_RE.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

export function parseMoveDirection(value: unknown): "up" | "down" | null {
  return value === "up" || value === "down" ? value : null;
}

export interface TemplateTag {
  tag_code: string;
  label: string;
  sort_order: number;
  visible: 0 | 1;
}

const TEMPLATE_TAGS: readonly TemplateTag[] = [
  { tag_code: "marketing", label: "营销视频", sort_order: 0, visible: 0 },
  { tag_code: "short", label: "微短片", sort_order: 1, visible: 0 },
  { tag_code: "replicate", label: "视频复刻", sort_order: 2, visible: 0 },
  { tag_code: "social", label: "社媒视频", sort_order: 3, visible: 0 },
  { tag_code: "image", label: "图片设计", sort_order: 4, visible: 0 },
  { tag_code: "video", label: "视频", sort_order: 5, visible: 1 },
  { tag_code: "picture", label: "图片", sort_order: 6, visible: 1 },
];

export function isValidTagCode(tagCode: string): boolean {
  return TEMPLATE_TAGS.some((t) => t.tag_code === tagCode);
}

export function listTemplateTags(): { tag_code: string; label: string }[] {
  return [...TEMPLATE_TAGS]
    .filter((t) => t.visible === 1)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(({ tag_code, label }) => ({ tag_code, label }));
}

export function listAllTemplateTags(): {
  tag_code: string;
  label: string;
  visible: number;
}[] {
  return [...TEMPLATE_TAGS]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(({ tag_code, label, visible }) => ({ tag_code, label, visible }));
}
