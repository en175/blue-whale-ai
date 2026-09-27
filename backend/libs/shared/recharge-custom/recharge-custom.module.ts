import { Global, Module } from "@nestjs/common";
import { RechargeCustomService } from "./recharge-custom.service.js";

/**
 * 自定义充值（模块 B）配置域。
 *
 * <p>做成 Global：`RechargeService.createOrder` 要读同一份配置来受理自定义充值订单，
 * 而它与本模块之间**不能互相 import 服务**（会成环）。Global 让两边都只依赖
 * `RechargeCustomService` 这一个提供者，谁也不用 import 谁。
 */
@Global()
@Module({
  providers: [RechargeCustomService],
  exports: [RechargeCustomService],
})
export class RechargeCustomLibModule {}
