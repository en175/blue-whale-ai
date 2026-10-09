import { Module } from "@nestjs/common";
import { AgentV1ProxyController } from "./agent-v1-proxy.controller.js";
import { AgentModelGatewayController } from "./agent-model-gateway.controller.js";
import { AgentSessionCreditsController } from "./agent-session-credits.controller.js";

@Module({
  controllers: [
    AgentV1ProxyController,
    AgentModelGatewayController,
    AgentSessionCreditsController,
  ],
})
export class AgentV1Module {}
