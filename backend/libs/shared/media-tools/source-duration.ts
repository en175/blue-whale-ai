import type { PrismaClient } from "@prisma/client";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import type { AssetStorageService } from "../assets/storage.service.js";

export interface SourceAssetDurationFields {
  id: string;
  storage_key: string | null;
  duration_ms?: number | null | undefined;
}

export async function resolveSourceDurationSeconds(args: {
  prisma: PrismaClient;
  storage: AssetStorageService;
  asset: SourceAssetDurationFields;
}): Promise<number | null> {
  const { asset } = args;
  if (typeof asset.duration_ms === "number" && asset.duration_ms > 0) {
    return Math.round(asset.duration_ms / 1000);
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
    await args.prisma.assets.updateMany({
      where: { id: BigInt(asset.id), is_delete: false },
      data: {
        duration_ms: info.durationMs,
        ...(info.width === null ? {} : { width: info.width }),
        ...(info.height === null ? {} : { height: info.height }),
        gmt_modified: new Date(),
        version: { increment: 1 },
      },
    });
  } catch (error) {
    logger.warn(
      `[media-tool] 源视频时长回填失败 asset=${asset.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return Math.round(info.durationMs / 1000);
}
