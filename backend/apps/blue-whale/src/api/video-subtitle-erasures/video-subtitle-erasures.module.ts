import { Module } from "@nestjs/common";
import { VideoSubtitleErasuresService } from "@lib/shared/video-subtitle-erasures/video-subtitle-erasures.service.js";
import { VideoSubtitleErasuresController } from "./video-subtitle-erasures.controller.js";

@Module({
  controllers: [VideoSubtitleErasuresController],
  providers: [VideoSubtitleErasuresService],
})
export class VideoSubtitleErasuresApiModule {}
