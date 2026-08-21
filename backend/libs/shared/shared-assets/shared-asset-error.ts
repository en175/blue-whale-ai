import { SHARED_ASSET_TYPE_UNSUPPORTED_CODE } from "@blue-whale/contracts";
import type { SharedAssetKind, SharedAssetType } from "@blue-whale/contracts";

/** 共享资产领域错误：携带契约错误码，由 API 层捕获转为 fail(code, msg)。 */
export class SharedAssetError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "SharedAssetError";
  }
}

/** 不支持的共享资产类型组合（判别联合兜底，防枚举漂移/越权传值）。 */
export class SharedAssetUnsupportedTypeError extends SharedAssetError {
  constructor(assetType: SharedAssetType, kind?: SharedAssetKind | null) {
    super(
      SHARED_ASSET_TYPE_UNSUPPORTED_CODE,
      `不支持的共享资产类型: ${assetType}${kind ? `/${kind}` : ""}`,
    );
  }
}
