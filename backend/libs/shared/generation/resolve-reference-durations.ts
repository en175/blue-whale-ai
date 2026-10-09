import type { AssetOwnershipOps, WorkerInputAsset } from "@lib/shared/persistence/index.js";

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

export type ReferenceDurationResolution =
  | { kind: "shortfall" }
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
  assets: Pick<AssetOwnershipOps, "resolveInputAssets">;
}): Promise<ReferenceDurationResolution> {
  const assetIds = args.assetIdsOf(args.references);
  if (assetIds.length === 0) {
    return { kind: "resolved", references: [...args.references], assetsById: new Map() };
  }
  const resolved = await args.assets.resolveInputAssets(assetIds, args.userId, args.projectId);
  if (resolved.length !== assetIds.length) return { kind: "shortfall" };
  const assetsById = new Map(assetIds.map((id, i) => [id, resolved[i]!]));
  const secondsByAssetId = new Map(assetIds.map((id, i) => [id, resolved[i]!.duration]));
  return {
    kind: "resolved",
    references: withVideoReferenceDurations(args.references, secondsByAssetId),
    assetsById,
  };
}
