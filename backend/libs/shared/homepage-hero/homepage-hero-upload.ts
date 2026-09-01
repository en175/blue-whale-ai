import type { AssetUploadStorage } from "@lib/shared/assets/upload.js";
import type { HomepageHeroAuditService } from "./homepage-hero-audit.service.js";

/**
 * 首页背景媒体上传（IKCH05）：presign → TOS 直传 → complete 校验 size/mime + makePublic。
 * 规则对齐模板管理（admin/templates）：图 jpeg/png/webp/gif ≤20MB；视频 mp4 ≤200MB；
 * 仅 keyPrefix 差异（admin/site-config）。复用 AssetUploadStorage，不新建 TOS client，
 * 前端不接触 AccessKey。
 */
export const HOMEPAGE_HERO_UPLOAD_KEY_PREFIX = "admin/site-config";

export type HomepageHeroUploadType = "image" | "video";

type HomepageHeroUploadRule = {
  maxBytes: number;
  mimes: readonly string[];
  sizeHint: string;
};

export const HOMEPAGE_HERO_UPLOAD_RULES: Record<
  HomepageHeroUploadType,
  HomepageHeroUploadRule
> = {
  image: {
    maxBytes: 20 * 1024 * 1024,
    mimes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    sizeHint: "20MB",
  },
  video: {
    maxBytes: 200 * 1024 * 1024,
    mimes: ["video/mp4"],
    sizeHint: "200MB",
  },
};

export type PresignHomepageHeroUploadInput = {
  type: unknown;
  mime: unknown;
  size: unknown;
};

export type CompleteHomepageHeroUploadInput = PresignHomepageHeroUploadInput & {
  storage_key: unknown;
};

export type HomepageHeroUploadResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type Validated =
  | { ok: true; type: HomepageHeroUploadType; mime: string; size: number }
  | { ok: false; error: string };

function validateUploadInput(
  input: PresignHomepageHeroUploadInput,
): Validated {
  const type =
    input.type === "image" || input.type === "video" ? input.type : null;
  if (!type) {
    return { ok: false, error: "仅支持图片或视频上传" };
  }
  const rule = HOMEPAGE_HERO_UPLOAD_RULES[type];
  const mime =
    typeof input.mime === "string" ? input.mime.trim().toLowerCase() : "";
  if (!rule.mimes.includes(mime)) {
    return {
      ok: false,
      error:
        type === "image"
          ? "仅支持 jpg/jpeg/png/webp/gif 图片"
          : "仅支持 mp4 视频",
    };
  }
  if (
    typeof input.size !== "number" ||
    !Number.isInteger(input.size) ||
    input.size <= 0 ||
    input.size > rule.maxBytes
  ) {
    return { ok: false, error: `文件大小无效或超过 ${rule.sizeHint}` };
  }
  return { ok: true, type, mime, size: input.size };
}

export async function handlePresignHomepageHeroUpload(
  input: PresignHomepageHeroUploadInput,
  storage: AssetUploadStorage | null,
): Promise<
  HomepageHeroUploadResult<{
    storage_key: string;
    upload_url: string;
    headers: Record<string, string>;
    expires_in: number;
  }>
> {
  const valid = validateUploadInput(input);
  if (!valid.ok) return valid;
  if (!storage) return { ok: false, error: "对象存储未配置" };

  const prepared = await storage.prepareUpload({
    userId: "site-config-admin",
    type: valid.type,
    mime: valid.mime,
    keyPrefix: HOMEPAGE_HERO_UPLOAD_KEY_PREFIX,
  });
  return {
    ok: true,
    data: {
      storage_key: prepared.storageKey,
      upload_url: prepared.uploadUrl,
      headers: prepared.headers,
      expires_in: prepared.expiresIn,
    },
  };
}

export async function handleCompleteHomepageHeroUpload(
  input: CompleteHomepageHeroUploadInput,
  deps: { storage: AssetUploadStorage | null; audit: HomepageHeroAuditService },
): Promise<HomepageHeroUploadResult<{ url: string }>> {
  const valid = validateUploadInput(input);
  if (!valid.ok) return valid;
  if (typeof input.storage_key !== "string" || input.storage_key === "") {
    return { ok: false, error: "缺少存储键" };
  }
  const expectedPrefix = `${HOMEPAGE_HERO_UPLOAD_KEY_PREFIX}/${valid.type}/`;
  if (!input.storage_key.startsWith(expectedPrefix)) {
    return { ok: false, error: "存储键与站点配置媒体前缀不匹配" };
  }
  if (!deps.storage) return { ok: false, error: "对象存储未配置" };

  const object = await deps.storage.inspectObject(input.storage_key);
  if (!object) return { ok: false, error: "上传对象不存在" };
  if (object.size !== valid.size) {
    return { ok: false, error: "文件大小与实际上传不符" };
  }
  const objectMime = object.mime?.split(";", 1)[0]?.trim().toLowerCase();
  if (objectMime !== valid.mime) {
    return { ok: false, error: "文件类型与实际上传不符" };
  }

  await deps.storage.makePublic(input.storage_key);
  await deps.audit.logUpload({
    type: valid.type,
    mime: valid.mime,
    size: valid.size,
    storageKey: input.storage_key,
    url: object.publicUrl,
  });
  return { ok: true, data: { url: object.publicUrl } };
}
