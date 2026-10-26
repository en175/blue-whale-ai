import { Module } from "@nestjs/common";
import { AudioMixesService } from "@lib/shared/audio-mixes/audio-mixes.service.js";
import { AudioMixesController } from "./audio-mixes.controller.js";

@Module({ controllers: [AudioMixesController], providers: [AudioMixesService] })
export class AudioMixesApiModule {}
