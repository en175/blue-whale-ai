import { Module } from "@nestjs/common";
import { AgentAssetsController } from "./agent-assets.controller.js";
import { InternalAgentAssetsController } from "./internal-agent-assets.controller.js";

@Module({
  controllers: [AgentAssetsController, InternalAgentAssetsController],
})
export class AgentAssetsModule {}
