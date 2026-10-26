import { Module } from "@nestjs/common";
import { AudioSpeedsService } from "@lib/shared/audio-speeds/audio-speeds.service.js";
import { AudioSpeedsController } from "./audio-speeds.controller.js";

@Module({
  controllers: [AudioSpeedsController],
  providers: [AudioSpeedsService],
})
export class AudioSpeedsApiModule {}
