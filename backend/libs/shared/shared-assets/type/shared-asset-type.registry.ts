import { Inject, Injectable } from "@nestjs/common";
import type { SharedAssetKind, SharedAssetType } from "@lib/contracts";
import { SharedAssetUnsupportedTypeError } from "../shared-asset-error.js";
import {
  SHARED_ASSET_TYPE_STRATEGY,
  type SharedAssetTypeStrategy,
} from "./shared-asset-type.strategy.js";

@Injectable()
export class SharedAssetTypeRegistry {
  private readonly byTypeKind = new Map<string, SharedAssetTypeStrategy>();

  constructor(
    @Inject(SHARED_ASSET_TYPE_STRATEGY)
    strategies: SharedAssetTypeStrategy[],
  ) {
    for (const strategy of strategies) {
      const key = registryKey(strategy.assetType, strategy.kind);
      if (this.byTypeKind.has(key)) {
        throw new Error(`duplicate shared asset type strategy: ${key}`);
      }
      this.byTypeKind.set(key, strategy);
    }
  }

  get(
    assetType: SharedAssetType,
    kind: SharedAssetKind | null,
  ): SharedAssetTypeStrategy {
    const strategy = this.byTypeKind.get(registryKey(assetType, kind));
    if (!strategy) {
      throw new SharedAssetUnsupportedTypeError(assetType, kind);
    }
    return strategy;
  }
}

function registryKey(
  assetType: SharedAssetType,
  kind: SharedAssetKind | null,
): string {
  return `${assetType}:${kind ?? ""}`;
}
