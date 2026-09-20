import { Module } from "@nestjs/common";
import { AudioTrimsService } from "@lib/shared/audio-trims/audio-trims.service.js";
import { AudioTrimsController } from "./audio-trims.controller.js";

@Module({
  controllers: [AudioTrimsController],
  providers: [AudioTrimsService],
})
export class AudioTrimsApiModule {}
