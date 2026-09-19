import { Module } from "@nestjs/common";
import { VideoEnhancementsService } from "@lib/shared/video-enhancements/video-enhancements.service.js";
import { VideoEnhancementsController } from "./video-enhancements.controller.js";

@Module({
  controllers: [VideoEnhancementsController],
  providers: [VideoEnhancementsService],
})
export class VideoEnhancementsApiModule {}
