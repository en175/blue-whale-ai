import { Module } from "@nestjs/common";
import { GenerationJobsController } from "./generation-jobs.controller.js";
import { GenerationQuotesController } from "./generation-quotes.controller.js";
import { GenerationModelsController } from "./models.controller.js";
import { SceneCardGenerateController } from "./scene-card-generate.controller.js";
import { MaterialApiModule } from "../material/material.module.js";

@Module({
  imports: [MaterialApiModule],
  controllers: [
    GenerationJobsController,
    GenerationQuotesController,
    GenerationModelsController,
    SceneCardGenerateController,
  ],
})
export class GenerationApiModule {}
