import { Global, Module } from "@nestjs/common";
import { AssetService } from "./assets.service.js";
import { AssetStorageService } from "./storage.service.js";

@Global()
@Module({
  providers: [AssetService, AssetStorageService],
  exports: [AssetService, AssetStorageService],
})
export class AssetModule {}
