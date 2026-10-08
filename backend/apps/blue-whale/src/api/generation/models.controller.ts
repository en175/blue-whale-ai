import { Controller, Get, Query } from "@nestjs/common";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { handleListModels } from "@lib/shared/generation/handle-list-models.js";

@Controller("generation")
export class GenerationModelsController {
  constructor(private readonly models: ModelCapabilityReadService) {}

  @Public()
  @Get("models")
  listModels(@Query("capability") capability?: string) {
    return handleListModels(capability ?? "image", { models: this.models });
  }
}
