import { Module } from "@nestjs/common";
import { AgentTemplatesController } from "./templates.controller.js";

@Module({
  controllers: [AgentTemplatesController],
})
export class AgentTemplatesModule {}
