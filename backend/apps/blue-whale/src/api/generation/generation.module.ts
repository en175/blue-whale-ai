import { Module } from "@nestjs/common";
import { GenerationJobsController } from "./generation-jobs.controller.js";
import { GenerationModelsController } from "./models.controller.js";
import { MaterialApiModule } from "../material/material.module.js";

@Module({
  imports: [MaterialApiModule],
  controllers: [
    GenerationJobsController,
    GenerationModelsController,
  ],
})
export class GenerationApiModule {}
