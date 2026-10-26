import { Module } from "@nestjs/common";
import { AgentV1ProxyController } from "./agent-v1-proxy.controller.js";
import { AgentModelGatewayController } from "./agent-model-gateway.controller.js";

@Module({
  controllers: [
    AgentV1ProxyController,
    AgentModelGatewayController,
  ],
})
export class AgentV1Module {}
