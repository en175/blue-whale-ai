import { Body, Controller, Headers, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AudioSpeedsService } from "@lib/shared/audio-speeds/audio-speeds.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { isRecoveryControlledEnvelope, writeRecoveryControlled } from "../recovery-envelope.js";

@Controller("projects/:projectId/audio-speeds")
export class AudioSpeedsController {
  constructor(private readonly audioSpeeds: AudioSpeedsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body()
    body: {
      source_asset_id?: unknown;
      speed?: unknown;
    },
    @Headers("idempotency-key") idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.audioSpeeds.create(
      user.userId,
      projectId,
      body ?? {},
      idempotencyKey,
    );
    if (isRecoveryControlledEnvelope(result)) {
      writeRecoveryControlled(result, res);
      return;
    }
    return result;
  }
}
