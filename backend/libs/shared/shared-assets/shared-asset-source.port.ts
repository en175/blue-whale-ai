import type { AssetSourceFields } from "@lib/shared/persistence/index.js";

export interface SharedAssetSourcePort {
  findOwnedSource(
    sourceAssetId: string,
    userId: string,
  ): Promise<AssetSourceFields | null>;
}
