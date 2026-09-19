import { Module } from "@nestjs/common";
import { ImageErasuresService } from "@lib/shared/image-erasures/image-erasures.service.js";
import { ImageErasuresController } from "./image-erasures.controller.js";

@Module({
  controllers: [ImageErasuresController],
  providers: [ImageErasuresService],
})
export class ImageErasuresApiModule {}
