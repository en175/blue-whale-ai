import {
  ASSET_UNAVAILABLE_CODE,
  RESOURCE_NOT_FOUND_CODE,
  DomainError,
  ok,
} from "@lib/contracts";
import type { ProjectService } from "@lib/shared/project/project.service.js";
import type { AssetService } from "./assets.service.js";
import type { AssetReader, AssetSigner } from "./ports.js";

export async function handleAccessAsset(
  userId: string,
  projectId: string,
  assetId: string,
  deps: {
    project: ProjectService;
    assets: AssetService;
    signer: AssetSigner | null;
  },
) {
  const project = await deps.project.findOwnedById(projectId, userId);
  if (!project) throw new DomainError(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  const asset = await deps.assets.findAccessible(assetId, userId);
  if (!asset) throw new DomainError(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  if (!asset.storage_key || asset.storage_key.trim() === "") {
    throw new DomainError(ASSET_UNAVAILABLE_CODE, "资源不可用");
  }
  if (!deps.signer) throw new DomainError(ASSET_UNAVAILABLE_CODE, "资源不可用");
  try {
    const signed = await deps.signer.sign(asset.storage_key);
    return ok({ url: signed.url, expires_at: signed.expiresAt.toISOString() });
  } catch {
    throw new DomainError(ASSET_UNAVAILABLE_CODE, "资源不可用");
  }
}

export type ContentResult =
  | { ok: true; content: Uint8Array; mime: string }
  | { ok: false; code: number; msg: string };

export async function handleContentAsset(
  userId: string,
  projectId: string,
  assetId: string,
  deps: {
    project: ProjectService;
    assets: AssetService;
    reader: AssetReader | null;
  },
): Promise<ContentResult> {
  const project = await deps.project.findOwnedById(projectId, userId);
  if (!project) {
    return { ok: false, code: RESOURCE_NOT_FOUND_CODE, msg: "资源不存在" };
  }
  const asset = await deps.assets.findAccessible(assetId, userId);
  if (!asset) {
    return { ok: false, code: RESOURCE_NOT_FOUND_CODE, msg: "资源不存在" };
  }
  if (!asset.storage_key || asset.storage_key.trim() === "") {
    return { ok: false, code: ASSET_UNAVAILABLE_CODE, msg: "资源不可用" };
  }
  if (!deps.reader) {
    return { ok: false, code: ASSET_UNAVAILABLE_CODE, msg: "资源不可用" };
  }
  try {
    const content = await deps.reader.read(asset.storage_key);
    return {
      ok: true,
      content,
      mime:
        asset.mime && asset.mime.length > 0
          ? asset.mime
          : "application/octet-stream",
    };
  } catch {
    return { ok: false, code: ASSET_UNAVAILABLE_CODE, msg: "资源不可用" };
  }
}
