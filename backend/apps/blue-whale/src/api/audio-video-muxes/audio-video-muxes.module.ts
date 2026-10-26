import { Module } from "@nestjs/common";
import { AudioVideoMuxesService } from "@lib/shared/audio-video-muxes/audio-video-muxes.service.js";
import { AudioVideoMuxesController } from "./audio-video-muxes.controller.js";

@Module({ controllers: [AudioVideoMuxesController], providers: [AudioVideoMuxesService] })
export class AudioVideoMuxesApiModule {}
