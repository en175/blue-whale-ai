import { Module } from "@nestjs/common";
import { AgentV1ProxyController } from "./agent-v1-proxy.controller.js";
import { AgentModelGatewayController } from "./agent-model-gateway.controller.js";
import { AgentRunCapabilityController } from "./agent-run-capability.controller.js";
import { AgentSessionCreditsController } from "./agent-session-credits.controller.js";

/**
 * Agent 相关代理模块：
 * - AgentV1ProxyController（IK9DZO / S4）：/api/agent/v1/* → 独立 agent 服务
 * - AgentModelGatewayController：/api/internal/agent-model/* → NewAPI（agent 服务的计费网关，
 *   见 docs/blueprint/local-minimax-newapi-debugging.md「配置业务 Agent API」）
 * - AgentRunCapabilityController（IK9DWX）：/api/internal/v1/runtime-capabilities/agent-runs
 *   Capability Broker，Agent 领 Run 能力券，转调 NewAPI 铸券
 * - AgentSessionCreditsController（IKAFPC）：/api/agent/billing/sessions/:id
 *   本会话累计消耗积分。刻意放在 agent/billing 而非 agent/v1 下——后者是 `@All("*path")`
 *   的透传代理，任何挂进去的路径都会被原样转发给 agent 服务。
 */
@Module({
  controllers: [
    AgentV1ProxyController,
    AgentModelGatewayController,
    AgentRunCapabilityController,
    AgentSessionCreditsController,
  ],
})
export class AgentV1Module {}
