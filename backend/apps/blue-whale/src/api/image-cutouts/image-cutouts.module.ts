import { Module } from "@nestjs/common";
import { ImageCutoutsService } from "@lib/shared/image-cutouts/image-cutouts.service.js";
import { ImageCutoutsController } from "./image-cutouts.controller.js";

@Module({
  controllers: [ImageCutoutsController],
  providers: [ImageCutoutsService],
})
export class ImageCutoutsApiModule {}
