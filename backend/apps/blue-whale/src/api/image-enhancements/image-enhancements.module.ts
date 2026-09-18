import { Module } from "@nestjs/common";
import { ImageEnhancementsService } from "@lib/shared/image-enhancements/image-enhancements.service.js";
import { ImageEnhancementsController } from "./image-enhancements.controller.js";

@Module({
  controllers: [ImageEnhancementsController],
  providers: [ImageEnhancementsService],
})
export class ImageEnhancementsApiModule {}
