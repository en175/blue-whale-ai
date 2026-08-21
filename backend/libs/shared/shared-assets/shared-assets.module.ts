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
import { SceneStrategy } from "./type/scene-strategy.js";
import { GoodsStrategy } from "./type/goods-strategy.js";
import { TextStrategy } from "./type/text-strategy.js";
import { SharedAssetSourceAdapter } from "./shared-asset-source.adapter.js";

/** 共享资产共享层：@Global 使 API 层可直接注入 SharedAssetService。
 *  11 种类型策略由单一工厂组装成数组注册到 SHARED_ASSET_TYPE_STRATEGY token
 *  （Nest 对多个同 token provider 不会自动装数组，单测直接 new Registry 传数组掩盖了该接线坑，
 *  真实启动暴露 strategies is not iterable，故用工厂聚合）。 */
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
        new SceneStrategy(source),
        new TextStrategy(),
      ],
      inject: [SHARED_ASSET_SOURCE_PORT],
    },
  ],
  exports: [SharedAssetService, SharedAssetTypeRegistry],
})
export class SharedAssetsModule {}
