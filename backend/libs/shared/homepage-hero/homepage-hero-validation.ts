import {
  isHomepageHeroScene,
  type CreateHomepageHeroInput,
  type HomepageHeroScene,
} from "@lib/shared/persistence/index.js";


export const HOMEPAGE_HERO_MEDIA_TYPES = ["image", "video"] as const;
export type HomepageHeroMediaTypeValue = (typeof HOMEPAGE_HERO_MEDIA_TYPES)[number];

const URL_MAX = 512;
const SORT_ORDER_MAX = 2_147_483_647;
const POSITIVE_INT_RE = /^[1-9]\d*$/;

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

export type HomepageHeroForm = {
  scene?: unknown;
  media_type?: unknown;
  media_url?: unknown;
  poster_url?: unknown;
  sort_order?: unknown;
  enabled?: unknown;
};

export type HomepageHeroParseResult =
  | { ok: true; input: CreateHomepageHeroInput }
  | { ok: false; error: string };

export const DEFAULT_HOMEPAGE_HERO_SCENE: HomepageHeroScene = "homepage";

export function parseHomepageHeroScene(value: unknown): HomepageHeroScene | null {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_HOMEPAGE_HERO_SCENE;
  }
  return isHomepageHeroScene(value) ? value : null;
}

export function parseHomepageHeroForm(
  form: HomepageHeroForm,
): HomepageHeroParseResult {
  const scene = parseHomepageHeroScene(form.scene);
  if (!scene) {
    return { ok: false, error: "scene 仅支持 homepage/auth" };
  }

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

  if (mediaType === "video" && posterUrl.value === null) {
    return { ok: false, error: "视频背景必须配置 poster_url 封面" };
  }

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
    if (typeof enabledRaw !== "number" || (enabledRaw !== 0 && enabledRaw !== 1)) {
      return { ok: false, error: "enabled 仅支持 0/1" };
    }
    enabled = enabledRaw;
  }

  return {
    ok: true,
    input: {
      scene,
      media_type: mediaType,
      media_url: mediaUrl.value ?? "",
      poster_url: posterUrl.value,
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
