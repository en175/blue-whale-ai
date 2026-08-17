import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { SceneCardGenerationService } from "@lib/shared/generation/scene-card-generation.service.js";
import { GenerationCostEstimatorService } from "@lib/shared/generation/cost-estimator.service.js";
import { handleSceneCardGenerate } from "@lib/shared/generation/handle-scene-card-generate.js";
import { enqueueVideoGenerationJob } from "@lib/shared/generation/video-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

function bodyString(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body ?? "");
}

@Controller("projects/:projectId/scene-cards/:sceneCardId")
export class SceneCardGenerateController {
  constructor(
    private readonly sceneCard: SceneCardGenerationService,
    private readonly cost: GenerationCostEstimatorService,
  ) {}

  @Post("generate")
  async generate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("sceneCardId") sceneCardId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Headers("authorization") authorization?: string,
  ) {
    const internal = sealProviderCredential(authorization);
    const result = await handleSceneCardGenerate(
      user.userId,
      projectId,
      sceneCardId,
      idempotencyKey ?? null,
      bodyString(body),
      this.sceneCard.repo,
      {
        ...(internal.providerCredential
          ? { providerCredential: internal.providerCredential }
          : {}),
        ...(this.cost.estimator
          ? { costEstimator: this.cost.estimator }
          : {}),
      },
    );
    if (result.code === 200 && result.data?.generation_job_id != null) {
      try {
        await enqueueVideoGenerationJob(
          String(result.data.generation_job_id),
        );
      } catch (error) {
        console.error(
          "[scene-card-generate] enqueue video job failed:",
          error instanceof Error ? error.message : "unknown",
        );
      }
    }
    return result;
  }
}
