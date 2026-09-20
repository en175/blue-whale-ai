import { Module } from "@nestjs/common";
import { VideoSceneSplitsService } from "@lib/shared/video-scene-splits/video-scene-splits.service.js";
import { VideoSceneSplitsController } from "./video-scene-splits.controller.js";

@Module({
  controllers: [VideoSceneSplitsController],
  providers: [VideoSceneSplitsService],
})
export class VideoSceneSplitsApiModule {}
