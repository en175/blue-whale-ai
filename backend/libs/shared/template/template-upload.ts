import type { AssetUploadStorage } from "@lib/shared/assets/upload.js";
import type { TemplateAuditService } from "./template-audit.service.js";

export const TEMPLATE_UPLOAD_KEY_PREFIX = "admin/templates";

export type TemplateUploadType = "image" | "video";

type TemplateUploadRule = {
  maxBytes: number;
  mimes: readonly string[];
  sizeHint: string;
};

export const TEMPLATE_UPLOAD_RULES: Record<
  TemplateUploadType,
  TemplateUploadRule
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

export type PresignTemplateUploadInput = {
  type: unknown;
  mime: unknown;
  size: unknown;
};

export type CompleteTemplateUploadInput = PresignTemplateUploadInput & {
  storage_key: unknown;
};

export type TemplateUploadResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type Validated =
  | { ok: true; type: TemplateUploadType; mime: string; size: number }
  | { ok: false; error: string };

function validateUploadInput(input: PresignTemplateUploadInput): Validated {
  const type =
    input.type === "image" || input.type === "video" ? input.type : null;
  if (!type) {
    return { ok: false, error: "仅支持图片或视频上传" };
  }
  const rule = TEMPLATE_UPLOAD_RULES[type];
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

export async function handlePresignTemplateUpload(
  input: PresignTemplateUploadInput,
  storage: AssetUploadStorage | null,
): Promise<
  TemplateUploadResult<{
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
    userId: "template-admin",
    type: valid.type,
    mime: valid.mime,
    keyPrefix: TEMPLATE_UPLOAD_KEY_PREFIX,
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

export async function handleCompleteTemplateUpload(
  input: CompleteTemplateUploadInput,
  deps: { storage: AssetUploadStorage | null; audit: TemplateAuditService },
): Promise<TemplateUploadResult<{ url: string }>> {
  const valid = validateUploadInput(input);
  if (!valid.ok) return valid;
  if (typeof input.storage_key !== "string" || input.storage_key === "") {
    return { ok: false, error: "缺少存储键" };
  }
  const expectedPrefix = `${TEMPLATE_UPLOAD_KEY_PREFIX}/${valid.type}/`;
  if (!input.storage_key.startsWith(expectedPrefix)) {
    return { ok: false, error: "存储键与模板媒体前缀不匹配" };
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
