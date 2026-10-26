import { Global, Module } from "@nestjs/common";
import { RechargeCustomService } from "./recharge-custom.service.js";

@Global()
@Module({
  providers: [RechargeCustomService],
  exports: [RechargeCustomService],
})
export class RechargeCustomLibModule {}
