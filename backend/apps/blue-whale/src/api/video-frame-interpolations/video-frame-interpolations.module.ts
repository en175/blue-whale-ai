import { Module } from "@nestjs/common";
import { VideoFrameInterpolationsService } from "@lib/shared/video-frame-interpolations/video-frame-interpolations.service.js";
import { VideoFrameInterpolationsController } from "./video-frame-interpolations.controller.js";

@Module({
  controllers: [VideoFrameInterpolationsController],
  providers: [VideoFrameInterpolationsService],
})
export class VideoFrameInterpolationsApiModule {}
