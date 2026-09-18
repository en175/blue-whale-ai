import { Module } from "@nestjs/common";
import { ImageOutpaintsService } from "@lib/shared/image-outpaints/image-outpaints.service.js";
import { ImageOutpaintsController } from "./image-outpaints.controller.js";

@Module({
  controllers: [ImageOutpaintsController],
  providers: [ImageOutpaintsService],
})
export class ImageOutpaintsApiModule {}
