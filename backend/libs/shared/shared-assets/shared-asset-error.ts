import { SHARED_ASSET_TYPE_UNSUPPORTED_CODE } from "@lib/contracts";
import type { SharedAssetKind, SharedAssetType } from "@lib/contracts";

export class SharedAssetError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "SharedAssetError";
  }
}

export class SharedAssetUnsupportedTypeError extends SharedAssetError {
  constructor(assetType: SharedAssetType, kind?: SharedAssetKind | null) {
    super(
      SHARED_ASSET_TYPE_UNSUPPORTED_CODE,
      `不支持的共享资产类型: ${assetType}${kind ? `/${kind}` : ""}`,
    );
  }
}
