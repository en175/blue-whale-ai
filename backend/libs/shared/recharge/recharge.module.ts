import { Global, Module } from "@nestjs/common";
import { RechargeService } from "./recharge.service.js";

/** 充值域服务：路由在 `apps/blue-whale/src/api/recharge`，业务在这里。 */
@Global()
@Module({
  providers: [RechargeService],
  exports: [RechargeService],
})
export class RechargeLibModule {}
