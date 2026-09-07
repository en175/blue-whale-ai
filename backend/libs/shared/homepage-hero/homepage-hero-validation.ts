import type { CreateHomepageHeroInput } from "@lib/shared/persistence/index.js";

/**
 * 首页背景配置入参校验纯函数（IKCH05），对齐母工单 IKCH01 接口草稿：
 * - media_type ∈ {image, video}；media_url 可暂空（TOS 资源迁移中，先建条目后填地址）
 * - media_type=video 时 poster_url 必填（视频没封面不能保存）
 * - media_type=image 时 poster_url 可空（纯图背景）
 * - enabled ∈ {0,1}；sort_order 非负整数；URL 一律 http(s)://
 * - create 与 update 共用本函数：update 由控制器把现存条目与补丁字段合并成完整表单再校验，
 *   保证"视频必须有封面"跨字段规则在改动后仍成立。
 */

export const HOMEPAGE_HERO_MEDIA_TYPES = ["image", "video"] as const;
export type HomepageHeroMediaTypeValue = (typeof HOMEPAGE_HERO_MEDIA_TYPES)[number];

const URL_MAX = 512;
const SORT_ORDER_MAX = 2_147_483_647;
const POSITIVE_INT_RE = /^[1-9]\d*$/;

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** 可空 URL：undefined/null/"" → null；否则须为 http(s):// 且不超长。 */
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

export type HomepageHeroForm = {
  media_type?: unknown;
  media_url?: unknown;
  poster_url?: unknown;
  sort_order?: unknown;
  enabled?: unknown;
};

export type HomepageHeroParseResult =
  | { ok: true; input: CreateHomepageHeroInput }
  | { ok: false; error: string };

export function parseHomepageHeroForm(
  form: HomepageHeroForm,
): HomepageHeroParseResult {
  const mediaType = form.media_type;
  if (
    typeof mediaType !== "string" ||
    !HOMEPAGE_HERO_MEDIA_TYPES.includes(mediaType as HomepageHeroMediaTypeValue)
  ) {
    return { ok: false, error: "media_type 仅支持 image/video" };
  }

  const mediaUrl = parseOptionalUrl(form.media_url, "media_url");
  if (!mediaUrl.ok) return mediaUrl;

  const posterUrl = parseOptionalUrl(form.poster_url, "poster_url");
  if (!posterUrl.ok) return posterUrl;

  // 视频必须要有封面（media_type=video 时 poster_url 必填）
  if (mediaType === "video" && posterUrl.value === null) {
    return { ok: false, error: "视频背景必须配置 poster_url 封面" };
  }

  // sort_order 缺省省略：create 时由 repo 取 max+1，update 合并表单后必已携带
  let sortOrder: number | undefined;
  if (form.sort_order !== undefined) {
    const raw = form.sort_order;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > SORT_ORDER_MAX) {
      return { ok: false, error: "sort_order 须为非负整数" };
    }
    sortOrder = n;
  }

  const enabledRaw = form.enabled;
  let enabled: number | undefined;
  if (enabledRaw !== undefined) {
    // enabled 严格只认 0/1 数字：布尔 true 经 Number 会变成 1，属歧义输入，拒绝
    if (typeof enabledRaw !== "number" || (enabledRaw !== 0 && enabledRaw !== 1)) {
      return { ok: false, error: "enabled 仅支持 0/1" };
    }
    enabled = enabledRaw;
  }

  return {
    ok: true,
    input: {
      media_type: mediaType,
      // media_url 可暂空（TOS 迁移期）：空值落库为 ""，占位待填
      media_url: mediaUrl.value ?? "",
      poster_url: posterUrl.value,
      // 可选字段条件展开，避免 exactOptionalPropertyTypes 下显式 undefined
      ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
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
