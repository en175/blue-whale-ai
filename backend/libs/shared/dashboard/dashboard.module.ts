import { Global, Module } from "@nestjs/common";
import { DashboardService } from "./dashboard.service.js";

@Global()
@Module({
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
