import { Module } from "@nestjs/common";
import { SharedAssetsController } from "./shared-assets.controller.js";

@Module({
  controllers: [SharedAssetsController],
})
export class SharedAssetsApiModule {}
