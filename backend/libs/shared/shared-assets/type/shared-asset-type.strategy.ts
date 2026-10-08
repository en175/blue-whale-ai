import { createHash } from "node:crypto";
import type {
  SaveSharedAssetRequest,
  SharedAssetKind,
  SharedAssetSnapshot,
  SharedAssetType,
} from "@lib/contracts";

export interface SharedAssetSavePlan {
  name: string;
  thumbnailUrl: string | null;
  snapshot: SharedAssetSnapshot;
  dedupKey: string | null;
}

export interface SharedAssetSaveContext {
  userId: string;
}

export interface SharedAssetTypeStrategy {
  readonly assetType: SharedAssetType;
  readonly kind: SharedAssetKind | null;
  buildSavePlan(
    ctx: SharedAssetSaveContext,
    input: SaveSharedAssetRequest,
  ): Promise<SharedAssetSavePlan>;
}

export const SHARED_ASSET_TYPE_STRATEGY = "SHARED_ASSET_TYPE_STRATEGY";
export const SHARED_ASSET_SOURCE_PORT = "SHARED_ASSET_SOURCE_PORT";

export function sharedAssetSnapshotOf(
  input: SaveSharedAssetRequest,
): SharedAssetSnapshot | null {
  switch (input.assetType) {
    case "card":
    case "goods":
    case "text":
      return input.snapshot;
    default:
      return null;
  }
}

export function sharedAssetKindOf(
  input: SaveSharedAssetRequest,
): SharedAssetKind | null {
  switch (input.assetType) {
    case "card":
    case "media":
      return input.kind;
    default:
      return null;
  }
}

export function sharedAssetSourceAssetIdOf(
  input: SaveSharedAssetRequest,
): string | null {
  return input.assetType === "media" ? input.sourceAssetId : null;
}

export function sharedAssetSourceSceneCardIdOf(
  input: SaveSharedAssetRequest,
): string | null {
  return input.assetType === "scene" ? input.sourceSceneCardId : null;
}

export function sharedAssetRequestNameOf(
  input: SaveSharedAssetRequest,
): string | undefined {
  return input.assetType === "media" ? input.name : undefined;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

export function truncateUrl(url: string, max: number): string {
  return url.length <= max ? url : url.slice(0, max);
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
