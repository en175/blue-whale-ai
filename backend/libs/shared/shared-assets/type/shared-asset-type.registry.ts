import { Inject, Injectable } from "@nestjs/common";
import type { SharedAssetKind, SharedAssetType } from "@blue-whale/contracts";
import { SharedAssetUnsupportedTypeError } from "../shared-asset-error.js";
import {
  SHARED_ASSET_TYPE_STRATEGY,
  type SharedAssetTypeStrategy,
} from "./shared-asset-type.strategy.js";

/** 类型 → 策略注册表：Service 经 (assetType, kind) 分发，不写 if-else。
 *  新增类型 = 注册一个新策略 provider，本类零改动（构造时自动校验重复）。 */
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
