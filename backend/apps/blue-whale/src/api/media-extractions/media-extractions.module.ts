import { Module } from "@nestjs/common";
import { MediaExtractionsService } from "@lib/shared/media-extractions/media-extractions.service.js";
import { MediaExtractionsController } from "./media-extractions.controller.js";

@Module({
  controllers: [MediaExtractionsController],
  providers: [MediaExtractionsService],
})
export class MediaExtractionsApiModule {}
