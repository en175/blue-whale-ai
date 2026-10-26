import { Body, Controller, Headers, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { ImageErasuresService } from "@lib/shared/image-erasures/image-erasures.service.js";
import { isRecoveryControlledEnvelope, writeRecoveryControlled } from "../recovery-envelope.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/image-erasures")
export class ImageErasuresController {
  constructor(private readonly imageErasures: ImageErasuresService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.imageErasures.create(
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
