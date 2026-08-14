import { Module } from "@nestjs/common";
import { AssetsController } from "./assets.controller.js";

@Module({
  controllers: [AssetsController],
})
export class AssetsApiModule {}
