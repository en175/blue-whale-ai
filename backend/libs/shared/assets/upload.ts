import {
  ASSET_ERROR_SPECS,
  DomainError,
  IMAGE_ERASE_MASK_ASSET_SOURCE,
  RESOURCE_NOT_FOUND_CODE,
  assetError,
  ok,
} from "@lib/contracts";
import {
  FILE_SIGNATURE_HEAD_BYTES,
  sniffFileSignature,
  type FileSignature,
  type MediaKind,
} from "./file-signature.js";
import type { AssetService } from "./assets.service.js";
import type { ProjectService } from "@lib/shared/project/project.service.js";
import type { AssetProbe, MediaInfo } from "./ports.js";

export type PresignAssetInput = {
  type: "image" | "video" | "audio";
  mime: string;
  size: number;
};

export type CompleteAssetInput = PresignAssetInput & {
  project_id?: string;
  storage_key: string;
  name?: string;
  width?: number;
  height?: number;
  duration?: number;
  md5?: string;
  materialId?: string;
  source?: string;
};

export type DedupAssetInput = {
  type: "image" | "video" | "audio";
  mime: string;
  size: number;
  md5: string;
  project_id?: string;
  materialId?: string;
};

export interface AssetUploadStorage {
  readHead(storageKey: string, length: number): Promise<Uint8Array | null>;
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
  deleteMultiObjects(storageKeys: string[]): Promise<void>;
}

const UNSUPPORTED_IMAGE_MIMES = new Set(["image/svg+xml", "image/svg"]);

const MAX_BYTES = {
  image: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
} as const;

function assertUploadInput(input: PresignAssetInput): void {
  if (
    input.type !== "image" &&
    input.type !== "video" &&
    input.type !== "audio"
  ) {
    throw assetError("ASSET_TYPE_UNSUPPORTED");
  }
  if (!input.mime.startsWith(`${input.type}/`)) {
    throw assetError("ASSET_TYPE_MIME_MISMATCH");
  }
  if (UNSUPPORTED_IMAGE_MIMES.has(input.mime.toLowerCase())) {
    throw assetError("ASSET_FORMAT_UNSUPPORTED");
  }
  if (
    !Number.isInteger(input.size) ||
    input.size <= 0 ||
    input.size > MAX_BYTES[input.type]
  ) {
    throw assetError("ASSET_SIZE_INVALID");
  }
}

