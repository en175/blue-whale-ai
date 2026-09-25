import { Global, Module } from "@nestjs/common";
import { DashboardService } from "./dashboard.service.js";

/** 仪表盘统计（跨本地库 + billing 的聚合）。全局模块，与 JobsModule / RechargeModule 同款。 */
@Global()
@Module({
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
