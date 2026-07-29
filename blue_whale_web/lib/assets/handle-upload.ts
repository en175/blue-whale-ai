import { fail, ok } from "@blue-whale/contracts";

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
};

export type PendingUpload = {
  id: string;
  type: string;
  storage_key: string;
  url: string;
  mime: string | null;
  size: bigint | null;
  width: number | null;
  height: number | null;
  duration: number | null;
};

export interface AssetUploadRepo {
  findCommittedUpload(
    userId: string,
    storageKey: string,
  ): Promise<PendingUpload | null>;
  createUploadedAsset(input: {
    userId: string;
    projectId: string;
    type: "image" | "video" | "audio";
    mime: string;
    size: number;
    storageKey: string;
    url: string;
    width?: number;
    height?: number;
    duration?: number;
  }): Promise<PendingUpload>;
}

export interface AssetUploadStorage {
  prepareUpload(input: {
    userId: string;
    type: "image" | "video" | "audio";
    mime: string;
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
}

const MAX_BYTES = {
  image: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
} as const;

type ProjectOwnership = {
  findOwnedById(
    projectId: string,
    userId: string,
  ): Promise<{ id: string } | null>;
};

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
  deps: { storage: AssetUploadStorage | null },
) {
  const invalid = validateUploadInput(input);
  if (invalid) return invalid;
  if (!deps.storage) return fail(100202, "对象存储未配置");

  const prepared = await deps.storage.prepareUpload({
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

export async function handleCompleteAsset(
  userId: string,
  input: CompleteAssetInput,
  deps: {
    projects: ProjectOwnership;
    uploads: AssetUploadRepo;
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
  });

  return ok(toAssetResponse(asset));
}

function toAssetResponse(asset: PendingUpload) {
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
