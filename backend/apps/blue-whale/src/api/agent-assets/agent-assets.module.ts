import { Module } from "@nestjs/common";
import { AgentAssetsController } from "./agent-assets.controller.js";

@Module({
  controllers: [AgentAssetsController],
})
export class AgentAssetsModule {}
