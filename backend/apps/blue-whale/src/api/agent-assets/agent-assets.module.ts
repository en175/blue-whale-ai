import { Module } from "@nestjs/common";
import { MaterialModule } from "@lib/shared/material/material.module.js";
import { AgentAssetsController } from "./agent-assets.controller.js";
import { InternalAgentAssetsController } from "./internal-agent-assets.controller.js";

@Module({
  imports: [MaterialModule],
  controllers: [AgentAssetsController, InternalAgentAssetsController],
})
export class AgentAssetsModule {}
