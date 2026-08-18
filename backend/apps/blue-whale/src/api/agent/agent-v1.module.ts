import { Module } from "@nestjs/common";
import { AgentV1ProxyController } from "./agent-v1-proxy.controller.js";

/** Agent v1 BFF 透传代理模块（IK9DZO / S4）：/api/agent/v1/* → 独立 agent 服务 */
@Module({
  controllers: [AgentV1ProxyController],
})
export class AgentV1Module {}
