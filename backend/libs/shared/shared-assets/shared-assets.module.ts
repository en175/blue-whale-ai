import { Global, Module } from "@nestjs/common";
import { SharedAssetService } from "./shared-assets.service.js";
import { SharedAssetTypeRegistry } from "./type/shared-asset-type.registry.js";
import {
  SHARED_ASSET_SOURCE_PORT,
  SHARED_ASSET_TYPE_STRATEGY,
} from "./type/shared-asset-type.strategy.js";
import {
  CharacterCardStrategy,
  CustomCardStrategy,
  EnvironmentCardStrategy,
  ObjectCardStrategy,
  StyleCardStrategy,
} from "./type/card-strategies.js";
import { MediaStrategy } from "./type/media-strategies.js";
import { GoodsStrategy } from "./type/goods-strategy.js";
import { TextStrategy } from "./type/text-strategy.js";
import { SharedAssetSourceAdapter } from "./shared-asset-source.adapter.js";

@Global()
@Module({
  providers: [
    SharedAssetService,
    SharedAssetTypeRegistry,
    { provide: SHARED_ASSET_SOURCE_PORT, useClass: SharedAssetSourceAdapter },
    {
      provide: SHARED_ASSET_TYPE_STRATEGY,
      useFactory: (source: SharedAssetSourceAdapter) => [
        new StyleCardStrategy(),
        new CharacterCardStrategy(),
        new ObjectCardStrategy(),
        new EnvironmentCardStrategy(),
        new CustomCardStrategy(),
        new MediaStrategy(source, "image"),
        new MediaStrategy(source, "video"),
        new MediaStrategy(source, "audio"),
        new GoodsStrategy(),
        new TextStrategy(),
      ],
      inject: [SHARED_ASSET_SOURCE_PORT],
    },
  ],
  exports: [SharedAssetService, SharedAssetTypeRegistry],
})
export class SharedAssetsModule {}
