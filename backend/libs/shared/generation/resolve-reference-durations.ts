import type { AssetOwnershipOps, WorkerInputAsset } from "@lib/shared/persistence/index.js";

import type { MediaInfo } from "../assets/ports.js";
import type { ReferenceItemInput } from "./reference-item-input.js";

function withVideoReferenceDurations(
  references: ReadonlyArray<ReferenceItemInput>,
  secondsByAssetId: ReadonlyMap<string, number | null>,
): ReferenceItemInput[] {
  return references.map((item) => {
    if (item.type !== "video" || item.duration !== undefined || item.asset_id === undefined) {
      return item;
    }
    const seconds = secondsByAssetId.get(String(item.asset_id));
    return typeof seconds === "number" && seconds > 0 ? { ...item, duration: seconds } : item;
  });
}

export function videoAssetIdsNeedingDuration(
  references: ReadonlyArray<ReferenceItemInput>,
): string[] {
  return [
    ...new Set(
      references
        .filter(
          (item) =>
            item.type === "video" && item.asset_id !== undefined && item.duration === undefined,
        )
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
): string[] {
  return videoAssetIdsNeedingDuration(references).filter((id) => {
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
    if (storageKey === undefined) return false;
    let info: MediaInfo;
    try {
      info = await args.probe(storageKey);
    } catch {
      return false;
    }
    if (info.durationMs === null || info.durationMs <= 0) return false;
    const durationMs = info.durationMs;
    try {
      await saveMediaInfo(id, {
        durationMs,
        width: info.width,
        height: info.height,
      });
    } catch {}
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
  const missing = missingDurationIds(args.references, secondsByAssetId);
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
