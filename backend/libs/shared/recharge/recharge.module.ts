import { Global, Module } from "@nestjs/common";
import { createLogger } from "@lib/core/logging";
import {
  GRANT_RETRY_WINDOW_MS_TOKEN,
  resolveGrantRetryWindowMs,
} from "./recharge-grant-sweeper.js";
import { RechargeGrantReconcileTask } from "./recharge-grant-task.js";
import { RechargeService } from "./recharge.service.js";

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
