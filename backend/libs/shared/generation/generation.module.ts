import { Global, Module } from "@nestjs/common";
import { GenerationCommandService } from "./generation-command.service.js";
import { ModelCapabilityReadService } from "./model-capability.service.js";

@Global()
@Module({
  providers: [
    GenerationCommandService,
    ModelCapabilityReadService,
  ],
  exports: [
    GenerationCommandService,
    ModelCapabilityReadService,
  ],
})
export class GenerationModule {}
