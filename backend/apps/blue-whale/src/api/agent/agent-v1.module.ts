import { Module } from "@nestjs/common";
import { AgentV1ProxyController } from "./agent-v1-proxy.controller.js";
import { AgentModelGatewayController } from "./agent-model-gateway.controller.js";

/**
 * Agent 相关代理模块：
 * - AgentV1ProxyController（IK9DZO / S4）：/api/agent/v1/* → 独立 agent 服务
 * - AgentModelGatewayController：/api/internal/agent-model/* → NewAPI（agent 服务的计费网关，
 *   见 docs/blueprint/local-minimax-newapi-debugging.md「配置业务 Agent API」）
 */
@Module({
  controllers: [AgentV1ProxyController, AgentModelGatewayController],
})
export class AgentV1Module {}
