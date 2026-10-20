import { Module } from "@nestjs/common";
import { MediaToolsController } from "./media-tools.controller.js";

@Module({
  controllers: [MediaToolsController],
})
export class MediaToolsApiModule {}
