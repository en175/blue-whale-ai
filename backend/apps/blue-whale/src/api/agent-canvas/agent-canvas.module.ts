import { Module } from "@nestjs/common";

import { InternalAgentCanvasController } from "./internal-agent-canvas.controller.js";

@Module({
  controllers: [InternalAgentCanvasController],
})
export class AgentCanvasModule {}
