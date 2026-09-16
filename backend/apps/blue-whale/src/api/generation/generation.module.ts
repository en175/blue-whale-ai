import { Module } from "@nestjs/common";
import { GenerationJobsController } from "./generation-jobs.controller.js";
import { GenerationModelsController } from "./models.controller.js";
import { SceneCardGenerateController } from "./scene-card-generate.controller.js";
import { MaterialApiModule } from "../material/material.module.js";

@Module({
  // IKF YHJ：素材校验门需要 MaterialService（GetAsset 实时查询 + material_assets 状态仓库面）。
  imports: [MaterialApiModule],
  controllers: [
    GenerationJobsController,
    GenerationModelsController,
    SceneCardGenerateController,
  ],
})
export class GenerationApiModule {}
