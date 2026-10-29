import { Injectable } from "@nestjs/common";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import type { SharedAssetSourcePort } from "./shared-asset-source.port.js";

@Injectable()
export class SharedAssetSourceAdapter implements SharedAssetSourcePort {
  constructor(private readonly assets: AssetService) {}

  findOwnedSource(sourceAssetId: string, userId: string) {
    return this.assets.findOwnedSource(sourceAssetId, userId);
  }
}
