import { Module } from "@nestjs/common";
import { GenerationJobsController } from "./generation-jobs.controller.js";
import { GenerationModelsController } from "./models.controller.js";
import { SceneCardGenerateController } from "./scene-card-generate.controller.js";
import { ImageRecoveryService } from "./image-recovery.service.js";

@Module({
  controllers: [
    GenerationJobsController,
    GenerationModelsController,
    SceneCardGenerateController,
  ],
  providers: [ImageRecoveryService],
})
export class GenerationApiModule {}
