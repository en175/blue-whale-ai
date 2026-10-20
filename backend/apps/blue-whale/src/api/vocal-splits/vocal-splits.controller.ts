import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { VocalSplitsService } from "@lib/shared/vocal-splits/vocal-splits.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/vocal-splits")
export class VocalSplitsController {
  constructor(private readonly vocalSplits: VocalSplitsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: { source_asset_id?: unknown; scene?: unknown; output_format?: unknown; canvas_binding?: unknown },
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const result = await this.vocalSplits.create(
      user.userId,
      projectId,
      body ?? {},
      idempotencyKey,
    );
    return result;
  }
}
