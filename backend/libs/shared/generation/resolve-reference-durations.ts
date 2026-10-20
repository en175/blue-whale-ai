import type { AssetOwnershipOps, WorkerInputAsset } from "@lib/shared/persistence/index.js";

import { logger } from "@lib/infra/logging/blue-whale-logger.js";

import type { MediaInfo } from "../assets/ports.js";
import type { ReferenceItemInput } from "./reference-item-input.js";

function withVideoReferenceDurations(
  references: ReadonlyArray<ReferenceItemInput>,
  secondsByAssetId: ReadonlyMap<string, number | null>,
): ReferenceItemInput[] {
  return references.map((item) => {
    if (item.type !== "video" || item.asset_id === undefined) {
      return item;
    }
    const seconds = secondsByAssetId.get(String(item.asset_id));
    return typeof seconds === "number" && seconds > 0 ? { ...item, duration: seconds } : item;
  });
}

export function videoAssetIdsForDuration(
  references: ReadonlyArray<ReferenceItemInput>,
): string[] {
  return [
    ...new Set(
      references
        .filter((item) => item.type === "video" && item.asset_id !== undefined)
        .map((item) => String(item.asset_id)),
    ),
  ];
}

export function localAssetReferenceIds(
  references: ReadonlyArray<ReferenceItemInput>,
): string[] {
  return [
    ...new Set(
      references
        .filter((item) => item.asset_id !== undefined)
        .map((item) => String(item.asset_id)),
    ),
  ];
}

function missingDurationIds(
  references: ReadonlyArray<ReferenceItemInput>,
  secondsByAssetId: ReadonlyMap<string, number | null>,
  assetsById: ReadonlyMap<string, WorkerInputAsset>,
): string[] {
  return videoAssetIdsForDuration(references).filter((id) => {
    if (assetsById.get(id)?.type !== "video") return false;
    const seconds = secondsByAssetId.get(id);
    return typeof seconds !== "number" || seconds <= 0;
  });
}

async function fillDurationsFromProbe(
  ids: string[],
  args: {
    userId: string;
    projectId: string;
    assets: Partial<
      Pick<AssetOwnershipOps, "findStorageKeys" | "saveMediaInfo">
    >;
    probe: (storageKey: string) => Promise<MediaInfo>;
    secondsByAssetId: Map<string, number | null>;
  },
): Promise<boolean> {
  const { findStorageKeys, saveMediaInfo } = args.assets;
  if (!findStorageKeys || !saveMediaInfo) return false;
  const storageKeys = await findStorageKeys(
    ids,
    args.userId,
    args.projectId,
  );
  for (const id of ids) {
    const storageKey = storageKeys.get(id);
    if (storageKey === undefined) {
      logger.warn(`[duration] 素材缺少存储键，无法探测时长 asset=${id}`);
      return false;
    }
    let info: MediaInfo;
    try {
      info = await args.probe(storageKey);
    } catch (error) {
      logger.warn(
        `[duration] 探测时长失败 asset=${id} key=${storageKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
    if (info.durationMs === null || info.durationMs <= 0) {
      logger.warn(`[duration] 探测结果没有有效时长 asset=${id} key=${storageKey}`);
      return false;
    }
    const durationMs = info.durationMs;
    try {
      const saved = await saveMediaInfo(id, {
        durationMs,
        width: info.width,
        height: info.height,
      });
      if (!saved) {
        logger.warn(`[duration] 时长回填未命中资产行 asset=${id}`);
      }
    } catch (error) {
      logger.warn(
        `[duration] 时长回填失败 asset=${id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    args.secondsByAssetId.set(id, durationMs / 1000);
  }
  return true;
}

export type ReferenceDurationResolution =
  | { kind: "shortfall" }
  | { kind: "probe_failed" }
  | {
      kind: "resolved";
      references: ReferenceItemInput[];
      assetsById: ReadonlyMap<string, WorkerInputAsset>;
    };

export async function resolveReferenceDurations(args: {
  references: ReadonlyArray<ReferenceItemInput>;
  assetIdsOf: (references: ReadonlyArray<ReferenceItemInput>) => string[];
  userId: string;
  projectId: string;
  assets: Pick<AssetOwnershipOps, "resolveInputAssets"> &
    Partial<Pick<AssetOwnershipOps, "findStorageKeys" | "saveMediaInfo">>;
  probe?: (storageKey: string) => Promise<MediaInfo>;
}): Promise<ReferenceDurationResolution> {
  const assetIds = args.assetIdsOf(args.references);
  if (assetIds.length === 0) {
    return { kind: "resolved", references: [...args.references], assetsById: new Map() };
  }
  const resolved = await args.assets.resolveInputAssets(assetIds, args.userId, args.projectId);
  if (resolved.length !== assetIds.length) return { kind: "shortfall" };
  const assetsById = new Map(assetIds.map((id, i) => [id, resolved[i]!]));
  const secondsByAssetId = new Map(assetIds.map((id, i) => [id, resolved[i]!.duration]));
  const missing = missingDurationIds(args.references, secondsByAssetId, assetsById);
  if (missing.length > 0) {
    if (args.probe === undefined) return { kind: "probe_failed" };
    const filled = await fillDurationsFromProbe(missing, {
      userId: args.userId,
      projectId: args.projectId,
      assets: args.assets,
      probe: args.probe,
      secondsByAssetId,
    });
    if (!filled) return { kind: "probe_failed" };
  }
  return {
    kind: "resolved",
    references: withVideoReferenceDurations(args.references, secondsByAssetId),
    assetsById,
  };
}