export async function handlePresignAsset(
  userId: string,
  input: PresignAssetInput,
  storage: AssetUploadStorage | null,
) {
  assertUploadInput(input);
  if (!storage) throw assetError("ASSET_STORAGE_UNCONFIGURED");

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

const MATERIAL_ID_PATTERN = /^asset-.{1,128}$/i;

function readOptionalMaterialId(value: unknown): string | undefined {
  if (typeof value !== "string" || !MATERIAL_ID_PATTERN.test(value.trim())) return undefined;
  return value.trim();
}

export interface UploadMaterialGate {
  check(
    userId: string,
    materialId: string,
  ): Promise<{ ok: true } | { ok: false; message: string }>;
}

export interface MaterialStatusReader {
  load(userId: string, materialId: string): Promise<string | null>;
}

function materialUnavailable(message: string): DomainError {
  return new DomainError(
    ASSET_ERROR_SPECS.ASSET_MATERIAL_UNAVAILABLE.code,
    message,
  );
}

export async function handleDedupAsset(
  userId: string,
  input: DedupAssetInput,
  deps: {
    projects: ProjectService;
    uploads: AssetService;
    materialGate: UploadMaterialGate;
    materialStatus: MaterialStatusReader;
  },
) {
  assertUploadInput(input);
  const materialId = readOptionalMaterialId(input.materialId);

  const gate = materialId ? await deps.materialGate.check(userId, materialId) : null;
  if (gate !== null && !gate.ok) throw materialUnavailable(gate.message);

  const projectId = input.project_id || "0";
  if (
    projectId !== "0" &&
    !(await deps.projects.findOwnedById(projectId, userId))
  ) {
    throw new DomainError(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  }

  const reusable = await findReusableAsset(
    deps.uploads,
    userId,
    input,
    materialId,
  );
  if (!reusable) {
    return ok({ dedup: false });
  }
  if (projectId !== "0") {
    await deps.uploads.linkAssetToProject({
      userId,
      assetId: reusable.id,
      projectId,
    });
  }
  if (materialId && gate?.ok) {
    await deps.uploads.bindMaterialId({
      userId,
      assetId: reusable.id,
      materialId,
    });
  }
  return ok({
    dedup: true,
    asset: await toAssetResponse(reusable, {
      userId,
      materialStatus: deps.materialStatus,
      boundMaterialId: materialId ?? reusable.material_id ?? null,
    }),
  });
}

async function findReusableAsset(
  uploads: AssetService,
  userId: string,
  input: DedupAssetInput,
  materialId: string | undefined,
) {
  if (typeof input.md5 === "string" && /^[a-f0-9]{32}$/i.test(input.md5)) {
    const byMd5 = await uploads.findOwnedByMd5(userId, input.md5);
    if (byMd5 && byMd5.type === input.type) return byMd5;
  }
  if (materialId) {
    const byMaterial = await uploads.findOwnedByMaterialId(userId, materialId);
    if (byMaterial && byMaterial.type === input.type) return byMaterial;
  }
  return null;
}

const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

async function rejectUploadedObject(
  storage: AssetUploadStorage,
  storageKey: string,
  error: DomainError,
): Promise<never> {
  try {
    await storage.deleteMultiObjects([storageKey]);
  } catch {
  }
  throw error;
}

async function readFileSignature(
  storage: AssetUploadStorage,
  storageKey: string,
): Promise<{ checked: boolean; value: FileSignature | null }> {
  let head: Uint8Array | null;
  try {
    head = await storage.readHead(storageKey, FILE_SIGNATURE_HEAD_BYTES);
  } catch {
    return { checked: false, value: null };
  }
  if (!head) return { checked: false, value: null };
  return { checked: true, value: sniffFileSignature(head) };
}

async function probeMedia(
  probe: AssetProbe | null | undefined,
  storageKey: string,
): Promise<MediaInfo | null> {
  if (!probe) return null;
  try {
    return await probe(storageKey);
  } catch {
    return null;
  }
}

export async function handleCompleteAsset(
  userId: string,
  input: CompleteAssetInput,
  deps: {
    projects: ProjectService;
    uploads: AssetService;
    storage: AssetUploadStorage | null;
    probe?: AssetProbe | null;
    materialGate: UploadMaterialGate;
    materialStatus: MaterialStatusReader;
  },
) {
  assertUploadInput(input);
  if (!input.storage_key) throw assetError("ASSET_STORAGE_KEY_MISSING");
  const projectId = input.project_id || "0";
  if (
    projectId !== "0" &&
    !(await deps.projects.findOwnedById(projectId, userId))
  ) {
    throw new DomainError(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  }
  if (!input.storage_key.startsWith(`uploads/${userId}/${input.type}/`)) {
    throw assetError("ASSET_STORAGE_KEY_FOREIGN");
  }
  if (!deps.storage) throw assetError("ASSET_STORAGE_UNCONFIGURED");

  const materialId = readOptionalMaterialId(input.materialId);

  const existing = await deps.uploads.findCommittedUpload(
    userId,
    input.storage_key,
  );
  if (existing) {
    await deps.storage.makePublic(input.storage_key);
    let boundMaterialId = existing.material_id;
    if (materialId) {
      const replayGate = await deps.materialGate.check(userId, materialId);
      if (replayGate.ok) {
        await deps.uploads.bindMaterialId({
          userId,
          assetId: existing.id,
          materialId,
        });
        boundMaterialId = materialId;
      } else {
        const fresh = await deps.uploads.findCommittedUpload(
          userId,
          input.storage_key,
        );
        boundMaterialId = fresh?.material_id ?? null;
      }
    }
    return ok(
      await toAssetResponse(existing, {
        userId,
        materialStatus: deps.materialStatus,
        boundMaterialId: boundMaterialId ?? null,
      }),
    );
  }

  const gate = materialId
    ? await deps.materialGate.check(userId, materialId)
    : null;
  if (gate !== null && !gate.ok) {
    return rejectUploadedObject(
      deps.storage,
      input.storage_key,
      materialUnavailable(gate.message),
    );
  }

  if (materialId && gate?.ok) {
    const bound = await deps.uploads.findOwnedByMaterialId(userId, materialId);
    if (bound) {
      if (bound.storage_key !== input.storage_key) {
        await deps.storage
          .deleteMultiObjects([input.storage_key])
          .catch(() => undefined);
      }
      if (projectId !== "0") {
        await deps.uploads.linkAssetToProject({
          userId,
          assetId: bound.id,
          projectId,
        });
      }
      await deps.uploads.bindMaterialId({
        userId,
        assetId: bound.id,
        materialId,
      });
      return ok(
        await toAssetResponse(bound, {
          userId,
          materialStatus: deps.materialStatus,
          boundMaterialId: materialId,
        }),
      );
    }
  }
  const object = await deps.storage.inspectObject(input.storage_key);
  if (!object) {
    throw assetError("ASSET_OBJECT_MISSING");
  }
  if (object.size !== input.size) {
    throw assetError("ASSET_SIZE_MISMATCH");
  }
  if (
    object.mime?.split(";", 1)[0]?.trim().toLowerCase() !==
    input.mime.toLowerCase()
  ) {
    throw assetError("ASSET_MIME_MISMATCH");
  }

  const signature = await readFileSignature(deps.storage, input.storage_key);
  if (signature.checked && !signature.value) {
    return rejectUploadedObject(
      deps.storage,
      input.storage_key,
      assetError("ASSET_BYTES_UNRECOGNIZED"),
    );
  }
  if (signature.value && signature.value.kind !== input.type) {
    return rejectUploadedObject(
      deps.storage,
      input.storage_key,
      new DomainError(
        ASSET_ERROR_SPECS.ASSET_KIND_MISMATCH.code,
        `这个文件实际是${MEDIA_KIND_LABELS[signature.value.kind]}，和你选择的类型不一致。请重新上传。`,
      ),
    );
  }

  const media =
    input.type === "image"
      ? null
      : await probeMedia(deps.probe, input.storage_key);
  if (
    input.type !== "image" &&
    (media === null || media.durationMs === null || media.durationMs <= 0)
  ) {
    return rejectUploadedObject(
      deps.storage,
      input.storage_key,
      assetError("ASSET_MEDIA_INFO_UNAVAILABLE"),
    );
  }
  await deps.storage.makePublic(input.storage_key);
  const source =
    input.source === IMAGE_ERASE_MASK_ASSET_SOURCE ? input.source : "uploaded";
  const asset = await deps.uploads.createUploadedAsset({
    userId,
    projectId,
    type: input.type,
    mime: input.mime,
    size: input.size,
    storageKey: input.storage_key,
    ...(typeof input.name === "string" && input.name.trim()
      ? { name: Array.from(input.name.trim().split(/[\\/]/).pop() ?? "").slice(0, 255).join("") }
      : {}),
    url: object.publicUrl,
    ...(media?.width != null
      ? { width: media.width }
      : input.width == null ? {} : { width: input.width }),
    ...(media?.height != null
      ? { height: media.height }
      : input.height == null ? {} : { height: input.height }),
    ...(media?.durationMs != null
      ? { duration: media.durationMs / 1000 }
      : input.duration == null ? {} : { duration: input.duration }),
    ...(input.md5 ? { md5: input.md5 } : {}),
    ...(materialId ? { materialId } : {}),
    source,
  });

  return ok(
    await toAssetResponse(asset, {
      userId,
      materialStatus: deps.materialStatus,
      boundMaterialId: materialId ?? asset.material_id ?? null,
    }),
  );
}

async function toAssetResponse(
  asset: {
    id: string;
    type: string;
    url: string;
    mime: string | null;
    size: bigint | null;
    width: number | null;
    height: number | null;
    duration: number | null;
  },
  ctx: {
    userId: string;
    materialStatus: MaterialStatusReader;
    boundMaterialId: string | null;
  },
) {
  const materialId = ctx.boundMaterialId;
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
    material_id: materialId,
    material_status:
      materialId === null
        ? null
        : await ctx.materialStatus.load(ctx.userId, materialId),
  };
}
