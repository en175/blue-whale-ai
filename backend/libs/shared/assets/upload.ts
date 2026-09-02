import { fail, ok } from "@blue-whale/contracts";
import type { AssetService } from "./assets.service.js";
import type { ProjectService } from "@lib/shared/project/project.service.js";

export type PresignAssetInput = {
  type: "image" | "video" | "audio";
  mime: string;
  size: number;
};

export type CompleteAssetInput = PresignAssetInput & {
  project_id?: string;
  storage_key: string;
  width?: number;
  height?: number;
  duration?: number;
  /** IKCNLS：落库时写入 md5，供去重查询。 */
  md5?: string;
};

/** IKCNLS：上传 md5 去重输入（presign 前判断）。 */
export type DedupAssetInput = {
  type: "image" | "video" | "audio";
  mime: string;
  size: number;
  md5: string;
  project_id?: string;
};

export interface AssetUploadStorage {
  prepareUpload(input: {
    userId: string;
    type: "image" | "video" | "audio";
    mime: string;
    keyPrefix?: string;
  }): Promise<{
    storageKey: string;
    publicUrl: string;
    uploadUrl: string;
    headers: Record<string, string>;
    expiresIn: number;
  }>;
  inspectObject(storageKey: string): Promise<{
    size: number;
    mime: string | null;
    publicUrl: string;
  } | null>;
  makePublic(storageKey: string): Promise<void>;
  /** 批量物理删除对象（quiet 模式；404 视为成功幂等）。 */
  deleteMultiObjects(storageKeys: string[]): Promise<void>;
}

const MAX_BYTES = {
  image: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
} as const;

function validateUploadInput(input: PresignAssetInput) {
  if (
    input.type !== "image" &&
    input.type !== "video" &&
    input.type !== "audio"
  ) {
    return fail(400, "不支持的素材类型");
  }
  if (!input.mime.startsWith(`${input.type}/`)) {
    return fail(400, "文件类型与声明类型不匹配");
  }
  if (
    !Number.isInteger(input.size) ||
    input.size <= 0 ||
    input.size > MAX_BYTES[input.type]
  ) {
    return fail(400, "文件大小无效或超过限制");
  }
  return null;
}

export async function handlePresignAsset(
  userId: string,
  input: PresignAssetInput,
  storage: AssetUploadStorage | null,
) {
  const invalid = validateUploadInput(input);
  if (invalid) return invalid;
  if (!storage) return fail(100202, "对象存储未配置");

  const prepared = await storage.prepareUpload({
    userId,
    type: input.type,
    mime: input.mime,
  });
  return ok({
    storage_key: prepared.storageKey,
    upload_url: prepared.uploadUrl,
    headers: prepared.headers,
    expires_in: prepared.expiresIn,
  });
}

/**
 * IKCNLS：上传 md5 去重（presign 前判断）。
 * 命中：返回该用户未删同 md5 的最优资产（toAssetResponse），并建 project_asset 关联，前端跳过 presign→PUT→complete 3 步。
 * 未命中：返回需上传标记，前端走 3 步。
 */
export async function handleDedupAsset(
  userId: string,
  input: DedupAssetInput,
  deps: {
    projects: ProjectService;
    uploads: AssetService;
  },
) {
  const invalid = validateUploadInput(input);
  if (invalid) return invalid;
  // 去重是 presign 前的 fast-path，绝不该阻断正常上传：md5 缺失/格式不标准 → 返回 {dedup:false}，
  // 前端走 presign→PUT→complete 3 步。type/mime/size 校验保持 fail-closed（presign/complete 也会校验）。
  if (!input.md5 || !/^[a-f0-9]{32}$/i.test(input.md5)) {
    return ok({ dedup: false });
  }
  const projectId = input.project_id || "0";
  if (
    projectId !== "0" &&
    !(await deps.projects.findOwnedById(projectId, userId))
  ) {
    return fail(100301, "资源不存在");
  }
  const existing = await deps.uploads.findOwnedByMd5(userId, input.md5);
  // 命中但 type 不一致（同 md5 但存储时误标类型）→ 视为未命中，避免返回错误类型资产。
  if (!existing || existing.type !== input.type) {
    // 未命中：标记需上传，前端走 presign→PUT→complete。
    return ok({ dedup: false });
  }
  // 命中：挂到目标项目（幂等），返回资产直接复用。
  if (projectId !== "0") {
    await deps.uploads.linkAssetToProject({
      userId,
      assetId: existing.id,
      projectId,
    });
  }
  return ok({ dedup: true, asset: toAssetResponse(existing) });
}

export async function handleCompleteAsset(
  userId: string,
  input: CompleteAssetInput,
  deps: {
    projects: ProjectService;
    uploads: AssetService;
    storage: AssetUploadStorage | null;
  },
) {
  const invalid = validateUploadInput(input);
  if (invalid) return invalid;
  if (!input.storage_key) return fail(400, "缺少存储键");
  const projectId = input.project_id || "0";
  if (
    projectId !== "0" &&
    !(await deps.projects.findOwnedById(projectId, userId))
  ) {
    return fail(100301, "资源不存在");
  }
  if (!input.storage_key.startsWith(`uploads/${userId}/${input.type}/`)) {
    return fail(400, "存储键与当前用户不匹配");
  }

  if (!deps.storage) return fail(100202, "对象存储未配置");
  const existing = await deps.uploads.findCommittedUpload(
    userId,
    input.storage_key,
  );
  if (existing) {
    await deps.storage.makePublic(input.storage_key);
    return ok(toAssetResponse(existing));
  }
  const object = await deps.storage.inspectObject(input.storage_key);
  if (!object) {
    return fail(400, "上传对象不存在");
  }
  if (object.size !== input.size) {
    return fail(400, "文件大小与实际上传不符");
  }
  if (
    object.mime?.split(";", 1)[0]?.trim().toLowerCase() !==
    input.mime.toLowerCase()
  ) {
    return fail(400, "文件类型与实际上传不符");
  }

  await deps.storage.makePublic(input.storage_key);
  const asset = await deps.uploads.createUploadedAsset({
    userId,
    projectId,
    type: input.type,
    mime: input.mime,
    size: input.size,
    storageKey: input.storage_key,
    url: object.publicUrl,
    ...(input.width == null ? {} : { width: input.width }),
    ...(input.height == null ? {} : { height: input.height }),
    ...(input.duration == null ? {} : { duration: input.duration }),
    ...(input.md5 ? { md5: input.md5 } : {}),
  });

  return ok(toAssetResponse(asset));
}

function toAssetResponse(asset: {
  id: string;
  type: string;
  url: string;
  mime: string | null;
  size: bigint | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}) {
  return {
    asset_id: asset.id,
    status: "ready" as const,
    type: asset.type,
    url: asset.url,
    width: asset.width ?? 0,
    height: asset.height ?? 0,
    duration: asset.duration,
    mime: asset.mime ?? "application/octet-stream",
    size: Number(asset.size ?? BigInt(0)),
  };
}
