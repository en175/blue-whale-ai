import type { PrismaClient } from "@prisma/client";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { createAssetOwnershipOps } from "../persistence/asset-ownership-repo.js";
import type { AssetStorageService } from "../assets/storage.service.js";

export interface SourceAssetDurationFields {
  id: string;
  storage_key: string | null;
  duration_ms?: number | null | undefined;
}

export interface ResolvedSourceDuration {
  seconds: number;
  durationMs: number;
  width: number | null;
  height: number | null;
}

function toSeconds(durationMs: number): number {
  return Math.max(1, Math.round(durationMs / 1000));
}

export async function resolveSourceDuration(args: {
  prisma: PrismaClient;
  storage: AssetStorageService;
  asset: SourceAssetDurationFields;
}): Promise<ResolvedSourceDuration | null> {
  const { asset } = args;
  if (typeof asset.duration_ms === "number" && asset.duration_ms > 0) {
    return {
      seconds: toSeconds(asset.duration_ms),
      durationMs: asset.duration_ms,
      width: null,
      height: null,
    };
  }
  const probe = args.storage.probe;
  if (!probe || !asset.storage_key) return null;
  let info;
  try {
    info = await probe(asset.storage_key);
  } catch (error) {
    logger.warn(
      `[media-tool] 源视频探测时长失败 asset=${asset.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
  if (info.durationMs === null || info.durationMs <= 0) return null;
  try {
    await createAssetOwnershipOps(args.prisma).saveMediaInfo(asset.id, {
      durationMs: info.durationMs,
      width: info.width,
      height: info.height,
    });
  } catch (error) {
    logger.warn(
      `[media-tool] 源视频时长回填失败 asset=${asset.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return {
    seconds: toSeconds(info.durationMs),
    durationMs: info.durationMs,
    width: info.width,
    height: info.height,
  };
}
