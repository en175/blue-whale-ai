import { Global, Module } from "@nestjs/common";
import { createLogger } from "@lib/core/logging";
import {
  GRANT_RETRY_WINDOW_MS_TOKEN,
  resolveGrantRetryWindowMs,
} from "./recharge-grant-sweeper.js";
import { RechargeGrantReconcileTask } from "./recharge-grant-task.js";
import { RechargeService } from "./recharge.service.js";

/**
 * 充值域服务：路由在 `apps/blue-whale/src/api/recharge`，业务在这里。
 *
 * <p>⚠️ `RechargeGrantReconcileTask` 挂在这个模块里**就是**它的开关（NestJS 没有 Spring 的
 * `@EnableScheduling`）：本模块是 `@Global()` 且被 `AppModule` 导入，于是 Nest 启动时
 * 会实例化这个 provider，它的 `OnModuleInit` 随之把计时器点着 —— 见该类注释。
 *
 * <p>⚠️ 重试窗口的 env **只在这里读一次**（下面的工厂），结果注入给两个消费者
 * （定时任务与 `RechargeService`）：用户轮询那条补发路与主动对账扫描器共用同一个窗口，
 * 各读各的 env 迟早漂成两个数 —— 见 `resolveGrantRetryWindowMs`。
 */
@Global()
@Module({
  providers: [
    {
      provide: GRANT_RETRY_WINDOW_MS_TOKEN,
      useFactory: () =>
        resolveGrantRetryWindowMs(
          process.env.RECHARGE_GRANT_RETRY_WINDOW_MS,
          createLogger("recharge-grant"),
        ),
    },
    RechargeService,
    RechargeGrantReconcileTask,
  ],
  exports: [RechargeService],
})
export class RechargeLibModule {}
