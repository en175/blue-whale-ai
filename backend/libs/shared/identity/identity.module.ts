import { Global, Module } from "@nestjs/common";

import { IdentityService } from "./identity.service.js";

/**
 * 用户身份域。
 *
 * <p>@Global 的理由与 prisma / snapshot 等模块一致：**它被多个域依赖**
 * （me 接口要报等级、billing 调用方要拿等级做折扣），
 * 每个用到的地方都 import 一遍只会让依赖图噪声更大。
 */
@Global()
@Module({
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
