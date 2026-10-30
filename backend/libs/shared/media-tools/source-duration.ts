import type { PrismaClient } from "@prisma/client";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { createAssetOwnershipOps } from "../persistence/asset-ownership-repo.js";
import type { AssetStorageService } from "../assets/storage.service.js";
import { loadTosStorageConfig } from "../assets/tos-storage.js";

export interface SourceAssetDurationFields {
  id: string;
  storage_key: string | null;
  duration_ms?: number | null | undefined;
  width?: number | null;
  height?: number | null;
}

export interface ResolvedSourceDuration {
  seconds: number;
  durationMs: number;
  width: number | null;
  height: number | null;
}

export type SecondsPolicy = "round" | "floor";

function toSeconds(durationMs: number, policy: SecondsPolicy): number {
  const seconds =
    policy === "floor"
      ? Math.floor(durationMs / 1000)
      : Math.round(durationMs / 1000);
  return Math.max(1, seconds);
}

export function storageKeyOfAsset(asset: {
  storage_key: string | null;
  url: string;
}): string | null {
  if (asset.storage_key) return asset.storage_key;
  const config = loadTosStorageConfig();
  const endpoint = config?.endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const origin = config ? `https://${config.bucket}.${endpoint}` : null;
  try {
    const url = new URL(asset.url);
    if (!origin || url.origin !== origin || !url.pathname || url.pathname === "/" || url.search) {
      return null;
    }
    return decodeURIComponent(url.pathname.slice(1));
  } catch {
    return null;
  }
}

export async function resolveSourceDuration(args: {
  prisma: PrismaClient;
  storage: AssetStorageService;
  asset: SourceAssetDurationFields;
  probeDimensions?: boolean;
  secondsPolicy?: SecondsPolicy;
}): Promise<ResolvedSourceDuration | null> {
  const { asset } = args;
  const policy = args.secondsPolicy ?? "round";
  const knownDurationMs =
    typeof asset.duration_ms === "number" && asset.duration_ms > 0
      ? asset.duration_ms
      : null;
  const needsDimensions =
    args.probeDimensions === true &&
    (asset.width == null || asset.height == null);
  if (knownDurationMs !== null && !needsDimensions) {
    return {
      seconds: toSeconds(knownDurationMs, policy),
      durationMs: knownDurationMs,
      width: null,
      height: null,
    };
  }
  const probe = args.storage.probe;
  if (!probe || !asset.storage_key) {
    if (knownDurationMs !== null) {
      return {
        seconds: toSeconds(knownDurationMs, policy),
        durationMs: knownDurationMs,
        width: null,
        height: null,
      };
    }
    return null;
  }
  let info;
  try {
    info = await probe(asset.storage_key);
  } catch (error) {
    logger.warn(
      `[media-tool] 源视频探测时长失败 asset=${asset.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    if (knownDurationMs !== null) {
      return {
        seconds: toSeconds(knownDurationMs, policy),
        durationMs: knownDurationMs,
        width: null,
        height: null,
      };
    }
    return null;
  }
  if (knownDurationMs === null && (info.durationMs === null || info.durationMs <= 0)) {
    return null;
  }
  const durationMs = knownDurationMs ?? info.durationMs;
  if (durationMs === null) return null;
  try {
    await createAssetOwnershipOps(args.prisma).saveMediaInfo(asset.id, {
      durationMs,
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
    seconds: toSeconds(durationMs, policy),
    durationMs,
    width: info.width,
    height: info.height,
  };
}
