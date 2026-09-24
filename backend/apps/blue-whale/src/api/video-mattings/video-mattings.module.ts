import { Module } from "@nestjs/common";
import { VideoMattingsService } from "@lib/shared/video-mattings/video-mattings.service.js";
import { VideoMattingsController } from "./video-mattings.controller.js";

@Module({
  controllers: [VideoMattingsController],
  providers: [VideoMattingsService],
})
export class VideoMattingsApiModule {}
