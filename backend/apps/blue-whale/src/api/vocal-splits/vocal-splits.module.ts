import { Module } from "@nestjs/common";
import { VocalSplitsService } from "@lib/shared/vocal-splits/vocal-splits.service.js";
import { VocalSplitsController } from "./vocal-splits.controller.js";

@Module({
  controllers: [VocalSplitsController],
  providers: [VocalSplitsService],
})
export class VocalSplitsApiModule {}
