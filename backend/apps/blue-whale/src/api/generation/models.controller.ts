import { Controller, Get, Query } from "@nestjs/common";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { handleListModels } from "@lib/shared/generation/handle-list-models.js";

/** 公开模型目录（首页/编辑器匿名展示，无鉴权）。 */
@Controller("generation")
export class GenerationModelsController {
  constructor(private readonly models: ModelCapabilityReadService) {}

  @Public()
  @Get("models")
  listModels(@Query("capability") capability?: string) {
    return handleListModels(capability ?? "image", { models: this.models });
  }
}
