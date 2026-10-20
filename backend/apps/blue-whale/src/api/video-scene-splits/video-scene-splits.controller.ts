import { Body, Controller, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { VideoSceneSplitsService } from "@lib/shared/video-scene-splits/video-scene-splits.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/video-scene-splits")
export class VideoSceneSplitsController {
  constructor(private readonly videoSceneSplits: VideoSceneSplitsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.videoSceneSplits.create(user.userId, projectId, body ?? {});
  }
}
