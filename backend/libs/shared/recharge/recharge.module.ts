import { Global, Module } from "@nestjs/common";
import { RechargeGrantReconcileTask } from "./recharge-grant-task.js";
import { RechargeService } from "./recharge.service.js";

/**
 * 充值域服务：路由在 `apps/blue-whale/src/api/recharge`，业务在这里。
 *
 * <p>⚠️ `RechargeGrantReconcileTask` 挂在这个模块里**就是**它的开关（NestJS 没有 Spring 的
 * `@EnableScheduling`）：本模块是 `@Global()` 且被 `AppModule` 导入，于是 Nest 启动时
 * 会实例化这个 provider，它的 `OnModuleInit` 随之把计时器点着 —— 见该类注释。
 */
@Global()
@Module({
  providers: [RechargeService, RechargeGrantReconcileTask],
  exports: [RechargeService],
})
export class RechargeLibModule {}
