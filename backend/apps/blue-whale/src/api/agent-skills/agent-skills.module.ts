import { Module } from "@nestjs/common";
import { InternalAgentSkillsController } from "./internal-agent-skills.controller.js";

@Module({
  controllers: [InternalAgentSkillsController],
})
export class AgentSkillsModule {}
