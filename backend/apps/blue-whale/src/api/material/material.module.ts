import { Module } from "@nestjs/common";
import { MaterialService } from "@lib/shared/material/material.service.js";
import { MaterialController } from "./material.controller.js";

@Module({
  controllers: [MaterialController],
  providers: [MaterialService],
  // IKF YHJ：生成创建期的素材校验门复用 MaterialService（代打网关 GetAsset + 状态仓库面）。
  exports: [MaterialService],
})
export class MaterialApiModule {}
