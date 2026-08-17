import { Global, Module } from "@nestjs/common";
import { GenerationCommandService } from "./generation-command.service.js";
import { ModelCapabilityReadService } from "./model-capability.service.js";
import { GenerationCostEstimatorService } from "./cost-estimator.service.js";
import { SceneCardGenerationService } from "./scene-card-generation.service.js";
import { GenerationWorkerService } from "./generation-worker.service.js";

@Global()
@Module({
  providers: [
    GenerationCommandService,
    ModelCapabilityReadService,
    GenerationCostEstimatorService,
    SceneCardGenerationService,
    GenerationWorkerService,
  ],
  exports: [
    GenerationCommandService,
    ModelCapabilityReadService,
    GenerationCostEstimatorService,
    SceneCardGenerationService,
    GenerationWorkerService,
  ],
})
export class GenerationModule {}
