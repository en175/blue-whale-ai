import { Module } from "@nestjs/common";
import { MaterialModule } from "@lib/shared/material/material.module.js";
import { AgentAssetsController } from "./agent-assets.controller.js";
import { InternalAgentAssetsController } from "./internal-agent-assets.controller.js";

@Module({
  // IKGQWR：上传口的素材闸复用 MaterialService（代打网关 GetAsset + 状态仓库面）。
  // MaterialModule 不是 @Global 的，要显式 import——AssetModule / ProjectModule 才是全局的，
  // 本模块此前不需要 import 任何模块，正是因为它只用了那两个。
  imports: [MaterialModule],
  controllers: [AgentAssetsController, InternalAgentAssetsController],
})
export class AgentAssetsModule {}
